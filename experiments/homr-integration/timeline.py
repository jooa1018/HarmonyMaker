"""Automatic timeline candidates, v1. No reference score or correction input.

Only time declarations and MusicXML implicit may change. Geometry/OCR scores
are heuristics, never calibrated confidence or a user's acceptance.
"""
from fractions import Fraction as F
from xml.etree import ElementTree as E
from collections import defaultdict
import copy

VERSION = 'hm-automatic-timeline-v1'


def extent(m):
    return max([F(e['onset']) + F(e['duration']) for e in m['events']] + [F(0)])


def continuous(m):
    """Deliberately limited: polyphony/backup/gaps need independent review."""
    if len({e['voice'] for e in m['events']}) != 1:
        return False
    if any(n.tag in ('backup', 'forward') for n in m['element']):
        return False
    cursor = F(0)
    for e in m['events']:
        if F(e['onset']) != cursor or F(e['duration']) <= 0:
            return False
        cursor += F(e['duration'])
    return True


def closed_beam_group(m):
    """A single fully closed group supplies more than 'last note ends early'."""
    if len(m['events']) < 2:
        return False
    beams = [e['element'].findtext('beam[@number="1"]') for e in m['events']]
    return beams[0]=='begin' and beams[-1]=='end' and all(b=='continue' for b in beams[1:-1])


def pickup_beam_pixels(frame, m, s, links, physical):
    """Corroborate a closed short group using source ink, not inferred extent."""
    import numpy as np
    import cv2
    if not physical.get('supported') or len(m['events']) < 2 or any(e['kind']!='note' for e in m['events']):
        return {'supported':False,'reason':'non-pitched/incomplete group'}
    gs=[links[e['id']]['geometry'] for e in m['events']]
    sp=s['spacing'];xs=[g['center'][0]for g in gs];ys=[g['center'][1]for g in gs]
    if xs!=sorted(xs) or max(b-a for a,b in zip(xs,xs[1:]))>3.5*sp:
        return {'supported':False,'reason':'large interior gap or reverse source order'}
    x0=max(0,int(min(xs)-sp));x1=min(frame.width,int(max(xs)+1.5*sp))
    y0=max(0,int(min(ys)-7*sp));y1=min(frame.height,int(max(ys)+sp))
    # Thin antialiased stems can be lighter than the notehead threshold. Keep
    # their observed pixels; no interpolated/dilated stem is allowed.
    ink=(np.asarray(frame.convert('L'))<210).astype('uint8')
    clean=ink-cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((1,max(5,int(sp*5))),np.uint8))
    # Retain original vertical stem pixels at staff intersections; do not
    # invent a bridge by generic dilation/closing.
    clean |= cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((max(3,int(sp*1.5)),1),np.uint8))
    crop=clean[y0:y1,x0:x1]
    count,labels,stats,_=cv2.connectedComponentsWithStats(crop,8)
    components=[]
    for x,y in zip(xs,ys):
        patch=labels[max(0,int(y-y0-.45*sp)):int(y-y0+.45*sp)+1,max(0,int(x-x0-.45*sp)):int(x-x0+.45*sp)+1]
        values,counts=np.unique(patch[patch>0],return_counts=True)
        if not len(values):return {'supported':False,'reason':'source notehead ink component absent'}
        components.append(int(values[np.argmax(counts)]))
    if len(set(components))!=1:return {'supported':False,'reason':'source noteheads are not in one beam/stem component'}
    mask=(labels==components[0]).astype('uint8')
    horizontals=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((1,max(3,int((max(xs)-min(xs))*.7))),np.uint8))
    # A curve at the heads is insufficient: a beam must be above the heads.
    band=horizontals[:max(0,int(min(ys)-y0-1.5*sp))]
    supported=bool(band.sum()>=sp*2)
    return {'supported':supported,'reason':'unique notehead/stem ink component with spanning horizontal beam above heads' if supported else 'no spanning beam above heads',
            'sourceBox':[x0,y0,x1,y1],'componentArea':int(stats[components[0],cv2.CC_STAT_AREA]),'beamPixels':int(band.sum())}


