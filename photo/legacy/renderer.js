const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let images = []; // {img, url, name}
let cur = 0, rotation = 0;
let straighten = 0, flipH = false, flipV = false; // 构图：校正角度/镜像
let lastPresetBase = null; // 预设强度插值基准
const S = { brightness:100, contrast:100, saturate:100, exposure:0, warm:0, vignette:0, grain:0, sharpen:0, dehaze:0, soften:0, rain:0, fog:0 };
const KEYS = Object.keys(S);
let comparing = false; // 按住看原图
let cropping = false, cropStart = null, cropRect = null; // 显示像素
const history = []; // 撤销栈

const $ = id => document.getElementById(id);
const fileInput=$('fileInput'), thumbList=$('thumbList'), modeSel=$('modeSel');
const cropBox=$('cropBox');

function tip(t){ $('kouyuTip').textContent = t||''; }
function clamp(v,[a,b]){ return Math.max(a,Math.min(b,v)); }
function gradeSnap(){ try{ return (typeof gradeSnapshot==='function')?gradeSnapshot():null; }catch(e){ return null; } }
function snap(){ history.push({ S:{...S}, rotation, straighten, flipH, flipV, grade:gradeSnap() }); if(history.length>30) history.shift(); }
// 带图片快照的记录（裁剪/自动增强/删除/清空用，图片级可撤销）
function snapWith(mut){
  history.push({ S:{...S}, rotation, straighten, flipH, flipV, ...mut });
  if(history.length>30) history.shift();
}
function setImageFromSrc(index, src, done){
  const rec=images[index]; if(!rec){ done&&done(); return; }
  const ni=new Image();
  ni.onload=()=>{ rec.img=ni; renderThumbs(); render(); done&&done(); };
  ni.src=src;
}
function undo(){
  const h=history.pop(); if(!h){ tip('没有可撤销的了'); return; }
  if(h.removed){ images.splice(Math.min(h.removed.index,images.length),0,h.removed.item); cur=h.removed.index; }
  else if(h.cleared){ images=h.cleared.slice(); cur=0; }
  else {
    Object.assign(S,h.S); rotation=h.rotation; straighten=h.straighten||0; flipH=!!h.flipH; flipV=!!h.flipV;
    if(h.grade && typeof restoreGrade==='function'){ try{ restoreGrade(h.grade); }catch(e){} }
    if(h.imgSnap && images[h.imgSnap.index]){ setImageFromSrc(h.imgSnap.index, h.imgSnap.src); }
  }
  syncSliders(); renderThumbs(); render(); tip('已撤销一步');
}
// 确定性随机：颗粒图案每帧稳定，不闪烁
function rng(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
// 设置持久化：调子记忆，下次打开还在
let persistTimer=null;
function schedulePersist(){ clearTimeout(persistTimer); persistTimer=setTimeout(persist,800); }
function persist(){
  try{
    localStorage.setItem('zhaopian_v1', JSON.stringify({
      S, straighten,
      longEdge: $('longEdgeSel').value, format: $('formatSel').value, quality: $('qualityRange').value,
      wmText: $('wmText').value, border: $('borderRange').value,
      wmPos: $('wmPos').value, wmColor: $('wmColor').value, wmSize: $('wmSize').value,
      wmAlpha: $('wmAlpha').value, wmStroke: $('wmStroke').checked, borderColor: $('borderColorSel').value,
      stickerText: $('stickerText').value, stickerStyle: $('stickerStyle').value,
      stickerPos: $('stickerPos').value, stickerSize: $('stickerSize').value,
      cutCols: $('cutCols').value, cutRows: $('cutRows').value,
      bgMode: $('bgModeSel').value, grade: gradeSnap(),
    }));
  }catch(e){}
}
function restorePersist(){
  try{
    const o=JSON.parse(localStorage.getItem('zhaopian_v1')||'null'); if(!o) return;
    if(o.S) for(const k in S) if(typeof o.S[k]==='number') S[k]=o.S[k];
    if(typeof o.straighten==='number') straighten=o.straighten;
    if(o.longEdge) $('longEdgeSel').value=o.longEdge;
    if(o.format) $('formatSel').value=o.format;
    if(o.quality){ $('qualityRange').value=o.quality; $('qualityRange').nextElementSibling.textContent=o.quality; }
    if(typeof o.wmText==='string') $('wmText').value=o.wmText;
    if(o.border!==undefined) $('borderRange').value=o.border;
    if(o.wmPos) $('wmPos').value=o.wmPos;
    if(o.wmColor) $('wmColor').value=o.wmColor;
    if(o.wmSize){ $('wmSize').value=o.wmSize; $('wmSize').nextElementSibling.textContent=o.wmSize; }
    if(o.wmAlpha){ $('wmAlpha').value=o.wmAlpha; $('wmAlpha').nextElementSibling.textContent=o.wmAlpha; }
    if(typeof o.wmStroke==='boolean') $('wmStroke').checked=o.wmStroke;
    if(o.borderColor) $('borderColorSel').value=o.borderColor;
    if(typeof o.stickerText==='string') $('stickerText').value=o.stickerText;
    if(o.stickerStyle) $('stickerStyle').value=o.stickerStyle;
    if(o.stickerPos) $('stickerPos').value=o.stickerPos;
    if(o.stickerSize){ $('stickerSize').value=o.stickerSize; $('stickerSize').nextElementSibling.textContent=o.stickerSize; }
    if(o.cutCols) $('cutCols').value=o.cutCols;
    if(o.cutRows) $('cutRows').value=o.cutRows;
    if(o.bgMode) $('bgModeSel').value=o.bgMode;
    if(o.grade && typeof restoreGrade==='function'){ try{ restoreGrade(o.grade); }catch(e){} }
  }catch(e){}
}
// 渲染节流：滑杆连发时合到下一帧，避免像素管线卡顿
let rafPending=false;
function requestRender(){ if(rafPending) return; rafPending=true; requestAnimationFrame(()=>{ rafPending=false; render(); }); }

// 预设按钮（含实拍小预览，看得见再点）
const presetList = $('presetList');
window.PRESETS.forEach(p=>{
  const b=document.createElement('button');
  const cv=document.createElement('canvas'); cv.width=144; cv.height=90; cv.style.display='none';
  const lb=document.createElement('span'); lb.textContent=p.name;
  b.appendChild(cv); b.appendChild(lb);
  b.onclick=()=>{ snap(); applyPreset(p.key); };
  p._btn=b; p._cv=cv;
  presetList.appendChild(b);
});
let presetThumbTimer=null;
function schedulePresetThumbs(){ clearTimeout(presetThumbTimer); presetThumbTimer=setTimeout(refreshPresetThumbs,300); }
function refreshPresetThumbs(){
  const hasImg = images.length>0 && images[cur];
  window.PRESETS.forEach(p=>{
    if(!hasImg){ p._cv.style.display='none'; return; }
    p._cv.style.display='block';
    const c=p._cv.getContext('2d'), W=p._cv.width, H=p._cv.height;
    const img=images[cur].img, pr=p.params;
    c.save(); c.filter=`brightness(${pr.brightness}%) brightness(${100+pr.exposure*0.8}%) contrast(${pr.contrast}%) saturate(${pr.saturate}%)`;
    const sr=img.width/img.height, tr=W/H;
    let sw,sh,sx,sy;
    if(sr>tr){ sh=img.height; sw=sh*tr; sx=(img.width-sw)/2; sy=0; }
    else { sw=img.width; sh=sw/tr; sx=0; sy=(img.height-sh)/2; }
    c.drawImage(img,sx,sy,sw,sh,0,0,W,H); c.restore();
    if(pr.warm){ c.save(); c.globalAlpha=Math.abs(pr.warm)/120; c.fillStyle=pr.warm>0?'#ff9a3c':'#3ca9ff'; c.globalCompositeOperation='overlay'; c.fillRect(0,0,W,H); c.restore(); }
    if(pr.vignette){ const g=c.createRadialGradient(W/2,H/2,10,W/2,H/2,90); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,`rgba(0,0,0,${pr.vignette/140})`); c.fillStyle=g; c.fillRect(0,0,W,H); }
  });
}
function applyPreset(key){
  const p = window.PRESETS.find(x=>x.key===key); if(!p) return;
  Object.assign(S, p.params);
  if(key==='none' && typeof resetGrade==='function'){ try{ resetGrade(); }catch(e){} }
  lastPresetBase = {...p.params};
  const inten=$('intensityRange'); if(inten){ inten.value=100; inten.nextElementSibling.textContent=100; }
  syncSliders(); render();
  tip('已套用：'+p.name+'（强度可再拉）');
}
// 预设强度：中性<->预设插值
function applyIntensity(k){
  if(!lastPresetBase){ tip('先选个氛围预设，再拉强度'); return; }
  const N=window.NEUTRAL;
  for(const key in lastPresetBase) S[key]=Math.round((N[key]+(lastPresetBase[key]-N[key])*k/100)*10)/10;
  syncSliders(); render();
}

