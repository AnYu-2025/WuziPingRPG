/* 记事本画画：画笔、橡皮、多色、撤销、清空。
   笔画保存在工作区快照的 drawStrokes 里，坐标是 CSS 像素。
   位图按 devicePixelRatio 放大。元素宽高只从已经显示的图层量，
   绝不用隐藏画布自己的 0×0 —— 写进 style.width 后会盖掉 width:100%，
   手指就点在画布旁边，一笔都画不出来。 */

let canvas,ctx,drawing=false,activePointer=-1,currentTool='pen',currentColor='#3c3a32';
let strokes=[],currentStroke=null,env=null,uiReady=false;
const ERASER_SIZE=18;
const PEN_SIZE=3;

export function initDraw(hooks){
  env=hooks;
}

export function ensureDrawUI(){
  if(uiReady)return;
  const node=document.getElementById('drawCanvas');
  if(!node)return;
  uiReady=true;
  canvas=node;
  ctx=canvas.getContext('2d');
  window.addEventListener('resize',resizeCanvas);
  window.addEventListener('pointerup',onPointerUp,true);
  window.addEventListener('pointercancel',onPointerUp,true);
  if(window.ResizeObserver){
    const observed=new ResizeObserver(()=>resizeCanvas());
    const layer=document.getElementById('drawLayer');
    const toolbar=document.getElementById('drawToolbar');
    if(layer)observed.observe(layer);
    if(toolbar)observed.observe(toolbar);
  }

  canvas.addEventListener('pointerdown',onPointerDown,{passive:false});
  canvas.addEventListener('pointermove',onPointerMove,{passive:false});
  canvas.addEventListener('pointerup',onPointerUp,{passive:false});
  canvas.addEventListener('pointercancel',onPointerUp,{passive:false});
  /* 旧 WebView 可能不把 touch-action 当真。preventDefault 挡住滚动，真正的笔画仍走 pointer。 */
  canvas.addEventListener('touchstart',swallowTouch,{passive:false});
  canvas.addEventListener('touchmove',swallowTouch,{passive:false});

  for(const btn of document.querySelectorAll('.draw-tool')){
    btn.addEventListener('click',()=>{
      currentTool=btn.dataset.tool||'pen';
      for(const b of document.querySelectorAll('.draw-tool'))b.classList.toggle('active',b===btn);
      canvas.style.cursor=currentTool==='eraser'?'cell':'crosshair';
    });
  }
  for(const btn of document.querySelectorAll('.draw-color')){
    btn.addEventListener('click',()=>{
      currentColor=btn.dataset.color||'#3c3a32';
      for(const b of document.querySelectorAll('.draw-color'))b.classList.toggle('active',b===btn);
      if(currentTool==='eraser'){
        currentTool='pen';
        for(const b of document.querySelectorAll('.draw-tool'))b.classList.toggle('active',b.dataset.tool==='pen');
        canvas.style.cursor='crosshair';
      }
    });
  }
  const clearBtn=document.getElementById('drawClear');
  if(clearBtn)clearBtn.addEventListener('click',()=>{
    if(!strokes.length&&!currentStroke)return;
    currentStroke=null;drawing=false;activePointer=-1;strokes=[];redraw();commit();
  });
  const undoBtn=document.getElementById('drawUndo');
  if(undoBtn)undoBtn.addEventListener('click',()=>{
    if(!strokes.length)return;
    strokes.pop();redraw();commit();
  });
  const backBtn=document.getElementById('drawBack');
  if(backBtn)backBtn.addEventListener('click',()=>exitDrawMode());
}

function swallowTouch(e){
  if(e.cancelable)e.preventDefault();
}

function layerSize(){
  const layer=document.getElementById('drawLayer');
  if(!layer||layer.hidden)return null;
  const toolbar=document.getElementById('drawToolbar');
  const w=layer.clientWidth;
  const h=layer.clientHeight-(toolbar?toolbar.offsetHeight:0);
  if(w<2||h<2)return null;
  return {w,h};
}

let resizing=false;
function resizeCanvas(){
  if(!canvas||!ctx||resizing)return;
  const box=layerSize();
  if(!box)return;
  resizing=true;
  try{
    const dpr=window.devicePixelRatio||1;
    const nextW=Math.max(1,Math.round(box.w*dpr));
    const nextH=Math.max(1,Math.round(box.h*dpr));
    /* Size the element from the layer, never from the canvas itself.
       A hidden canvas reports 0×0; writing that inline width locks the hit target shut. */
    canvas.style.width=box.w+'px';
    canvas.style.height=box.h+'px';
    if(canvas.width===nextW&&canvas.height===nextH)return;
    canvas.width=nextW;
    canvas.height=nextH;
    redraw();
  }finally{
    resizing=false;
  }
}

