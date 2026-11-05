/* 记事本画画：画笔、橡皮、手型平移、自由缩放。
   笔画保存在工作区快照的 drawStrokes 里，坐标是「画布逻辑像素」；
   scale / offset 只影响视图，不写进笔画，所以放大后画的线回到 1× 仍在原位。
   位图按 devicePixelRatio 放大。元素宽高只从已经显示的图层量，
   绝不用隐藏画布自己的 0×0 —— 写进 style.width 后会盖掉 width:100%。 */

let canvas,ctx,env=null,uiReady=false;
let strokes=[],currentStroke=null;
let currentTool='pen',currentColor='#3c3a32';
let view={scale:1,offsetX:0,offsetY:0};
let pointers=new Map();          /* pointerId -> 屏幕 CSS 坐标 */
let gesture='idle';              /* 'draw' | 'pan' | 'pinch' */
let activePointer=-1,panStart=null,pinchStart=null;
const ERASER_SIZE=18,PEN_SIZE=3,MIN_SCALE=.5,MAX_SCALE=8;

/* ---- 纯函数：方便单测，也让坐标换算只有一份真相 ---- */
export const clampScale=v=>{
  const n=Number(v);
  if(!Number.isFinite(n)||n<=0)return 1;
  return Math.min(MAX_SCALE,Math.max(MIN_SCALE,n));
};
export function normalizeView(v){
  const o=v&&typeof v==='object'?v:{};
  const x=Number(o.offsetX),y=Number(o.offsetY);
  return {scale:clampScale(o.scale),offsetX:Number.isFinite(x)?x:0,offsetY:Number.isFinite(y)?y:0};
}
export function screenToWorld(v,x,y){
  const base=normalizeView(v);
  return {x:(Number(x)-base.offsetX)/base.scale,y:(Number(y)-base.offsetY)/base.scale};
}
/** 以 (ax,ay) 为锚点缩放：锚点下的逻辑坐标保持不变。 */
export function zoomView(v,factor,ax,ay){
  const base=normalizeView(v),world=screenToWorld(base,ax,ay);
  const scale=clampScale(base.scale*Number(factor));
  return {scale,offsetX:Number(ax)-world.x*scale,offsetY:Number(ay)-world.y*scale};
}

export function initDraw(hooks){env=hooks;}
export function getDrawView(){return {scale:view.scale,offsetX:view.offsetX,offsetY:view.offsetY};}
export function loadDrawView(data){
  view=normalizeView(data);
  if(isDrawMode()){ensureDrawUI();resizeCanvas();clampView();redraw();updateZoom();}
}

export function isDrawMode(){return document.body.classList.contains('drawing');}
function layerSize(){
  const layer=document.getElementById('drawLayer');
  if(!layer||layer.hidden)return null;
  const toolbar=document.getElementById('drawToolbar');
  const w=layer.clientWidth,h=layer.clientHeight-(toolbar?toolbar.offsetHeight:0);
  if(w<2||h<2)return null;
  return {w,h};
}
function getPos(e){
  const rect=canvas.getBoundingClientRect();
  return {x:e.clientX-rect.left,y:e.clientY-rect.top};
}
function toWorld(pos){return screenToWorld(view,pos.x,pos.y);}
/** 别把画布拖到完全找不着，也别在 1× 时锁死不动。 */
function clampView(){
  const box=layerSize();if(!box||!canvas)return;
  view.scale=clampScale(view.scale);
  for(const axis of ['X','Y']){
    const size=axis==='X'?box.w:box.h,margin=140;
    const lo=Math.min(margin,size-size*view.scale-margin);
    const hi=Math.max(margin,size-size*view.scale-margin);
    const key='offset'+axis;
    const n=Number(view[key]);
    view[key]=Math.max(lo,Math.min(hi,Number.isFinite(n)?n:0));
  }
}
function updateZoom(){
  const label=document.getElementById('drawZoomLabel');
  if(label)label.textContent=Math.round(view.scale*100)+'%';
  const hint=document.getElementById('drawHint');
  if(hint)hint.textContent=currentTool==='hand'
    ?'手型 · 拖动平移，双指捏合或滚轮缩放'
    :'画画模式 · 手指涂写，双指捏合或滚轮缩放';
}
function saveView(){
  if(env&&env.saveDrawView)env.saveDrawView({scale:view.scale,offsetX:view.offsetX,offsetY:view.offsetY});
}
function zoomBy(factor){
  const box=layerSize()||{w:canvas.clientWidth,h:canvas.clientHeight};
  view=zoomView(view,factor,box.w/2,box.h/2);
  clampView();redraw();updateZoom();saveView();
}