// 导入（含拖拽复用）
function loadFiles(files){
  [...files].filter(f=>f.type.startsWith('image/')).forEach(f=>{
    const url=URL.createObjectURL(f);
    const img=new Image();
    img.onload=()=>{ images.push({img,url,name:f.name||'未命名',file:f}); if(images.length===1) cur=0; renderThumbs(); render(); tip(`已加入 ${images.length} 张，点缩略图切换`); };
    img.src=url;
  });
}
fileInput.onchange = e=>{ loadFiles(e.target.files); fileInput.value=''; };
['dragover','drop'].forEach(ev=>document.addEventListener(ev,e=>e.preventDefault()));
document.addEventListener('drop',e=>{ if(e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files); });

function renderThumbs(){
  thumbList.innerHTML='';
  images.forEach((o,i)=>{
    const wrap=document.createElement('div');
    wrap.className='thumb'+(i===cur?' active':'');
    wrap.draggable=true; wrap.dataset.i=i;
    const im=document.createElement('img'); im.src=o.url; im.title=o.name+'（拖动排序）';
    im.onclick=()=>{cur=i; renderThumbs(); render();};
    const del=document.createElement('span'); del.className='del'; del.textContent='×'; del.title='删除这张';
    del.onclick=(e)=>{ e.stopPropagation(); delIndex(i); };
    wrap.appendChild(im); wrap.appendChild(del);
    wrap.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',String(i)); wrap.classList.add('dragging'); });
    wrap.addEventListener('dragend',()=>wrap.classList.remove('dragging'));
    wrap.addEventListener('dragover',e=>{ e.preventDefault(); wrap.classList.add('over'); });
    wrap.addEventListener('dragleave',()=>wrap.classList.remove('over'));
    wrap.addEventListener('drop',e=>{
      e.preventDefault(); wrap.classList.remove('over');
      const from=+e.dataTransfer.getData('text/plain'), to=i;
      if(isNaN(from)||from===to) return;
      const [mv]=images.splice(from,1);
      images.splice(to,0,mv);
      if(cur===from) cur=to; else if(cur>from&&cur<=to) cur--; else if(cur<from&&cur>=to) cur++;
      renderThumbs(); render(); tip('已调整顺序');
    });
    thumbList.appendChild(wrap);
  });
  schedulePresetThumbs();
}
function delIndex(i){
  if(!images.length) return;
  snapWith({ removed:{ index:i, item:images[i] } });
  images.splice(i,1); cur=Math.max(0,Math.min(cur,images.length-1));
  renderThumbs(); render(); tip('已删除，可撤销');
}
$('delCurBtn').onclick=()=>delIndex(cur);
$('clearBtn').onclick=()=>{ if(!images.length) return; snapWith({ cleared: images.slice() }); images=[]; cur=0; renderThumbs(); render(); tip('已清空，可撤销'); };

// 滑杆
KEYS.forEach(k=>{
  const el=$('s_'+k); if(!el) return;
  el.oninput=()=>{ S[k]=+el.value; el.nextElementSibling.textContent=el.value; lastPresetBase=null; requestRender(); };
  el.onchange=()=>snap(); // 松手记一步（注意：onchange在input后触发，snap存的是新值；撤销语义可接受）
});
$('straightRange').oninput=e=>{ straighten=+e.target.value; e.target.nextElementSibling.textContent=e.target.value; requestRender(); };
$('straightRange').onchange=()=>snap();
$('intensityRange').oninput=e=>{ e.target.nextElementSibling.textContent=e.target.value; applyIntensity(+e.target.value); };
$('intensityRange').onchange=()=>snap();
function syncSliders(){
  KEYS.forEach(k=>{ const el=$('s_'+k); if(el){ el.value=S[k]; el.nextElementSibling.textContent=S[k]; } });
  const st=$('straightRange'); if(st){ st.value=straighten; st.nextElementSibling.textContent=straighten; }
  paintRanges();
}
// 滑杆进度填充（CSS --fill 渐变用）
function paintRanges(){
  document.querySelectorAll('input[type=range]').forEach(el=>{
    const min=+el.min||0, max=+el.max||100;
    el.style.setProperty('--fill', ((+el.value-min)/Math.max(1,max-min)*100)+'%');
  });
}
document.addEventListener('input',e=>{ if(e.target && e.target.matches && e.target.matches('input[type=range]')) paintRanges(); });
modeSel.onchange=()=>{ $('cutRow').classList.toggle('hidden', modeSel.value!=='cut'); render(); };
$('cutCols').onchange=render; $('cutRows').onchange=render;
function cutSettings(){ return { cols:+$('cutCols').value, rows:+$('cutRows').value }; }
$('gapRange').oninput=e=>{ $('gapVal').textContent=e.target.value; requestRender(); };
$('bgModeSel').onchange=()=>render();
$('borderRange').oninput=()=>requestRender();
$('wmText').oninput=()=>requestRender();
['wmPos','wmColor','wmStroke','borderColorSel'].forEach(id=>{ $(id).onchange=()=>requestRender(); });
$('wmSize').oninput=e=>{ e.target.nextElementSibling.textContent=e.target.value; requestRender(); };
$('wmAlpha').oninput=e=>{ e.target.nextElementSibling.textContent=e.target.value; requestRender(); };
$('stickerText').oninput=()=>requestRender();
['stickerStyle','stickerPos'].forEach(id=>{ $(id).onchange=()=>requestRender(); });
$('stickerSize').oninput=e=>{ e.target.nextElementSibling.textContent=e.target.value; requestRender(); };
$('rotateBtn').onclick=()=>{ snap(); rotation=(rotation+90)%360; render(); };
$('flipHBtn').onclick=()=>{ snap(); flipH=!flipH; render(); tip(flipH?'已水平镜像':'已取消镜像'); };
$('flipVBtn').onclick=()=>{ snap(); flipV=!flipV; render(); tip(flipV?'已垂直翻转':'已取消翻转'); };
$('resetBtn').onclick=()=>{ snap(); Object.assign(S,{brightness:100,contrast:100,saturate:100,exposure:0,warm:0,vignette:0,grain:0,sharpen:0,dehaze:0,soften:0,rain:0,fog:0}); rotation=0; straighten=0; flipH=flipV=false; lastPresetBase=null; if(typeof resetGrade==='function'){ try{ resetGrade(); }catch(e){} } const st=$('straightRange'); if(st){st.value=0;st.nextElementSibling.textContent=0;} const it=$('intensityRange'); if(it){it.value=100;it.nextElementSibling.textContent=100;} syncSliders(); render(); };
$('exportBtn').onclick=()=>doExport();
$('undoBtn').onclick=undo;
document.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); undo(); } });

// ---- 我的预设（存当前调子，localStorage长存） ----
function loadMyPresets(){ try{ return JSON.parse(localStorage.getItem('zhaopian_mypresets')||'[]'); }catch(e){ return []; } }
function storeMyPresets(list){ try{ localStorage.setItem('zhaopian_mypresets', JSON.stringify(list)); }catch(e){ tip('存不下，名字太多了删几个'); } }
function renderMyPresets(){
  const box=$('myPresetList'); box.innerHTML='';
  loadMyPresets().forEach((p,idx)=>{
    const b=document.createElement('button');
    const lb=document.createElement('span'); lb.textContent='⭐ '+p.name;
    const del=document.createElement('b'); del.textContent='×'; del.title='删除'; del.style.cssText='color:#e74c3c;cursor:pointer;margin-left:4px;';
    del.onclick=(e)=>{ e.stopPropagation(); const l=loadMyPresets(); l.splice(idx,1); storeMyPresets(l); renderMyPresets(); };
    b.appendChild(lb); b.appendChild(del);
    b.onclick=()=>{ snap(); Object.assign(S,p.params); if(p.grade && typeof restoreGrade==='function'){ try{ restoreGrade(p.grade); }catch(e){} } lastPresetBase={...p.params}; syncSliders(); render(); tip('已套用我的预设：'+p.name); };
    box.appendChild(b);
  });
}
$('savePresetBtn').onclick=()=>{
  const name=$('myPresetName').value.trim()||('调子'+new Date().toLocaleDateString());
  const l=loadMyPresets(); l.push({ name, params:{...S}, grade:gradeSnap() });
  storeMyPresets(l); $('myPresetName').value=''; renderMyPresets(); tip('已存为我的预设：'+name);
};

