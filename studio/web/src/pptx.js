/* PPTX 整文件导入：.pptx 本质是 ZIP，这里用 JSZip 解包后在 Canvas 上
   把每一页（文本框 / 图片 / 表格 / 组合形状）绘制成 JPEG，交给上课模式
   的 PPT 照片库。全部在 WebView 本地完成，离线可用。

   渲染目标是「课堂笔记里认得出这一页」，不追求像素级还原：
   - 文本：字号 / 加粗 / 颜色 / 对齐 / 自动换行 / 垂直居中都支持；
     艺术字、渐变、图表等复杂效果降级为普通文本或占位框。
   - 图片：png/jpg/gif/bmp/webp 直接绘制；wmf/emf 无法解码则跳过。
   - 主题色从 theme1.xml 读取，缺省回落到 Office 经典配色。

   旧版二进制 .ppt（OLE2 魔数 D0 CF 11 E0）无法在浏览器解析，
   renderPptx 会对它抛出带提示的异常，由调用方转成用户可读的消息。 */

import JSZip from 'jszip';

const EMU_PER_PT=12700;             // 1pt = 12700 EMU
const DEFAULT_SLIDE_W=9144000;      // 10in
const DEFAULT_SLIDE_H=6858000;      // 7.5in
const DEFAULT_PT=18;                // PowerPoint 正文默认字号
const FONT_STACK='"Calibri","Microsoft YaHei","PingFang SC",sans-serif';
const OFFICE_FALLBACK={bg1:'FFFFFF',lt1:'FFFFFF',dk1:'000000',tx1:'000000',bg2:'EEECE1',lt2:'EEECE1',dk2:'1F497D',tx2:'1F497D',accent1:'4F81BD',accent2:'C0504D',accent3:'9BBB59',accent4:'8064A2',accent5:'4BACC6',accent6:'F79646',hlink:'0000FF',folHlink:'800080'};

/* ---------------- XML 工具（按 localName 匹配，不依赖前缀写法） ---------------- */

function tag(el){return el?(el.localName||String(el.nodeName).replace(/^.*:/,'')):'';}
function kids(el){return el&&el.children?[...el.children]:[];}
function findAll(root,name,out=[]){
  for(const child of kids(root)){
    if(tag(child)===name)out.push(child);
    findAll(child,name,out);
  }
  return out;
}
function findFirst(root,name){return findAll(root,name)[0]||null;}
function attrR(el,name){
  /* r:embed / r:id 等关系属性：标准前缀是 r，个别生成器用别的写法，兜底取任意前缀同尾名 */
  if(!el)return '';
  const direct=el.getAttribute('r:'+name);
  if(direct!=null&&direct!=='')return direct;
  for(const a of el.attributes){
    if(a.name===name||a.name.endsWith(':'+name))return a.value;
  }
  return '';
}
function parseXml(text){
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw new Error('演示文稿 XML 损坏');
  return doc;
}

/* ---------------- 颜色 / 主题 ---------------- */

function solidFillOf(node,theme){
  if(!node)return null;
  if(findFirst(node,'noFill'))return null;
  const sf=findFirst(node,'solidFill');
  if(!sf)return null;
  const srgb=findFirst(sf,'srgbClr');
  if(srgb)return '#'+(srgb.getAttribute('val')||'000000');
  const sys=findFirst(sf,'sysClr');
  if(sys)return '#'+(sys.getAttribute('lastClr')||'000000');
  const scheme=findFirst(sf,'schemeClr');
  if(scheme&&scheme.getAttribute('val'))return schemeColor(scheme.getAttribute('val'),theme);
  return null;
}
function schemeColor(name,theme){
  const key=String(name||'');
  if(theme&&theme[key])return '#'+theme[key];
  return '#'+(OFFICE_FALLBACK[key]||'000000');
}
async function readTheme(zip){
  try{
    const entry=zip.file('ppt/theme/theme1.xml')||zip.file(/theme\d*\.xml$/)[0];
    if(!entry)return {};
    const doc=parseXml(await entry.async('string'));
    const scheme=findFirst(doc,'clrScheme');
    if(!scheme)return {};
    const map={};
    for(const child of kids(scheme)){
      const name=tag(child);
      if(name==='extLst')continue;
      const srgb=findFirst(child,'srgbClr');
      const sys=findFirst(child,'sysClr');
      const val=(srgb&&srgb.getAttribute('val'))||(sys&&sys.getAttribute('lastClr'))||'000000';
      map[name]=val;
    }
    /* bg1/bg2、tx1/tx2 与 lt1/lt2/dk1/dk2 是别名 */
    if(map.lt1&&!map.bg1)map.bg1=map.lt1;
    if(map.dk1&&!map.tx1)map.tx1=map.dk1;
    if(map.lt2&&!map.bg2)map.bg2=map.lt2;
    if(map.dk2&&!map.tx2)map.tx2=map.dk2;
    return map;
  }catch(e){return {};}
}