export function ensureDrawUI(){
  if(uiReady)return;
  const node=document.getElementById('drawCanvas');
  if(!node)return;
  uiReady=true;canvas=node;ctx=canvas.getContext('2d');
  window.addEventListener('resize',resizeCanvas);
  window.addEventListener('pointerup',onPointerUp,true);
  window.addEventListener('pointercancel',onPointerUp,true);
  if(window.ResizeObserver){
    const observed=new ResizeObserver(()=>resizeCanvas());
    const layer=document.getElementById('drawLayer'),toolbar=document.getElementById('drawToolbar');
    if(layer)observed.observe(layer);
    if(toolbar)observed.observe(toolbar);
  }
  canvas.addEventListener('pointerdown',onPointerDown,{passive:false});
  canvas.addEventListener('pointermove',onPointerMove,{passive:false});
  canvas.addEventListener('pointerup',onPointerUp,{passive:false});
  canvas.addEventListener('pointercancel',onPointerUp,{passive:false});
  canvas.addEventListener('wheel',onWheel,{passive:false});
  /* 旧 WebView 可能不把 touch-action 当真；preventDefault 挡住滚动，笔画仍走 pointer。 */
  canvas.addEventListener('touchstart',swallowTouch,{passive:false});
  canvas.addEventListener('touchmove',swallowTouch,{passive:false});
  for(const btn of document.querySelectorAll('.draw-tool')){
    btn.addEventListener('click',()=>{
      currentTool=btn.dataset.tool||'pen';
      for(const b of document.querySelectorAll('.draw-tool'))b.classList.toggle('active',b===btn);
      canvas.style.cursor=currentTool==='hand'?'grab':currentTool==='eraser'?'cell':'crosshair';
      updateZoom();
    });
  }
  for(const btn of document.querySelectorAll('.draw-color')){
    btn.addEventListener('click',()=>{
      currentColor=btn.dataset.color||'#3c3a32';
      for(const b of document.querySelectorAll('.draw-color'))b.classList.toggle('active',b===btn);
      if(currentTool==='eraser'||currentTool==='hand'){
        currentTool='pen';
        for(const b of document.querySelectorAll('.draw-tool'))b.classList.toggle('active',b.dataset.tool==='pen');
        canvas.style.cursor='crosshair';
        updateZoom();
      }
    });
  }
  const bind=(id,fn)=>{const b=document.getElementById(id);if(b)b.addEventListener('click',fn);};
  bind('drawZoomIn',()=>zoomBy(1.25));
  bind('drawZoomOut',()=>zoomBy(1/1.25));
  bind('drawZoomReset',()=>{view={scale:1,offsetX:0,offsetY:0};redraw();updateZoom();saveView();});
  bind('drawClear',()=>{
    if(!strokes.length&&!currentStroke)return;
    currentStroke=null;gesture='idle';activePointer=-1;pointers.clear();strokes=[];redraw();commit();
  });
  bind('drawUndo',()=>{
    if(!strokes.length)return;
    strokes.pop();redraw();commit();
  });
  bind('drawBack',()=>exitDrawMode());
}

function swallowTouch(e){if(e.cancelable)e.preventDefault();}
function onWheel(e){
  if(!isDrawMode())return;
  if(e.cancelable)e.preventDefault();
  const pos=getPos(e);
  view=zoomView(view,e.deltaY<0?1.12:1/1.12,pos.x,pos.y);
  clampView();redraw();updateZoom();saveView();
}