function getPos(e){
  const rect=canvas.getBoundingClientRect();
  return {x:e.clientX-rect.left,y:e.clientY-rect.top};
}

function onPointerDown(e){
  if(!document.body.classList.contains('drawing'))return;
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(drawing)return;
  if(e.cancelable)e.preventDefault();
  resizeCanvas();
  if(!canvas.width||!canvas.height)return;
  try{canvas.setPointerCapture(e.pointerId);}catch(err){}
  drawing=true;
  activePointer=e.pointerId;
  const pos=getPos(e);
  currentStroke={
    tool:currentTool,
    color:currentColor,
    size:currentTool==='eraser'?ERASER_SIZE:PEN_SIZE,
    points:[pos]
  };
  redraw();
}

function onPointerMove(e){
  if(!drawing||!currentStroke)return;
  if(e.cancelable)e.preventDefault();
  const pos=getPos(e);
  const last=currentStroke.points[currentStroke.points.length-1];
  if(last&&Math.hypot(pos.x-last.x,pos.y-last.y)<0.4)return;
  currentStroke.points.push(pos);
  redraw();
}

function onPointerUp(e){
  if(!drawing)return;
  if(e&&e.pointerId!==undefined&&activePointer!==-1&&e.pointerId!==activePointer)return;
  if(e&&e.cancelable)e.preventDefault();
  drawing=false;
  activePointer=-1;
  if(currentStroke&&currentStroke.points.length)strokes.push(currentStroke);
  currentStroke=null;
  redraw();
  commit();
}

function paint(stroke){
  const pts=stroke.points;
  if(!pts||!pts.length)return;
  ctx.beginPath();
  ctx.lineCap='round';
  ctx.lineJoin='round';
  if(stroke.tool==='eraser'){
    ctx.globalCompositeOperation='destination-out';
    ctx.strokeStyle='rgba(0,0,0,1)';
    ctx.lineWidth=stroke.size||ERASER_SIZE;
  }else{
    ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle=stroke.color||'#3c3a32';
    ctx.lineWidth=stroke.size||PEN_SIZE;
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
  ctx.setTransform(dpr,0,0,dpr,0,0);
  for(const stroke of strokes)paint(stroke);
  if(currentStroke)paint(currentStroke);
  ctx.globalCompositeOperation='source-over';
}

function exportStrokes(){
  return strokes.map(s=>({
    tool:s.tool==='eraser'?'eraser':'pen',
    color:s.color,
    size:s.size,
    points:s.points.map(p=>({x:p.x,y:p.y}))
  }));
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
      const x=Number(p&&p.x),y=Number(p&&p.y);
      if(Number.isFinite(x)&&Number.isFinite(y))points.push({x,y});
    }
    if(!points.length)continue;
    const size=Number(stroke.size);
    out.push({
      tool:stroke.tool==='eraser'?'eraser':'pen',
      color:typeof stroke.color==='string'&&stroke.color?stroke.color:'#3c3a32',
      size:Number.isFinite(size)&&size>0?size:(stroke.tool==='eraser'?ERASER_SIZE:PEN_SIZE),
      points
    });
  }
  return out;
}

function setChrome(on){
  const toggle=document.getElementById('drawToggle');
  if(toggle){
    toggle.textContent=on?'画':'🖌️';
    toggle.title=on?'返回文字':'画画';
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
  const stored=env&&env.getDrawData?env.getDrawData():strokes;
  strokes=normalizeStrokes(stored);
  currentStroke=null;
  drawing=false;
  ensureDrawUI();
  resizeCanvas();
  redraw();
}

export function exitDrawMode(){
  if(drawing&&currentStroke&&currentStroke.points.length)strokes.push(currentStroke);
  currentStroke=null;
  drawing=false;
  activePointer=-1;
  commit();
  const layer=document.getElementById('drawLayer');
  if(layer)layer.hidden=true;
  document.body.classList.remove('drawing');
  setChrome(false);
}

export function isDrawMode(){
  return document.body.classList.contains('drawing');
}

export function getDrawStrokes(){
  return exportStrokes();
}

export function loadDrawStrokes(data){
  strokes=normalizeStrokes(data);
  currentStroke=null;
  if(isDrawMode()){
    ensureDrawUI();
    resizeCanvas();
    redraw();
  }
}
