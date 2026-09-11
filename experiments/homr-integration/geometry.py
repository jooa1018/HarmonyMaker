"""Recover source geometry from unchanged homr debug masks and token provenance.

No score reference is read. Attention points remain estimates. Replayed crop pixels
must match the engine's saved staff input before any coordinate correspondence is used.
"""
from pathlib import Path
from xml.etree import ElementTree as ET
import json,hashlib,sys
import cv2,numpy as np

def sha(data):return hashlib.sha256(data).hexdigest()
def write(path,data):path.write_text(json.dumps(data,indent=2,default=lambda v:v.tolist() if isinstance(v,np.ndarray) else v.item() if isinstance(v,np.generic) else str(v)),encoding='utf-8')

def replay_geometry(compare, cache, out):
    sys.path.insert(0,str(compare/'homr-source'))
    import homr.main as main
    import homr.staff_parsing as sp
    from homr.model import InputPredictions
    from homr.debug import Debug
    from homr.staff_regions import StaffRegions
    from homr.staff_dewarping import PiecewiseAffineTransform
    from homr.image_utils import crop_image_and_return_new_top as crop
    out.mkdir(parents=True,exist_ok=True)
    def replay(*args):
        masks={name:(cv2.imread(str(next(cache.glob('*_debug_*_'+name+'.png'))),cv2.IMREAD_GRAYSCALE)>127).astype(np.uint8) for name in ['notehead','symbols','staff','clefs_keys','stems_rest']}
        original=cv2.imread(str(cache/'resize_image.png'))
        preprocessed=cv2.imread(str(next(cache.glob('*_debug_*_color_adjust.png'))),cv2.IMREAD_UNCHANGED)
        pred=InputPredictions(original,preprocessed,**masks)
        return pred,Debug(original,str(out/'input.png'),True)
    main.load_and_preprocess_predictions=replay
    detected_bars=[]; old_bars=main.detect_bar_lines
    def collect_bars(*args,**kwargs):
        found=old_bars(*args,**kwargs);detected_bars.extend(found);return found
    main.detect_bar_lines=collect_bars
    config=main.ProcessingConfig(True,False,False,False,-1,False,False,False,False)
    try:multi,image,debug,_,_=main.detect_staffs_in_image(str(cache/'input.png'),config)
    finally:main.detect_bar_lines=old_bars
    multi=sp._ensure_same_number_of_staffs(multi)
    if any(len(m.staffs)!=1 for m in multi):raise ValueError('Prototype only accepts single-staff systems; multi-staff remains unresolved.')
    regions=StaffRegions(multi);result=[]
    original_shape=json.loads((cache/'input-transforms.json').read_text())[0]['beforeShape']
    transforms=json.loads((cache/'input-transforms.json').read_text())
    if transforms[0]['beforeShape']!=transforms[0]['afterShape']:raise ValueError('Autocrop translation was not saved; cannot claim original coordinates.')
    page_scale=np.array([original_shape[1]/image.shape[1],original_shape[0]/image.shape[0]])
    for i,ms in enumerate(multi):
        staff=ms.staffs[0];region=sp._calculate_region(staff,regions)
        dims=sp.get_tr_omr_canvas_size((int(region[3]-region[1]),int(region[2]-region[0])))
        scaling=dims[1]/(region[3]-region[1]);scaled_size=(int(image.shape[1]*scaling),int(image.shape[0]*scaling))
        resized=cv2.resize(image,scaled_size);actual_scale=np.array(scaled_size)/np.array([image.shape[1],image.shape[0]])
        scaled_region=np.round(region*scaling)
        first,top1=crop(resized,*(scaled_region+np.array([-10,-50,10,50])))
        region2=scaled_region-np.array([*top1,*top1])
        moved=sp._dewarp_staff(staff,None,top1/scaling,scaling)
        dewarp=sp.dewarp_staff_image(first,moved,i,debug)
        warped=dewarp.dewarp(first);second,top2=crop(warped,*region2)
        clean=sp.remove_black_contours_at_edges_of_image(second.copy(),moved.average_unit_size)
        canvas=sp.center_image_on_canvas(clean,dims)
        encoded=cv2.imencode('.jpg',canvas)[1].tobytes();old=(cache/f'input_staff-{i}_input.jpg').read_bytes()
        exact=sha(encoded)==sha(old)
        # Reproduction identity is stronger than matching only dimensions or staff count.
        if not exact:raise ValueError(f'Staff {i}: recreated raster differs from saved inference raster; coordinate mapping rejected.')
        inverse=None
        if dewarp.tform is not None:
            inverse=PiecewiseAffineTransform();inverse.estimate(dewarp.tform.dst_points,dewarp.tform.src_points)
        center_scale=np.array(dims)/np.array([second.shape[1],second.shape[0]])
        offset=np.array([0,(sp.tr_omr_max_height-int(dims[1]))//2])
        def forward(point):
            raw=np.array(point)*actual_scale-top1
            return (np.array(dewarp.dewarp_point(tuple(raw)))-top2)*center_scale+offset
        def back(point):
            raw=(np.array(point)-offset)/center_scale+top2
            if inverse:raw=np.array(inverse.transform_point(tuple(raw)))
            return (raw+top1)/actual_scale*page_scale
        raw_tokens=json.loads((cache/f'raw-staff-{i}-symbols.json').read_text())[0]
        tokens=[]
        for n,t in enumerate(raw_tokens):
            f=t['fields'];coord=f.get('coordinates')
            tokens.append({'tokenIndex':n,'text':t['text'],'fields':{k:v for k,v in f.items() if k!='_duration'},'attentionCanvas':coord,'attentionOriginal':back(coord).tolist() if coord and np.isfinite(coord).all() else None,'coordinateStatus':'attention-estimate-not-confirmed'})
        symbols=[]
        for n,s in enumerate(staff.symbols):
            center=np.array(s.center);box=getattr(s,'box',None)
            row={'id':f's{i}-g{n}','type':type(s).__name__,'center':(center*page_scale).tolist(),'canvasCenter':forward(center).tolist()}
            if box is not None:
                poly=np.asarray(box.polygon);row['polygon']=(poly*page_scale).tolist();row['size']=(np.array(box.size)*page_scale).tolist()
            if hasattr(s,'position'):
                row['staffPosition']=int(s.position)
                line_y=np.array(staff.get_at(float(center[0])).y);space=float(np.median(np.diff(line_y)))
                # A notehead can distort one segmented line; fit the regular five-line lattice
                # by medians, retaining the measured lines and residuals for review.
                intercept=float(np.median(line_y-np.arange(5)*space));fitted=intercept+np.arange(5)*space
                row['pixelStaffPosition']=float(1+(fitted[-1]-center[1])/(space/2))
                row['staffGridResidualPixels']=(np.abs(line_y-fitted)*page_scale[1]).tolist()
                row['sourceStaffLinesAtX']=(line_y*page_scale[1]).tolist()
            if getattr(s,'stem',None) is not None:row['stemPolygon']=(np.asarray(s.stem.polygon)*page_scale).tolist()
            if getattr(s,'stem_direction',None) is not None:row['stemDirection']=s.stem_direction.name
            symbols.append(row)
        for n,box in enumerate(detected_bars):
            cx,cy=box.center
            if not staff.min_x-staff.average_unit_size<=cx<=staff.max_x+staff.average_unit_size:continue
            at=staff.get_at(cx);poly=np.asarray(box.polygon)
            if poly[:,1].min()>at.y[0]+staff.average_unit_size*0.5 or poly[:,1].max()<at.y[-1]-staff.average_unit_size*0.5:continue
            symbols.append({'id':f's{i}-bar{n}','type':'BarLine','center':(np.array(box.center)*page_scale).tolist(),'polygon':(poly*page_scale).tolist(),'canvasCenter':forward(box.center).tolist(),'source':'unchanged homr detect_bar_lines, spanning staff corroborated'})
        x=(staff.min_x+staff.max_x)/2;at=staff.get_at(x)
        roundtrip=max((float(np.linalg.norm(back(forward(s.center))-np.array(s.center)*page_scale)) for s in staff.symbols),default=0)
        if roundtrip>0.5:raise ValueError('Coordinate inverse round trip exceeds half an original pixel')
        result.append({'page':0,'systemIndex':i,'staffIndex':0,'originalImageSize':[original_shape[1],original_shape[0]],'bounds':[staff.min_x*page_scale[0],staff.min_y*page_scale[1],staff.max_x*page_scale[0],staff.max_y*page_scale[1]],'lines':(np.array(at.y)*page_scale[1]).tolist(),'spacing':float(staff.average_unit_size*page_scale[1]),'symbols':symbols,'tokens':tokens,'transform':{'cachedCanvasSha256':sha(old),'recreatedCanvasSha256':sha(encoded),'exactPixelReplay':exact,'maxSymbolRoundTripErrorPixels':roundtrip,'pageScale':page_scale.tolist(),'resizeScale':actual_scale.tolist(),'crop1':top1.tolist(),'crop2':top2.tolist(),'canvasScale':center_scale.tolist(),'canvasOffset':offset.tolist(),'dewarpSource':dewarp.tform.src_points.tolist() if dewarp.tform else None,'dewarpDestination':dewarp.tform.dst_points.tolist() if dewarp.tform else None}})
    write(out/'source-geometry.json',{'source':'homr cached segmentation and geometric staff detection; original raster coordinate units; no oracle','systems':result})
    return result

def traced_xml(compare,cache,out):
    sys.path.insert(0,str(compare/'homr-source'))
    import homr.music_xml_generator as gen
    from homr.transformer.vocabulary import EncodedSymbol
    snapshot=json.loads((cache/'symbols-before-xml.json').read_text());voices=[];trace={}
    for pi,rows in enumerate(snapshot['voices']):
        symbols=[];system=0
        for ti,row in enumerate(rows):
            fields=row['fields'];s=EncodedSymbol(**{k:v for k,v in fields.items() if k!='_duration'})
            s._trace=f'p{pi}-t{ti}';trace[s._trace]={'part':pi,'tokenIndex':ti,'systemIndex':system,'fields':fields}
            if s.rhythm=='newline':system+=1
            symbols.append(s)
        voices.append(symbols)
    old=gen.build_note_or_rest
    def observed(symbol,*args,**kwargs):
        n=old(symbol,*args,**kwargs);tag=getattr(symbol,'_trace',None)
        if tag:n.set('data-hm-token',tag)
        return n
    gen.build_note_or_rest=observed
    root=gen.generate_xml(gen.XmlGeneratorArguments(),voices,snapshot['title'])
    gen.build_note_or_rest=old
    original=ET.parse(cache/'input.musicxml').getroot();orig_parts=original.findall('part');parts=root.findall('part')
    assert len(parts)==len(orig_parts)
    events=[]
    for pi,(a,b) in enumerate(zip(parts,orig_parts,strict=True)):
        am=a.findall('measure');bm=b.findall('measure');assert len(am)==len(bm)
        for mi,(m,om) in enumerate(zip(am,bm,strict=True)):
            an=m.findall('note');bn=om.findall('note');assert len(an)==len(bn)
            for ni,(n,on) in enumerate(zip(an,bn,strict=True)):
                tag=n.attrib.pop('data-hm-token',None)
                if ET.tostring(n)!=ET.tostring(on):raise ValueError('Cached XML generation differs from engine output')
                events.append({'id':f'd0p{pi}m{mi}n{ni}','partIndex':pi,'measureIndex':mi,'noteIndex':ni,'trace':trace.get(tag),'provenanceStatus':'exact-generator-trace' if tag else 'missing-token-trace'})
    if ET.tostring(root)!=ET.tostring(original):raise ValueError('Cached XML replay is not identical')
    write(out/'token-event-provenance.json',{'xmlExactReplay':True,'events':events})
    return events

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('compare',type=Path);ap.add_argument('cache',type=Path);ap.add_argument('out',type=Path);v=ap.parse_args()
    rows=replay_geometry(v.compare,v.cache,v.out);traced_xml(v.compare,v.cache,v.out)
    print(json.dumps({'systems':len(rows),'exactCanvasReplay':True,'exactXmlReplay':True,'out':str(v.out)}))