def physical_intervals(measures, systems, links):
    """A separate strict timing correspondence; never rewrite original links."""
    result = {}
    for m in measures:
        s = next((s for s in systems if s['systemIndex'] == m['systemIndex']), None)
        row = {'measureId': m['id'], 'supported': False, 'reason': 'incomplete unique glyph coverage'}
        result[m['id']] = row
        if s is None:
            continue
        sp = s['spacing']
        boundaries = []
        for x in sorted([s['bounds'][0], s['bounds'][2]] + [g['center'][0] for g in s['symbols'] if g['type'] == 'BarLine']):
            if boundaries and x - boundaries[-1] < .8 * sp:
                boundaries[-1] = (boundaries[-1] + x) / 2
            else:
                boundaries.append(x)
        pitched = [e for e in m['events'] if e['kind'] == 'note']
        good = [links.get(e['id'], {}) for e in pitched]
        if not good or any(r.get('status') != 'physical-candidate' or r.get('geometry', {}).get('type') != 'Note' for r in good):
            continue
        used = [r['geometry']['id'] for r in good]
        if len(used) != len(set(used)):
            continue
        assignments = {next((i for i in range(len(boundaries)-1) if boundaries[i] < r['geometry']['center'][0] < boundaries[i+1]), None) for r in good}
        if len(assignments) != 1 or None in assignments:
            continue
        bi = next(iter(assignments)); left, right = boundaries[bi:bi+2]
        glyphs = [g for g in s['symbols'] if g['type'] == 'Note' and left < g['center'][0] < right]
        if {g['id'] for g in glyphs} != set(used):
            row['reason'] = 'unmatched source note glyph in interval'; continue
        # Every rest needs a replayed token. No invented coverage for absent rests.
        rests = [e for e in m['events'] if e['kind'] == 'rest']
        rest_links = [links.get(e['id'], {}) for e in rests]
        if any(not r.get('token') or not r.get('attentionEstimate') for r in rest_links):
            row['reason'] = 'rest token correspondence missing'; continue
        right_tokens = [t for t in s['tokens'] if ('barline' in t['fields']['rhythm'] or t['fields']['rhythm'].startswith('repeat')) and t.get('attentionOriginal') and abs(t['attentionOriginal'][0]-right) <= 2*sp]
        edge = abs(right-s['bounds'][2]) < sp
        if not right_tokens and not edge:
            row['reason'] = 'right boundary uncorroborated'; continue
        xs = [r['geometry']['center'][0] for r in good] + [r['attentionEstimate'][0] for r in rest_links]
        if any(not left < x < right for x in xs):
            row['reason'] = 'event token lies outside source interval'; continue
        row.update(supported=True, sourceBox=[left, s['bounds'][1], right, s['bounds'][3]],
                   eventIds=[e['id'] for e in m['events']], firstX=min(xs), lastX=max(xs),
                   tailSpaces=(right-max(xs))/sp, firstInterval=bi == 0, lastInterval=bi == len(boundaries)-2,
                   rightBoundaryTokens=[t['fields']['rhythm'] for t in right_tokens],
                   reason='all pitched glyphs bijective; rests have exact replay tokens; physical boundary corroborated')
    groups = defaultdict(list)
    for m in measures:
        r = result[m['id']]
        if r['supported']:
            groups[(m['systemIndex'], tuple(r['sourceBox']))].append(r)
    for rows in groups.values():
        if len(rows) > 1:
            for r in rows:
                r.update(supported=False, reason='multiple XML intervals claim same physical region')
    return result


