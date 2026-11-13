/* 天工 · 鹈鹕骑自行车 3D 渲染层（three.js，静态包含于主 bundle）
 * 可爱低多边形鹈鹕+真自行车，横版自动前进，点按跳跃躲障碍。
 * 逻辑在 pelican.js（纯函数），这里只负责画与输入。 */
import * as THREE from 'three';
import {pelicanStart,pelicanJump,pelicanTick} from './pelican.js';

export function init(env){
  const $=id=>document.getElementById(id);
  let renderer=null,scene=null,camera=null,raf=0,active=false,last=0;
  let pelican=null,bike=null,pedal=null,legL=null,legR=null,wingL=null,wingR=null,head=null,shadow=null;
  const wheels=[],clouds=[],dashes=[],obstaclePool=[],particles=[];
  let prevScore=0,wasOver=false,crashT=0,stretch=0,squash=0,prevGround=true,shake=0;
  let state=pelicanStart(0);
  let best=(env.getBest&&env.getBest())||0;

  const WHITE=0xfbf7ee,CREAM=0xefe6d4,ORANGE=0xf6a13c,ORANGE_D=0xe08a2c,TIP=0x3a3f45,RED=0xe05545,TIRE=0x2e3134;
  function mat(c,extra){return new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:.65,metalness:.05},extra||{}));}
  function tube(a,b,r,m){
    const d=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    const len=d.length();
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,len,8),m);
    mesh.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
    return mesh;
  }

  function buildBike(){
    const g=new THREE.Group();
    const frameM=mat(RED,{roughness:.4,metalness:.25});
    const metalM=mat(0xb9c1c9,{roughness:.35,metalness:.6});
    /* 车轮：外胎+轮圈+辐条+花鼓 */
    for(const sx of [-.5,.5]){
      const w=new THREE.Group();
      w.add(new THREE.Mesh(new THREE.TorusGeometry(.3,.05,10,24),mat(TIRE,{roughness:.9})));
      w.add(new THREE.Mesh(new THREE.TorusGeometry(.24,.015,6,24),metalM));
      for(let i=0;i<6;i++){
        const s=new THREE.Mesh(new THREE.BoxGeometry(.02,.46,.02),metalM);
        s.rotation.z=i*Math.PI/3;w.add(s);
      }
      const hub=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,.08,10),metalM);
      hub.rotation.x=Math.PI/2;w.add(hub);
      w.position.set(sx,.3,0);g.add(w);wheels.push(w);
    }
    /* 车架管 */
    g.add(tube([-.5,.3,0],[-.2,.78,0],.03,frameM));      // 后叉→座管
    g.add(tube([-.2,.78,0],[.02,.42,0],.03,frameM));     // 座管→中轴
    g.add(tube([.02,.42,0],[-.5,.3,0],.025,frameM));     // 中轴→后轴
    g.add(tube([.02,.42,0],[.38,.72,0],.03,frameM));     // 下管
    g.add(tube([-.2,.78,0],[.38,.72,0],.028,frameM));    // 上管
    g.add(tube([.38,.72,0],[.5,.3,0],.028,frameM));      // 前叉
    g.add(tube([.38,.72,0],[.42,.9,0],.025,metalM));     // 把立
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.4,8),metalM);
    bar.rotation.x=Math.PI/2;bar.position.set(.42,.9,0);g.add(bar);
    for(const sz of [-.19,.19]){
      const grip=new THREE.Mesh(new THREE.CylinderGeometry(.032,.032,.1,8),mat(TIRE));
      grip.rotation.x=Math.PI/2;grip.position.set(.42,.9,sz);g.add(grip);
    }
    /* 座垫 */
    g.add(tube([-.2,.78,0],[-.22,.9,0],.02,metalM));
    const seat=new THREE.Mesh(new THREE.SphereGeometry(.11,12,8),mat(TIRE,{roughness:.8}));
    seat.scale.set(1.5,.5,1);seat.position.set(-.22,.93,0);g.add(seat);
    /* 牙盘+曲柄+踏板（旋转组） */
    const chain=new THREE.Mesh(new THREE.TorusGeometry(.09,.015,6,16),metalM);
    chain.position.set(.02,.42,.05);g.add(chain);
    pedal=new THREE.Group();pedal.position.set(.02,.42,0);
    for(const s of [1,-1]){
      const arm=new THREE.Mesh(new THREE.BoxGeometry(.03,.3,.03),metalM);
      arm.position.set(0,.13*s,.07*s);pedal.add(arm);
      const pd=new THREE.Mesh(new THREE.BoxGeometry(.12,.025,.07),mat(TIRE));
      pd.position.set(0,.27*s,.1*s);pedal.add(pd);
    }
    g.add(pedal);
    g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    return g;
  }

  function buildRider(){
    const g=new THREE.Group();
    /* 圆身体+奶油肚皮 */
    const body=new THREE.Mesh(new THREE.SphereGeometry(.34,20,14),mat(WHITE));
    body.scale.set(1.15,1,.9);body.position.set(-.16,1.22,0);g.add(body);
    const belly=new THREE.Mesh(new THREE.SphereGeometry(.3,16,12),mat(CREAM));
    belly.scale.set(1,.85,.75);belly.position.set(-.08,1.14,0);g.add(belly);
    /* 尾羽 */
    const tail=new THREE.Mesh(new THREE.ConeGeometry(.09,.28,8),mat(TIP));
    tail.rotation.z=Math.PI/2+.5;tail.position.set(-.52,1.3,0);g.add(tail);
    /* 头（独立组，可点头） */
    head=new THREE.Group();head.position.set(.16,1.62,0);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(.21,20,14),mat(WHITE)));
    const beak=new THREE.Mesh(new THREE.BoxGeometry(.42,.05,.1),mat(ORANGE));
    beak.position.set(.3,-.02,0);head.add(beak);
    const pouch=new THREE.Mesh(new THREE.SphereGeometry(.14,14,10),mat(ORANGE_D));
    pouch.scale.set(1.7,.9,.75);pouch.position.set(.26,-.1,0);head.add(pouch);
    for(const sz of [-.13,.13]){
      const eye=new THREE.Mesh(new THREE.SphereGeometry(.058,10,8),mat(0xffffff,{roughness:.3}));
      eye.position.set(.12,.07,sz);head.add(eye);
      const pupil=new THREE.Mesh(new THREE.SphereGeometry(.03,8,6),mat(0x14161a,{roughness:.3}));
      pupil.position.set(.155,.07,sz*1.12);head.add(pupil);
      const spark=new THREE.Mesh(new THREE.SphereGeometry(.011,6,4),mat(0xffffff,{roughness:.2}));
      spark.position.set(.175,.095,sz*1.1);head.add(spark);
      const blush=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),mat(0xf7c8c0,{roughness:.9}));
      blush.scale.set(1,.6,.5);blush.position.set(.1,-.03,sz*1.25);head.add(blush);
    }
    g.add(head);
    /* 翅膀：白翅+黑翅尖，可扇动 */
    for(const s of [1,-1]){
      const w=new THREE.Group();w.position.set(-.14,1.3,.27*s);
      const wing=new THREE.Mesh(new THREE.SphereGeometry(.2,12,10),mat(CREAM));
      wing.scale.set(1.2,.6,.35);wing.position.set(-.04,-.06,.04*s);w.add(wing);
      const tip=new THREE.Mesh(new THREE.SphereGeometry(.12,10,8),mat(TIP));
      tip.scale.set(1.2,.5,.3);tip.position.set(-.2,-.1,.05*s);w.add(tip);
      g.add(w);if(s===1)wingL=w;else wingR=w;
    }
    /* 橙色小腿+脚蹼，踩踏板 */
    for(const s of [1,-1]){
      const leg=new THREE.Group();leg.position.set(-.05,.95,.1*s);
      const thigh=new THREE.Mesh(new THREE.CylinderGeometry(.035,.03,.3,8),mat(ORANGE));
      thigh.position.set(0,-.14,0);leg.add(thigh);
      const foot=new THREE.Mesh(new THREE.BoxGeometry(.14,.03,.08),mat(ORANGE_D));
      foot.position.set(.04,-.3,.02*s);leg.add(foot);
      g.add(leg);if(s===1)legL=leg;else legR=leg;
    }
    g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    return g;
  }

  function buildObstacle(kind){
    const g=new THREE.Group();
    if(kind===0){ /* 交通锥 */
      const base=new THREE.Mesh(new THREE.BoxGeometry(.7,.06,.7),mat(0xd9742a));base.position.y=.03;g.add(base);
      const cone=new THREE.Mesh(new THREE.ConeGeometry(.3,1,12),mat(0xe8842f));cone.position.y=.55;g.add(cone);
      const band=new THREE.Mesh(new THREE.CylinderGeometry(.19,.23,.14,12),mat(0xffffff));band.position.y=.55;g.add(band);
    }else if(kind===1){ /* 木箱 */
      const box=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),mat(0xb08050));box.position.y=.5;g.add(box);
      for(const y of [.25,.75]){const slat=new THREE.Mesh(new THREE.BoxGeometry(1.02,.08,1.02),mat(0x8a6238));slat.position.y=y;g.add(slat);}
    }else{ /* 灌木 */
      const bush=new THREE.Mesh(new THREE.SphereGeometry(.5,12,10),mat(0x4f8f5b));bush.scale.set(1,.9,.8);bush.position.y=.45;g.add(bush);
      const b2=new THREE.Mesh(new THREE.SphereGeometry(.32,10,8),mat(0x5fa06b));b2.position.set(.3,.35,.1);g.add(b2);
      for(let i=0;i<3;i++){const f=new THREE.Mesh(new THREE.SphereGeometry(.04,6,5),mat(0xe26d5a));f.position.set(-.2+i*.2,.6+(i%2)*.12,.2);g.add(f);}
    }
    g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
    return g;
  }

  function burst(x,y,n,color){
    for(let i=0;i<n;i++){
      let p=particles.find(q=>!q.active);
      if(!p){
        if(particles.length>=48)break;
        const m=new THREE.Mesh(new THREE.SphereGeometry(.06,6,5),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true}));
        scene.add(m);p={m,active:false,vx:0,vy:0,life:0};particles.push(p);
      }
      p.active=true;p.m.visible=true;p.m.material.color.setHex(color);
      p.m.position.set(x,y,.25);
      const a=Math.random()*Math.PI*2,s=2+Math.random()*3;
      p.vx=Math.cos(a)*s;p.vy=Math.sin(a)*s+2.5;p.life=.5+Math.random()*.3;
      p.m.material.opacity=1;
    }
  }
  function scorePop(text){
    const stage=$('pelicanStage');if(!stage)return;
    const el=document.createElement('span');el.className='pelican-pop';el.textContent=text;
    el.style.left=(38+Math.random()*12)+'%';el.style.top='36%';
    stage.append(el);setTimeout(()=>el.remove(),750);
  }

  function ensure(){
    if(renderer)return true;
    const canvas=$('pelicanCanvas');if(!canvas)return false;
    try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});}
    catch(e){return false;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x9fd3f0);
    scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x9fd3f0,20,46);
    camera=new THREE.PerspectiveCamera(50,1,.1,120);
    camera.position.set(0,1.9,7.4);
    camera.lookAt(0,1.15,0);
    scene.add(new THREE.HemisphereLight(0xffffff,0x86a06a,1.15));
    const sun=new THREE.DirectionalLight(0xfff2dd,1.6);
    sun.position.set(4,8,5);sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);
    sun.shadow.camera.left=-9;sun.shadow.camera.right=9;
    sun.shadow.camera.top=9;sun.shadow.camera.bottom=-4;
    scene.add(sun);
    /* 草地+路面+滚动中线 */
    const grass=new THREE.Mesh(new THREE.PlaneGeometry(140,26),mat(0x8cc07c,{roughness:1}));
    grass.rotation.x=-Math.PI/2;grass.receiveShadow=true;scene.add(grass);
    const road=new THREE.Mesh(new THREE.PlaneGeometry(140,2.6),mat(0x8f959c,{roughness:1}));
    road.rotation.x=-Math.PI/2;road.position.y=.01;road.receiveShadow=true;scene.add(road);
    for(let i=0;i<14;i++){
      const d=new THREE.Mesh(new THREE.PlaneGeometry(.7,.12),mat(0xf4f6f8,{roughness:1}));
      d.rotation.x=-Math.PI/2;d.position.set(-20+i*3,.02,0);scene.add(d);dashes.push(d);
    }
    /* 远山+太阳+流云 */
    for(const [x,r,c] of [[-14,7,0x6faf7f],[6,9,0x5f9f6f],[20,6,0x7fbf8f]]){
      const h=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),mat(c,{roughness:1}));
      h.scale.set(1,.35,1);h.position.set(x,-.4,-22);scene.add(h);
    }
    const sunBall=new THREE.Mesh(new THREE.SphereGeometry(1.1,16,12),new THREE.MeshBasicMaterial({color:0xffd76e}));
    sunBall.position.set(-11,10,-30);scene.add(sunBall);
    for(let i=0;i<5;i++){
      const c=new THREE.Group();
      const cm=mat(0xffffff,{roughness:1});
      for(const [ox,oy,r] of [[0,0,.7],[.7,.1,.5],[-.7,.05,.5]]){
        const p=new THREE.Mesh(new THREE.SphereGeometry(r,12,9),cm);p.position.set(ox,oy,0);c.add(p);
      }
      c.position.set(-18+i*8,5.5+(i%3)*1.2,-14-(i%2)*4);
      scene.add(c);clouds.push(c);
    }
    /* 主角：车+鹈鹕 */
    bike=buildBike();pelican=buildRider();
    pelican.position.y=-.12; /* 让鹈鹕坐实在座垫上 */
    const actor=new THREE.Group();actor.add(bike);actor.add(pelican);
    pelican=actor;scene.add(actor);
    /* 软阴影贴片（跳跃时缩小变淡） */
    shadow=new THREE.Mesh(new THREE.CircleGeometry(.75,20),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.22}));
    shadow.rotation.x=-Math.PI/2;shadow.position.y=.02;scene.add(shadow);
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
    while(obstaclePool.length<state.obstacles.length){
      const kinds=[buildObstacle(0),buildObstacle(1),buildObstacle(2)];
      const g=new THREE.Group();for(const k of kinds){k.visible=false;g.add(k);}
      scene.add(g);obstaclePool.push(g);
    }
    state.obstacles.forEach((o,i)=>{
      const g=obstaclePool[i];g.visible=true;
      const kind=i%3;
      g.children.forEach((k,j)=>{k.visible=j===kind;});
      g.scale.set(o.w,o.h,.6);
      g.position.set(o.x,0,0);
    });
    for(let i=state.obstacles.length;i<obstaclePool.length;i++)obstaclePool[i].visible=false;
  }

  function loop(t){
    if(!active)return;
    raf=requestAnimationFrame(loop);
    const dt=last?Math.min(.05,(t-last)/1000):0;last=t;
    if(state.started&&!state.over){
      state=pelicanTick(state,dt);
      if(state.over){env.onOver&&env.onOver(state.score,state.best);env.setBest&&env.setBest(state.best);}
    }
    /* 事件：撞车 / 得分 / 起跳 / 落地 */
    if(state.over&&!wasOver){crashT=0;shake=1;burst(0,state.y+.7,16,0xffb347);burst(0,state.y+.5,8,0xffffff);}
    wasOver=state.over;
    if(state.score>prevScore){scorePop('+1');burst(.7,state.y+.9,4,0xffe08a);}
    prevScore=state.score;
    if(prevGround&&!state.onGround&&state.started&&!state.over)stretch=1;
    if(!prevGround&&state.onGround){squash=1;burst(0,.12,5,0xcfc8b8);}
    prevGround=state.onGround;
    /* 主角姿态：跳跃拉伸/落地压扁/撞车翻倒 */
    stretch=Math.max(0,stretch-dt*4);squash=Math.max(0,squash-dt*5);
    pelican.position.y=state.y;
    if(state.over){crashT+=dt;pelican.rotation.z=Math.min(1.1,crashT*3);}
    else pelican.rotation.z=clamp(state.vy*.02,-.3,.3);
    pelican.scale.set(1+squash*.15-stretch*.08,1-squash*.18+stretch*.15,1);
    const spin=state.distance*3;
    for(const w of wheels)w.rotation.z=-spin;
    pedal.rotation.z=-spin;
    legL.rotation.z=Math.sin(spin)*.45;legR.rotation.z=-Math.sin(spin)*.45;
    const flap=state.onGround?Math.sin(t*.004)*.06:.5;
    wingL.rotation.x=flap;wingR.rotation.x=-flap;
    head.rotation.z=state.onGround?Math.sin(t*.003)*.04:.15;
    shadow.scale.setScalar(clamp(1-state.y*.18,.4,1));
    shadow.material.opacity=.22*clamp(1-state.y*.2,.3,1);
    /* 环境流动 */
    const move=(state.started&&!state.over)?state.speed*dt:0;
    for(const d of dashes){d.position.x-=move;if(d.position.x<-21)d.position.x+=42;}
    for(const c of clouds){c.position.x-=move*.12+dt*.25;if(c.position.x<-24)c.position.x+=48;}
    syncObstacles();
    /* 粒子更新 */
    for(const p of particles){
      if(!p.active)continue;
      p.life-=dt;
      if(p.life<=0){p.active=false;p.m.visible=false;continue;}
      p.vy-=12*dt;p.m.position.x+=p.vx*dt;p.m.position.y+=p.vy*dt;
      p.m.material.opacity=Math.min(1,p.life*2.5);
    }
    /* 镜头震动 */
    shake=Math.max(0,shake-dt*2.5);
    camera.position.x=(Math.random()-.5)*shake*.3;
    camera.position.y=1.9+(Math.random()-.5)*shake*.3;
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
    if(!state.started||state.over){
      state=pelicanStart(best);best=state.best;
      crashT=0;shake=0;stretch=0;squash=0;prevScore=0;wasOver=false;prevGround=true;
      for(const p of particles){p.active=false;p.m.visible=false;}
    }
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