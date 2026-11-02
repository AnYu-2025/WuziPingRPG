"""Original pixel tissue tiles, cell enemies and a stylized full-body vessel atlas."""
from pathlib import Path
from PIL import Image, ImageDraw
import math, random

out = Path(__file__).resolve().parents[1] / 'app/src/main/assets'
rng = random.Random(20261102)
palettes = [('#322e43','#453951','#735065','#b77b83'),('#283d48','#38565d','#4c7e85','#8dc6c2'),('#3d303f','#583e50','#936679','#cf9b9a'),('#3f293a','#603848','#92535e','#ce8580'),('#30243f','#493153','#825080','#cf8ca8'),('#402a38','#603744','#a96376','#e9a4a0'),('#263b42','#34545d','#648d95','#a6d0cf'),('#272940','#414661','#727eb2','#b7bde8')]
tiles = Image.new('RGBA',(256,512));d=ImageDraw.Draw(tiles)
for region, colors in enumerate(palettes):
    for tile in range(64):
        x=(tile%16)*16;y=region*64+(tile//16)*16
        d.rectangle((x,y,x+15,y+15),fill=colors[0 if tile<32 else 1])
        for j in range(10):
            xx=x+rng.randrange(16);yy=y+rng.randrange(16)
            d.point((xx,yy),fill=colors[rng.choice([1,1,2])])
        if tile<32:
            d.arc((x+2,y+2,x+14,y+14),30,270,fill=colors[1],width=1)
            if tile%3==0:d.rectangle((x+7,y+6,x+9,y+8),fill=colors[2])
        else:
            d.line((x,y+5,x+15,y+5),fill=colors[2],width=1)
            if tile%3==0:d.line((x+6,y+9,x+9,y+11,x+6,y+13),fill=colors[3])
tiles.save(out/'body_tiles.png')

actors=Image.new('RGBA',(128,160))
for kind in range(5):
    for frame in range(4):
        im=Image.new('RGBA',(32,32));p=ImageDraw.Draw(im);bob=frame%2
        colors=[('#5fa394','#a6dec3','#315965'),('#6f85bd','#b1c7eb','#3a426e'),('#bba06b','#f3d79e','#6c4b5e'),('#ba7098','#e8afd0','#683f70'),('#a966a8','#f1b5d2','#472e60')][kind]
        r=8 if kind<2 else 10 if kind<4 else 13
        for j in range(8 if kind<4 else 12):
            a=j*math.tau/(8 if kind<4 else 12)+frame*.06
            xx=16+math.cos(a)*(r+3);yy=16+bob+math.sin(a)*(r+3)
            p.line((16,16+bob,xx,yy),fill=colors[2],width=3);p.rectangle((xx-1,yy-1,xx+1,yy+1),fill=colors[0])
        p.ellipse((16-r,16-r+bob,16+r,16+r+bob),fill='#202436',outline=colors[2],width=1)
        p.ellipse((17-r,17-r+bob,15+r,15+r+bob),fill=colors[0])
        p.arc((19-r,18-r+bob,13+r,12+r+bob),190,300,fill=colors[1],width=2)
        if kind>=3:
            p.ellipse((11,11+bob,22,23+bob),fill=colors[2]);p.ellipse((14,13+bob,20,20+bob),fill=colors[1])
            p.rectangle((7,19+bob,9,22+bob),fill=colors[1]);p.rectangle((23,10+bob,25,13+bob),fill=colors[2])
        else:
            p.rectangle((11,13+bob,13,16+bob),fill='#203342');p.rectangle((19,13+bob,21,16+bob),fill='#203342')
            p.line((13,21+bob,18,19+bob,21,21+bob),fill=colors[2],width=1)
        actors.alpha_composite(im,(frame*32,kind*32))
actors.save(out/'body_enemies.png')

atlas=Image.new('RGBA',(160,240));p=ImageDraw.Draw(atlas)
p.ellipse((64,7,96,40),fill='#304857',outline='#7a9c9f',width=2)
p.rectangle((72,38,88,53),fill='#304857')
p.polygon([(49,50),(70,45),(90,45),(111,50),(120,82),(109,128),(102,155),(58,155),(51,128),(40,82)],fill='#304857',outline='#7a9c9f')
for xx,sign in [(44,-1),(116,1)]:
    p.line((xx,58,xx+sign*12,103,xx+sign*18,141),fill='#7a9c9f',width=13)
    p.line((xx,58,xx+sign*12,103,xx+sign*18,141),fill='#304857',width=9)
for xx,sign in [(68,-1),(92,1)]:
    p.line((xx,153,xx+sign*3,194,xx+sign*7,226),fill='#7a9c9f',width=19)
    p.line((xx,153,xx+sign*3,194,xx+sign*7,226),fill='#304857',width=15)
    p.rectangle((xx+sign*7-8,222,xx+sign*7+8,230),fill='#7a9c9f')
# Two vessel trunks and branches, deliberately schematic rather than diagnostic anatomy.
p.line((77,44,77,149),fill='#b36675',width=3);p.line((83,44,83,149),fill='#577f9e',width=3)
for yy in [58,77,94,112,130]:
    p.line((77,yy,59,yy+5),fill='#b36675',width=2);p.line((83,yy,101,yy+5),fill='#577f9e',width=2)
p.line((77,149,66,192,61,222),fill='#b36675',width=2);p.line((83,149,95,192,99,222),fill='#577f9e',width=2)
p.line((58,60,43,87,30,135),fill='#b36675',width=2);p.line((102,60,117,87,130,135),fill='#577f9e',width=2)
p.line((80,48,80,74,67,86),fill='#9fae9a',width=3);p.line((80,74,93,86),fill='#9fae9a',width=3)
p.ellipse((53,74,75,106),fill='#5e797d');p.ellipse((85,74,107,106),fill='#5e797d')
p.polygon([(58,110),(95,107),(106,115),(91,125),(62,121)],fill='#8b6675')
for yy in range(132,153,6):p.line((61,yy,99,yy,99,yy+3,61,yy+3),fill='#8b7686',width=2)
p.ellipse((74,154,86,167),fill='#94739d')
atlas.save(out/'body_atlas.png')
print('Generated body_tiles.png, body_enemies.png and body_atlas.png')
