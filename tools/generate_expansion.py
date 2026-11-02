"""Original pixel silhouettes for five bosses and six equipment icons."""
from pathlib import Path
from PIL import Image,ImageDraw
import math
out=Path(__file__).resolve().parents[1]/'app/src/main/assets'
bosses=Image.new('RGBA',(256,320))
colors=[('#6cbfba','#b3efda','#294d61'),('#b580b5','#ead1ea','#594062'),('#b7767a','#f5c598','#5b3a52'),('#94b97b','#d6dfad','#4d4e59'),('#8f9bd1','#d9d6ff','#414c7c')]
for kind,(base,light,shade) in enumerate(colors):
 for frame in range(4):
  im=Image.new('RGBA',(64,64));p=ImageDraw.Draw(im);dy=frame%2
  if kind==0:
   for j in range(8):
    a=j*math.tau/8+frame*.06;x=32+math.cos(a)*25;y=32+dy+math.sin(a)*25
    p.line((32,32+dy,x,y),fill=shade,width=5);p.rectangle((x-3,y-3,x+3,y+3),fill=base)
   p.ellipse((14,14+dy,50,50+dy),fill=shade);p.ellipse((17,16+dy,48,46+dy),fill=base)
   p.polygon([(32,19+dy),(42,32+dy),(32,43+dy),(23,32+dy)],fill=light)
  elif kind==1:
   p.polygon([(10,24),(7,8),(21,16),(31,4),(43,16),(57,8),(53,25)],fill=shade)
   p.polygon([(14,23),(12,13),(23,21),(31,10),(41,21),(51,13),(49,26)],fill=light)
   p.ellipse((10,21+dy,54,57+dy),fill=shade);p.ellipse((13,24+dy,51,53+dy),fill=base)
   for xx in [9,22,42,55]:p.rectangle((xx-2,40,xx+2,49),fill=light)
  elif kind==2:
   p.polygon([(19,11),(45,11),(55,29),(48,53),(17,53),(8,29)],fill=shade)
   p.polygon([(23,16),(42,16),(49,31),(42,46),(22,46),(15,31)],fill=base)
   p.rectangle((0,26+dy,23,36+dy),fill=shade);p.rectangle((41,26+dy,63,36+dy),fill=shade)
   p.rectangle((1,28+dy,20,31+dy),fill=light);p.rectangle((44,28+dy,62,31+dy),fill=light)
   p.polygon([(24,20),(40,20),(32,35)],fill=light)
  elif kind==3:
   p.ellipse((11,12,53,57),fill=shade);p.ellipse((15,14,49,52),fill=base)
   for j in range(6):
    xx=8+j*9;yy=49+(j+frame)%2*5;p.line((32,29,xx,yy),fill=shade,width=5);p.ellipse((xx-4,yy-4,xx+4,yy+4),fill=base)
   p.ellipse((22,21,42,42),fill=light);p.ellipse((28,25,36,37),fill=shade)
  else:
   p.ellipse((7,12+dy,34,51+dy),fill=shade);p.ellipse((30,12+dy,57,51+dy),fill=shade)
   p.ellipse((10,14+dy,31,48+dy),fill=base);p.ellipse((33,14+dy,54,48+dy),fill=base)
   for j in range(4):p.line((13,22+j*6+dy,24,18+j*6+dy,29,24+j*6+dy),fill=light,width=2);p.line((35,23+j*6+dy,42,18+j*6+dy,52,23+j*6+dy),fill=light,width=2)
   p.rectangle((28,28+dy,36,37+dy),fill='#edd59f')
  p.rectangle((22,29+dy,27,33+dy),fill='#182c3d');p.rectangle((38,29+dy,43,33+dy),fill='#182c3d')
  bosses.alpha_composite(im,(frame*64,kind*64))
bosses.save(out/'bosses.png')
sheet=Image.new('RGBA',(192,32))
for kind in range(6):
 im=Image.new('RGBA',(32,32));p=ImageDraw.Draw(im);c=['#edc985','#9cdcc7','#da9aba','#83c9e4','#bca5ed','#e9a47e'][kind]
 if kind in (0,1,2):
  xs=[9,20] if kind==1 else [15]
  for x in xs:
   p.line((x,27,x+4,7 if kind==2 else 10),fill='#4d3d4c',width=5);p.line((x,26,x+4,6 if kind==2 else 9),fill=c,width=3);p.line((x-4,22,x+6,22),fill='#987751',width=2)
   p.polygon([(x+4,2),(x+1,11),(x+7,11)],fill=c)
 elif kind==3:
  p.line((5,8,24,24),fill=c,width=4);p.line((3,22,22,3),fill=c,width=3);p.line((4,21,21,4),fill='#d1dfe0',width=1)
 elif kind==4:
  p.line((9,29,21,8),fill='#9b826e',width=4);p.ellipse((17,2,28,13),fill=c);p.ellipse((20,5,24,9),fill='#f7e6f1')
 else:
  p.line((9,29,21,8),fill='#9b826e',width=5);p.rectangle((12,2,29,14),fill='#4d3d4c');p.rectangle((13,3,28,12),fill=c);p.line((16,5,25,5),fill='#ffdab3',width=2)
 sheet.alpha_composite(im,(kind*32,0))
sheet.save(out/'weapons.png')
print('Generated five boss sprite rows and six equipment icons')