// ---- 缩放浏览（滚轮/按钮/双击适应，框选裁剪自动跟随） ----
let zoomMode='fit', zoomF=1;
function applyZoom(){
  const wrap=$('canvasWrap');
  const availW=Math.max(200, wrap.parentElement.clientWidth-28);
  const availH=Math.max(200, window.innerHeight*0.62);
  let f;
  if(zoomMode==='fit') f=Math.min(availW/canvas.width, availH/canvas.height);
  else f=zoomF;
  f=Math.max(0.05,Math.min(8,f)); zoomF=f;
  canvas.style.width=canvas.width+'px'; canvas.style.height=canvas.height+'px'; // 锁定布局盒，缩放只走transform
  canvas.style.transform=`scale(${f})`;
  wrap.style.width=Math.round(canvas.width*f)+'px';
  wrap.style.height=Math.round(canvas.height*f)+'px';
  $('zoomLabel').textContent=Math.round(f*100)+'%';
  updateGrid();
}
$('zoomInBtn').onclick=()=>{ zoomMode='custom'; zoomF=Math.min(8,zoomF*1.25); applyZoom(); };
$('zoomOutBtn').onclick=()=>{ zoomMode='custom'; zoomF=Math.max(0.05,zoomF/1.25); applyZoom(); };
$('zoomFitBtn').onclick=()=>{ zoomMode='fit'; applyZoom(); };
$('zoomLabel').onclick=()=>{ zoomMode='custom'; zoomF=1; applyZoom(); };
canvas.addEventListener('dblclick',()=>{ zoomMode='fit'; applyZoom(); });
canvas.addEventListener('wheel',e=>{ e.preventDefault(); zoomMode='custom'; zoomF=Math.max(0.05,Math.min(8,zoomF*(e.deltaY<0?1.15:1/1.15))); applyZoom(); },{passive:false});
window.addEventListener('resize',()=>applyZoom());
// 三分构图线：裁剪中或校正中显示
function updateGrid(){
  const show = cropping || (straighten!==0 && modeSel.value==='single' && images.length>0);
  $('straightGrid').classList.toggle('hidden', !show);
}
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && cropping) $('cropCancelBtn').click(); });
// 按住看原图
const cmpBtn=$('compareBtn');
cmpBtn.addEventListener('mousedown',()=>{ comparing=true; render(); });
['mouseup','mouseleave'].forEach(ev=>cmpBtn.addEventListener(ev,()=>{ comparing=false; render(); }));
cmpBtn.addEventListener('touchstart',()=>{ comparing=true; render(); });
cmpBtn.addEventListener('touchend',()=>{ comparing=false; render(); });