let resizing=false;
function resizeCanvas(){
  if(!canvas||!ctx||resizing)return;
  const box=layerSize();if(!box)return;
  resizing=true;
  try{
    const dpr=window.devicePixelRatio||1;
    const nextW=Math.max(1,Math.round(box.w*dpr)),nextH=Math.max(1,Math.round(box.h*dpr));
    canvas.style.width=box.w+'px';canvas.style.height=box.h+'px';
    if(canvas.width===nextW&&canvas.height===nextH)return;
    canvas.width=nextW;canvas.height=nextH;
    clampView();redraw();
  }finally{resizing=false;}
}

function onPointerDown(e){
  if(!isDrawMode())return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(e.cancelable)e.preventDefault();
  resizeCanvas();
  if(!canvas.width||!canvas.height)return;
  const pos=getPos(e);
  pointers.set(e.pointerId,pos);
  try{canvas.setPointerCapture(e.pointerId);}catch(err){}
  if(pointers.size>=2){
    /* 第二根手指落下：放弃正在画的那一笔，改成捏合 + 平移。 */
    currentStroke=null;gesture='pinch';activePointer=-1;
    const pair=[...pointers.values()].slice(0,2),a=pair[0],b=pair[1];
    const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    pinchStart={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale:view.scale,
      world:toWorld({x:cx,y:cy})};
    redraw();return;
  }
  if(currentTool==='hand'){
    gesture='pan';
    panStart={x:pos.x,y:pos.y,offsetX:view.offsetX,offsetY:view.offsetY};
    canvas.style.cursor='grabbing';return;
  }
  gesture='draw';activePointer=e.pointerId;
  currentStroke={tool:currentTool,color:currentColor,
    size:currentTool==='eraser'?ERASER_SIZE:PEN_SIZE,points:[toWorld(pos)]};
  redraw();
}

function onPointerMove(e){
  const pos=getPos(e);
  if(pointers.has(e.pointerId))pointers.set(e.pointerId,pos);
  if(gesture==='pinch'&&pointers.size>=2&&pinchStart){
    if(e.cancelable)e.preventDefault();
    const pair=[...pointers.values()].slice(0,2),a=pair[0],b=pair[1];
    const distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));
    const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
    view.scale=clampScale(pinchStart.scale*distance/pinchStart.distance);
    view.offsetX=cx-pinchStart.world.x*view.scale;
    view.offsetY=cy-pinchStart.world.y*view.scale;
    clampView();redraw();updateZoom();return;
  }
  if(gesture==='pan'&&panStart){
    if(e.cancelable)e.preventDefault();
    view.offsetX=panStart.offsetX+(pos.x-panStart.x);
    view.offsetY=panStart.offsetY+(pos.y-panStart.y);
    clampView();redraw();return;
  }
  if(gesture!=='draw'||!currentStroke||e.pointerId!==activePointer)return;
  if(e.cancelable)e.preventDefault();
  const world=toWorld(pos),last=currentStroke.points[currentStroke.points.length-1];
  if(last&&Math.hypot(world.x-last.x,world.y-last.y)<0.4/view.scale)return;
  currentStroke.points.push(world);redraw();
}

function onPointerUp(e){
  if(e&&e.pointerId!==undefined)pointers.delete(e.pointerId);
  if(e&&e.cancelable&&gesture!=='idle')e.preventDefault();
  if(gesture==='pinch'){
    if(pointers.size<2){gesture='idle';pinchStart=null;currentStroke=null;clampView();redraw();saveView();}
    return;
  }
  if(gesture==='pan'){
    if(!pointers.size){gesture='idle';panStart=null;if(canvas)canvas.style.cursor='grab';clampView();redraw();saveView();}
    return;
  }
  if(gesture==='draw'&&e&&e.pointerId===activePointer){
    if(currentStroke&&currentStroke.points.length)strokes.push(currentStroke);
    currentStroke=null;gesture='idle';activePointer=-1;redraw();commit();
  }
}

