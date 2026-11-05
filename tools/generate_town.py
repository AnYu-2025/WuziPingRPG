"""Code-authored pixel architecture and residents for the town chapter."""
from pathlib import Path
from PIL import Image, ImageDraw
import random

out=Path(__file__).resolve().parents[1]/'app/src/main/assets'
out.mkdir(parents=True,exist_ok=True)
rng=random.Random(1122026)
tiles=Image.new('RGBA',(256,64));p=ImageDraw.Draw(tiles)
for index in range(64):
    x,y=index%16*16,index//16*16
    if index<16:
        p.rectangle((x,y,x+15,y+15),fill='#30493e')
        for _ in range(14):
            xx,yy=x+rng.randrange(16),y+rng.randrange(16)
            p.point((xx,yy),fill=rng.choice(['#3d5945','#284034','#48604a']))
    elif index<48:
        p.rectangle((x,y,x+15,y+15),fill='#4c5954')
        for yy in range(0,16,8):
            offset=4 if yy==8 else 0
            for xx in range(-offset,16,8):
                a,b=max(0,xx),min(15,xx+6)
                if a<=b:
                    c=rng.choice(['#6e7770','#747b70','#667169','#7c8073'])
                    p.rectangle((x+a,y+yy,x+b,y+yy+6),fill=c)
                    p.line((x+a,y+yy,x+b,y+yy),fill='#8a8c7d')
        if index>=32:
            for _ in range(4):p.point((x+rng.randrange(16),y+rng.randrange(16)),fill='#566e4d')
    else:
        p.rectangle((x,y,x+15,y+15),fill='#28515a')
        for _ in range(4):
            xx,yy=x+rng.randrange(12),y+rng.randrange(16)
            p.line((xx,yy,xx+3,yy),fill='#53858a')
tiles.save(out/'town_tiles.png')