// ---- 导出设置（A：批量+尺寸压缩+格式） ----
const USE_PRESETS = {
  moment: { longEdge: 1920, format: 'jpeg', quality: 85, label: '朋友圈' },
  small:  { longEdge: 1280, format: 'jpeg', quality: 80, label: '小图' },
  print:  { longEdge: 0, format: 'png', quality: 100, label: '打印' },
};
function getExportSettings(){
  return {
    longEdge: +$('longEdgeSel').value,
    format: $('formatSel').value,
    quality: +$('qualityRange').value,
  };
}
function applyUse(name){
  const u=USE_PRESETS[name]; if(!u) return;
  $('longEdgeSel').value=String(u.longEdge);
  $('formatSel').value=u.format;
  $('qualityRange').value=u.quality;
  $('qualityRange').nextElementSibling.textContent=u.quality;
  scheduleEstimate(); tip(`已切到${u.label}设置：长边${u.longEdge||'原图'} ${u.format.toUpperCase()} 画质${u.quality}`);
}
document.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>applyUse(b.dataset.use));
$('longEdgeSel').onchange=scheduleEstimate;
$('formatSel').onchange=scheduleEstimate;
$('qualityRange').oninput=e=>{ e.target.nextElementSibling.textContent=e.target.value; scheduleEstimate(); };
function mimeOf(fmt){ return fmt==='png'?'image/png':fmt==='webp'?'image/webp':'image/jpeg'; }
function extOf(fmt){ return fmt==='png'?'png':fmt==='webp'?'webp':'jpg'; }
function baseName(name){ return (name||'照片加工').replace(/\.[a-zA-Z0-9]+$/,'').replace(/[\\/:*?"<>|]/g,'_'); }

// 按导出尺寸重绘单图（高质量：从原图画，不用1400预览图，保证打印清晰）
function paintSingleTo(tcanvas, img, rot, skipText=false){
  const { longEdge } = getExportSettings();
  const border=+$('borderRange').value;
  let w=img.width, h=img.height;
  if(rot%180!==0) [w,h]=[h,w];
  if(longEdge>0){
    const sc=Math.min(1,longEdge/Math.max(w,h));
    w=Math.round(w*sc); h=Math.round(h*sc);
  }
  tcanvas.width=w+border*2; tcanvas.height=h+border*2;
  const c=tcanvas.getContext('2d');
  c.fillStyle=borderColor(); c.fillRect(0,0,tcanvas.width,tcanvas.height);
  if(straighten!==0 && !comparing){
    c.save(); c.filter='blur(28px) brightness(62%) saturate(130%)';
    const m=Math.round(Math.max(w,h)*0.04);
    coverTo(c,img,border-m,border-m,w+m*2,h+m*2); c.restore();
  }
  c.save();
  c.filter=effFilter();
  c.translate(border+w/2,border+h/2); c.rotate((rot+straighten)*Math.PI/180);
  c.scale(flipH?-1:1, flipV?-1:1);
  const odd=(Math.round(rot)%180!==0);
  // 注意：旋转后绘制用未旋转的原图尺寸
  let dw=w, dh=h; if(odd){ dw=h; dh=w; }
  // 原图若超导出尺寸，先等比缩到框内（等价于预览逻辑，但以导出尺寸为基准）
  const sc2=Math.min(dw/img.width, dh/img.height);
  const rw=img.width*sc2, rh=img.height*sc2;
  c.drawImage(img,-rw/2,-rh/2,rw,rh);
  c.restore();
  if(!comparing && S.soften>0){ try{ softSkinCanvas(tcanvas); }catch(e){} }
  if(!comparing && typeof applyGrade==='function'){ try{ applyGrade(tcanvas); }catch(e){} }
  paintOverlayTo(c, tcanvas.width, tcanvas.height, true);
  if(!comparing && (S.sharpen>0||S.dehaze>0)){ try{ enhanceCanvas(tcanvas); }catch(e){} }
  paintWeather(c, tcanvas.width, tcanvas.height);
  if(!skipText){ watermarkTo(c,tcanvas.width,tcanvas.height); paintSticker(c,tcanvas.width,tcanvas.height); }
}
// 拼图虚化底：第一张铺满模糊垫底，缝隙不再是死黑死白
function blurBgTo(c,W,H,img){
  c.save(); c.filter='blur(30px) brightness(62%) saturate(140%)';
  coverTo(c,img,-50,-50,W+100,H+100); c.restore();
}
// cover铺底（导出ctx用）
function coverTo(c,img,dx,dy,dw,dh){
  const sr=img.width/img.height, tr=dw/dh;
  let sw,sh,sx,sy;
  if(sr>tr){ sh=img.height; sw=sh*tr; sx=(img.width-sw)/2; sy=0; }
  else { sw=img.width; sh=sw/tr; sx=0; sy=(img.height-sh)/2; }
  c.drawImage(img,sx,sy,sw,sh,dx,dy,dw,dh);
}
// 暗角/颗粒/色温/水印：复用S，画到任意ctx上
function paintOverlayTo(c, w, h, skipWM=false){
  if(comparing){ watermarkTo(c,w,h); return; }
  if(S.warm!==0){
    c.save(); c.globalAlpha=Math.abs(S.warm)/120;
    c.fillStyle=S.warm>0?'#ff9a3c':'#3ca9ff';
    c.globalCompositeOperation='overlay';
    c.fillRect(0,0,w,h); c.restore();
  }
  if(S.vignette>0){
    const g=c.createRadialGradient(w/2,h/2,Math.min(w,h)*0.3,w/2,h/2,Math.max(w,h)*0.75);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,`rgba(0,0,0,${S.vignette/140})`);
    c.fillStyle=g; c.fillRect(0,0,w,h);
  }
  if(S.grain>0){
    c.save(); c.globalAlpha=S.grain/160;
    const R=rng(1234567);
    const n=Math.round(S.grain*Math.max(w,h)/28);
    for(let i=0;i<n;i++){ c.fillStyle=R()>0.5?'#fff':'#000'; c.fillRect(R()*w,R()*h,1.3,1.3); }
    c.restore();
  }
  if(!skipWM) watermarkTo(c,w,h);
}
function watermarkTo(c,w,h){
  paintWMText(c,w,h);
}
// 拼图导出：预览已合成好，按长边等比缩放即可
function scalePreviewTo(tcanvas){
  const { longEdge } = getExportSettings();
  let w=canvas.width, h=canvas.height;
  if(longEdge>0){ const sc=Math.min(1,longEdge/Math.max(w,h)); w=Math.round(w*sc); h=Math.round(h*sc); }
  tcanvas.width=w; tcanvas.height=h;
  tcanvas.getContext('2d').drawImage(canvas,0,0,w,h);
}
function exportCanvasForSingle(i){
  const t=document.createElement('canvas');
  paintSingleTo(t, images[i].img, i===cur?rotation:0);
  return t;
}
// 切图底图（无宫格线/水印/贴纸，旋转边框忽略，纯净分片）
function cutBaseCanvas(){
  const t=document.createElement('canvas');
  const img=images[cur].img;
  const { longEdge }=getExportSettings();
  let w=img.width, h=img.height;
  if(longEdge>0){ const sc=Math.min(1,longEdge/Math.max(w,h)); w=Math.round(w*sc); h=Math.round(h*sc); }
  t.width=w; t.height=h;
  const c=t.getContext('2d');
  c.save(); c.filter=effFilter(); c.drawImage(img,0,0,w,h); c.restore();
  if(S.warm!==0){ c.save(); c.globalAlpha=Math.abs(S.warm)/120; c.fillStyle=S.warm>0?'#ff9a3c':'#3ca9ff'; c.globalCompositeOperation='overlay'; c.fillRect(0,0,w,h); c.restore(); }
  if(!comparing && S.soften>0){ try{ softSkinCanvas(t); }catch(e){} }
  if(!comparing && typeof applyGrade==='function'){ try{ applyGrade(t); }catch(e){} }
  paintOverlayTo(c,w,h,true); // 暗角颗粒，无水印
  if(!comparing && (S.sharpen>0||S.dehaze>0)){ try{ enhanceCanvas(t); }catch(e){} }
  paintWeather(c,w,h);
  return t;
}
// 切图导出整图一张
async function exportCutFull(){
  const t=cutBaseCanvas();
  const { format }=getExportSettings();
  const bytes=await downloadCanvas(t, `${baseName(images[cur].name)}_切图底图_${t.width}x${t.height}.${extOf(format)}`);
  tip(`整图已导出 ${t.width}x${t.height} ${fmtKB(bytes)}，要分片点批量打ZIP`);
}
// 切图分片打ZIP（N张原尺寸拼回去正好一张）
async function exportCutZip(){
  if(typeof JSZip==='undefined'){ tip('ZIP组件没加载上，试试重启软件'); return; }
  const { cols, rows }=cutSettings();
  const { format }=getExportSettings();
  const base=cutBaseCanvas();
  const zip=new JSZip();
  const cw=Math.floor(base.width/cols), ch=Math.floor(base.height/rows);
  let n=0;
  for(let j=0;j<rows;j++) for(let i=0;i<cols;i++){
    n++;
    const x=i*cw, y=j*ch, w=(i===cols-1)?base.width-x:cw, h=(j===rows-1)?base.height-y:ch;
    const cell=document.createElement('canvas'); cell.width=w; cell.height=h;
    cell.getContext('2d').drawImage(base,x,y,w,h,0,0,w,h);
    tip(`正在切片 ${n}/${cols*rows}…`);
    const blob=await canvasToBlob(cell);
    zip.file(`${baseName(images[cur].name)}_九宫格${n}.${extOf(format)}`, blob);
  }
  tip('正在生成ZIP…');
  const zipBlob=await zip.generateAsync({ type:'blob' });
  await saveBlob(zipBlob, `${baseName(images[cur].name)}_切图${cols}x${rows}_${Date.now()}.zip`);
  tip(`已切成 ${cols*rows} 张，按1-${cols*rows}顺序发朋友圈即拼回整图`);
}
function canvasToBlob(tcanvas){
  const { format, quality } = getExportSettings();
  return new Promise(res=>{
    tcanvas.toBlob(b=>res(b), mimeOf(format), format==='png'?undefined:quality/100);
  });
}
// 桌面优先走系统另存为对话框，浏览器里则走下载
async function saveBlob(blob, filename){
  if(!blob) return 0;
  const { format } = getExportSettings();
  if(window.electronAPI && window.electronAPI.saveBuffer){
    const buf=await blob.arrayBuffer();
    const ext=extOf(format);
    const r=await window.electronAPI.saveBuffer(buf, {
      defaultName: filename,
      filters: [{ name: ext.toUpperCase()+'图片', extensions: [ext] }, { name: '所有文件', extensions: ['*'] }]
    });
    if(r && r.saved) tip('已保存：'+r.filePath);
    return blob.size;
  }
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  return blob.size;
}
async function downloadCanvas(tcanvas, filename){
  const blob=await canvasToBlob(tcanvas);
  return saveBlob(blob, filename);
}
const fmtKB = b => b>1048576 ? (b/1048576).toFixed(2)+'MB' : Math.round(b/1024)+'KB';

// 大小预估（防抖，只估当前视图）
let estTimer=null;
function scheduleEstimate(){ clearTimeout(estTimer); estTimer=setTimeout(estimateSize,450); }
async function estimateSize(){
  if(!images.length){ $('sizeTip').textContent='—'; return; }
  try{
    const { longEdge, format, quality } = getExportSettings();
    const t=document.createElement('canvas');
    if(modeSel.value==='single') paintSingleTo(t, images[cur].img, rotation);
    else if(modeSel.value==='cut'){
      const full=cutBaseCanvas();
      const sc=Math.min(1,960/Math.max(full.width,full.height));
      t.width=Math.max(1,Math.round(full.width*sc)); t.height=Math.max(1,Math.round(full.height*sc));
      t.getContext('2d').drawImage(full,0,0,t.width,t.height);
      const q=format==='png'?undefined:quality/100;
      const b=await new Promise(r=>t.toBlob(r, mimeOf(format), q));
      const ratio=(full.width*full.height)/(t.width*t.height);
      $('sizeTip').textContent=`约${fmtKB(b.size*ratio)} · 整图${full.width}x${full.height}→${cutSettings().cols*cutSettings().rows}片 ${extOf(format).toUpperCase()}${format==='png'?'':' '+quality}`;
      return;
    }
    else scalePreviewTo(t);
    const q=format==='png'?undefined:quality/100;
    const b=await new Promise(r=>t.toBlob(r, mimeOf(format), q));
    $('sizeTip').textContent=`约${fmtKB(b.size)} · ${t.width}x${t.height} ${extOf(format).toUpperCase()}${format==='png'?'':' '+quality}`;
  }catch{ $('sizeTip').textContent='—'; }
}
// 供视频页读取：照片调子全局共享（一套参数两处用）
window.getPhotoState = () => ({ S, rotation, flipH, flipV, straighten });
// 预览变化后刷新预估
const _render=render;
render=function(){ _render(); scheduleEstimate(); schedulePersist(); scheduleHistogram(); scheduleInfo(); if(typeof applyVidFilters==='function') applyVidFilters(); };

// 批量导出：当前效果套到每张图，打成一个ZIP（一次对话框，不再连弹）
$('batchBtn').onclick=batchExport;
async function batchExport(){
  if(!images.length){ tip('先放照片进来'); return; }
  if(modeSel.value==='cut'){ exportCutZip(); return; }
  if(modeSel.value!=='single'){
    const t=document.createElement('canvas'); scalePreviewTo(t);
    const bytes=await downloadCanvas(t, `拼图_${Date.now()}.${extOf(getExportSettings().format)}`);
    tip(`拼图已导出（${fmtKB(bytes)}），批量请先切单图模式`); return;
  }
  if(typeof JSZip==='undefined'){ tip('ZIP组件没加载上，试试重启软件'); return; }
  const { longEdge, format } = getExportSettings();
  const zip=new JSZip();
  for(let i=0;i<images.length;i++){
    tip(`正在打包 ${i+1}/${images.length}…`);
    const t=exportCanvasForSingle(i);
    const blob=await canvasToBlob(t);
    zip.file(`${baseName(images[i].name)}_加工_${t.width}x${t.height}.${extOf(format)}`, blob);
    await new Promise(r=>setTimeout(r,30));
  }
  tip('正在生成ZIP…');
  const zipBlob=await zip.generateAsync({ type:'blob' }, meta=>{ tip(`正在生成ZIP ${Math.round(meta.percent)}%…`); });
  await saveBlob(zipBlob, `照片加工_批量${images.length}张_${Date.now()}.zip`);
  tip(`已批量打包 ${images.length} 张（长边${longEdge||'原图'} ${extOf(format).toUpperCase()}）`);
}

// ---- 绘制 ----
function effFilter(){
  if(comparing) return 'none';
  const exp = 100 + S.exposure*0.8;
  return `brightness(${S.brightness}%) brightness(${exp}%) contrast(${S.contrast}%) saturate(${S.saturate}%)`;
}
// cover模式：目标框 dw,dh，居中裁源图铺满（修网格拉伸）
function drawCover(img,dx,dy,dw,dh){
  const sr=img.width/img.height, tr=dw/dh;
  let sw,sh,sx,sy;
  if(sr>tr){ sh=img.height; sw=sh*tr; sx=(img.width-sw)/2; sy=0; }
  else { sw=img.width; sh=sw/tr; sx=0; sy=(img.height-sh)/2; }
  ctx.drawImage(img,sx,sy,sw,sh,dx,dy,dw,dh);
}
function drawOne(img, dx,dy,dw,dh, cover=false){
  const single = modeSel.value==='single' && !cover;
  // 校正露出的边：用模糊铺底盖住（白边难看，学主流修图做法）
  if(single && straighten!==0 && !comparing){
    ctx.save(); ctx.filter='blur(28px) brightness(62%) saturate(130%)';
    const m=46; drawCover(img,dx-m,dy-m,dw+m*2,dh+m*2); ctx.restore();
  }
  ctx.save();
  ctx.filter=effFilter();
  if(single){
    ctx.translate(dx+dw/2,dy+dh/2); ctx.rotate((rotation+straighten)*Math.PI/180);
    ctx.scale(flipH?-1:1, flipV?-1:1);
    // 旋转90/270度时宽高互换才不溢出
    const odd = (Math.round(rotation)%180!==0);
    if(odd){ const w=Math.min(dw,dh), h=Math.max(dw,dh); ctx.drawImage(img,-w/2,-h/2,w,h); }
    else ctx.drawImage(img,-dw/2,-dh/2,dw,dh);
  } else if(cover){ drawCover(img,dx,dy,dw,dh); }
  else ctx.drawImage(img,dx,dy,dw,dh);
  ctx.restore();
  if(!comparing && S.warm!==0){
    ctx.save(); ctx.globalAlpha=Math.abs(S.warm)/120;
    ctx.fillStyle = S.warm>0 ? '#ff9a3c' : '#3ca9ff';
    ctx.globalCompositeOperation='overlay';
    ctx.fillRect(dx,dy,dw,dh); ctx.restore();
  }
}
function addVignetteGrain(w,h,skipWM=false){
  if(comparing) { drawWatermark(w,h); return; }
  if(S.vignette>0){
    const g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.3,w/2,h/2,Math.max(w,h)*0.75);
    g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,`rgba(0,0,0,${S.vignette/140})`);
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  }
  if(S.grain>0){
    ctx.save(); ctx.globalAlpha=S.grain/160;
    const R=rng(1234567); // 固定种子，图案稳定不闪
    for(let i=0;i<S.grain*60;i++){
      ctx.fillStyle=R()>0.5?'#fff':'#000';
      ctx.fillRect(R()*w,R()*h,1.3,1.3);
    }
    ctx.restore();
  }
  if(!skipWM) drawWatermark(w,h);
}
function borderColor(){ const el=$('borderColorSel'); return el?el.value:'#ffffff'; }
function drawWatermark(w,h){ paintWMText(ctx,w,h); }
function paintWMText(c,w,h){
  const t=$('wmText').value.trim(); if(!t) return;
  const pos=$('wmPos').value, px=Math.max(10,Math.round(w*0.018)), py=Math.max(8,Math.round(h*0.03));
  const fs=Math.max(12,Math.round(w*(+$('wmSize').value)/100));
  c.save();
  c.font=`${fs}px "Microsoft YaHei"`;
  c.globalAlpha=(+$('wmAlpha').value)/100;
  c.fillStyle=$('wmColor').value;
  c.textBaseline='alphabetic';
  let x,y;
  if(pos==='tl'){ c.textAlign='left'; x=px; y=py+fs; }
  else if(pos==='tr'){ c.textAlign='right'; x=w-px; y=py+fs; }
  else if(pos==='bl'){ c.textAlign='left'; x=px; y=h-py; }
  else if(pos==='c'){ c.textAlign='center'; x=w/2; y=h/2+fs/3; }
  else { c.textAlign='right'; x=w-px; y=h-py; }
  if($('wmStroke').checked){ c.lineWidth=Math.max(1,fs*0.08); c.strokeStyle='rgba(0,0,0,.65)'; c.strokeText(t,x,y); }
  c.fillText(t,x,y);
  c.restore();
}

