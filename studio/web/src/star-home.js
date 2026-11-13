/* 天工 · 星穹首页
 * 每个功能是一颗星，挂在可拨转的天球上：
 *   - 单指拖动拨转天球（带惯性），点星打开功能
 *   - 手机摆动时星星跟着晃（DeviceOrientation，桌面用指针视差兜底）
 *   - 长按星拖到黑洞 = 收进垃圾箱；点黑洞找回
 * 不支持 WebGL 时整体不启用，首页保留卡片列表，功能不丢。
 */
import * as THREE from 'three';
import {starSanitize} from './star-data.js';

const R=5;
const STAR_COLORS={
  lecture:0xff5d73, tts:0x2fd4bf, scan:0x5b8cff,
  python:0xffb347, notepad:0x6f8dff, photo:0xff8a4d, model:0xb06fff,
  ai:0xff5dc8, game:0xffd75e
};
const DEFAULT_PREFS=()=>({starred:[],motion:true,view:'sky'});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

/* 斐波那契球面布点，稍微压扁上下极，保证星星都在可拨到的范围。 */
export function starPositions(n,radius=R){
  const out=[];
  const golden=Math.PI*(3-Math.sqrt(5));
  for(let i=0;i<n;i++){
    const y=1-(i/(Math.max(1,n-1)))*2;
    const rad=Math.sqrt(Math.max(0,1-y*y));
    const th=golden*i;
    const v=new THREE.Vector3(Math.cos(th)*rad,y*.82,Math.sin(th)*rad).normalize().multiplyScalar(radius);
    out.push([v.x,v.y,v.z]);
  }
  return out;
}