function paint(stroke){
  const pts=stroke.points;if(!pts||!pts.length)return;
  ctx.beginPath();ctx.lineCap='round';ctx.lineJoin='round';
  if(stroke.tool==='eraser'){
    ctx.globalCompositeOperation='destination-out';
    ctx.strokeStyle='rgba(0,0,0,1)';ctx.lineWidth=stroke.size||ERASER_SIZE;
  }else{
    ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle=stroke.color||'#3c3a32';ctx.lineWidth=stroke.size||PEN_SIZE;
  }
  ctx.moveTo(pts[0].x,pts[0].y);
  if(pts.length===1)ctx.lineTo(pts[0].x+0.01,pts[0].y+0.01);
  else for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke();
}
function redraw(){
  if(!canvas||!ctx)return;
  const dpr=window.devicePixelRatio||1;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr*view.scale,0,0,dpr*view.scale,dpr*view.offsetX,dpr*view.offsetY);
  for(const stroke of strokes)paint(stroke);
  if(currentStroke)paint(currentStroke);
  ctx.globalCompositeOperation='source-over';
}
function exportStrokes(){
  return strokes.map(s=>({tool:s.tool==='eraser'?'eraser':'pen',color:s.color,size:s.size,
    points:s.points.map(p=>({x:p.x,y:p.y}))}));
}
function commit(){
  if(!env)return;
  const data=exportStrokes();
  if(env.saveDrawData)env.saveDrawData(data);
  else if(env.scheduleSave)env.scheduleSave();
}
export function normalizeStrokes(data){
  if(!Array.isArray(data))return [];
  const out=[];
  for(const stroke of data){
    if(!stroke||typeof stroke!=='object'||!Array.isArray(stroke.points))continue;
    const points=[];
    for(const p of stroke.points){
      if(!p||typeof p!=='object')continue;
      const x=Number(p.x),y=Number(p.y);
      if(Number.isFinite(x)&&Number.isFinite(y))points.push({x,y});
    }
    if(!points.length)continue;
    const size=Number(stroke.size);
    out.push({tool:stroke.tool==='eraser'?'eraser':'pen',
      color:typeof stroke.color==='string'&&stroke.color?stroke.color:'#3c3a32',
      size:Number.isFinite(size)&&size>0?size:(stroke.tool==='eraser'?ERASER_SIZE:PEN_SIZE),points});
  }
  return out;
}
function setChrome(on){
  const toggle=document.getElementById('drawToggle');
  if(toggle){
    toggle.textContent=on?'画':'🖌️';toggle.title=on?'返回文字':'画画';
    toggle.setAttribute('aria-label',on?'返回文字':'画画');
    toggle.setAttribute('aria-pressed',on?'true':'false');
  }
  const lang=document.getElementById('language');
  if(lang&&on)lang.textContent='画画';
  else if(lang&&!on&&document.body.classList.contains('notepad'))lang.textContent='纯文本';
}
export function enterDrawMode(){
  const layer=document.getElementById('drawLayer');
  if(layer)layer.hidden=false;
  document.body.classList.add('drawing');
  setChrome(true);
  view=normalizeView(env&&env.getDrawView?env.getDrawView():null);
  const stored=env&&env.getDrawData?env.getDrawData():strokes;
  strokes=normalizeStrokes(stored);
  currentStroke=null;gesture='idle';activePointer=-1;pointers.clear();panStart=null;pinchStart=null;
  ensureDrawUI();
  if(canvas)canvas.style.cursor=currentTool==='hand'?'grab':currentTool==='eraser'?'cell':'crosshair';
  resizeCanvas();clampView();redraw();updateZoom();
}
export function exitDrawMode(){
  if(gesture==='draw'&&currentStroke&&currentStroke.points.length)strokes.push(currentStroke);
  currentStroke=null;gesture='idle';activePointer=-1;pointers.clear();panStart=null;pinchStart=null;
  commit();saveView();
  const layer=document.getElementById('drawLayer');
  if(layer)layer.hidden=true;
  document.body.classList.remove('drawing');
  setChrome(false);
}
export function getDrawStrokes(){return exportStrokes();}
export function loadDrawStrokes(data){
  strokes=normalizeStrokes(data);currentStroke=null;
  if(isDrawMode()){ensureDrawUI();resizeCanvas();redraw();}
}