function render(){
  cropBox.classList.add('hidden');
  if(!images.length){ canvas.width=800; canvas.height=450; ctx.fillStyle='#111'; ctx.fillRect(0,0,800,450);
    ctx.fillStyle='#666'; ctx.font='20px sans-serif'; ctx.textAlign='center'; ctx.fillText('把照片拖进来就行（可多张）',400,230); applyZoom(); return; }
  const mode=modeSel.value, gap=+$('gapRange').value, border=+$('borderRange').value;
  ctx.filter='none';
  if(mode==='single'){
    const img=images[cur].img;
    let w=img.width,h=img.height;
    const max=1400, sc=Math.min(1,max/Math.max(w,h)); w=Math.round(w*sc); h=Math.round(h*sc);
    if(rotation%180!==0){ canvas.width=h+border*2; canvas.height=w+border*2; drawBg(); drawOne(img,border,border,h,w); }
    else { canvas.width=w+border*2; canvas.height=h+border*2; drawBg(); drawOne(img,border,border,w,h); }
    finishCanvas();
  } else if(mode==='cut'){
    // 切图：色调+质感全吃，水印贴纸不进分片，旋转翻转在切图里忽略
    const img=images[cur].img;
    let w=img.width,h=img.height;
    const max=1400, sc=Math.min(1,max/Math.max(w,h)); w=Math.round(w*sc); h=Math.round(h*sc);
    canvas.width=w; canvas.height=h;
    ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h);
    drawOne(img,0,0,w,h);
    if(!comparing && S.soften>0){ try{ softSkinCanvas(canvas); }catch(e){} }
    addVignetteGrain(w,h,true);
    if(!comparing && (S.sharpen>0||S.dehaze>0)){ try{ enhanceCanvas(canvas); }catch(e){} }
    paintWeather(ctx,w,h);
    drawCutGrid(w,h);
  } else {
    const list = images.slice(0, mode==='grid'?9:9);
    if(!list.length) return;
    let W=0,H=0;
    if(mode==='h'){ H=800; const ws=list.map(o=>o.img.width/o.img.height*H); W=Math.round(ws.reduce((a,b)=>a+b,0)+gap*(list.length-1)); }
    if(mode==='v'){ W=800; const hs=list.map(o=>o.img.height/o.img.width*W); H=Math.round(hs.reduce((a,b)=>a+b,0)+gap*(list.length-1)); }
    let gCols=2, gRows=2;
    if(mode==='grid'){
      const n=list.length;
      gCols = n<=2?n:(n<=4?2:3); gRows=Math.ceil(n/gCols);
      W=1000; H=Math.round(1000*gRows/gCols);
    }
    canvas.width=W+border*2; canvas.height=H+border*2;
    if($('bgModeSel').value==='blur' && !comparing){ blurBgTo(ctx,canvas.width,canvas.height,list[0].img); }
    else { ctx.fillStyle=borderColor(); ctx.fillRect(0,0,canvas.width,canvas.height); }
    if(mode==='h'){ let x=border; list.forEach(o=>{ const w=o.img.width/o.img.height*H; drawOne(o.img,x,border,w,H); x+=w+gap; }); }
    if(mode==='v'){ let y=border; list.forEach(o=>{ const h=o.img.height/o.img.width*W; drawOne(o.img,border,y,W,h); y+=h+gap; }); }
    if(mode==='grid'){
      const cw=(W-gap*(gCols-1))/gCols, ch=(H-gap*(gRows-1))/gRows;
      list.forEach((o,i)=>{ drawOne(o.img,border+(i%gCols)*(cw+gap),border+Math.floor(i/gCols)*(ch+gap),cw,ch,true); });
    }
    finishCanvas();
  }
  applyZoom(); // 跟随画布尺寸，更新显示缩放与构图线
  function drawBg(){ ctx.fillStyle=borderColor(); ctx.fillRect(0,0,canvas.width,canvas.height); }
  // 收尾：磨皮 -> 曲线HSL -> 暗角颗粒 -> 锐化去雾(像素级) -> 雨雾 -> 水印贴纸(保持清晰)
  function finishCanvas(){
    if(!comparing && S.soften>0){ try{ softSkinCanvas(canvas); }catch(e){} }
    if(!comparing && typeof applyGrade==='function'){ try{ applyGrade(canvas); }catch(e){} }
    addVignetteGrain(canvas.width,canvas.height,true);
    if(!comparing && (S.sharpen>0||S.dehaze>0)){ try{ enhanceCanvas(canvas); }catch(e){ /* 大图内存不足则跳过 */ } }
    paintWeather(ctx,canvas.width,canvas.height);
    drawWatermark(canvas.width,canvas.height);
    paintSticker(ctx,canvas.width,canvas.height);
  }
}

