/* 天工 · 鹈鹕骑自行车 3D 渲染层（three.js，静态包含于主 bundle）
 * 低多边形鹈鹕+自行车，横版自动前进，点按跳跃躲障碍。
 * 逻辑在 pelican.js（纯函数），这里只负责画与输入。 */
import * as THREE from 'three';
import {pelicanStart,pelicanJump,pelicanTick,pelicanSanitize} from './pelican.js';

export function init(env){
  const $=id=>document.getElementById(id);
  let renderer=null,scene=null,camera=null,raf=0,active=false,last=0;
  let pelican=null,wheelF=null,wheelB=null,legL=null,legR=null,ground=null;
  const obstacleMeshes=[];
  let state=pelicanStart(0);
  let best=(env.getBest&&env.getBest())||0;

  function mat(c,extra){return new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.7,metalness:.05},extra||{}));}

  function buildPelican(){
    const g=new THREE.Group();
    /* 自行车车架 */
    const frame=new THREE.Mesh(new THREE.BoxGeometry(1.0,.08,.08),mat(0xd0453a));
    frame.position.set(0,.42,0);g.add(frame);
    const seatPost=new THREE.Mesh(new THREE.BoxGeometry(.06,.3,.06),mat(0x888888));
    seatPost.position.set(-.25,.55,0);g.add(seatPost);
    const handle=new THREE.Mesh(new THREE.BoxGeometry(.06,.3,.06),mat(0x888888));
    handle.position.set(.45,.6,0);g.add(handle);
    /* 车轮 */
    const wheelGeo=new THREE.TorusGeometry(.28,.05,8,20);
    wheelB=new THREE.Mesh(wheelGeo,mat(0x222222));wheelB.position.set(-.45,.28,0);g.add(wheelB);
    wheelF=new THREE.Mesh(wheelGeo,mat(0x222222));wheelF.position.set(.45,.28,0);g.add(wheelF);
    /* 鹈鹕身体 */
    const body=new THREE.Mesh(new THREE.SphereGeometry(.34,16,12),mat(0xf5f0e6));
    body.scale.set(1.2,.9,.8);body.position.set(-.1,.85,0);g.add(body);
    /* 头 */
    const head=new THREE.Mesh(new THREE.SphereGeometry(.2,14,10),mat(0xf5f0e6));
    head.position.set(.25,1.2,0);g.add(head);
    /* 大嘴（鹈鹕特征） */
    const beak=new THREE.Mesh(new THREE.ConeGeometry(.12,.5,8),mat(0xf2a03d));
    beak.rotation.z=-Math.PI/2;beak.position.set(.55,1.15,0);g.add(beak);
    const pouch=new THREE.Mesh(new THREE.SphereGeometry(.12,10,8),mat(0xf2a03d));
    pouch.scale.set(1.4,.8,.7);pouch.position.set(.45,1.05,0);g.add(pouch);
    /* 眼 */
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.04,8,6),mat(0x111111));
    eye.position.set(.32,1.26,.14);g.add(eye);
    /* 腿（踩踏板） */
    legL=new THREE.Mesh(new THREE.BoxGeometry(.06,.3,.06),mat(0xf2a03d));
    legL.position.set(-.1,.6,.12);g.add(legL);
    legR=new THREE.Mesh(new THREE.BoxGeometry(.06,.3,.06),mat(0xf2a03d));
    legR.position.set(-.1,.6,-.12);g.add(legR);
    /* 翅膀 */
    const wing=new THREE.Mesh(new THREE.SphereGeometry(.2,10,8),mat(0xe8e0d0));
    wing.scale.set(1.1,.6,.4);wing.position.set(-.15,.9,.28);g.add(wing);
    return g;
  }

  function ensure(){
    if(renderer)return true;
    const canvas=$('pelicanCanvas');if(!canvas)return false;
    try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});}
    catch(e){return false;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0x87c5eb);
    scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x87c5eb,18,40);
    camera=new THREE.PerspectiveCamera(55,1,.1,100);
    camera.position.set(0,2.2,7);
    camera.lookAt(0,1,0);
    scene.add(new THREE.HemisphereLight(0xffffff,0x6688aa,1.1));
    const sun=new THREE.DirectionalLight(0xfff2dd,1.4);sun.position.set(3,6,4);scene.add(sun);
    /* 地面 */
    ground=new THREE.Mesh(new THREE.PlaneGeometry(80,8),mat(0x7fb069));
    ground.rotation.x=-Math.PI/2;ground.position.y=0;scene.add(ground);
    const road=new THREE.Mesh(new THREE.PlaneGeometry(80,2.2),mat(0x9aa0a6));
    road.rotation.x=-Math.PI/2;road.position.y=.01;scene.add(road);
    pelican=buildPelican();scene.add(pelican);
    window.addEventListener('resize',resize);
    resize();
    return true;
  }
  function resize(){
    const stage=$('pelicanStage');if(!stage||!renderer)return;
    const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.updateProjectionMatrix();
  }

  function syncObstacles(){
    /* 复用网格池 */
    while(obstacleMeshes.length<state.obstacles.length){
      const m=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),mat(0xc96f2f));
      scene.add(m);obstacleMeshes.push(m);
    }
    state.obstacles.forEach((o,i)=>{
      const m=obstacleMeshes[i];
      m.visible=true;
      m.scale.set(o.w,o.h,.6);
      m.position.set(o.x,o.h/2,0);
    });
    for(let i=state.obstacles.length;i<obstacleMeshes.length;i++)obstacleMeshes[i].visible=false;
  }

  function loop(t){
    if(!active)return;
    raf=requestAnimationFrame(loop);
    const dt=last?Math.min(.05,(t-last)/1000):0;last=t;
    if(state.started&&!state.over){
      state=pelicanTick(state,dt);
      if(state.over){env.onOver&&env.onOver(state.score,state.best);env.setBest&&env.setBest(state.best);}
    }
    /* 画鹈鹕 */
    pelican.position.y=state.y;
    pelican.rotation.z=state.onGround?0:clamp(state.vy*.02,-.3,.3);
    const spin=state.distance*3;
    wheelF.rotation.z=-spin;wheelB.rotation.z=-spin;
    legL.rotation.x=Math.sin(spin)*.5;legR.rotation.x=-Math.sin(spin)*.5;
    syncObstacles();
    /* 地面纹理滚动错觉：移动 road 不需要，障碍移动已体现前进 */
    const hud=$('pelicanScore');if(hud)hud.textContent=state.score;
    const bhud=$('pelicanBest');if(bhud)bhud.textContent=state.best;
    const msg=$('pelicanMsg');
    if(msg){
      if(!state.started)msg.textContent='点按屏幕开始 · 跳跃躲障碍';
      else if(state.over)msg.textContent='撞上了！得分 '+state.score+' · 点按重来';
      else msg.textContent='';
    }
    renderer.render(scene,camera);
  }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

  function tap(){
    if(!state.started||state.over){state=pelicanStart(best);best=state.best;}
    else state=pelicanJump(state);
  }
  function enter(){
    if(!ensure())return false;
    active=true;last=0;
    state=pelicanStart(best);
    resize();
    cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
    return true;
  }
  function leave(){active=false;cancelAnimationFrame(raf);}

  const canvas=$('pelicanCanvas');
  if(canvas)canvas.addEventListener('pointerdown',e=>{e.preventDefault();tap();});
  const btn=$('pelicanJumpBtn');if(btn)btn.onclick=tap;

  return {enter,leave,jump:tap,debug:()=>({score:state.score,over:state.over,started:state.started})};
}