export function initStarHome(env,api){
  const $=id=>document.getElementById(id);
  let renderer=null,scene=null,camera=null,group=null,stars=new Map();
  let hole=null,holeDisk=null,holeSwirl=null,holeGlow=null,holePhoton=null,holeShock=null,holeHud=[],labels=new Map(),constellation=null;
  let holePulse=0,holeAttract=0,shockT=1;
  const buzz=ms=>{try{if(navigator.vibrate)navigator.vibrate(ms);}catch(e){}};
  /* 近邻星连成星座线：每颗可见星连最近的两颗，去重；收纳后重连。 */
  function buildConstellation(){
    if(constellation){group.remove(constellation);constellation.geometry.dispose();constellation.material.dispose();constellation=null;}
    const ids=[...stars.keys()].filter(id=>stars.get(id).sprite.visible);
    const pairs=new Set();
    for(const a of ids){
      const pa=stars.get(a).base;
      const near=ids.filter(b=>b!==a)
        .map(b=>({b,d:pa.distanceTo(stars.get(b).base)}))
        .sort((x,y)=>x.d-y.d).slice(0,2);
      for(const {b} of near)pairs.add(a<b?a+'|'+b:b+'|'+a);
    }
    const pos=[];
    for(const key of pairs){
      const [a,b]=key.split('|');
      const pa=stars.get(a).base,pb=stars.get(b).base;
      pos.push(pa.x,pa.y,pa.z,pb.x,pb.y,pb.z);
    }
    if(!pos.length)return;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    constellation=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x8fb7ff,transparent:true,opacity:.16,depthWrite:false}));
    group.add(constellation);
  }
  let active=false,raf=0,dirty=true;
  let vel={x:0,y:0},tilt={x:0,y:0},tiltTarget={x:0,y:0};
  let drag=null,downInfo=null,dragStar=null,dragPlane=null,dragMoved=false;
  let raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let prefs=starSanitize(env.getPrefs(),env.modules().map(m=>m.id));
  let motionBound=false,orientBase=null;

  const host=()=>$('starStage');
  const canvas=()=>$('starCanvas');

  function glowTexture(inner,outer){
    const c=document.createElement('canvas');c.width=c.height=128;
    const g=c.getContext('2d');
    const grad=g.createRadialGradient(64,64,0,64,64,64);
    grad.addColorStop(0,inner);
    grad.addColorStop(.35,outer);
    grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad;g.fillRect(0,0,128,128);
    const tex=new THREE.CanvasTexture(c);
    return tex;
  }

  /* EHT 实机照片风格吸积环：中心暗阴影，环下亮上暗（多普勒束流），整体柔糊。 */
  function ehtRingTexture(){
    const S=256,c=document.createElement('canvas');c.width=c.height=S;
    const g=c.getContext('2d'),cx=S/2,cy=S/2;
    let grad=g.createRadialGradient(cx,cy,S*.14,cx,cy,S*.5);
    grad.addColorStop(0,'rgba(255,110,35,0)');
    grad.addColorStop(.4,'rgba(255,110,35,.22)');
    grad.addColorStop(.58,'rgba(255,130,45,.7)');
    grad.addColorStop(.74,'rgba(200,60,20,.4)');
    grad.addColorStop(1,'rgba(110,18,8,0)');
    g.fillStyle=grad;g.fillRect(0,0,S,S);
    /* 下半 hotspot（照片里最亮的橙黄弧） */
    g.globalCompositeOperation='lighter';
    grad=g.createRadialGradient(cx,cy+S*.15,S*.03,cx,cy+S*.15,S*.36);
    grad.addColorStop(0,'rgba(255,230,160,.95)');
    grad.addColorStop(.45,'rgba(255,160,60,.55)');
    grad.addColorStop(1,'rgba(255,110,35,0)');
    g.fillStyle=grad;g.fillRect(0,0,S,S);
    /* 压暗上半，形成不对称 */
    g.globalCompositeOperation='destination-out';
    grad=g.createLinearGradient(0,0,0,cy);
    grad.addColorStop(0,'rgba(0,0,0,.62)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad;g.fillRect(0,0,S,cy);
    /* 中心暗阴影 */
    grad=g.createRadialGradient(cx,cy,0,cx,cy,S*.24);
    grad.addColorStop(0,'rgba(0,0,0,1)');
    grad.addColorStop(.75,'rgba(0,0,0,.92)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle=grad;g.beginPath();g.arc(cx,cy,S*.25,0,7);g.fill();
    return new THREE.CanvasTexture(c);
  }
  /* 吸积流 swirl：几条淡橙螺旋 streak，持续慢转提供"活"的感觉，
     不带动主环（主环保持照片的下亮上暗方位）。 */
  function swirlTexture(){
    const S=256,c=document.createElement('canvas');c.width=c.height=S;
    const g=c.getContext('2d'),cx=S/2,cy=S/2;
    g.lineCap='round';
    for(let i=0;i<4;i++){
      const r0=S*(.28+i*.045);
      g.strokeStyle='rgba(255,'+(150+i*20)+','+(60+i*15)+','+(0.20-i*.035)+')';
      g.lineWidth=5-i;
      g.shadowColor='rgba(255,140,50,.5)';g.shadowBlur=6;
      g.beginPath();
      g.arc(cx,cy,r0,i*1.7,i*1.7+2.1);
      g.stroke();
    }
    return new THREE.CanvasTexture(c);
  }
  /* 引力透镜弧：上下两段细亮弧，科幻感（低调）。 */
  function lensArcTexture(){
    const S=256,c=document.createElement('canvas');c.width=c.height=S;
    const g=c.getContext('2d'),cx=S/2,cy=S/2;
    g.strokeStyle='rgba(150,205,255,.4)';g.lineWidth=2;g.shadowColor='rgba(150,205,255,.7)';g.shadowBlur=6;
    g.beginPath();g.arc(cx,cy,S*.36,Math.PI*1.15,Math.PI*1.85);g.stroke();
    g.beginPath();g.arc(cx,cy,S*.36,Math.PI*.15,Math.PI*.85);g.stroke();
    return new THREE.CanvasTexture(c);
  }

  function ensure(){
    if(renderer)return true;
    const cv=canvas();if(!cv)return false;
    try{renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});}
    catch(e){return false;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0x000000,0);
    scene=new THREE.Scene();
    camera=new THREE.PerspectiveCamera(55,1,.1,60);
    camera.position.set(0,0,10.5);
    group=new THREE.Group();
    scene.add(group);
    /* 背景星尘 */
    const dustGeo=new THREE.BufferGeometry();
    const dustPos=new Float32Array(320*3);
    for(let i=0;i<320;i++){
      const v=new THREE.Vector3().randomDirection().multiplyScalar(14+Math.random()*10);
      dustPos[i*3]=v.x;dustPos[i*3+1]=v.y;dustPos[i*3+2]=v.z;
    }
    dustGeo.setAttribute('position',new THREE.BufferAttribute(dustPos,3));
    const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0x9fb8ff,size:.06,transparent:true,opacity:.55,sizeAttenuation:true}));
    scene.add(dust);
    /* 黑洞（首页视觉中心）：参照 EHT 实机照片——暗阴影+下亮橙红吸积环+光子环+透镜弧+科幻HUD */
    hole=new THREE.Group();
    const core=new THREE.Mesh(new THREE.SphereGeometry(.5,24,16),new THREE.MeshBasicMaterial({color:0x000000}));
    hole.add(core);
    holeDisk=new THREE.Sprite(new THREE.SpriteMaterial({map:ehtRingTexture(),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
    holeDisk.scale.set(3.2,3.2,1);hole.add(holeDisk);
    holeSwirl=new THREE.Sprite(new THREE.SpriteMaterial({map:swirlTexture(),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.8}));
    holeSwirl.scale.set(3.1,3.1,1);hole.add(holeSwirl);
    holePhoton=new THREE.Mesh(new THREE.TorusGeometry(.56,.012,8,64),new THREE.MeshBasicMaterial({color:0xffd9a0,transparent:true,opacity:.45,blending:THREE.AdditiveBlending,depthWrite:false}));
    hole.add(holePhoton);
    holeShock=new THREE.Mesh(new THREE.RingGeometry(.6,.66,48),new THREE.MeshBasicMaterial({color:0xffc07a,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    hole.add(holeShock);
    const lens=new THREE.Sprite(new THREE.SpriteMaterial({map:lensArcTexture(),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.5}));
    lens.scale.set(3.6,3.6,1);hole.add(lens);
    holeGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture('rgba(255,110,35,.42)','rgba(140,30,10,.18)'),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
    holeGlow.scale.set(5,5,1);hole.add(holeGlow);
    const hudMat=new THREE.MeshBasicMaterial({color:0x7fd4ff,transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
    const hud1=new THREE.Mesh(new THREE.RingGeometry(1.5,1.52,64),hudMat);hole.add(hud1);
    const hud2=new THREE.Mesh(new THREE.RingGeometry(1.8,1.81,64,1,0,Math.PI*1.5),hudMat.clone());hud2.material.opacity=.12;hole.add(hud2);
    holeHud=[hud1,hud2];
    hole.position.set(0,0,3.5);
    hole.scale.setScalar(1.15);
    scene.add(hole);
    window.addEventListener('resize',resize);
    resize();
    bindPointer();
    bindMotion();
    return true;
  }

  let lastW=0,lastH=0;
  function resize(){
    const stage=host();if(!stage||!renderer)return;
    /* 容器还没布局（display:none / 0 尺寸）时不要建 1×1 画布：
       它会被 CSS 拉伸铺满整屏，把背后的夜空糊成一片浅色。 */
    const w=stage.clientWidth,h=stage.clientHeight;
    if(w<2||h<2)return;
    if(w===lastW&&h===lastH)return;
    lastW=w;lastH=h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.updateProjectionMatrix();
    dirty=true;
  }

  function buildStars(){
    for(const [,s] of stars){group.remove(s.sprite);s.sprite.material.map.dispose();s.sprite.material.dispose();}
    stars.clear();
    for(const [,el] of labels)el.remove();
    labels.clear();
    const mods=env.modules();
    const pos=starPositions(mods.length);
    const layer=$('starLabels');
    mods.forEach((m,i)=>{
      const color=STAR_COLORS[m.id]||0xffffff;
      const mat=new THREE.SpriteMaterial({map:glowTexture('rgba(255,255,255,1)','rgba('+((color>>16)&255)+','+((color>>8)&255)+','+(color&255)+',.5)'),transparent:true,depthWrite:false});
      const sprite=new THREE.Sprite(mat);
      sprite.position.fromArray(pos[i]);
      sprite.scale.set(.9,.9,1);
      sprite.userData.moduleId=m.id;
      group.add(sprite);
      stars.set(m.id,{sprite,base:new THREE.Vector3().fromArray(pos[i]),color,phase:Math.random()*Math.PI*2});
      const label=document.createElement('button');
      label.type='button';label.className='star-label';
      label.textContent=m.title;
      label.onclick=()=>env.open(m.id);
      if(layer)layer.append(label);
      labels.set(m.id,label);
    });
    applyStarred();
    buildConstellation();
    dirty=true;
  }

  function applyStarred(){
    const set=new Set(prefs.starred);
    for(const [id,s] of stars){
      const hiddenStar=set.has(id);
      s.sprite.visible=!hiddenStar;
      const label=labels.get(id);
      if(label)label.hidden=hiddenStar;
    }
    updateHoleBadge();
    buildConstellation();
  }
  function updateHoleBadge(){
    const badge=$('starHoleBadge');
    if(badge){badge.textContent=String(prefs.starred.length);badge.hidden=prefs.starred.length===0;}
    const chip=$('starHoleBtn');
    if(chip)chip.style.display=prefs.starred.length?'flex':'none';
  }
  function savePrefs(){env.setPrefs(prefs);}

  /* ---------- 交互 ---------- */
  function setPointerFromEvent(e){
    const cv=canvas(),rect=cv.getBoundingClientRect();
    pointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(pointer,camera);
  }
  function pickStar(e){
    setPointerFromEvent(e);
    const targets=[...stars.values()].filter(s=>s.sprite.visible).map(s=>s.sprite);
    const hits=raycaster.intersectObjects(targets,false);
    return hits.length?hits[0].object.userData.moduleId:null;
  }
  function pickHole(e){
    setPointerFromEvent(e);
    return raycaster.intersectObject(hole,true).length>0;
  }
  function bindPointer(){
    const cv=canvas();
    cv.addEventListener('pointerdown',e=>{
      downInfo={x:e.clientX,y:e.clientY,t:Date.now(),moved:false};
      dragMoved=false;
      const id=pickStar(e);
      if(id){dragStar=id;dragPlane=new THREE.Plane();const n=new THREE.Vector3();camera.getWorldDirection(n);dragPlane.setFromNormalAndCoplanarPoint(n,stars.get(id).sprite.getWorldPosition(new THREE.Vector3()));}
      else dragStar=null;
      drag={x:e.clientX,y:e.clientY};
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove',e=>{
      if(!downInfo)return;
      const dx=e.clientX-downInfo.x,dy=e.clientY-downInfo.y;
      if(Math.hypot(dx,dy)>10)downInfo.moved=true;
      if(dragStar&&downInfo.moved){
        /* 拖星：从球面摘下来跟手 */
        dragMoved=true;
        setPointerFromEvent(e);
        const p=new THREE.Vector3();
        if(raycaster.ray.intersectPlane(dragPlane,p)){
          const s=stars.get(dragStar);
          group.worldToLocal(p);
          s.sprite.position.copy(p);
        }
        const over=pickHole(e);
        holeAttract=over?1:0;
        holeGlow.material.opacity=over?1:.7;
        holeDisk.material.color.setHex(over?0xffe0b0:0xffffff);
        dirty=true;
        return;
      }
      if(drag&&!dragStar){
        /* 拨转天球 */
        const mx=e.clientX-drag.x,my=e.clientY-drag.y;
        group.rotation.y+=mx*.005;
        group.rotation.x=clamp(group.rotation.x+my*.004,-1.1,1.1);
        vel={x:my*.004,y:mx*.005};
        drag={x:e.clientX,y:e.clientY};
        dirty=true;
      }
    });
    const up=e=>{
      if(!downInfo)return;
      const wasTap=!downInfo.moved&&Date.now()-downInfo.t<500;
      if(dragStar&&dragMoved){
        if(pickHole(e))starStar(dragStar);
        else snapBack(dragStar);
        holeGlow.material.opacity=.7;holeDisk.material.color.setHex(0xffffff);holeAttract=0;
      }else if(wasTap){
        if(pickHole(e))openHole();
        else{
          const id=pickStar(e);
          if(id){buzz(8);env.open(id);}
        }
      }
      dragStar=null;drag=null;downInfo=null;
      dirty=true;
    };
    cv.addEventListener('pointerup',up);
    cv.addEventListener('pointercancel',up);
  }
  function snapBack(id){
    const s=stars.get(id);if(!s)return;
    s.sprite.position.copy(s.base);
  }
  let sucking=null;
  function starStar(id){
    const s=stars.get(id);
    if(s){
      /* 吸入动画：星被拉向黑洞并缩小，结束后才真正隐藏。 */
      const label=labels.get(id);if(label)label.style.opacity='0';
      sucking={id,t0:performance.now(),from:s.sprite.position.clone()};
    }else{
      finishStar(id);
    }
  }
  function finishStar(id){
    if(!prefs.starred.includes(id))prefs.starred.push(id);
    buzz([12,40,12]);
    holePulse=1;shockT=0;
    savePrefs();applyStarred();
    const s=stars.get(id);if(s)s.sprite.position.copy(s.base);
    const m=env.modules().find(x=>x.id===id);
    env.notify('「'+(m?m.title:id)+'」收进黑洞了，点黑洞可以找回。');
  }
  function openHole(){
    const sheet=$('starHoleSheet'),list=$('starHoleList');
    if(!sheet||!list)return;
    list.replaceChildren();
    if(!prefs.starred.length){
      const p=document.createElement('p');p.className='star-hole-empty';p.textContent='黑洞里还没有星星。长按星拖进来收纳。';list.append(p);
    }
    for(const id of prefs.starred){
      const m=env.modules().find(x=>x.id===id);
      const row=document.createElement('div');row.className='star-hole-row';
      const name=document.createElement('span');name.textContent=m?m.title:id;
      const back=document.createElement('button');back.type='button';back.textContent='放回星空';
      back.onclick=()=>{prefs.starred=prefs.starred.filter(x=>x!==id);savePrefs();applyStarred();openHole();};
      const open=document.createElement('button');open.type='button';open.className='primary';open.textContent='打开';
      open.onclick=()=>{closeHole();env.open(id);};
      row.append(name,back,open);
      list.append(row);
    }
    sheet.hidden=false;
  }
  function closeHole(){const sheet=$('starHoleSheet');if(sheet)sheet.hidden=true;}

  /* ---------- 晃动 ---------- */
  function bindMotion(){
    if(motionBound)return;
    motionBound=true;
    window.addEventListener('deviceorientation',e=>{
      if(!prefs.motion||e.beta==null||e.gamma==null)return;
      if(!orientBase)orientBase={beta:e.beta,gamma:e.gamma};
      tiltTarget.x=clamp((e.gamma-orientBase.gamma)/40,-1,1);
      tiltTarget.y=clamp((e.beta-orientBase.beta)/40,-1,1);
    });
    /* 桌面兜底：指针视差 */
    window.addEventListener('pointermove',e=>{
      if(!prefs.motion||'ontouchstart'in window)return;
      tiltTarget.x=(e.clientX/window.innerWidth-.5)*.6;
      tiltTarget.y=(e.clientY/window.innerHeight-.5)*.6;
    });
  }
  function requestMotionPermission(){
    const DOE=window.DeviceOrientationEvent;
    if(DOE&&typeof DOE.requestPermission==='function'){
      DOE.requestPermission().then(r=>{env.notify(r==='granted'?'晃动已开启，摇摇手机试试。':'未授权晃动，星星保持安静。');}).catch(()=>{});
    }else{
      prefs.motion=!prefs.motion;savePrefs();
      env.notify(prefs.motion?'晃动已开启。':'晃动已关闭。');
    }
    syncMotionBtn();
  }
  function syncMotionBtn(){
    const b=$('starMotionBtn');if(b)b.classList.toggle('active',prefs.motion);
  }

  /* ---------- 渲染循环 ---------- */
  function loop(t){
    if(!active)return;
    raf=requestAnimationFrame(loop);
    /* 尺寸自愈：首帧可能早于布局，或旋屏/分屏后容器变化，
       每帧廉价比对一次，避免画布停留在错误分辨率。 */
    resize();
    /* 黑洞吸入动画 */
    if(sucking){
      const s=stars.get(sucking.id);
      const k=clamp((t-sucking.t0)/380,0,1);
      if(s){
        const target=group.worldToLocal(hole.position.clone());
        s.sprite.position.lerpVectors(sucking.from,target,k*k);
        const sc=.9*(1-k*.9);
        s.sprite.scale.set(sc,sc,1);
      }
      if(k>=1){const id=sucking.id;sucking=null;finishStar(id);}
      dirty=true;
    }
    /* 惯性拨转 */
    if(!drag){
      group.rotation.y+=vel.y;
      group.rotation.x=clamp(group.rotation.x+vel.x,-1.1,1.1);
      vel.x*=.94;vel.y*=.94;
    }
    /* 晃动平滑 */
    tilt.x+=(tiltTarget.x-tilt.x)*.06;
    tilt.y+=(tiltTarget.y-tilt.y)*.06;
    group.position.x=tilt.x*.5;
    group.position.y=-tilt.y*.4;
    camera.position.x=tilt.x*.8;
    camera.position.y=-tilt.y*.6;
    camera.lookAt(0,0,0);
    /* 星星呼吸 + 标签投影 */
    const stage=host();
    const w=stage?stage.clientWidth:1,h=stage?stage.clientHeight:1;
    /* 先投影全部星，按深度排序；标签重叠时只留近的，避免糊成一团。 */
    const proj=[];
    for(const [id,s] of stars){
      if(!s.sprite.visible)continue;
      if(!sucking||sucking.id!==id){
        const pulse=1+Math.sin(t*.0016+s.phase)*.12;
        s.sprite.scale.set(.9*pulse,.9*pulse,1);
      }
      const wp=s.sprite.getWorldPosition(new THREE.Vector3());
      const depth=wp.distanceTo(camera.position);
      const behind=wp.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()))<0;
      const p=wp.project(camera);
      proj.push({id,behind,p,depth,x:(p.x*.5+.5)*w,y:(-p.y*.5+.5)*h});
    }
    proj.sort((a,b)=>a.depth-b.depth);
    /* 黑洞在屏幕上的排斥区：标签落进去会被吸积盘盖住，必须让开。 */
    const hp=hole.position.clone().project(camera);
    const hpe=hole.position.clone().add(new THREE.Vector3(1.15*hole.scale.x,0,0)).project(camera);
    const hr=Math.max(70,Math.abs((hpe.x-hp.x)*.5*w));
    const holeRect={x:(hp.x*.5+.5)*w-hr,y:(-hp.y*.5+.5)*h-hr,w:hr*2,h:hr*2};
    const placed=[];
    for(const item of proj){
      const label=labels.get(item.id);
      if(!label)continue;
      if(item.behind||item.p.z>1){label.style.opacity='0';label.style.pointerEvents='none';continue;}
      /* 用真实渲染宽度收敛，估算值会让长标签贴边被裁。 */
      const lw=label.offsetWidth||Math.max(56,(env.modules().find(m=>m.id===item.id)||{title:''}).title.length*13+20);
      const lh=label.offsetHeight||24;
      const topSafe=76,bottomSafe=176,pad=10;
      const lx=clamp(item.x,lw/2+pad,Math.max(lw/2+pad,w-lw/2-pad));
      const ly=clamp(item.y+14,topSafe,Math.max(topSafe,h-bottomSafe-lh));
      const rect={x:lx-lw/2,y:ly,w:lw,h:lh};
      const hit=r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y;
      if(placed.some(hit)||hit(holeRect)){label.style.opacity='0';label.style.pointerEvents='none';continue;}
      placed.push(rect);
      /* 越靠边越淡，但始终可读；被收敛过的标签不再额外压暗。 */
      label.style.opacity=String(clamp(1.15-Math.abs(item.p.x)*.35,.55,1));
      label.style.pointerEvents='auto';
      label.style.transform='translate(-50%,0) translate('+lx+'px,'+ly+'px)';
    }
    holeSwirl.material.rotation-=.0035;
    holeHud[0].rotation.z-=.002;holeHud[1].rotation.z+=.003;
    const breathe=1+Math.sin(t*.0012)*.03;
    holePulse=Math.max(0,holePulse-.02);
    holeGlow.scale.set(5*breathe*(1+holePulse*.25),5*breathe*(1+holePulse*.25),1);
    holePhoton.material.opacity=.4+Math.sin(t*.002)*.12+holePulse*.4;
    const target=1.15*(1+holeAttract*.08+holePulse*.1);
    hole.scale.setScalar(hole.scale.x+(target-hole.scale.x)*.15);
    if(shockT<1){shockT=Math.min(1,shockT+.03);const sc=.7+shockT*2.2;holeShock.scale.set(sc,sc,1);holeShock.material.opacity=(1-shockT)*.5;}
    else holeShock.material.opacity=0;
    renderer.render(scene,camera);
  }

  function enter(){
    if(!host())return false;
    if(!ensure())return false;
    active=true;
    buildStars();
    syncMotionBtn();
    resize();
    cancelAnimationFrame(raf);
    raf=requestAnimationFrame(loop);
    return true;
  }
  function leave(){
    active=false;
    cancelAnimationFrame(raf);
    closeHole();
  }

  /* ---------- 绑定 ---------- */
  const motionBtn=$('starMotionBtn');if(motionBtn)motionBtn.onclick=requestMotionPermission;
  const listBtn=$('starListBtn');if(listBtn)listBtn.onclick=()=>{env.showList();};
  const holeClose=$('starHoleClose');if(holeClose)holeClose.onclick=closeHole;
  const holeBtn=$('starHoleBtn');if(holeBtn)holeBtn.onclick=openHole;

  api.enter=enter;
  api.leave=leave;
  api.available=()=>!!renderer;
  api.openHole=openHole;
  api.debug=()=>({stars:stars.size,starred:prefs.starred.length,active});
}

/* 懒加载入口：app.js 通过动态 import 调用，three 只在首页星穹启用时才加载。
 * 旧 WebView 解析不了 three 时，首页保留卡片列表，功能不丢。 */
export function init(env){
  const api={enter:()=>false,leave:()=>{},available:()=>false,openHole:()=>{},debug:()=>({})};
  initStarHome(env,api);
  return {
    enter:()=>api.enter(),
    leave:()=>api.leave(),
    available:()=>api.available(),
    openHole:()=>api.openHole(),
    debug:()=>api.debug()
  };
}