/* ---------------- 几何 ---------------- */

function readXfrm(spPr){
  if(!spPr)return null;
  const xfrm=findFirst(spPr,'xfrm');
  if(!xfrm)return null;
  const off=findFirst(xfrm,'off'),ext=findFirst(xfrm,'ext');
  const chOff=findFirst(xfrm,'chOff'),chExt=findFirst(xfrm,'chExt');
  return {
    x:off?Number(off.getAttribute('x'))||0:0,
    y:off?Number(off.getAttribute('y'))||0:0,
    w:ext?Number(ext.getAttribute('cx'))||0:0,
    h:ext?Number(ext.getAttribute('cy'))||0:0,
    chX:chOff?Number(chOff.getAttribute('x'))||0:0,
    chY:chOff?Number(chOff.getAttribute('y'))||0:0,
    chW:chExt?Number(chExt.getAttribute('cx'))||0:0,
    chH:chExt?Number(chExt.getAttribute('cy'))||0:0
  };
}
function transformFor(groupXf,parent){
  /* 组合形状：把子坐标系（chOff/chExt）映射到父坐标（off/ext），
     再由父 transform 完成到画布的最终变换。 */
  const sx=groupXf.w>0&&groupXf.chW>0?groupXf.w/groupXf.chW:1;
  const sy=groupXf.h>0&&groupXf.chH>0?groupXf.h/groupXf.chH:1;
  return {
    sx:parent.sx*sx,sy:parent.sy*sy,
    apply(r){
      return parent.apply({
        x:groupXf.x+(r.x-groupXf.chX)*sx,
        y:groupXf.y+(r.y-groupXf.chY)*sy,
        w:r.w*sx,h:r.h*sy
      });
    }
  };
}

/* ---------------- 图片 ---------------- */

