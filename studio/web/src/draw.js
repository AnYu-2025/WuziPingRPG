/* 记事本绘图模块：canvas 自由绘图，支持画笔/橡皮/多色/撤销/清空。
   绘图数据以 base64 PNG 保存在 state.files 的 drawData 字段里。 */

let canvas,ctx,drawing=false,currentTool='pen',currentColor='#3c3a32';
let strokes=[],currentStroke=null,env=null,uiReady=false;
const ERASER_SIZE=18;

export function initDraw(hooks){
  env=hooks;
}

export function ensureDrawUI(){
  if(uiReady)return;
  uiReady=true;
  canvas=document.getElementById('drawCanvas');
  if(!canvas)return;
  ctx=canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize',resizeCanvas);

  canvas.addEventListener('pointerdown',onPointerDown);
  canvas.addEventListener('pointermove',onPointerMove);
  canvas.addEventListener('pointerup',onPointerUp);
  canvas.addEventListener('pointercancel',onPointerUp);
  canvas.addEventListener('pointerleave',onPointerUp);

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
    if(!strokes.length)return;
    strokes=[];redraw();env.scheduleSave();
  });
  const undoBtn=document.getElementById('drawUndo');
  if(undoBtn)undoBtn.addEventListener('click',()=>{
    if(!strokes.length)return;
    strokes.pop();redraw();env.scheduleSave();
  });
  const backBtn=document.getElementById('drawBack');
  if(backBtn)backBtn.addEventListener('click',()=>{
    exitDrawMode();
  });
}

function resizeCanvas(){
  if(!canvas)return;
  const rect=canvas.getBoundingClientRect();
  const dpr=window.devicePixelRatio||1;
  const prev=canvas.toDataURL('image/png');
  canvas.width=rect.width*dpr;
  canvas.height=rect.height*dpr;
  ctx.scale(dpr,dpr);
  canvas.style.width=rect.width+'px';
  canvas.style.height=rect.height+'px';
  if(strokes.length){
    const img=new Image();
    img.onload=()=>{ctx.drawImage(img,0,0,rect.width,rect.height);};
    img.src=prev;
  }
}

function getPos(e){
  const rect=canvas.getBoundingClientRect();
  return {x:e.clientX-rect.left,y:e.clientY-rect.top};
}

function onPointerDown(e){
  if(e.pointerType==='mouse'&&e.button!==0)return;
  canvas.setPointerCapture(e.pointerId);
  drawing=true;
  const pos=getPos(e);
  currentStroke={tool:currentTool,color:currentColor,size:currentTool==='eraser'?ERASER_SIZE:3,points:[pos]};
  ctx.beginPath();
  ctx.moveTo(pos.x,pos.y);
  ctx.lineCap='round';
  ctx.lineJoin='round';
  if(currentTool==='eraser'){
    ctx.globalCompositeOperation='destination-out';
    ctx.strokeStyle='rgba(0,0,0,1)';
    ctx.lineWidth=ERASER_SIZE;
  }else{
    ctx.globalCompositeOperation='source-over';
    ctx.strokeStyle=currentColor;
    ctx.lineWidth=3;
  }
  ctx.lineTo(pos.x+0.1,pos.y+0.1);
  ctx.stroke();
}

function onPointerMove(e){
  if(!drawing||!currentStroke)return;
  const pos=getPos(e);
  currentStroke.points.push(pos);
  ctx.lineTo(pos.x,pos.y);
  ctx.stroke();
}

function onPointerUp(e){
  if(!drawing)return;
  drawing=false;
  if(currentStroke&&currentStroke.points.length>0){
    strokes.push(currentStroke);
  }
  currentStroke=null;
  ctx.globalCompositeOperation='source-over';
  env.scheduleSave();
}

function redraw(){
  if(!canvas||!ctx)return;
  const rect=canvas.getBoundingClientRect();
  ctx.clearRect(0,0,rect.width,rect.height);
  for(const stroke of strokes){
    if(stroke.points.length<1)continue;
    ctx.beginPath();
    ctx.lineCap='round';
    ctx.lineJoin='round';
    if(stroke.tool==='eraser'){
      ctx.globalCompositeOperation='destination-out';
      ctx.strokeStyle='rgba(0,0,0,1)';
      ctx.lineWidth=stroke.size;
    }else{
      ctx.globalCompositeOperation='source-over';
      ctx.strokeStyle=stroke.color;
      ctx.lineWidth=stroke.size;
    }
    ctx.moveTo(stroke.points[0].x,stroke.points[0].y);
    for(let i=1;i<stroke.points.length;i++){
      ctx.lineTo(stroke.points[i].x,stroke.points[i].y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation='source-over';
}

export function enterDrawMode(){
  ensureDrawUI();
  const layer=document.getElementById('drawLayer');
  if(layer)layer.hidden=false;
  document.body.classList.add('drawing');
  const toggle=document.getElementById('drawToggle');
  if(toggle)toggle.textContent='📝';
  resizeCanvas();
  const data=env.getDrawData();
  if(data&&data.length){
    const img=new Image();
    img.onload=()=>{
      const rect=canvas.getBoundingClientRect();
      ctx.drawImage(img,0,0,rect.width,rect.height);
      strokes=data;
    };
    img.src=data;
  }else if(Array.isArray(data)){
    strokes=data;
    redraw();
  }
}

export function exitDrawMode(){
  const layer=document.getElementById('drawLayer');
  if(layer)layer.hidden=true;
  document.body.classList.remove('drawing');
  const toggle=document.getElementById('drawToggle');
  if(toggle)toggle.textContent='🖌️';
  env.saveDrawData(strokes);
}

export function isDrawMode(){
  return document.body.classList.contains('drawing');
}

export function getDrawStrokes(){
  return strokes;
}

export function loadDrawStrokes(data){
  if(Array.isArray(data)){
    strokes=data;
    ensureDrawUI();
    redraw();
  }
}
