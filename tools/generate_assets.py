"""Original code-drawn pixel art and synthesized audio; no external art dependencies."""
from pathlib import Path
from PIL import Image, ImageDraw
import random, math, wave, struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'app/src/main/assets'
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(20261102)

def save(im, name): im.save(OUT / name)

tiles = Image.new('RGBA', (256, 64))
d = ImageDraw.Draw(tiles)
for idx in range(64):
    ox, oy = (idx % 16)*16, (idx//16)*16
    path = idx >= 32
    base = (80, 76, 55) if path else ((24, 57, 43) if idx < 16 else (27, 62, 45))
    d.rectangle((ox,oy,ox+15,oy+15),fill=base)
    for j in range(17):
        x,y=ox+rng.randrange(16),oy+rng.randrange(16)
        c = rng.choice([(95,87,60),(64,66,48),(106,94,64)]) if path else rng.choice([(34,72,48),(39,77,49),(20,49,39),(31,65,44)])
        d.rectangle((x,y,min(x+1,ox+15),y),fill=c)
    if not path and idx%3==0:
        x,y=ox+rng.randrange(3,13),oy+rng.randrange(5,13)
        d.line((x,y,x-1,y-3),fill='#3e6541');d.point((x+1,y-2),fill='#6b8048')
save(tiles,'tiles.png')

actors = Image.new('RGBA',(256,128))
def actor(col,row,kind,frame):
    im=Image.new('RGBA',(32,32));p=ImageDraw.Draw(im)
    O='#131e21';phase=frame%2;dy=phase
    def r(box,c): p.rectangle(box,fill=c)
    if kind=='hero' or kind=='back':
        back=kind=='back'
        r((10,27,14,29),O);r((18,27,22,29),O)
        r((10,25+phase,14,27+phase),'#504132');r((18,26-phase,22,28-phase),'#504132')
        r((9,15+dy,22,25+dy),O);r((10,15+dy,21,23+dy),'#367d77');r((12,17+dy,19,24+dy),'#41988a')
        r((13,21+dy,19,22+dy),'#bca364');r((14,22+dy,16,23+dy),'#e8c876')
        r((7,17+dy,9,22+dy),O);r((8,18+dy,10,22+dy),'#d6ad80')
        r((22,17+dy,24,22+dy),O);r((22,18+dy,23,21+dy),'#efc99d')
        r((10,4+dy,21,14+dy),O);r((12,3+dy,19,5+dy),O);r((9,6+dy,22,10+dy),O)
        if back:r((11,7+dy,20,13+dy),'#2d3438');r((12,5+dy,18,7+dy),'#424849')
        else:
            r((11,9+dy,20,14+dy),'#edc498');r((12,14+dy,19,15+dy),'#c59972')
            r((11,7+dy,14,10+dy),'#242c33');r((17,6+dy,21,10+dy),'#242c33')
            r((12,11+dy,13,12+dy),O);r((18,11+dy,19,12+dy),O);r((15,14+dy,16,14+dy),'#b77765')
        r((10,15+dy,21,16+dy),'#be5c49');r((19,16+dy,22,19+dy),'#e27e58')
        r((24,14+dy,25,25+dy),'#d4b56a');r((23,18+dy,27,19+dy),'#f1d89b');r((24,12+dy,25,16+dy),'#e4e5c0')
    elif kind=='slime':
        p.ellipse((5,16+dy,27,28),fill=O);p.ellipse((6,14+dy,26,26),fill='#4d9e8b')
        r((9,15+dy,23,23+dy),'#67c2a1');r((11,14+dy,20,18+dy),'#89d8b3')
        r((11,20+dy,12,22+dy),O);r((21,20+dy,22,22+dy),O);r((15,24+dy,19,24+dy),'#346c62')
        r((9,17+dy,11,18+dy),'#c0f2cf')
    elif kind=='bat':
        yy=12+phase*3
        p.polygon([(2,yy),(10,yy+4),(13,12),(19,12),(23,yy+4),(30,yy),(27,yy+12),(19,23),(12,23),(5,yy+12)],fill=O)
        p.polygon([(3,yy+2),(11,yy+6),(12,20),(6,yy+9)],fill='#70609e')
        p.polygon([(29,yy+2),(22,yy+6),(20,20),(26,yy+9)],fill='#8b71b5')
        r((12,12,20,24),'#514c79');r((12,10,14,13),'#746391');r((18,10,20,13),'#746391')
        r((13,16,14,17),'#ffc77e');r((18,16,19,17),'#ffc77e')
    elif kind=='brute' or kind=='boss':
        boss=kind=='boss';body='#6b827c' if boss else '#857d62';light='#9baca0' if boss else '#aaa080'
        r((7,9+dy,25,26+dy),O);r((9,8+dy,23,25+dy),body);r((10,7+dy,22,12+dy),light)
        r((4,15+dy,8,25+dy),O);r((5,15+dy,9,23+dy),body);r((24,15+dy,29,25+dy),O);r((24,15+dy,28,23+dy),body)
        r((9,25,13,29),O);r((21,25,25,29),O)
        r((12,13+dy,20,16+dy),'#263d3c');r((12,14+dy,14,15+dy),'#ffb05e');r((19,14+dy,21,15+dy),'#ffb05e')
        r((14,20+dy,19,23+dy),'#d6a75c');r((16,18+dy,17,25+dy),'#f9d278')
        if boss:r((7,5+dy,10,11+dy),'#d4b879');r((22,5+dy,25,11+dy),'#d4b879');r((11,9+dy,21,10+dy),'#b6c1ab')
    elif kind=='shaman':
        p.polygon([(15,5+dy),(24,20+dy),(25,28),(6,28),(8,18+dy)],fill=O)
        p.polygon([(15,7+dy),(22,21+dy),(23,26),(8,26),(10,18+dy)],fill='#725780')
        r((11,14+dy,20,18+dy),'#242936');r((12,15+dy,13,16+dy),'#e6baeb');r((18,15+dy,19,16+dy),'#e6baeb')
        r((25,12+dy,26,28),'#bfa476');r((23,9+dy,28,13+dy),'#c17cd2');r((24,9+dy,26,11+dy),'#f0c5f5')
    actors.paste(im,(col*32,row*32))
for f in range(4):
    actor(f,0,'hero',f);actor(f+4,0,'back',f)
    actor(f,1,'slime',f);actor(f+4,1,'bat',f)
    actor(f,2,'brute',f);actor(f+4,2,'shaman',f)
    actor(f,3,'boss',f)
save(actors,'actors.png')

objects=Image.new('RGBA',(512,128))
for idx in range(16):
    im=Image.new('RGBA',(64,64));p=ImageDraw.Draw(im)
    def r(box,c):p.rectangle(box,fill=c)
    if idx in [0,1,2]:
        r((29,35,36,60),'#202b24');r((31,37,34,58),'#665442');r((34,45,36,57),'#423b31')
        if idx==2:
            for yy,ww in [(6,8),(14,14),(24,20),(34,24)]:
                p.polygon([(32,yy),(32-ww,yy+18),(32+ww,yy+18)],fill='#152e2c');p.polygon([(31,yy+2),(34-ww,yy+14),(29+ww,yy+14)],fill='#2c5740')
        else:
            for box in [(8,20,55,43),(14,12,49,46),(21,6,45,44),(3,25,57,36)]:r(box,'#152c29')
            for box in [(11,19,51,35),(17,12,44,40),(24,8,39,15),(7,26,55,31)]:r(box,'#284c36' if idx==0 else '#2c5140')
            for j in range(35):
                x,y=rng.randrange(12,49),rng.randrange(16,35);r((x,y,x+3,y+1),rng.choice(['#365b3a','#3d6340','#244530']))
            r((22,12,29,13),'#527047');r((12,24,17,25),'#4a7047')
    elif idx==3:
        p.polygon([(15,52),(10,43),(16,30),(35,25),(49,35),(52,48),(41,56)],fill='#172d29')
        p.polygon([(14,43),(19,32),(35,29),(46,36),(47,46),(35,52),(18,50)],fill='#73796a')
        p.polygon([(19,32),(35,29),(43,35),(27,40),(15,41)],fill='#939584');p.line((27,40,32,49),fill='#4c6054',width=2)
        r((16,46,23,49),'#3f6247')
    elif idx in [4,12]:
        for box in [(19,52,44,55),(15,49,19,53),(43,47,48,51),(22,45,27,48),(36,44,42,47)]:r(box,'#747569')
        p.line((22,52,41,46),fill='#674938',width=4);p.line((23,47,41,53),fill='#98714b',width=3)
        p.polygon([(24,48),(20,39),(27,32),(28,23),(34,34),(39,27),(44,42),(39,49)],fill='#c85f39')
        p.polygon([(26,47),(27,38),(32,32),(32,41),(38,36),(39,46)],fill='#f6af55');r((30,42,34,48),'#ffdfa0')
    elif idx==5:
        for x in [10,42]:r((x,23,x+12,57),'#263832');r((x+2,23,x+10,56),'#7e8775');r((x+3,30,x+8,32),'#9da38a');r((x+1,44,x+9,45),'#4f6753')
        r((12,15,52,24),'#293c35');r((16,11,48,22),'#838b76');r((24,8,40,12),'#a0a68b')
        r((29,15,35,20),'#8bd4b1');r((11,54,23,58),'#48694c');r((44,51,52,58),'#395a41')
    elif idx==6:
        r((17,35,47,54),'#182c28');r((19,36,45,51),'#946340');r((20,33,44,39),'#c58a4f');r((19,40,46,42),'#e2ba6d');r((30,40,35,46),'#ffe0a0');r((21,46,26,48),'#704b37')
    elif idx==7:
        r((18,51,47,57),'#283c34');r((22,46,43,52),'#7c8974');r((27,30,38,47),'#5f796b')
        p.polygon([(33,13),(42,27),(33,41),(24,27)],fill='#315f60');p.polygon([(33,15),(39,27),(33,36),(27,27)],fill='#79d7c1');r((32,19,33,28),'#d2f7dd')
    elif idx==8:
        for x,y in [(17,49),(35,53),(43,44)]:r((x,y,x+2,y+9),'#bbb198');r((x-3,y-2,x+5,y+1),'#c57855');r((x-1,y-3,x+3,y-2),'#e8b37e')
    elif idx==9:
        for x,y in [(17,50),(31,56),(43,46)]:r((x,y,x,y+5),'#5d7c4b');r((x-1,y-1,x+1,y+1),'#e2b768');r((x,y,x,y),'#fff0b0')
    elif idx==10:
        r((23,25,39,57),'#33483e');r((24,27,37,54),'#6a7e6a');r((21,21,41,27),'#8c9b7e');r((27,34,32,44),'#405e4c');r((28,35,30,42),'#a8cba0')
    elif idx==11:
        r((29,14,31,58),'#b79b6b');p.polygon([(32,15),(48,18),(44,25),(49,30),(32,28)],fill='#b35f45');r((35,19,38,24),'#e2bd75')
    elif idx==13:
        r((18,45,47,54),'#596e61');r((22,40,43,48),'#81917b');r((25,43,39,50),'#203e38')
    elif idx==14:
        r((16,47,47,49),'#b8b38b');r((17,43,19,52),'#d0c7a3');r((43,44,45,52),'#d0c7a3')
    elif idx==15:
        p.ellipse((2,21,61,59),fill='#143e3c');p.ellipse((6,25,57,55),fill='#235958')
        for j in range(20):
            x,y=rng.randrange(14,48),rng.randrange(30,50);r((x,y,x+5,y),'#397270')
    objects.paste(im,((idx%8)*64,(idx//8)*64))
save(objects,'objects.png')

icons=Image.new('RGBA',(256,64))
for idx in range(16):
    im=Image.new('RGBA',(32,32));p=ImageDraw.Draw(im)
    if idx==0:
        p.line((9,24,24,7),fill='#d6e1cd',width=5);p.line((11,24,25,8),fill='#fff4bd',width=2);p.line((7,18,16,27),fill='#dfa95c',width=3);p.line((6,27,11,22),fill='#a87c4f',width=4)
    elif idx==1:
        p.polygon([(15,3),(17,13),(23,8),(26,20),(22,28),(10,28),(5,20),(10,10),(11,19)],fill='#f09c55');p.polygon([(16,14),(21,23),(18,27),(12,25)],fill='#ffe5a2')
    elif idx==2:
        for a in [0,7,14]:p.line((6+a,9,13+a,16,6+a,23),fill='#9cd9cf',width=3)
    elif idx==3:
        p.rectangle((12,5,20,10),fill='#d2bf91');p.rectangle((10,11,22,26),fill='#bce0d4');p.rectangle((12,17,20,24),fill='#d66d62');p.rectangle((14,12,16,16),fill='#eff9d7')
    elif idx==4:
        p.polygon([(16,4),(26,8),(24,21),(16,28),(8,21),(6,8)],fill='#bca56f');p.polygon([(16,8),(22,11),(21,20),(16,24),(11,20),(10,11)],fill='#6da58d')
    elif idx==5:
        p.polygon([(11,5),(20,5),(19,20),(25,23),(24,27),(8,27),(8,20),(12,18)],fill='#a2bd99');p.rectangle((12,9,18,14),fill='#577e6d');p.line((10,25,24,25),fill='#f1d39a',width=2)
    elif idx==6:
        p.arc((6,5,26,26),0,180,fill='#d8b879',width=5);p.rectangle((6,12,10,17),fill='#efcd91');p.rectangle((22,12,26,17),fill='#efcd91')
    elif idx==7:
        p.polygon([(16,3),(20,12),(29,16),(20,20),(16,29),(12,20),(3,16),(12,12)],fill='#f8d98a');p.rectangle((14,14,18,18),fill='#fff3bd')
    elif idx==8:
        p.polygon([(16,3),(25,15),(16,29),(7,15)],fill='#70c6ba');p.line((16,6,16,25),fill='#c4f6d9',width=2)
    elif idx==9:
        p.ellipse((7,6,25,26),fill='#bd904b');p.ellipse((10,8,23,23),fill='#f0ce75');p.line((16,11,16,21),fill='#b48646',width=2)
    elif idx==10:
        p.polygon([(16,10),(11,6),(6,9),(5,15),(16,26),(27,15),(26,9),(21,6)],fill='#dc7e6b')
    elif idx==11:
        p.rectangle((7,5,24,27),fill='#bea873');p.rectangle((9,7,22,24),fill='#e9d9aa');p.rectangle((15,7,16,24),fill='#a28b64');p.line((10,11,13,11),fill='#6e765e');p.line((18,14,21,14),fill='#6e765e')
    elif idx==12:
        p.line((7,10,7,22,20,22),fill='#c6debd',width=3);p.polygon([(19,17),(25,22),(19,27)],fill='#c6debd')
    elif idx==13:
        p.rectangle((9,7,13,25),fill='#e3d5ae');p.rectangle((19,7,23,25),fill='#e3d5ae')
    elif idx==14:
        p.polygon([(8,9),(13,9),(20,4),(20,28),(13,23),(8,23)],fill='#c3d6bd');p.arc((15,8,29,24),-65,65,fill='#8cc9b6',width=2)
    else:
        p.polygon([(16,3),(19,12),(29,12),(21,18),(24,28),(16,22),(8,28),(11,18),(3,12),(13,12)],fill='#e2bd74')
    icons.paste(im,((idx%8)*32,(idx//8)*32))
save(icons,'icons.png')

# Launcher icon, created directly from the game's own pixel hero.
icon=Image.new('RGBA',(192,192),'#142e2a');p=ImageDraw.Draw(icon)
p.rectangle((10,10,181,181),outline='#d8b66b',width=6)
icon.alpha_composite(actors.crop((0,0,32,32)).resize((160,160),Image.Resampling.NEAREST),(16,16))
res=ROOT/'app/src/main/res/drawable';res.mkdir(parents=True,exist_ok=True);icon.save(res/'icon.png')

audio=OUT/'audio';audio.mkdir(exist_ok=True)
SR=22050
def write_wav(name,duration,fn):
    data=[]
    for i in range(int(duration*SR)):
        t=i/SR;v=max(-1,min(1,fn(t,duration)));data.append(struct.pack('<h',int(v*16000)))
    with wave.open(str(audio/(name+'.wav')),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(SR);w.writeframes(b''.join(data))
def tone(t,f):return .65*math.sin(2*math.pi*f*t)+.2*math.sin(4*math.pi*f*t)
fx={'slash':(.13,740,180),'hit':(.1,210,70),'kill':(.22,440,170),'hurt':(.24,160,60),'dash':(.17,280,950),'pickup':(.09,880,1400),'heal':(.35,440,880),'skill':(.5,220,880),'level':(.65,520,1560),'death':(.7,360,65),'boss':(.7,100,160),'warn':(.16,660,660)}
for name,(dur,start,end) in fx.items():
    write_wav(name,dur,lambda t,d,s=start,e=end:tone(t,s+(e-s)*t/d)*(1-t/d)**1.5*.4)
notes=[52,59,64,67,64,59,55,62,64,69,67,62,50,57,62,65,62,57,48,55,60,64,62,55]
def music(t,d):
    step=.36;n=int(t/step);local=t%step;note=notes[n%len(notes)];f=440*2**((note-69)/12)
    melody=tone(local,f)*math.exp(-local*7)*.13
    bass=440*2**(((40 if n//6%2==0 else 36)-69)/12)
    return melody+math.sin(2*math.pi*bass*t)*.035
write_wav('forest',len(notes)*.36,music)
print('Generated original sprites, launcher icon and 13 audio tracks:', OUT)