// ---- 锐化 / 去雾清晰（像素级，预览+导出共用） ----
function enhanceCanvas(tcanvas){
  const c=tcanvas.getContext('2d');
  const w=tcanvas.width, h=tcanvas.height;
  if(w*h>30000000) return; // 3千万像素以上跳过，防内存爆
  const img=c.getImageData(0,0,w,h);
  const d=img.data;
  const deh=S.dehaze/100, shp=S.sharpen/100;
  let blur=null;
  if(deh>0){
    const r=Math.max(4,Math.round(Math.min(w,h)/60)); // 局部对比半径
    blur=boxBlur(d,w,h,r);
  }
  const sharpCore=1+4*shp*0.9, sharpSide=-shp*0.9;
  const src=Uint8ClampedArray.from(d); // 锐化卷积读原值
  const bp=deh*38, wp=255-deh*14, span=Math.max(1,wp-bp); // 去雾黑白场
  const satBoost=1+deh*0.35;
  for(let i=0;i<d.length;i+=4){
    let r0=d[i], g0=d[i+1], b0=d[i+2];
    if(deh>0){
      const j=(i/4)|0;
      const br=blur[j*3], bg=blur[j*3+1], bb=blur[j*3+2];
      const amt=deh*0.85;
      r0=r0+(r0-br)*amt; g0=g0+(g0-bg)*amt; b0=b0+(b0-bb)*amt;
      r0=(r0-bp)/span*255; g0=(g0-bp)/span*255; b0=(b0-bp)/span*255;
      const avg=(r0+g0+b0)/3;
      r0=avg+(r0-avg)*satBoost; g0=avg+(g0-avg)*satBoost; b0=avg+(b0-avg)*satBoost;
    }
    if(shp>0){
      // 3x3卷积：逐像素取邻域（边缘钳制），只在锐化>0时走
      const p=(i/4)|0, x=p%w, y=(p/w)|0;
      const at=(xx,yy)=>{ xx=Math.min(w-1,Math.max(0,xx)); yy=Math.min(h-1,Math.max(0,yy)); return (yy*w+xx)*4; };
      const c0=at(x,y), cl=at(x-1,y), cr=at(x+1,y), cu=at(x,y-1), cd=at(x,y+1);
      r0=src[c0]*sharpCore+(src[cl]+src[cr]+src[cu]+src[cd])*sharpSide;
      g0=src[c0+1]*sharpCore+(src[cl+1]+src[cr+1]+src[cu+1]+src[cd+1])*sharpSide;
      b0=src[c0+2]*sharpCore+(src[cl+2]+src[cr+2]+src[cu+2]+src[cd+2])*sharpSide;
    }
    d[i]=r0; d[i+1]=g0; d[i+2]=b0;
  }
  c.putImageData(img,0,0);
}
// 滑动窗口盒式模糊，返回Float32Array(w*h*3)，O(n)与半径无关
function boxBlur(d,w,h,r){
  const n=w*h;
  const tmp=new Float32Array(n*3), out=new Float32Array(n*3);
  const div=2*r+1;
  for(let y=0;y<h;y++){ // 横向
    let ar=0,ag=0,ab=0;
    for(let x=-r;x<=r;x++){ const xx=Math.min(w-1,Math.max(0,x)); const j=(y*w+xx)*4; ar+=d[j]; ag+=d[j+1]; ab+=d[j+2]; }
    for(let x=0;x<w;x++){
      const j=(y*w+x)*3; tmp[j]=ar/div; tmp[j+1]=ag/div; tmp[j+2]=ab/div;
      const jo=(y*w+Math.max(0,x-r))*4, jn=(y*w+Math.min(w-1,x+r+1))*4;
      ar+=d[jn]-d[jo]; ag+=d[jn+1]-d[jo+1]; ab+=d[jn+2]-d[jo+2];
    }
  }
  for(let x=0;x<w;x++){ // 纵向
    let ar=0,ag=0,ab=0;
    for(let y=-r;y<=r;y++){ const yy=Math.min(h-1,Math.max(0,y)); const j=(yy*w+x)*3; ar+=tmp[j]; ag+=tmp[j+1]; ab+=tmp[j+2]; }
    for(let y=0;y<h;y++){
      const j=(y*w+x)*3; out[j]=ar/div; out[j+1]=ag/div; out[j+2]=ab/div;
      const jo=(Math.max(0,y-r)*w+x)*3, jn=(Math.min(h-1,y+r+1)*w+x)*3;
      ar+=tmp[jn]-tmp[jo]; ag+=tmp[jn+1]-tmp[jo+1]; ab+=tmp[jn+2]-tmp[jo+2];
    }
  }
  return out;
}

// ---- 磨皮柔肤：表面模糊（只平低反差区，边缘/头发丝不动） ----
function softSkinCanvas(tcanvas){
  const amt=S.soften/100; if(amt<=0||comparing) return;
  const w=tcanvas.width, h=tcanvas.height;
  const c=tcanvas.getContext('2d');
  const half=(w*h>10000000); // 千万像素以上半尺寸做，省内存
  const tw=half?Math.round(w/2):w, th=half?Math.round(h/2):h;
  let srcData, octx=null, off=null;
  if(half){ off=document.createElement('canvas'); off.width=tw; off.height=th; octx=off.getContext('2d'); octx.drawImage(tcanvas,0,0,tw,th); srcData=octx.getImageData(0,0,tw,th); }
  else srcData=c.getImageData(0,0,w,h);
  const d=srcData.data, tn=tw*th;
  const r=Math.max(2,Math.min(9,Math.round(Math.min(tw,th)/300)));
  const blur=boxBlur(d,tw,th,r);
  const T=22;
  for(let p=0;p<tn;p++){
    const i=p*4, j=p*3;
    const lum=(d[i]+d[i+1]+d[i+2])/3, bl=(blur[j]+blur[j+1]+blur[j+2])/3;
    let k=1-Math.abs(lum-bl)/T; k=k<0?0:k>1?1:k; k=k*k*(3-2*k);
    const b=k*amt;
    if(b<=0.001) continue;
    d[i]+=(blur[j]-d[i])*b; d[i+1]+=(blur[j+1]-d[i+1])*b; d[i+2]+=(blur[j+2]-d[i+2])*b;
  }
  if(off){ octx.putImageData(srcData,0,0); c.save(); c.filter='none'; c.drawImage(off,0,0,w,h); c.restore(); }
  else c.putImageData(srcData,0,0);
}
// ---- 雨丝 + 雾气（雨天氛围直接加上） ----
function paintWeather(c,w,h){
  if(comparing) return;
  if(S.fog>0){
    const a=S.fog/100;
    const g=c.createLinearGradient(0,0,0,h);
    g.addColorStop(0,`rgba(235,242,248,${a*0.18})`);
    g.addColorStop(0.55,`rgba(235,242,248,${a*0.3})`);
    g.addColorStop(1,`rgba(235,242,248,${a*0.55})`);
    c.save(); c.fillStyle=g; c.fillRect(0,0,w,h); c.restore();
  }
  if(S.rain>0){
    const R=rng(20260614); // 固定种子，雨丝不闪
    const n=Math.min(8000, Math.round(S.rain*Math.max(w,h)/45));
    const lenBase=h/22, ang=-0.28;
    c.save(); c.lineCap='round';
    for(let i=0;i<n;i++){
      const x=R()*w, y=R()*h, len=lenBase*(0.6+R()*0.8);
      c.strokeStyle=`rgba(210,228,245,${0.10+R()*0.20})`;
      c.lineWidth=Math.max(1,w/1400*(0.8+R()*0.8));
      c.beginPath(); c.moveTo(x,y); c.lineTo(x+Math.sin(ang)*len,y+Math.cos(ang)*len); c.stroke();
    }
    c.restore();
  }
}
// ---- 标题贴纸 ----
function paintSticker(c,w,h){
  const t=$('stickerText').value.trim(); if(!t||comparing) return;
  const style=$('stickerStyle').value, pos=$('stickerPos').value;
  const fs=Math.max(14,Math.round(w*(+$('stickerSize').value)/100));
  c.save();
  try{ c.letterSpacing='2px'; }catch(e){}
  c.font=`900 ${fs}px "Microsoft YaHei", sans-serif`;
  c.textAlign='center'; c.textBaseline='middle';
  const x=w/2, y=pos==='top'?h*0.16:pos==='center'?h*0.5:h*0.84;
  if(style==='seal'){
    c.font=`900 ${fs}px "SimSun", "Microsoft YaHei", serif`;
    const pad=fs*0.45, twm=c.measureText(t).width;
    c.fillStyle='#b8322a';
    roundRectPath(c, x-twm/2-pad, y-fs*0.72, twm+pad*2, fs*1.44, fs*0.18); c.fill();
    c.fillStyle='#fff'; c.fillText(t,x,y+fs*0.03);
  } else {
    const conf={ white:['#ffffff','rgba(0,0,0,.7)'], black:['#1a1a1a','rgba(255,255,255,.85)'], gold:['#ffd75e','rgba(90,50,0,.8)'] }[style]||['#ffffff','rgba(0,0,0,.7)'];
    c.lineWidth=Math.max(2,fs*0.12); c.strokeStyle=conf[1];
    c.shadowColor='rgba(0,0,0,.45)'; c.shadowBlur=fs*0.25; c.shadowOffsetY=fs*0.06;
    c.strokeText(t,x,y); c.fillStyle=conf[0]; c.fillText(t,x,y);
  }
  c.restore();
}
function roundRectPath(c,x,y,w,h,r){ c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }

// ---- 照片信息条（尺寸/大小/EXIF拍摄参数） ----
let infoTimer=null;
function scheduleInfo(){ clearTimeout(infoTimer); infoTimer=setTimeout(updatePhotoInfo,500); }
async function updatePhotoInfo(){
  const el=$('photoInfo'); if(!el) return;
  if(!images.length){ el.textContent='把照片拖进来就行'; return; }
  const o=images[cur], idx=cur;
  const dims=`${o.img.width}×${o.img.height}`;
  const kb=o.file?fmtKB(o.file.size):'';
  let ex='';
  try{
    if(o.file && typeof exifr!=='undefined'){
      if(!('exif' in o)){ o.exif=await exifr.parse(o.file).catch(()=>null); }
      if(idx!==cur) return; // 切图了就丢掉过期结果
      const x=o.exif;
      if(x){
        const parts=[];
        if(x.Model) parts.push(String(x.Model).trim());
        if(x.FNumber) parts.push('f/'+(+x.FNumber).toFixed(1));
        if(x.ExposureTime) parts.push(x.ExposureTime>=1?x.ExposureTime+'s':'1/'+Math.round(1/x.ExposureTime)+'s');
        const iso=x.ISO||x.ISOSpeedRatings; if(iso) parts.push('ISO'+iso);
        if(x.DateTimeOriginal){ const d=new Date(x.DateTimeOriginal); if(!isNaN(d)) parts.push(d.toLocaleDateString()); }
        ex=parts.join(' · ');
      }
    }
  }catch(e){}
  el.textContent=[o.name,dims,kb,ex].filter(Boolean).join(' ｜ ');
}

// ---- 直方图 + 自动增强（一键救废片） ----
let histTimer=null;
function scheduleHistogram(){ clearTimeout(histTimer); histTimer=setTimeout(drawHistogram,400); }
function drawHistogram(){
  const cv=$('histCanvas'); if(!cv) return;
  const c=cv.getContext('2d'), W=cv.width, H=cv.height;
  c.clearRect(0,0,W,H); c.fillStyle='#111'; c.fillRect(0,0,W,H);
  if(!images.length){ c.fillStyle='#555'; c.font='12px sans-serif'; c.textAlign='center'; c.fillText('暂无数据',W/2,H/2); return; }
  let data;
  try{ data=ctx.getImageData(0,0,canvas.width,canvas.height).data; }
  catch(e){ return; }
  const BINS=64, rh=new Array(BINS).fill(0), gh=new Array(BINS).fill(0), bh=new Array(BINS).fill(0);
  const step=Math.max(4, Math.floor(data.length/4/30000)*4);
  for(let i=0;i<data.length;i+=step){
    rh[data[i]>>2]++; gh[data[i+1]>>2]++; bh[data[i+2]>>2]++;
  }
  const mx=Math.max(...rh,...gh,...bh,1);
  const plot=(arr,color)=>{
    c.strokeStyle=color; c.lineWidth=1.2; c.beginPath();
    for(let b=0;b<BINS;b++){ const x=b/(BINS-1)*W, y=H-4-(arr[b]/mx)*(H-10); b?c.lineTo(x,y):c.moveTo(x,y); }
    c.stroke();
  };
  c.strokeStyle='#333'; c.beginPath(); c.moveTo(0,H-4.5); c.lineTo(W,H-4.5); c.stroke();
  plot(rh,'rgba(255,90,90,.9)'); plot(gh,'rgba(110,220,110,.9)'); plot(bh,'rgba(110,160,255,.9)');
}
$('autoBtn').onclick=autoEnhance;
function autoEnhance(){
  if(!images.length){ tip('先放照片进来'); return; }
  if(modeSel.value!=='single'){ tip('先切到单图再自动增强'); return; }
  snapWith({ imgSnap:{ index:cur, src:images[cur].img.src } });
  const img=images[cur].img;
  // 小图统计，大图套LUT（快且准）
  const sc=Math.min(1,900/Math.max(img.width,img.height));
  const sw=Math.max(1,Math.round(img.width*sc)), sh=Math.max(1,Math.round(img.height*sc));
  const sOff=document.createElement('canvas'); sOff.width=sw; sOff.height=sh;
  const sctx=sOff.getContext('2d'); sctx.drawImage(img,0,0,sw,sh);
  const sd=sctx.getImageData(0,0,sw,sh).data;
  const N=sw*sh, hR=new Array(256).fill(0), hG=new Array(256).fill(0), hB=new Array(256).fill(0);
  let aR=0,aG=0,aB=0;
  for(let i=0;i<sd.length;i+=4){ hR[sd[i]]++; hG[sd[i+1]]++; hB[sd[i+2]]++; aR+=sd[i]; aG+=sd[i+1]; aB+=sd[i+2]; }
  aR/=N; aG/=N; aB/=N;
  const avgL=(aR+aG+aB)/3;
  const cut=N*0.01;
  const bounds=h=>{ let lo=0,hi=255,acc=0; for(let v=0;v<256;v++){ acc+=h[v]; if(acc>=cut){lo=v;break;} } acc=0; for(let v=255;v>=0;v--){ acc+=h[v]; if(acc>=cut){hi=v;break;} } if(hi-lo<24){lo=Math.max(0,lo-12);hi=Math.min(255,hi+12);} return [lo,Math.max(lo+1,hi)]; };
  const [loR,hiR]=bounds(hR), [loG,hiG]=bounds(hG), [loB,hiB]=bounds(hB);
  const gR=clamp(avgL/Math.max(1,aR),[0.8,1.25]), gG=clamp(avgL/Math.max(1,aG),[0.8,1.25]), gB=clamp(avgL/Math.max(1,aB),[0.8,1.25]);
  const mkLUT=(lo,hi,g)=>{ const t=new Uint8ClampedArray(256); for(let v=0;v<256;v++) t[v]=(v-lo)/(hi-lo)*255*g; return t; };
  const LR=mkLUT(loR,hiR,gR), LG=mkLUT(loG,hiG,gG), LB=mkLUT(loB,hiB,gB);
  const full=document.createElement('canvas'); full.width=img.width; full.height=img.height;
  const fctx=full.getContext('2d'); fctx.drawImage(img,0,0);
  const fd=fctx.getImageData(0,0,full.width,full.height), dd=fd.data;
  for(let i=0;i<dd.length;i+=4){ dd[i]=LR[dd[i]]; dd[i+1]=LG[dd[i+1]]; dd[i+2]=LB[dd[i+2]]; }
  fctx.putImageData(fd,0,0);
  setImageFromSrc(cur, full.toDataURL('image/png'), ()=>{ schedulePresetThumbs(); tip('已自动增强：拉开层次+校正偏色，不满意可撤销'); });
}