atlas=Image.new('RGBA',(512,256))
roof_palettes=[('#364f61','#4b6776','#729197'),('#634f58','#826367','#ae8276'),('#3a6861','#4f8271','#86a18a'),('#674958','#8c6171','#b48b85'),('#4e526d','#69708c','#969bb1'),('#595c55','#7b7e69','#a0a086')]
for index in range(8):
    im=Image.new('RGBA',(128,128));d=ImageDraw.Draw(im)
    def r(box,c):d.rectangle(box,fill=c)
    if index<6:
        dark,mid,light=roof_palettes[index]
        r((17,109,115,119),'#1b302d');r((21,70,109,111),'#1f3133');r((23,71,107,109),'#b9aa87')
        for yy in range(74,108,7):
            for xx in range(25+(yy//7%2)*6,106,12):r((xx,yy,xx+8,yy+3),'#ac9b79')
        for xx in [23,62,104]:r((xx,69,xx+3,110),'#534b43');r((xx+1,72,xx+2,108),'#76614a')
        r((22,107,109,112),'#655e50');r((22,107,108,108),'#d0bd90')
        # Deep overhanging roof, tiled in staggered bands.
        d.polygon([(9,74),(19,67),(32,30),(95,30),(111,67),(121,74)],fill='#182e31')
        d.polygon([(14,70),(23,64),(35,33),(92,33),(106,64),(116,70)],fill=dark)
        for row,yy in enumerate(range(35,69,6)):
            left=35-int((yy-35)*.46);right=92+int((yy-35)*.46)
            d.line((left,yy,right,yy),fill=light,width=1)
            for xx in range(left+(row%2)*5,right,10):d.line((xx,yy+1,xx-1,min(yy+5,69)),fill=mid,width=2)
        r((34,29,95,33),light);r((36,28,93,29),'#b0aa8b');r((12,71,117,74),'#303e42')
        # Warm windows and a recessed door.
        for xx in [31,80]:
            r((xx,79,xx+16,98),'#50483f');r((xx+2,81,xx+14,95),'#e7b471');r((xx+3,82,xx+6,87),'#ffe0a0')
            r((xx+7,80,xx+8,96),'#7a694f');r((xx+1,88,xx+15,89),'#7a694f');r((xx-1,98,xx+17,100),'#d0b88c')
        r((53,83,73,111),'#403e39');r((56,85,70,108),'#735c49');r((58,86,59,106),'#9e7b57');r((67,96,68,98),'#eed397')
        r((49,111,77,114),'#92917e');r((46,115,80,118),'#65746a')
        # Shop sign, ropes and an emblem unique to each building.
        r((44,71,82,81),'#352f2d');r((46,72,80,79),'#b89866');r((51,70,52,74),'#d3c39a');r((74,70,75,74),'#d3c39a')
        if index==0:
            r((98,12,111,43),'#686d63');r((96,10,113,14),'#b2ad93');d.polygon([(105,15),(105,32),(113,28),(109,22),(114,17)],fill='#c67b5d')
            d.polygon([(64,74),(68,77),(64,79),(60,77)],fill='#f4d491')
        elif index==1:
            r((23,10,35,45),'#525955');r((21,9,37,13),'#949383');r((25,15,28,28),'#817c69')
            r((86,105,114,116),'#343e3c');r((89,102,109,106),'#899181');r((94,106,104,113),'#65766d')
            d.line((58,74,67,77),fill='#343f3e',width=2);d.line((64,73,64,78),fill='#343f3e',width=2)
            r((10,88,22,112),'#4b433c');r((12,90,20,98),'#dc8652');r((14,92,18,96),'#ffcc78')
        elif index==2:
            for xx,yy in [(14,103),(108,104)]:
                r((xx,yy,xx+9,yy+13),'#8b6b50');d.line((xx+4,yy,xx+4,yy-12),fill='#76935f',width=2)
                d.ellipse((xx-1,yy-12,xx+6,yy-6),fill='#93ae6c');d.ellipse((xx+4,yy-17,xx+11,yy-10),fill='#638c68')
            r((61,74,65,78),'#437459');r((62,73,64,75),'#e8ddb0')
        elif index==3:
            r((91,14,104,43),'#5b625c');r((89,12,106,15),'#9b9c87')
            r((14,80,20,83),'#b6a479');r((15,84,19,94),'#f1bf70');r((14,95,20,97),'#635242')
            d.line((59,76,68,76),fill='#524b3e',width=2)
        elif index==4:
            r((60,74,67,79),'#6c5b47');r((61,74,63,78),'#f5e3b7');r((65,74,66,78),'#e4d1a5')
            for xx in [12,110]:r((xx,101,xx+7,116),'#867654');r((xx+1,100,xx+6,103),'#b39d74')
        else:
            for xx in [30,79]:r((xx-3,98,xx+18,103),'#5e5b42');r((xx-1,97,xx+15,99),'#738654')
    elif index==6:
        r((5,56,123,117),'#263b39')
        for xx in [7,92]:
            r((xx,35,xx+28,114),'#687b73');r((xx+3,39,xx+24,109),'#889187')
            for yy in range(43,110,10):d.line((xx+3,yy,xx+24,yy),fill='#526a63')
            for a in [0,10,20]:r((xx+a,28,xx+a+7,39),'#a1aa94')
            r((xx+10,64,xx+17,68),'#3a5552');r((xx+12,65,xx+15,67),'#dbbc7d')
        r((33,45,95,59),'#76877b');r((37,40,91,49),'#a3a58b');r((42,36,86,42),'#c2b58c')
        r((54,44,73,54),'#415a53');d.polygon([(64,44),(68,49),(64,53),(60,49)],fill='#e0c88c')
        for xx in [27,99]:r((xx,70,xx+3,76),'#b29968');r((xx-2,77,xx+5,87),'#efbd6f')
        r((35,110,94,116),'#5e7168')
    else:
        d.ellipse((9,74,119,119),fill='#263b39');d.ellipse((12,68,116,111),fill='#929e8b');d.ellipse((18,70,110,102),fill='#385e63');d.ellipse((22,72,106,97),fill='#56858a')
        for xx,yy in [(30,83),(69,90),(86,79)]:r((xx,yy,xx+13,yy+1),'#a3c4b7')
        r((56,44,72,90),'#758d80');r((59,45,65,88),'#abb5a0');d.ellipse((41,42,87,58),fill='#bec1a5');d.ellipse((46,41,82,51),fill='#557b79')
        r((60,29,68,44),'#729b95');d.polygon([(64,11),(75,28),(64,40),(53,28)],fill='#486a68');d.polygon([(64,14),(71,27),(64,35),(57,27)],fill='#a3decc');r((62,18,64,27),'#e8f4d5')
    atlas.alpha_composite(im,((index%4)*128,index//4*128))
atlas.save(out/'town.png')

props=Image.new('RGBA',(512,64))
for index in range(8):
    im=Image.new('RGBA',(64,64));d=ImageDraw.Draw(im)
    def r(box,c):d.rectangle(box,fill=c)
    if index==0:
        r((29,20,32,60),'#554e43');r((27,59,35,62),'#92917b');r((30,9,31,23),'#ab9871');r((24,11,39,14),'#c5ad7a');r((25,15,38,28),'#5a5343');r((27,16,36,26),'#edbc74');r((29,17,32,23),'#ffe7a8');r((23,28,40,30),'#5e5b49')
    elif index==1:
        for yy in [34,39,44]:r((7,yy,56,yy+3),'#9f7e58');r((9,yy,54,yy),'#c4a271')
        r((9,48,13,57),'#4b554b');r((50,48,54,57),'#4b554b');r((5,32,7,49),'#5f6e5b');r((57,32,59,49),'#5f6e5b')
    elif index==2:
        r((12,22,15,58),'#71614b');r((49,22,52,58),'#71614b');r((10,43,54,55),'#a17d55')
        for xx in range(10,55,9):r((xx,44,xx+4,54),'#98704a')
        d.polygon([(6,27),(14,13),(50,13),(59,27)],fill='#314e49')
        for xx in range(9,56,10):d.polygon([(xx,25),(xx+5,14),(xx+9,14),(xx+7,27)],fill='#c28f60')
        for xx in [18,29,40]:d.ellipse((xx,36,xx+7,43),fill='#c4a359')
    elif index==3:
        r((20,42,44,59),'#705e48');r((18,39,46,44),'#9a7c55')
        for xx,yy in [(21,34),(28,28),(36,33)]:r((xx,yy,xx+3,42),'#5c8155');d.ellipse((xx-4,yy-7,xx+6,yy+2),fill='#a3778a');r((xx,yy-4,xx+2,yy-2),'#edc2a3')
    elif index==4:
        r((29,30,35,60),'#6d5a47');r((31,35,33,57),'#a1855b')
        for box in [(10,17,54,37),(17,10,47,43),(6,24,57,33)]:r(box,'#334d43')
        for box in [(14,18,51,33),(20,13,43,38),(11,26,55,31)]:r(box,'#57715a')
        for xx,yy in [(21,18),(35,24),(15,28),(41,17),(29,32)]:r((xx,yy,xx+3,yy+2),'#a89283')
    elif index==5:
        r((8,30,53,52),'#715d43');r((10,28,51,35),'#ad8a5d');r((12,37,49,39),'#bf9e6a');r((13,45,48,46),'#493f33')
        d.ellipse((13,48,24,61),fill='#263d37');d.ellipse((41,48,52,61),fill='#263d37');r((16,52,21,57),'#978064');r((44,52,49,57),'#978064')
        r((20,14,34,29),'#ad9571');r((34,18,46,29),'#d1b98a');r((24,11,29,18),'#6f8a60')
    elif index==6:
        for yy in [35,44,53]:r((12,yy,52,yy+6),'#849482');r((13,yy,51,yy+1),'#abb39b')
        r((15,32,49,36),'#465e54');r((22,13,25,35),'#826e50');r((40,13,43,35),'#826e50');d.polygon([(16,15),(32,5),(49,15)],fill='#6c5960')
    else:
        r((16,14,49,44),'#574d3d');r((19,17,46,41),'#a48b61');r((20,44,23,60),'#65583f');r((43,44,46,60),'#65583f');r((23,21,41,34),'#e6d1a4')
        for yy in [24,27,30]:r((26,yy,38,yy),'#817451')
    props.alpha_composite(im,(index*64,0))
props.save(out/'town_props.png')

npcs=Image.new('RGBA',(256,160))
colors=[('#697b9b','#899ab4'),('#456a5a','#709072'),('#8b6247','#b48759'),('#6c8c76','#a6b69a'),('#777095','#aaa1b4'),('#a27554','#d0a376'),
        ('#4d6b8a','#7f9fc0'),('#8a5a44','#c08a5e'),('#7a5a86','#b18cc0'),('#4f7168','#88ac9c')]
for kind in range(10):
    for frame in range(4):
        im=Image.new('RGBA',(32,32));d=ImageDraw.Draw(im);dy=frame%2;base,hi=colors[kind]
        def r(box,c):d.rectangle(box,fill=c)
        r((9,25,13,29),'#293437');r((19,25,23,29),'#293437');r((8,15+dy,23,26+dy),'#263335');r((10,16+dy,21,25+dy),base);r((12,17+dy,18,23+dy),hi)
        r((7,18+dy,9,23+dy),'#dab48b');r((23,18+dy,25,23+dy),'#dab48b')
        r((10,5+dy,21,15+dy),'#273136');r((11,8+dy,20,15+dy),'#e7c5a0');r((12,11+dy,13,12+dy),'#29353b');r((18,11+dy,19,12+dy),'#29353b')
        hair=['#b4b5a2','#465b48','#514039','#5c414b','#444454','#83735b','#3b3f4a','#4a3b32','#5c4756','#37433f'][kind]
        r((10,5+dy,21,9+dy),hair);r((9,7+dy,11,11+dy),hair)
        if kind==0:
            r((12,14+dy,19,17+dy),'#c8c9b5');r((14,17+dy,17,18+dy),'#c8c9b5');r((25,10+dy,26,28),'#bca577');r((24,8+dy,27,11+dy),'#e3c382')
        elif kind==1:
            d.polygon([(9,10+dy),(11,3+dy),(20,3+dy),(23,10+dy)],fill='#476f5b');r((13,3+dy,18,5+dy),'#77916b')
            d.arc((23,12+dy,30,27+dy),-80,80,fill='#bf9b62',width=2);r((28,14+dy,28,25+dy),'#dac49a')
        elif kind==2:
            r((11,19+dy,20,27),'#654939');r((14,17+dy,17,20+dy),'#d7ba83');r((24,16+dy,25,27),'#b49872');r((22,14+dy,29,18+dy),'#8a9590')
        elif kind==3:
            r((18,3+dy,22,7+dy),'#60464f');r((11,16+dy,20,18+dy),'#ddd0ac');r((24,20+dy,28,26+dy),'#679e87');r((25,18+dy,27,20+dy),'#d5bd89')
        elif kind==4:
            r((10,10+dy,14,13+dy),'#798b8a');r((17,10+dy,21,13+dy),'#798b8a');r((14,11+dy,17,11+dy),'#697874');r((22,20+dy,29,26+dy),'#bba77c');r((24,21+dy,27,24+dy),'#f0e2b7')
        elif kind==5:
            r((9,5+dy,22,8+dy),'#c6b799');r((11,3+dy,20,6+dy),'#c6b799');r((13,19+dy,20,27),'#ded0ac');r((23,18+dy,27,22+dy),'#ae9872')
        elif kind==6:
            # 程理 · 物理学者：细框眼镜与手中的公式板
            r((11,10+dy,14,12+dy),'#8fb8d1');r((17,10+dy,20,12+dy),'#8fb8d1');r((14,11+dy,17,11+dy),'#596b78')
            r((24,14+dy,30,25+dy),'#dfe9ef');r((25,16+dy,29,17+dy),'#6f8ba3');r((25,19+dy,28,20+dy),'#6f8ba3');r((25,22+dy,29,23+dy),'#6f8ba3')
        elif kind==7:
            # 朱华鸿 · 建造者：工匠帽与卷起来的图纸
            r((9,3+dy,22,7+dy),'#d9a24f');r((8,6+dy,23,8+dy),'#b68237');r((13,3+dy,18,4+dy),'#f0c877')
            r((23,16+dy,30,26+dy),'#e6d7ad');r((24,17+dy,29,18+dy),'#9b8160');r((24,21+dy,29,22+dy),'#9b8160');r((26,16+dy,27,26+dy),'#c1a87d')
        elif kind==8:
            # 李梓宁 · 画师：画笔与调色板
            r((24,10+dy,25,22+dy),'#b98a55');r((24,7+dy,26,10+dy),'#6b4a7a');r((22,20+dy,30,27+dy),'#d9c6a0')
            r((23,22+dy,25,23+dy),'#c4605f');r((27,22+dy,29,23+dy),'#5c86b0');r((25,25+dy,27,26+dy),'#d7b455')
        else:
            # 伍子安 · 叙事者：羽毛笔与随身书卷
            r((24,8+dy,25,19+dy),'#e7e2d2');r((25,7+dy,27,10+dy),'#b9c6c1');r((22,18+dy,30,26+dy),'#e8dcc0')
            r((23,20+dy,29,21+dy),'#8e7d61');r((23,23+dy,28,24+dy),'#8e7d61')
        slot=kind*4+frame;npcs.alpha_composite(im,((slot%8)*32,slot//8*32))
npcs.save(out/'npcs.png')
print('Generated town architecture, paving, street props and ten animated NPCs.')