def detect_meters(frame, systems, measures, physical, ocr):
    """Model supplies location+denominator, pixels independently support numerator.

    Equal upper/lower glyphs can corroborate the token denominator. Otherwise
    require existing OCR hypotheses to agree on the upper numeral. A token
    alone, a short event extent, or text outside the staff is never sufficient.
    """
    import numpy as np
    import cv2
    from PIL import Image, ImageOps
    frame = frame.convert('L')
    ink = (np.asarray(frame) < 160).astype('uint8')
    rows = []
    def normal(mask):
        ys, xs = np.where(mask)
        if len(xs) < 8:
            return None
        crop = mask[ys.min():ys.max()+1, xs.min():xs.max()+1]
        if crop.shape[1] < .4*crop.shape[0]:
            return None  # barline / stem / numeral 1 needs separate evidence
        return cv2.resize(crop, (24, 32), interpolation=cv2.INTER_NEAREST)
    for s in systems:
        sp = s['spacing']; top, bottom = s['lines'][0], s['lines'][-1]; mid = (top+bottom)/2
        clean = ink - cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones((1, max(5, int(sp*5))), np.uint8))
        band = clean[int(top):int(bottom)+1, int(s['bounds'][0]):int(s['bounds'][2])+1]
        active = np.flatnonzero(band.sum(axis=0) > sp*.45); runs = []
        for x in active:
            if runs and x-runs[-1][-1] <= max(2, int(sp*.25)):
                runs[-1].append(int(x))
            else:
                runs.append([int(x)])
        for ti, token in enumerate(s['tokens']):
            rhythm = token['fields'].get('rhythm', '')
            if not rhythm.startswith('timeSignature/'):
                continue
            row = {'feature': 'meter', 'ruleVersion': VERSION, 'tokenId': f"s{s['systemIndex']}t{ti}",
                   'systemIndex': s['systemIndex'], 'status': 'unresolved', 'reviewRequired': True,
                   'token': copy.deepcopy(token), 'reason': 'no unique stacked numeral/interval correspondence'}
            rows.append(row)
            den = rhythm.split('/')[-1]
            if den not in ('1', '2', '4', '8', '16') or not token.get('attentionOriginal'):
                continue
            tx = token['attentionOriginal'][0]
            options = []
            for run in runs:
                x0 = run[0]+int(s['bounds'][0]); x1 = run[-1]+int(s['bounds'][0])+1; x = (x0+x1)/2
                if not .5*sp <= x1-x0 <= 2.1*sp or abs(x-tx) > 1.5*sp:
                    continue
                if any(g['type']=='Note' and abs(g['center'][0]-x) < .9*sp for g in s['symbols']):
                    continue
                hits = [(m, physical[m['id']]) for m in measures if m['systemIndex']==s['systemIndex'] and physical[m['id']]['supported'] and physical[m['id']]['sourceBox'][0] < x < physical[m['id']]['sourceBox'][2] and x < physical[m['id']]['firstX']]
                if len(hits) != 1:
                    continue
                upper = clean[int(top):int(mid), x0:x1]; lower = clean[int(mid):int(bottom)+1, x0:x1]
                if upper.sum() < sp*2 or lower.sum() < sp*2:
                    continue
                a, b = normal(upper), normal(lower)
                if a is None or b is None:
                    continue
                intersection = float((a & b).sum()); union = float((a | b).sum())
                similarity = intersection/union if union else 0
                reads = []; numerator = None
                if similarity >= .78:
                    numerator = int(den)
                else:
                    # A source digit is not inferred from bar duration or expected transitions.
                    box = (max(0,x0-2), round(top), min(frame.width,x1+2), round(mid))
                    variants = {'source': frame.crop(box), 'staffRemoved': Image.fromarray(255-clean[box[1]:box[3],box[0]:box[2]]*255)}
                    def read(variant, oem, psm):
                        crop = variants[variant]
                        crop = ImageOps.expand(crop.resize((crop.width*6,crop.height*6)),20,fill=255)
                        words = ocr.recognize(crop,psm=psm,oem=oem,whitelist='0123456789') if ocr else []
                        reads.append({'variant':variant,'oem':oem,'psm':psm,'words':words})
                        values = [int(w['text']) for w in words if w['text'].isdigit() and w['confidence']>=40 and 1<=int(w['text'])<=16]
                        return values[0] if len(values)==1 else None
                    a_value = read('source',1,6)
                    b_value = read('staffRemoved',0,10)
                    # Legacy fallback only when the source LSTM abstains. It
                    # still needs agreement across original and cleaned pixels.
                    if a_value is None:
                        a_value = read('source',0,10)
                    if a_value is not None and a_value==b_value:
                        numerator = a_value
                m, region = hits[0]
                options.append({'measureId': m['id'], 'measureIndex': m['measureIndex'], 'sourceBox': [x0, int(top), x1, int(bottom)+1],
                    'value': [numerator, int(den)] if numerator else None, 'glyphIoU': similarity,
                    'scoreMeaning': 'uncalibrated normalized binary glyph intersection-over-union', 'reads': reads,
                    'evidence': ['existing denominator token at source x', 'two stacked glyphs within five staff lines',
                                 'unique physical interval before all event columns', 'same-image glyph agreement or original/cleaned OCR agreement for numerator']})
            row['options'] = options
            if len(options) == 1:
                row.update(options[0])
                if row['value']:
                    row.update(status='supported-candidate', reason='independent pixel numerator and replayed denominator token agree')
    # Multiple tokens at one location are ambiguity, not two printed signatures.
    groups = defaultdict(list)
    for r in rows:
        if r['status']=='supported-candidate':
            groups[r['measureId']].append(r)
    for group in groups.values():
        if len(group)>1:
            for r in group:
                r.update(status='unresolved', reason='duplicate/conflicting time tokens for same interval')
    return rows