function decodeImage(blob){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('decode'));};
    img.src=url;
  });
}
function resolveRelPath(baseDir,target){
  let t=String(target||'').replace(/\\/g,'/');
  if(t.startsWith('/'))return t.slice(1);
  const parts=(baseDir+t).split('/');
  const stack=[];
  for(const part of parts){
    if(!part||part==='.')continue;
    if(part==='..')stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const DECODABLE=/\.(?:png|jpe?g|gif|bmp|webp|svg|tiff?)$/i;
async function drawPicture(ctx,zip,node,relMap,baseDir,transform){
  const blip=findFirst(node,'blip');
  const embed=attrR(blip,'embed');
  if(!embed)return;
  const target=relMap[embed];
  if(!target)return;
  const path=resolveRelPath(baseDir,target);
  const entry=zip.file(path);
  if(!entry||!DECODABLE.test(path))return;   // wmf/emf 等无法解码，跳过
  const rect=transform.apply(xfrmRect(node));
  try{
    const img=await decodeImage(await entry.async('blob'));
    if(rect.w>0&&rect.h>0)ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h);
  }catch(e){/* 单张图片失败不影响整页 */}
}
function xfrmRect(node){
  const spPr=findFirst(node,'spPr');
  const xf=spPr?readXfrm(spPr):null;
  if(!xf)return {x:0,y:0,w:0,h:0};
  return {x:xf.x,y:xf.y,w:xf.w,h:xf.h};
}

/* ---------------- 文本 ---------------- */

function runProps(rPr,theme){
  const size=rPr&&rPr.getAttribute('sz')?Number(rPr.getAttribute('sz'))/100:null;
  const bold=rPr?rPr.getAttribute('b')==='1':false;
  const color=rPr?solidFillOf(rPr,theme):null;
  return {size,bold,color};
}
function shapeText(ctx,txBody,rect,theme){
  if(!txBody||rect.w<=0||rect.h<=0)return;
  const bodyPr=findFirst(txBody,'bodyPr');
  const anchor=(bodyPr&&bodyPr.getAttribute('anchor'))||'t';
  const inset=Math.max(2,Math.round(91440*rect.__scale));   // 默认左右 0.1in 内边距
  const box={x:rect.x+inset,y:rect.y+Math.round(inset*0.5),w:rect.w-inset*2,h:rect.h-inset,__scale:rect.__scale};
  if(box.w<=4||box.h<=4)return;
  const paragraphs=findAll(txBody,'p');
  const lines=[];   // {tokens:[{text,size,bold,color,x}],width,height,algn}
  for(const p of paragraphs){
    const pPr=findFirst(p,'pPr');
    const algn=(pPr&&pPr.getAttribute('algn'))||'l';
    /* 段级默认字号（lstStyle / defRPr）一般缺省，直接用 run 级 */
    const tokens=[];
    for(const child of kids(p)){
      const name=tag(child);
      if(name==='r'||name==='fld'){
        const t=findFirst(child,'t');
        const text=t?t.textContent:'';
        if(!text)continue;
        const props=runProps(findFirst(child,'rPr'),theme);
        tokens.push({text,size:props.size||DEFAULT_PT,bold:props.bold,color:props.color,br:false});
      }else if(name==='br'){
        tokens.push({text:'',size:DEFAULT_PT,bold:false,color:null,br:true});
      }
    }
    if(!tokens.length){lines.push({tokens:[],width:0,height:DEFAULT_PT*EMU_PER_PT*rect.__scale*1.25,algn});continue;}
    wrapTokens(ctx,tokens,box,lines,algn);
  }
  const totalHeight=lines.reduce((sum,l)=>sum+l.height,0);
  let y=box.y;
  if(anchor==='ctr')y=box.y+Math.max(0,(box.h-totalHeight)/2);
  else if(anchor==='b')y=box.y+Math.max(0,box.h-totalHeight);
  ctx.textBaseline='top';
  for(const line of lines){
    let x=box.x;
    if(line.algn==='ctr')x=box.x+Math.max(0,(box.w-line.width)/2);
    else if(line.algn==='r'||line.algn==='just')x=box.x+Math.max(0,box.w-line.width);
    for(const token of line.tokens){
      const px=Math.max(6,token.size*EMU_PER_PT*rect.__scale);   // pt -> EMU -> px
      ctx.font=(token.bold?'bold ':'')+px+'px '+FONT_STACK;
      ctx.fillStyle=token.color||'#111111';
      ctx.fillText(token.text,token.x+x,y);
    }
    y+=line.height;
    if(y>rect.y+rect.h+2)break;   // 超出形状就截断，避免溢满整页
  }
}
function wrapTokens(ctx,tokens,box,lines,algn){
  /* 中日韩逐字断行，拉丁按词断行；token 保留自己的样式 */
  const units=[];
  for(const token of tokens){
    if(token.br){units.push({...token,br:true});continue;}
    const parts=token.text.split(/(\s+)/);
    for(const part of parts){
      if(!part)continue;
      if(/^\s+$/.test(part)&&units.length&&!units[units.length-1].br)units.push({...token,text:' ',space:true});
      else if(/[\u3000-\u9fff\uff00-\uffef]/.test(part)){
        for(const ch of part)units.push({...token,text:ch});
      }else units.push({...token,text:part});
    }
  }
  let current=[],width=0,height=0;
  const flush=()=>{lines.push({tokens:current,width,height,algn});current=[];width=0;height=0;};
  for(const unit of units){
    if(unit.br){flush();continue;}
    const px=Math.max(6,unit.size*EMU_PER_PT*box.__scale);
    ctx.font=(unit.bold?'bold ':'')+px+'px '+FONT_STACK;
    const w=ctx.measureText(unit.text).width;
    const h=px*1.25;
    if(width+w>box.w&&current.length&&!unit.space){flush();}
    current.push({...unit,x:width});
    width+=w;height=Math.max(height,h);
  }
  if(current.length||!lines.length)flush();
}

/* ---------------- 形状绘制 ---------------- */

function drawShape(ctx,node,transform,theme){
  const spPr=findFirst(node,'spPr');
  const xf=spPr?readXfrm(spPr):null;
  if(!xf)return;
  const rect=transform.apply({x:xf.x,y:xf.y,w:xf.w,h:xf.h});
  rect.__scale=transform.sx;
  if(rect.w<=0||rect.h<=0)return;
  const fill=solidFillOf(spPr,theme);
  if(fill){ctx.fillStyle=fill;ctx.fillRect(rect.x,rect.y,rect.w,rect.h);}
  /* 线条：细描边即可（渐变线等忽略） */
  const ln=findFirst(spPr,'ln');
  const lnFill=ln?solidFillOf(ln,theme):null;
  if(lnFill){ctx.strokeStyle=lnFill;ctx.lineWidth=Math.max(0.5,(ln.getAttribute('w')?Number(ln.getAttribute('w')):9525)*transform.sx);ctx.strokeRect(rect.x+0.25,rect.y+0.25,rect.w-0.5,rect.h-0.5);}
  const txBody=findFirst(node,'txBody');
  if(txBody)shapeText(ctx,txBody,rect,theme);
}
function drawTable(ctx,node,transform,theme){
  const tbl=findFirst(node,'tbl');
  if(!tbl){ /* 图表等其他 graphicFrame：画一个占位框 */
    const rect=transform.apply(xfrmRect(node));
    if(rect.w>0&&rect.h>0){ctx.strokeStyle='#bbbbbb';ctx.lineWidth=1;ctx.strokeRect(rect.x,rect.y,rect.w,rect.h);}
    return;
  }
  const cols=findAll(tbl,'gridCol').map(c=>Number(c.getAttribute('w'))||0);
  const trs=findAll(tbl,'tr');
  const colSum=cols.reduce((a,b)=>a+b,0)||1;
  /* graphicFrame 的 p:xfrm 是直接子节点（不在 spPr 里），readXfrm 递归查找可以两者兼顾 */
  const xf=readXfrm(node);
  const rect=transform.apply(xf?{x:xf.x,y:xf.y,w:xf.w,h:xf.h}:{x:0,y:0,w:0,h:0});
  rect.__scale=transform.sx;
  if(rect.w<=0||rect.h<=0)return;
  const colW=cols.map(w=>w/colSum*rect.w);
  const rowH=Math.max(12,rect.h/Math.max(1,trs.length));
  let y=rect.y;
  ctx.strokeStyle='#999999';ctx.lineWidth=0.5;
  for(const tr of trs){
    let x=rect.x;
    const cells=findAll(tr,'tc');
    for(let i=0;i<cells.length;i++){
      const w=colW[i]||rect.w/ Math.max(1,cells.length);
      const txBody=findFirst(cells[i],'txBody');
      if(txBody)shapeText(ctx,txBody,{x,y,w,h:rowH,__scale:transform.sx},theme);
      ctx.strokeRect(x,y,w,rowH);
      x+=w;
    }
    y+=rowH;
    if(y>rect.y+rect.h)break;
  }
}
async function drawNode(ctx,zip,node,relMap,baseDir,transform,theme){
  const name=tag(node);
  if(name==='pic'){await drawPicture(ctx,zip,node,relMap,baseDir,transform);return;}
  if(name==='sp'){drawShape(ctx,node,transform,theme);return;}
  if(name==='graphicFrame'||name==='txbx'){drawTable(ctx,node,transform,theme);return;}
  if(name==='grpSp'){
    const grpSpPr=findFirst(node,'grpSpPr');
    const xf=grpSpPr?readXfrm(grpSpPr):null;
    const inner=xf&&xf.chW>0?transformFor(xf,transform):transform;
    for(const child of kids(node)){
      await drawNode(ctx,zip,child,relMap,baseDir,inner,theme);
    }
    return;
  }
  /* 兜底：任意节点里嵌着的 pic/sp（如 mc:AlternateContent） */
  for(const child of kids(node)){
    const t=tag(child);
    if(t==='pic'||t==='sp'||t==='grpSp'||t==='graphicFrame')await drawNode(ctx,zip,child,relMap,baseDir,transform,theme);
  }
}

/* ---------------- 单页 / 整个文件 ---------------- */

async function renderSlide(ctx,zip,path,width,height,scale,theme){
  const entry=zip.file(path);
  if(!entry)throw new Error('缺少幻灯片 '+path);
  const doc=parseXml(await entry.async('string'));
  const relPath=path.replace(/([^/]+)$/,'_rels/$1.rels');
  const relMap={};
  const relEntry=zip.file(relPath);
  if(relEntry){
    const relDoc=parseXml(await relEntry.async('string'));
    for(const rel of findAll(relDoc,'Relationship')){
      relMap[rel.getAttribute('Id')]=rel.getAttribute('Target');
    }
  }
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
  /* 页面背景 */
  const cSld=findFirst(doc,'cSld');
  const bg=cSld&&findFirst(cSld,'bg');
  if(bg){
    const fill=solidFillOf(bg,theme);
    if(fill){ctx.fillStyle=fill;ctx.fillRect(0,0,width,height);}
  }
  const baseDir=path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
  const spTree=findFirst(doc,'spTree');
  const transform={sx:scale,sy:scale,apply:r=>({x:r.x*scale,y:r.y*scale,w:r.w*scale,h:r.h*scale,__scale:scale})};
  for(const node of kids(spTree)){
    await drawNode(ctx,zip,node,relMap,baseDir,transform,theme);
  }
}
function slideNumber(path){
  const m=/slide(\d+)\.xml$/i.exec(path||'');
  return m?Number(m[1]):0;
}
/** 把 .pptx 渲染成 JPEG dataURL 列表。
 * @param buffer ArrayBuffer/Uint8Array 整个 pptx 文件内容
 * @returns {Promise<{images:string[],width:number,height:number,name:string}>} */
export async function renderPptx(buffer,opts={}){
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.length<4)throw new Error('文件为空');
  if(bytes[0]===0xD0&&bytes[1]===0xCF&&bytes[2]===0x11&&bytes[3]===0xE0){
    throw new Error('这是旧版 .ppt 二进制格式，浏览器无法直接解析。请在 WPS/PowerPoint 里「另存为 .pptx」后再导入。');
  }
  if(!(bytes[0]===0x50&&bytes[1]===0x4B))throw new Error('不是有效的 .pptx 文件');
  const maxW=opts.maxW||1024;
  const zip=await JSZip.loadAsync(bytes);
  const presEntry=zip.file('ppt/presentation.xml');
  if(!presEntry)throw new Error('文件结构不完整：缺少 ppt/presentation.xml');
  const presDoc=parseXml(await presEntry.async('string'));
  const sldSz=findFirst(presDoc,'sldSz');
  let cx=sldSz?Number(sldSz.getAttribute('cx'))||0:0;
  let cy=sldSz?Number(sldSz.getAttribute('cy'))||0:0;
  if(!cx||!cy){cx=DEFAULT_SLIDE_W;cy=DEFAULT_SLIDE_H;}
  const scale=maxW/cx;
  const width=Math.max(64,Math.round(cx*scale)),height=Math.max(48,Math.round(cy*scale));
  const theme=await readTheme(zip);
  /* 页序：presentation.xml 的 sldIdLst -> rels -> slideN.xml；异常时按编号排序兜底 */
  const slidePaths=[];
  try{
    const relDoc=parseXml(await zip.file('ppt/_rels/presentation.xml.rels').async('string'));
    const relMap={};
    for(const rel of findAll(relDoc,'Relationship'))relMap[rel.getAttribute('Id')]=rel.getAttribute('Target');
    const sldIdLst=findFirst(presDoc,'sldIdLst');
    for(const sldId of (sldIdLst?findAll(sldIdLst,'sldId'):[])){
      const target=relMap[attrR(sldId,'id')];
      if(target)slidePaths.push(resolveRelPath('ppt/',target));
    }
  }catch(e){/* 走兜底 */}
  const valid=slidePaths.filter(p=>zip.file(p));
  if(!valid.length){
    valid.push(...Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/i.test(n)).sort((a,b)=>slideNumber(a)-slideNumber(b)));
  }
  if(!valid.length)throw new Error('没有找到幻灯片页');
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');
  const images=[];
  const warnings=[];
  for(const path of valid){
    try{
      await renderSlide(ctx,zip,path,width,height,scale,theme);
      images.push(canvas.toDataURL('image/jpeg',opts.quality||0.8));
    }catch(e){
      warnings.push('第'+(valid.indexOf(path)+1)+'页：'+((e&&e.message)||String(e)));
      /* 单页损坏跳过，不影响其余页 */
    }
  }
  if(!images.length)throw new Error('所有页面都渲染失败'+(warnings.length?'（'+warnings[0]+'）':''));
  return {images,warnings,width,height};
}