// 切图宫格线 + 序号（只画在预览上，不进导出）
function drawCutGrid(w,h){
  const {cols,rows}=cutSettings();
  ctx.save();
  ctx.strokeStyle='rgba(255,255,255,.75)'; ctx.lineWidth=Math.max(1,w/700);
  for(let i=1;i<cols;i++){ const x=w*i/cols; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let j=1;j<rows;j++){ const y=h*j/rows; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  ctx.font=`${Math.max(12,Math.round(w*0.025))}px sans-serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
  let n=0;
  for(let j=0;j<rows;j++) for(let i=0;i<cols;i++){
    n++;
    const cx=w*(i+0.5)/cols, cy=h*(j+0.5)/rows, r=Math.max(10,Math.round(w*0.02));
    ctx.fillStyle='rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.fill();
    ctx.fillStyle='#fff'; ctx.fillText(n,cx,cy+1);
  }
  ctx.restore();
}

// ---- 裁剪（仅单图） ----
$('cropBtn').onclick=startCrop;
function startCrop(){
  if(modeSel.value!=='single'){ tip('先切到“单图精修”再裁剪'); return; }
  if(!images.length){ tip('先放照片进来'); return; }
  cropping=true; cropRect=null;
  updateGrid();
  $('cropOkBtn').classList.remove('hidden'); $('cropCancelBtn').classList.remove('hidden');
  tip('在图上按住拖出框，可选比例，点 ✓ 确认');
}
$('cropCancelBtn').onclick=()=>{ cropping=false; cropBox.classList.add('hidden'); $('cropOkBtn').classList.add('hidden'); $('cropCancelBtn').classList.add('hidden'); updateGrid(); tip('已取消裁剪'); };
$('cropOkBtn').onclick=()=>{
  if(!cropRect){ tip('先在图上框选一块'); return; }
  snapWith({ imgSnap:{ index:cur, src:images[cur].img.src } });
  const rect=canvas.getBoundingClientRect();
  const sx=canvas.width/rect.width, sy=canvas.height/rect.height;
  const border=+$('borderRange').value;
  // 转回图片坐标（含白边偏移）
  let x=(cropRect.x)*sx-border, y=(cropRect.y)*sy-border, w=cropRect.w*sx, h=cropRect.h*sy;
  const img=images[cur].img;
  const dispW = (rotation%180!==0? canvas.height-2*border : canvas.width-2*border);
  const dispH = (rotation%180!==0? canvas.width-2*border : canvas.height-2*border);
  const kx=img.width/dispW, ky=img.height/dispH;
  x*=kx; y*=ky; w*=kx; h*=ky;
  x=Math.max(0,x); y=Math.max(0,y); w=Math.min(img.width-x,w); h=Math.min(img.height-y,h);
  if(w<10||h<10){ tip('框太小了，拉大一点'); return; }
  const off=document.createElement('canvas'); off.width=Math.round(w); off.height=Math.round(h);
  off.getContext('2d').drawImage(img,x,y,w,h,0,0,off.width,off.height);
  const nimg=new Image();
  nimg.onload=()=>{
    images[cur].img=nimg; rotation=0;
    cropping=false; cropRect=null; cropBox.classList.add('hidden');
    $('cropOkBtn').classList.add('hidden'); $('cropCancelBtn').classList.add('hidden');
    render(); schedulePresetThumbs(); tip('裁剪好了，不满意可撤销');
  };
  nimg.src=off.toDataURL();
};
function canvasPos(e){
  const r=canvas.getBoundingClientRect();
  return { x:e.clientX-r.left, y:e.clientY-r.top, rect:r };
}
canvas.addEventListener('mousedown',e=>{
  if(!cropping) return;
  const p=canvasPos(e); cropStart={x:p.x,y:p.y}; cropRect={x:p.x,y:p.y,w:0,h:0}; paintCrop();
});
canvas.addEventListener('mousemove',e=>{
  if(!cropping||!cropStart) return;
  const p=canvasPos(e);
  let w=p.x-cropStart.x, h=p.y-cropStart.y;
  const ratio=$('cropRatio').value;
  if(ratio!=='free'){
    const [a,b]=ratio.split(':').map(Number); const r=a/b;
    if(Math.abs(w)>10){ h=Math.abs(w)/r*Math.sign(h||1); }
  }
  cropRect={ x:Math.min(cropStart.x,cropStart.x+w), y:Math.min(cropStart.y,cropStart.y+h), w:Math.abs(w), h:Math.abs(h) };
  paintCrop();
});
window.addEventListener('mouseup',()=>{ cropStart=null; });
function paintCrop(){
  if(!cropRect) return;
  cropBox.classList.remove('hidden');
  cropBox.style.left=cropRect.x+'px'; cropBox.style.top=cropRect.y+'px';
  cropBox.style.width=cropRect.w+'px'; cropBox.style.height=cropRect.h+'px';
}

// 口语入口
function runKouyu(text){
  const acts=window.parseKouyu(text);
  if(!acts.length){ tip('没听懂，试试：“自动增强”“雨天暗黑一点”“横着拼”“裁一下”“批量打ZIP”'); return; }
  const order={mode:0,vtab:0,preset:1,auto:1,adjust:2,hsl:2,rotate:2,flip:2,zoom:2,bgmode:2,vtrim:3,vmark:3,crop:3,compare:3,undo:3,delcur:3,intensity:4,use:5,batch:6,export:7,vexport:7,vcover:7};
  acts.sort((a,b)=>(order[a.type]??9)-(order[b.type]??9));
  const tips=[];
  acts.forEach(a=>{
    if(a.type==='mode'){
      modeSel.value=a.mode;
      $('cutRow').classList.toggle('hidden', a.mode!=='cut');
      if(a.mode==='cut' && a.cols){ $('cutCols').value=String(a.cols); $('cutRows').value=String(a.rows); }
    }
    if(a.type==='preset'){ snap(); const p=window.PRESETS.find(x=>x.key===a.key); if(p) Object.assign(S,p.params); }
    if(a.type==='adjust'){
      snap();
      for(const k in a.adj){
        const range=(window.PARAM_RANGE||{})[k]||[0,200];
        S[k]=clamp((S[k]??0)+a.adj[k], range);
      }
    }
    if(a.type==='hsl' && typeof window.applyHslAdjust==='function'){ try{ window.applyHslAdjust(a.k, a.d); }catch(e){} }
    if(a.type==='rotate'){ snap(); rotation=(rotation+90)%360; }
    if(a.type==='flip'){ snap(); flipH=!flipH; }
    if(a.type==='bgmode'){ $('bgModeSel').value=a.bg; }
    if(a.type==='vtab'){ if(window.switchTab) window.switchTab(a.tab); }
    if(a.type==='vtrim'){ if(window.switchTab) window.switchTab('vid'); document.getElementById('trimStart').value=a.a; document.getElementById('trimEnd').value=a.b; }
    if(a.type==='vmark'){ if(window.switchTab) window.switchTab('vid'); document.getElementById(a.which==='a'?'markStartBtn':'markEndBtn').click(); }
    if(a.type==='vexport'){ if(window.switchTab) window.switchTab('vid'); document.getElementById('vidExportBtn').click(); }
    if(a.type==='vcover'){ if(window.switchTab) window.switchTab('vid'); document.getElementById('vidCoverBtn').click(); }
    if(a.type==='zoom'){ if(a.z==='in') $('zoomInBtn').click(); else if(a.z==='out') $('zoomOutBtn').click(); else if(a.z==='one'){ zoomMode='custom'; zoomF=1; applyZoom(); } else { zoomMode='fit'; applyZoom(); } }
    if(a.type==='auto'){ autoEnhance(); }
    if(a.type==='intensity'){ snap(); const it=$('intensityRange'); if(it){ it.value=a.k; it.nextElementSibling.textContent=a.k; } applyIntensity(a.k); }
    if(a.type==='crop'){ startCrop(); }
    if(a.type==='compare'){ tip('按住中间的“👁 按住看原图”就能对比'); }
    if(a.type==='undo'){ undo(); }
    if(a.type==='delcur'){ $('delCurBtn').click(); }
    if(a.type==='use'){ applyUse(a.use); }
    if(a.type==='batch'){ batchExport(); }
    if(a.type==='export'){ doExport(); }
    if(a.tip) tips.push(a.tip);
  });
  syncSliders(); render(); tip(tips.join('，'));
}
$('kouyuBtn').onclick=()=>runKouyu($('kouyuInput').value);
$('kouyuInput').addEventListener('keydown',e=>{ if(e.key==='Enter') runKouyu(e.target.value); });

async function doExport(){
  if(!images.length){ tip('先放照片进来'); return; }
  if(modeSel.value==='cut'){ exportCutFull(); return; }
  const { format } = getExportSettings();
  const t=document.createElement('canvas');
  let filename;
  if(modeSel.value==='single'){ paintSingleTo(t, images[cur].img, rotation); filename=`${baseName(images[cur].name)}_加工_${t.width}x${t.height}.${extOf(format)}`; }
  else { scalePreviewTo(t); filename=`拼图_${Date.now()}_${t.width}x${t.height}.${extOf(format)}`; }
  const bytes=await downloadCanvas(t, filename);
  tip(`已导出 ${t.width}x${t.height} ${fmtKB(bytes)}，请查收`);
}
renderMyPresets();
restorePersist(); syncSliders(); paintRanges(); render(); // 启动时恢复上次调子