def resolve(root, meter_candidates, physical):
    """Pure resolver. Synthetic evidence tests do not count as image recognition."""
    from score import observe
    measures, _ = observe(root); decisions = []; changes = []
    by_id = {m['id']: m for m in measures}
    claims = defaultdict(int)
    for c in meter_candidates:
        if c.get('status') == 'supported-candidate':
            claims[c.get('measureId')] += 1
    for candidate in meter_candidates:
        row = copy.deepcopy(candidate); decisions.append(row)
        if row.get('status') != 'supported-candidate':
            continue
        if claims[row.get('measureId')] != 1:
            row.update(status='unresolved', reason='multiple meter claims'); continue
        m = by_id.get(row.get('measureId')); value = row.get('value')
        if not m or not value or not all(isinstance(v, int) and v > 0 for v in value):
            row.update(status='unresolved', reason='invalid target/value'); continue
        old = m['element'].findall('attributes/time')
        before = [E.tostring(t, encoding='unicode') for t in old]
        if len(old)==1 and old[0].findtext('beats')==str(value[0]) and old[0].findtext('beat-type')==str(value[1]):
            row.update(status='unchanged-candidate', reason='matching single printed declaration already present'); continue
        attrs = m['element'].find('attributes')
        if attrs is None:
            attrs = E.Element('attributes'); m['element'].insert(0, attrs)
        for a in m['element'].findall('attributes'):
            for t in a.findall('time'):
                a.remove(t)
        t = E.SubElement(attrs, 'time'); E.SubElement(t, 'beats').text=str(value[0]); E.SubElement(t, 'beat-type').text=str(value[1])
        row.update(status='applied-candidate', before=before, after=E.tostring(t, encoding='unicode'), impact='meter context until next explicit declaration')
        changes.append({**row, 'feature':'meter', 'reviewRequired':True})
    measures, _ = observe(root)
    def mark(m, reason, evidence):
        before = m['element'].get('implicit')
        row = {'feature':'timeline-extent', 'ruleVersion':VERSION, 'measureId':m['id'], 'measureIndex':m['measureIndex'],
               'before': before, 'after':'<implicit value="yes" />', 'extent':str(extent(m)), 'reason':reason,
               'evidence':copy.deepcopy(evidence), 'reviewRequired':True, 'impact':'following absolute times until end of part',
               'status':'unchanged-candidate' if before=='yes' else 'applied-candidate'}
        decisions.append(row)
        if before!='yes':
            m['element'].set('implicit', 'yes'); changes.append(row)
    for i, m in enumerate(measures):
        if not m['meter'] or not all(str(v).isdigit() for v in m['meter']):
            continue
        nominal = F(int(m['meter'][0])*4, int(m['meter'][1])); end = extent(m)
        if end==nominal:
            continue
        p = physical.get(m['id'], {}); reason = 'short interval lacks independent duration/continuation evidence'
        # Initial pickup: two or more unique pitched glyphs, exact token lineage,
        # no inferred rests, no secondary voice, no unexplained trailing space.
        eligible = p.get('supported') and continuous(m) and 0 < end < nominal and p.get('tailSpaces', 999) <= 4
        no_boundary = m['element'].find('barline/repeat') is None and m['element'].find('barline/ending') is None
        if m['measureIndex']==0 and eligible and no_boundary and (closed_beam_group(m) or p.get('pickupBeamPixels',{}).get('supported')) and all(e['kind']=='note' for e in m['events']) and p.get('firstInterval') and end <= nominal/2:
            mark(m, 'initial short contiguous pitched group with bijective source glyphs and packed right boundary', p)
            continue
        # A matching cross-system tie plus geometry can distinguish continuation
        # from independent short measures. Complementary lengths alone never do.
        if i+1 < len(measures):
            n = measures[i+1]; q = physical.get(n['id'], {})
            last = m['events'][-1] if m['events'] else None; first = n['events'][0] if n['events'] else None
            tied = last and first and last['kind']=='note' and first['kind']=='note' and last['element'].find('tie[@type="start"]') is not None and first['element'].find('tie[@type="stop"]') is not None and E.tostring(last['element'].find('pitch')) == E.tostring(first['element'].find('pitch'))
            separating = any(b.find('repeat') is not None or b.find('ending') is not None or b.findtext('bar-style', 'regular') not in ('regular', 'none') for b in m['element'].findall('barline'))
            if eligible and no_boundary and not separating and tied and n['partIndex']==m['partIndex'] and n['systemIndex']==m['systemIndex']+1 and n['meter']==m['meter'] and p.get('lastInterval') and q.get('firstInterval') and q.get('supported') and q.get('tailSpaces',999)<=4 and continuous(n) and 0 < extent(n) < nominal and end+extent(n)==nominal:
                mark(m, 'cross-system complementary fragment with explicit matching tie and independent source coverage', {'left':p,'right':q,'partner':n['id']})
                mark(n, 'continuation of preceding tied fragment; displayed IDs retained', {'left':p,'right':q,'partner':m['id']})
                continue
        if m['element'].get('implicit')=='yes':
            continue
        if end > nominal:
            reason = 'overfull existing events; cannot repair duration by clipping or changing voices'
        elif not p.get('supported'):
            reason = p.get('reason', 'automatic source correspondence absent')
        elif not continuous(m):
            reason = 'polyphony, cursor gap or overlapping events'
        decisions.append({'feature':'timeline-extent', 'ruleVersion':VERSION, 'measureId':m['id'], 'measureIndex':m['measureIndex'],
                          'status':'unresolved', 'nominal':str(nominal), 'extent':str(end), 'reason':reason, 'reviewRequired':True, 'evidence':copy.deepcopy(p)})
    return {'version':VERSION, 'decisions':decisions, 'changes':changes, 'runtimeReferenceUsed':False,
            'sourceApproved':False, 'policy':'automatic candidates require source comparison; no event changes; no retroactive workspace edits'}


def reconstruct(root, frame, systems, links, ocr):
    from score import observe
    measures, _ = observe(root)
    physical = physical_intervals(measures, systems, links)
    for m in measures:
        if m['measureIndex']==0:
            s=next((s for s in systems if s['systemIndex']==m['systemIndex']),None)
            if s:physical[m['id']]['pickupBeamPixels']=pickup_beam_pixels(frame,m,s,links,physical[m['id']])
    meters = detect_meters(frame, systems, measures, physical, ocr)
    result = resolve(root, meters, physical)
    result['physicalIntervals'] = physical
    return result
