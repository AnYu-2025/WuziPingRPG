"""Pack generated transparent quadrants into fixed-size game cells; no generative changes."""
from pathlib import Path
from PIL import Image

root=Path(__file__).resolve().parents[1]
source=root/'docs/art/nailong-sheet-generated.png'
im=Image.open(source).convert('RGBA')
assert im.getchannel('A').getextrema()[0]==0, 'Sprite sheet must retain transparent background'
w,h=im.size
sheet=Image.new('RGBA',(256,64))
for i in range(4):
    frame=im.crop((i%2*w//2,i//2*h//2,(i%2+1)*w//2,(i//2+1)*h//2))
    box=frame.getchannel('A').getbbox()
    assert box is not None
    frame=frame.crop(box)
    ratio=min(52/frame.width,54/frame.height)
    frame=frame.resize((round(frame.width*ratio),round(frame.height*ratio)),Image.Resampling.NEAREST)
    sheet.alpha_composite(frame,(i*64+(64-frame.width)//2,60-frame.height))
sheet.save(root/'app/src/main/assets/nailong.png')
print('Packed nailong.png: four 64x64 cells, original alpha preserved')
