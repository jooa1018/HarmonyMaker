"""Self-authored held-out raster. This file is never imported by recognition."""
from pathlib import Path
from xml.etree import ElementTree as E
import argparse,json
import verovio

def create(out):
    out.mkdir(parents=True,exist_ok=False)
    root=E.Element('score-partwise',version='4.0')
    def sub(p,t,val=None,**attrs):
        e=E.SubElement(p,t,attrs)
        if val is not None:e.text=str(val)
        return e
    sub(root,'movement-title','Holdout: Turning Path')
    sp=sub(sub(root,'part-list'),'score-part',id='P1');sub(sp,'part-name','Voice');p=sub(root,'part',id='P1')
    def measure(num,meter=None,new=False):
        m=sub(p,'measure',number=str(num))
        if new:sub(m,'print',**{'new-system':'yes'})
        if num==1 or meter:
            a=sub(m,'attributes')
            if num==1:sub(a,'divisions',4);sub(sub(a,'key'),'fifths',1)
            if meter:t=sub(a,'time');sub(t,'beats',meter[0]);sub(t,'beat-type',meter[1])
            if num==1:c=sub(a,'clef');sub(c,'sign','G');sub(c,'line',2)
        return m
    def harmony(m,r,kind='major',bass=None):
        h=sub(m,'harmony');sub(sub(h,'root'),'root-step',r);sub(h,'kind',kind,text='m' if kind=='minor' else '')
        if bass:b=sub(h,'bass');sub(b,'bass-step',bass[0]);sub(b,'bass-alter',1 if '#' in bass else 0)
    def note(m,pitch,dur,typ,lyric=None,syllabic='single',verse2=None,extend=False,beam=None,voice=1,slash=False,dot=False):
        n=sub(m,'note')
        if slash:u=sub(n,'unpitched');sub(u,'display-step','B');sub(u,'display-octave',4)
        elif pitch is None:sub(n,'rest')
        else:
            pp=sub(n,'pitch');sub(pp,'step',pitch[0])
            if '#' in pitch:sub(pp,'alter',1)
            sub(pp,'octave',pitch[-1])
        sub(n,'duration',dur);sub(n,'voice',voice);sub(n,'type',typ)
        if dot:sub(n,'dot')
        sub(n,'stem','up' if voice==1 else 'down')
        if slash:sub(n,'notehead','slash')
        if beam:sub(n,'beam',beam,number='1')
        if lyric:
            l=sub(n,'lyric',number='1');sub(l,'syllabic',syllabic);sub(l,'text',lyric)
            if extend:sub(l,'extend')
        if verse2:l=sub(n,'lyric',number='2');sub(l,'syllabic','single');sub(l,'text',verse2)
    m=measure(1,(3,4));harmony(m,'G')
    d=sub(m,'direction',placement='above');mt=sub(sub(d,'direction-type'),'metronome');sub(mt,'beat-unit','quarter');sub(mt,'per-minute',96);sub(d,'sound',tempo='96')
    note(m,'G4',2,'eighth','Be','begin','We',beam='begin');note(m,'A4',2,'eighth','gin','end','walk',beam='end');note(m,'B4',6,'quarter','slow',extend=True,dot=True);note(m,'A4',2,'eighth')
    m=measure(2);harmony(m,'D',bass='F#');note(m,'F#4',4,'quarter','and');note(m,'A4',4,'quarter','turn');note(m,'D5',4,'quarter','home')
    m=measure(3,(6,8),new=True);harmony(m,'E','minor')
    for i,pitch in enumerate(['E5','D5','B4','A4','G4','F#4']):note(m,pitch,2,'eighth',['One','new','path','to','the','hill'][i],beam='begin' if i%3==0 else 'end' if i%3==2 else 'continue')
    m=measure(4);harmony(m,'D')
    for i in range(6):note(m,None,2,'eighth',slash=True,beam='begin' if i%3==0 else 'end' if i%3==2 else 'continue')
    sub(sub(m,'backup'),'duration',12);note(m,'D4',12,'half',voice=2,dot=True)
    m=measure(5);harmony(m,'G');note(m,'G4',12,'half','Stay',dot=True)
    E.indent(root);xml=E.tostring(root,encoding='unicode');(out/'holdout.reference.musicxml').write_text(xml,encoding='utf-8')
    tk=verovio.toolkit();tk.setOptions({'pageWidth':2300,'pageHeight':2000,'scale':65,'breaks':'encoded','adjustPageHeight':True,'header':'auto','footer':'none','spacingStaff':16,'spacingSystem':16})
    assert tk.loadData(xml);assert tk.getPageCount()==1
    (out/'holdout.svg').write_text(tk.renderToSVG(1),encoding='utf-8');(out/'render.json').write_text(json.dumps({'engine':tk.getVersion(),'options':tk.getOptions(),'authorship':'new self-authored holdout after integration rule freeze; raster only is recognition input'},indent=2),encoding='utf-8')

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('out',type=Path);create(a.parse_args().out)
