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
  let hole=null,holeShock=null,holeHud=[],labels=new Map(),constellation=null;
  let holePlane=null,holeUniforms=null,holeParticles=null,holeJets=[];
  let holePulse=0,holeAttract=0,shockT=1,lastTelem=0;
  const reduceMotion=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const mScale=reduceMotion?.25:1;
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

  /* ---------- 引力透镜黑洞着色器（Gargantua 风格） ----------
     沿视线做弱场光线偏折（引力积分），吸积盘在 XZ 平面、近侧倾角。
     光线穿过盘面前后各取一次采样 → 前景盘 + 被透镜弯到阴影上方的远侧盘弧。
     多普勒束流让迎向我们的一侧更亮偏蓝、远离侧偏红；光子环 + 事件视界纯黑。
     背景是程序化星场 + 银河带，星光被引力弯折，边缘有渐晕。 */
  const BH_FRAG=`
    precision highp float;
    varying vec2 vUv;
    uniform float uTime,uPulse,uAttract,uMotion,uZoom,uDiskSpeed,uTurb,uBeam,uHue,uGlow,uIncl;
    uniform vec2 uTilt;
    const float RH=0.30;
    const float PI=3.14159265359;
    float h21(vec2 p){p=fract(p*vec2(234.34,435.345));p+=dot(p,p+34.23);return fract(p.x*p.y);}
    float vnoise(vec2 p){
      vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      float a=h21(i),b=h21(i+vec2(1.0,0.0)),c=h21(i+vec2(0.0,1.0)),d=h21(i+vec2(1.0,1.0));
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}
    vec3 starLayer(vec2 uv,float scale,float thresh){
      vec2 g=uv*scale;vec2 id=floor(g),f=fract(g);
      float rn=h21(id);
      if(rn<thresh)return vec3(0.0);
      vec2 sp=vec2(h21(id+7.1),h21(id+3.7));
      float d=length(f-sp);
      float tw=0.6+0.4*sin(uTime*(1.5+rn*3.0)+rn*40.0);
      float star=(1.0-smoothstep(0.0,0.10,d))*tw;
      vec3 tint=mix(vec3(0.70,0.82,1.0),vec3(1.0,0.88,0.72),h21(id+11.0));
      return tint*star*(0.4+rn);
    }
    vec3 background(vec2 dir){
      vec2 buv=dir*1.6+uTilt*0.18;
      vec3 col=vec3(0.012,0.016,0.035);
      float band=exp(-pow((buv.y+buv.x*0.35)*1.7,2.0));
      float neb=fbm(buv*2.4+vec2(3.1,1.3));
      col+=vec3(0.10,0.07,0.22)*band*neb*1.5;
      col+=vec3(0.03,0.11,0.17)*band*pow(neb,2.0)*1.2;
      col+=starLayer(buv,22.0,0.80)*0.9;
      col+=starLayer(buv+5.0,46.0,0.86)*0.6;
      col+=starLayer(buv+9.0,78.0,0.90)*0.4;
      return col;
    }
    vec3 diskColor(vec3 hp,float r,float ang){
      float t=uTime*uMotion;
      float speed=1.7*uDiskSpeed/pow(max(r,0.42),1.5);
      float a=ang+t*speed;
      vec2 sw=vec2(cos(a),sin(a))*r;
      float n=fbm(sw*3.1+vec2(0.0,r*2.0));
      float n2=fbm(sw*6.5-vec2(t*0.12,0.0));
      float streak=0.5+uTurb*(0.5*n+0.30*n2);
      float inner=smoothstep(RH*1.02,RH*1.38,r);
      float outer=1.0-smoothstep(1.02,1.58,r);
      float bright=inner*outer*streak;
      bright*=1.45/pow(max(r,0.42),1.35);
      float dop=cos(ang+0.7);
      float beam=1.0+uBeam*dop;
      bright*=max(beam,0.12);
      vec3 hot=vec3(1.0,0.94,0.80),mid=vec3(1.0,0.55,0.20),cool=vec3(0.78,0.17,0.06);
      float tt=clamp((r-RH)/1.1,0.0,1.0);
      vec3 col=mix(hot,mid,smoothstep(0.0,0.45,tt));
      col=mix(col,cool,smoothstep(0.45,1.0,tt));
      col=mix(col,vec3(0.78,0.87,1.0),clamp(dop,0.0,1.0)*0.32);
      col=mix(col,vec3(1.0,0.32,0.14),clamp(-dop,0.0,1.0)*0.28);
      /* 色相偏移：0 为 EHT 橙，1 偏向蓝移冷盘。 */
      col=mix(col,col.bgr*vec3(0.85,0.95,1.15),uHue);
      return col*bright;
    }
    void main(){
      vec2 p=(vUv-0.5)*2.0*uZoom;
      float r0=length(p);
      float camDist=4.6;
      vec3 ro=vec3(0.0,camDist*uIncl,camDist);
      vec3 fwd=normalize(-ro);
      vec3 right=normalize(cross(fwd,vec3(0.0,1.0,0.0)));
      vec3 up=cross(right,fwd);
      vec3 rd=normalize(fwd*1.9+right*p.x+up*p.y);
      vec3 pos=ro;vec3 dir=rd;
      vec3 col=vec3(0.0);
      float trans=1.0;
      float minR=100.0;
      bool captured=false;
      float dt=0.16;
      for(int i=0;i<72;i++){
        float r=length(pos);
        minR=min(minR,r);
        if(r<RH*0.98){captured=true;break;}
        if(r>18.0)break;
        vec3 acc=-pos*(0.40/(r*r*r));
        dir=normalize(dir+acc*dt);
        vec3 npos=pos+dir*dt;
        if(pos.y*npos.y<0.0){
          float tc=pos.y/(pos.y-npos.y);
          vec3 hp=mix(pos,npos,tc);
          float hr=length(hp.xz);
          if(hr>RH*1.02&&hr<1.6){
            float ang=atan(hp.z,hp.x);
            vec3 dc=diskColor(hp,hr,ang);
            float alpha=clamp(length(dc)*0.9,0.0,1.0);
            col+=dc*trans;
            trans*=(1.0-alpha*0.85);
          }
        }
        pos=npos;
        if(trans<0.02)break;
      }
      if(!captured){
        col+=background(dir.xy+dir.z*0.3)*trans;
      }
      /* 事件视界：被捕获的光线直接纯黑，边界即真实阴影轮廓，
         不再用屏幕空间圆罩（圆罩与投影边界错位会产生缺口）。 */
      if(captured){gl_FragColor=vec4(0.0,0.0,0.0,1.0);return;}
      float ringR=RH*1.55;
      float ring=exp(-pow((minR-ringR)/(RH*0.11),2.0));
      col+=vec3(1.0,0.86,0.62)*ring*(0.85+uPulse*1.6);
      float ph=exp(-pow((r0-ringR*0.80)/0.013,2.0));
      col+=vec3(1.0,0.90,0.72)*ph*(0.5+uPulse*1.1);
      col+=vec3(1.0,0.5,0.2)*exp(-r0*1.8)*0.05*uGlow*(1.0+uPulse*2.0+uAttract*1.6);
      col*=1.0-0.42*smoothstep(0.72,1.42,r0);
      col=col/(1.0+col*0.32);
      col=pow(max(col,0.0),vec3(0.92));
      col+=vec3(h21(vUv*913.0+fract(uTime))-0.5)*0.012;
      gl_FragColor=vec4(col,1.0);
    }`;
  const BH_VERT=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
  /* 喷流：沿极轴的淡蓝能量柱，上下各一，噪声流动。 */
  const JET_FRAG=`
    precision highp float;varying vec2 vUv;uniform float uTime,uMotion,uPulse,uJet;
    float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      float x=abs(vUv.x-0.5)*2.0;
      float core=exp(-x*x*7.0);
      float len=pow(1.0-vUv.y,1.5);
      float flick=0.7+0.3*sin(uTime*uMotion*3.0+vUv.y*22.0);
      float a=core*len*flick*uJet*(0.30+uPulse*0.5);
      vec3 col=mix(vec3(0.35,0.75,1.0),vec3(0.72,0.92,1.0),core);
      gl_FragColor=vec4(col*a,a);
    }`;
  const JET_VERT=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;

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
    /* 黑洞（首页视觉中心）：引力透镜着色器 + 内流粒子 + 极喷流 + 科幻 HUD。
       着色器平面永远面向相机（billboard），内部自带倾角与透镜，避免双重投影。 */
    hole=new THREE.Group();
    holeUniforms={uTime:{value:0},uPulse:{value:0},uAttract:{value:0},uMotion:{value:mScale},uZoom:{value:1.45},uDiskSpeed:{value:1},uTurb:{value:1},uBeam:{value:.9},uHue:{value:0},uGlow:{value:1},uIncl:{value:.30},uTilt:{value:new THREE.Vector2(0,0)}};
    const bhMat=new THREE.ShaderMaterial({vertexShader:BH_VERT,fragmentShader:BH_FRAG,uniforms:holeUniforms,transparent:false,depthWrite:true});
    holePlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),bhMat);
    holePlane.scale.set(6.4,6.4,1);
    holePlane.renderOrder=-1;
    hole.add(holePlane);
    holeAdvanced=true;
    /* 内流粒子：GPU 顶点着色器驱动螺旋坠入，零 CPU 逐帧开销。 */
    const PN=420;
    const pGeo=new THREE.BufferGeometry();
    const seeds=new Float32Array(PN*4),sizes=new Float32Array(PN),dummy=new Float32Array(PN*3);
    for(let i=0;i<PN;i++){
      seeds[i*4]=Math.random();          /* 相位 */
      seeds[i*4+1]=Math.random();        /* 角速度因子 */
      seeds[i*4+2]=Math.random();        /* 初始半径因子 */
      seeds[i*4+3]=Math.random();        /* 倾角/厚度 */
      sizes[i]=.5+Math.random()*1.3;
    }
    pGeo.setAttribute('position',new THREE.BufferAttribute(dummy,3));
    pGeo.setAttribute('aSeed',new THREE.BufferAttribute(seeds,4));
    pGeo.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
    const pMat=new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms:{uTime:{value:0},uMotion:{value:mScale},uPx:{value:Math.min(window.devicePixelRatio||1,2)},uDensity:{value:1}},
      vertexShader:`
        attribute vec4 aSeed;attribute float aSize;
        uniform float uTime,uMotion,uPx,uDensity;varying float vFade;varying float vHeat;
        void main(){
          if(aSeed.z>uDensity){gl_Position=vec4(2.0,2.0,2.0,1.0);gl_PointSize=0.0;vFade=0.0;vHeat=0.0;return;}
          float life=fract(aSeed.x+uTime*uMotion*(0.05+aSeed.y*0.06));
          float r=mix(2.9,0.34,pow(life,0.8));
          float ang=aSeed.x*6.2831+uTime*uMotion*(0.5+aSeed.y*0.9)+life*3.0;
          float thick=(aSeed.w-0.5)*0.16*r;
          vec3 p=vec3(cos(ang)*r,thick,sin(ang)*r);
          /* 坠入阴影轮廓前先淡出：粒子不许在纯黑视界里当橙点。 */
          vFade=smoothstep(0.0,0.12,life)*(1.0-smoothstep(0.82,1.0,life))*smoothstep(0.95,1.3,r);
          vHeat=1.0-life;
          vec4 mv=modelViewMatrix*vec4(p,1.0);
          gl_PointSize=aSize*uPx*(34.0/-mv.z)*(0.5+vHeat*0.8);
          gl_Position=projectionMatrix*mv;
        }`,
      fragmentShader:`
        precision highp float;varying float vFade;varying float vHeat;
        void main(){
          vec2 c=gl_PointCoord-0.5;float d=length(c);
          float a=(1.0-smoothstep(0.0,0.5,d))*vFade;
          vec3 col=mix(vec3(1.0,0.45,0.16),vec3(1.0,0.92,0.72),vHeat);
          gl_FragColor=vec4(col*a,a);
        }`
    });
    holeParticles=new THREE.Points(pGeo,pMat);
    holeParticles.rotation.x=1.28; /* 与着色器盘倾角呼应 */
    holeParticles.renderOrder=2;
    hole.add(holeParticles);
    /* 极喷流：上下两道淡蓝能量柱。 */
    const jetMat=new THREE.ShaderMaterial({vertexShader:JET_VERT,fragmentShader:JET_FRAG,uniforms:{uTime:{value:0},uMotion:{value:mScale},uPulse:{value:0},uJet:{value:1}},transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
    for(const sgn of [1,-1]){
      const jet=new THREE.Mesh(new THREE.PlaneGeometry(.42,2.2),jetMat);
      jet.position.y=sgn*2.1;
      if(sgn<0)jet.rotation.z=Math.PI;
      jet.renderOrder=1;
      holeJets.push(jet);hole.add(jet);
    }
    /* 冲击波（收纳时扩散） */
    holeShock=new THREE.Mesh(new THREE.RingGeometry(.6,.66,48),new THREE.MeshBasicMaterial({color:0xffc07a,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
    holeShock.renderOrder=3;hole.add(holeShock);
    /* 环境辉光改由着色器 uGlow 承担，不再叠不透明平面前的精灵（会染灰阴影）。 */
    /* 科幻 HUD：分段刻度环 + 旋转扫描弧 + 十字准星，青色冷光。 */
    const hudMat=new THREE.MeshBasicMaterial({color:0x6fe0ff,transparent:true,opacity:.20,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide});
    const hud1=new THREE.Mesh(new THREE.RingGeometry(2.35,2.37,96),hudMat);hole.add(hud1);
    const hud2=new THREE.Mesh(new THREE.RingGeometry(2.62,2.635,96,1,0,Math.PI*1.35),hudMat.clone());hud2.material.opacity=.16;hole.add(hud2);
    const hud3=new THREE.Mesh(new THREE.RingGeometry(2.05,2.06,64,1,0,Math.PI*.5),hudMat.clone());hud3.material.opacity=.22;hole.add(hud3);
    holeHud=[hud1,hud2,hud3];
    hole.position.set(0,0,3.5);
    hole.scale.setScalar(1.0);
    scene.add(hole);
    /* 启动时 obsApply 先于着色器创建跑过，uniform 没拿到记忆值；
       建好后把滑杆当前值重放一遍，保证重启后黑洞就是上次的模样。 */
    obsApply(obsRead());
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
    /* 收纳钮常驻坞内：空时也可点开看空态说明，不再整体隐藏。 */
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
      lastInteract=performance.now();
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
      lastInteract=performance.now();
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
        if(holeUniforms)holeUniforms.uAttract.value=holeAttract;
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
        holeAttract=0;if(holeUniforms)holeUniforms.uAttract.value=0;
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
    /* 视距：滚轮 / 双指捏合推拉黑洞，写回观测台滑杆并记忆。 */
    const setZoom=z=>{
      const v=obsRead();v.zoom=+clamp(z,OBS_RANGE.zoom[0],OBS_RANGE.zoom[1]).toFixed(2);
      obsApply(v);obsSave(v);
    };
    cv.addEventListener('wheel',e=>{e.preventDefault();lastInteract=performance.now();setZoom(obsZoom*(e.deltaY>0?.92:1.08));},{passive:false});
    let pinchD=0;
    cv.addEventListener('touchstart',e=>{if(e.touches.length===2){pinchD=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);downInfo=null;drag=null;dragStar=null;}},{passive:true});
    cv.addEventListener('touchmove',e=>{
      if(e.touches.length===2&&pinchD){
        e.preventDefault();lastInteract=performance.now();
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
        setZoom(obsZoom*(d/pinchD));pinchD=d;
      }
    },{passive:false});
    cv.addEventListener('touchend',e=>{if(e.touches.length<2)pinchD=0;},{passive:true});
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
  let lastT=0,lastInteract=0,lastLabel=0;
  function loop(t){
    if(!active)return;
    raf=requestAnimationFrame(loop);
    const dt=Math.min(50,t-(lastT||t));lastT=t;
    /* 尺寸自愈：首帧可能早于布局，或旋屏/分屏后容器变化，
       每帧廉价比对一次，避免画布停留在错误分辨率。 */
    resize();
    /* 闲置 2.5s 后天球极慢自转：首屏即有活感，一碰就停。 */
    if(!drag&&!sucking&&t-lastInteract>2500)group.rotation.y+=dt*.00002*mScale;
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
    /* 先投影全部星，按深度排序；标签重叠时只留近的，避免糊成一团。
       标签 DOM 读写节流到 ~30Hz，画布渲染仍全帧率。 */
    const doLabels=t-lastLabel>33;
    if(doLabels)lastLabel=t;
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
    const hpe=hole.position.clone().add(new THREE.Vector3(1.7*hole.scale.x,0,0)).project(camera);
    const hr=Math.max(70,Math.abs((hpe.x-hp.x)*.5*w));
    const holeRect={x:(hp.x*.5+.5)*w-hr,y:(-hp.y*.5+.5)*h-hr,w:hr*2,h:hr*2};
    /* 左上遥测也是排斥区：星标签落进去会和坐标文字叠在一起。 */
    const telem=document.querySelector('.bh-telemetry');
    const telemRect=telem?{x:0,y:0,w:telem.offsetWidth+20,h:telem.offsetTop+telem.offsetHeight+10}:null;
    const placed=[];
    for(const item of doLabels?proj:[]){
      const label=labels.get(item.id);
      if(!label)continue;
      if(item.behind||item.p.z>1){label.style.opacity='0';label.style.pointerEvents='none';continue;}
      /* 用真实渲染宽度收敛，估算值会让长标签贴边被裁。 */
      const lw=label.offsetWidth||Math.max(56,(env.modules().find(m=>m.id===item.id)||{title:''}).title.length*13+20);
      const lh=label.offsetHeight||24;
      const topSafe=76,bottomSafe=312,pad=10;
      let lx=clamp(item.x,lw/2+pad,Math.max(lw/2+pad,w-lw/2-pad));
      let ly=clamp(item.y+14,topSafe,Math.max(topSafe,h-bottomSafe-lh));
      /* 落在黑洞上的标签不隐藏：沿径向推到盘缘外，像环绕视界的仪表标牌，
         保证每个模块在首屏都点得到（首页即导航，藏标签等于藏功能）。 */
      const hcx=holeRect.x+hr,hcy=holeRect.y+hr;
      const need=hr+lh/2+12;
      let dx=lx-hcx,dy=(ly+lh/2)-hcy,dist=Math.hypot(dx,dy);
      if(dist<need){
        if(dist<1){const ang=proj.indexOf(item)*2.399963;dx=Math.cos(ang);dy=Math.sin(ang);dist=1;}
        const k=need/dist;
        let cx=clamp(hcx+dx*k,lw/2+pad,w-lw/2-pad);
        let cy=clamp(hcy+dy*k,topSafe+lh/2,Math.max(topSafe+lh/2,h-bottomSafe-lh/2));
        const ddx=cx-hcx,ddy=cy-hcy;
        if(Math.hypot(ddx,ddy)<need){
          const side=ddx>=0?1:-1;
          cx=clamp(hcx+side*Math.sqrt(Math.max(need*need-ddy*ddy,0)),lw/2+pad,w-lw/2-pad);
        }
        lx=cx;ly=cy-lh/2;
      }
      let rect={x:lx-lw/2,y:ly,w:lw,h:lh};
      const hit=r=>rect.x<r.x+r.w&&rect.x+rect.w>r.x&&rect.y<r.y+r.h&&rect.y+rect.h>r.y;
      /* 遥测区让位：先右移，放不下再下移。 */
      if(telemRect&&hit(telemRect)){
        lx=clamp(telemRect.w+lw/2+6,lw/2+pad,w-lw/2-pad);
        rect={x:lx-lw/2,y:ly,w:lw,h:lh};
        if(hit(telemRect)){ly=clamp(telemRect.h+6,topSafe,h-bottomSafe-lh);rect={x:lx-lw/2,y:ly,w:lw,h:lh};}
      }
      if(placed.some(hit)){label.style.opacity='0';label.style.pointerEvents='none';continue;}
      placed.push(rect);
      /* 越靠边越淡，但始终可读；被收敛过的标签不再额外压暗。 */
      label.style.opacity=String(clamp(1.15-Math.abs(item.p.x)*.35,.55,1));
      label.style.pointerEvents='auto';
      label.style.transform='translate(-50%,0) translate('+lx+'px,'+ly+'px)';
    }
    /* 黑洞：billboard 面向相机 + 着色器时间/脉冲/倾角 + 粒子喷流 + HUD 旋转。 */
    if(holePlane)holePlane.quaternion.copy(camera.quaternion);
    holePulse=Math.max(0,holePulse-.02);
    const ht=t*.001*obsTimeScale;
    if(holeUniforms){
      holeUniforms.uTime.value=ht;
      holeUniforms.uPulse.value=holePulse;
      holeUniforms.uTilt.value.set(tilt.x,tilt.y);
    }
    if(holeParticles)holeParticles.material.uniforms.uTime.value=ht;
    for(const j of holeJets){j.material.uniforms.uTime.value=ht;j.material.uniforms.uPulse.value=holePulse;j.quaternion.copy(camera.quaternion);}
    holeHud[0].rotation.z-=.0016*mScale;holeHud[1].rotation.z+=.0026*mScale;holeHud[2].rotation.z-=.004*mScale;
    const breathe=1+Math.sin(t*.0012)*.025*mScale;
    if(holeUniforms)holeUniforms.uGlow.value=obsGlowBase*breathe*(1+holePulse*.3);
    const target=obsZoom*(1+holeAttract*.07+holePulse*.09);
    hole.scale.setScalar(hole.scale.x+(target-hole.scale.x)*.15);
    if(shockT<1){shockT=Math.min(1,shockT+.03);const sc=.7+shockT*2.4;holeShock.scale.set(sc,sc,1);holeShock.material.opacity=(1-shockT)*.55;}
    else holeShock.material.opacity=0;
    /* 遥测 HUD：自旋/温度随脉冲与吸引实时跳动，约 8Hz 节流。 */
    if(t-lastTelem>120){lastTelem=t;
      const spin=$('bhSpin'),temp=$('bhTemp');
      const a=(0.998+holePulse*0.0015+holeAttract*0.0008);
      if(spin)spin.textContent='a* '+a.toFixed(4);
      if(temp)temp.textContent='T '+(1.2+holePulse*2.6+holeAttract*1.1).toFixed(1)+'×10⁷ K';
    }
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

  /* ---------- 观测台：常驻控制台，10 参数实时渲染 ---------- */
  const OBS_KEYS=['speed','incl','turb','beam','hue','glow','density','jet','time','zoom'];
  const OBS_DEFAULT={speed:1,incl:.3,turb:1,beam:.9,hue:0,glow:1,density:1,jet:1,time:1,zoom:1};
  const OBS_PRESETS={
    eht:{...OBS_DEFAULT},
    garg:{speed:.7,incl:.42,turb:1.3,beam:1.2,hue:.12,glow:1.4,density:.8,jet:1.2,time:.8},
    blue:{speed:1.4,incl:.3,turb:.8,beam:1.1,hue:.85,glow:1.1,density:.7,jet:1.4,time:1.2},
    quiet:{speed:.25,incl:.3,turb:.4,beam:.4,hue:0,glow:.4,density:.3,jet:.3,time:.4},
    edge:{speed:1.1,incl:.08,turb:1.1,beam:1.3,hue:.05,glow:.9,density:.9,jet:.8,time:1}
  };
  const OBS_IDS={speed:'obsSpeed',incl:'obsIncl',turb:'obsTurb',beam:'obsBeam',hue:'obsHue',glow:'obsGlow',density:'obsDensity',jet:'obsJet',time:'obsTime',zoom:'obsZoom'};
  const OBS_RANGE={speed:[0,3],incl:[.05,.8],turb:[0,2],beam:[0,1.6],hue:[0,1],glow:[0,2.5],density:[0,1],jet:[0,2],time:[0,3],zoom:[.55,1.7]};
  const OBS_STORE='ember-studio-obs-v1';
  let obsTimeScale=1,obsGlowBase=1,obsZoom=1;
  /* 观测参数记忆：重启后恢复上次的黑洞模样；非法值逐键回落默认。 */
  function obsLoad(){
    let raw=null;
    try{raw=JSON.parse(localStorage.getItem(OBS_STORE)||'null');}catch(e){}
    const v={...OBS_DEFAULT};
    if(raw&&typeof raw==='object'){
      for(const k of OBS_KEYS){
        const n=+raw[k];
        if(Number.isFinite(n))v[k]=Math.min(OBS_RANGE[k][1],Math.max(OBS_RANGE[k][0],n));
      }
    }
    return v;
  }
  function obsSave(v){try{localStorage.setItem(OBS_STORE,JSON.stringify(v));}catch(e){}}
  function obsApply(v){
    if(holeUniforms){
      holeUniforms.uDiskSpeed.value=v.speed;
      holeUniforms.uIncl.value=v.incl;
      holeUniforms.uTurb.value=v.turb;
      holeUniforms.uBeam.value=v.beam;
      holeUniforms.uHue.value=v.hue;
      holeUniforms.uGlow.value=v.glow;
      obsGlowBase=v.glow;
    }
    if(holeParticles)holeParticles.material.uniforms.uDensity.value=v.density;
    for(const j of holeJets)j.material.uniforms.uJet.value=v.jet;
    obsTimeScale=v.time;obsZoom=v.zoom;
    for(const k of OBS_KEYS){
      const el=$(OBS_IDS[k]);if(el)el.value=v[k];
      const out=$(OBS_IDS[k]+'V');if(out)out.textContent=(+v[k]).toFixed(2).replace(/0$/,'');
    }
    dirty=true;
  }
  function obsRead(){
    const v={};
    for(const k of OBS_KEYS){const el=$(OBS_IDS[k]);v[k]=el?+el.value:OBS_DEFAULT[k];}
    return v;
  }
  function bindObs(){
    for(const k of OBS_KEYS){
      const el=$(OBS_IDS[k]);if(el)el.addEventListener('input',()=>obsApply(obsRead()));
    }
    document.querySelectorAll('.bh-console-presets button').forEach(b=>{
      b.onclick=()=>{const p=OBS_PRESETS[b.dataset.preset];if(p)obsApply({...OBS_DEFAULT,...p});};
    });
    const rnd=$('obsRandom');if(rnd)rnd.onclick=()=>{
      const r=(a,b)=>+(a+Math.random()*(b-a)).toFixed(2);
      const v={speed:r(.2,2.4),incl:r(.08,.7),turb:r(.3,1.8),beam:r(.3,1.5),hue:r(0,1),glow:r(.3,2),density:r(.2,1),jet:r(0,1.8),time:r(.3,2)};
      obsApply(v);obsSave(v);
    };
    const rst=$('obsReset');if(rst)rst.onclick=()=>{obsApply({...OBS_DEFAULT});obsSave(OBS_DEFAULT);};
    const exp=$('obsExport');if(exp)exp.onclick=()=>{
      const v=obsRead();
      const blob=new Blob([JSON.stringify({preset:'custom',params:v},null,2)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='blackhole-preset.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),2000);
      env.notify('观测参数已导出为 JSON。');
    };
    /* 折叠：收起只留标题行，把画面让给黑洞；展开恢复调参。 */
    const panel=$('bhObs'),toggle=$('starObsBtn'),close=$('bhObsClose');
    const setCollapsed=c=>{if(panel)panel.classList.toggle('bh-collapsed',c);if(toggle)toggle.classList.toggle('active',!c);};
    if(toggle)toggle.onclick=()=>setCollapsed(!panel.classList.contains('bh-collapsed'));
    if(close)close.onclick=()=>setCollapsed(true);
    for(const k of OBS_KEYS){
      const el=$(OBS_IDS[k]);if(el)el.addEventListener('change',()=>obsSave(obsRead()));
    }
    document.querySelectorAll('.bh-console-presets button').forEach(b=>{
      const prev=b.onclick;
      b.onclick=()=>{prev();obsSave(obsRead());};
    });
    const start=obsLoad();
    obsApply(start);
    setCollapsed(false);
  }

  /* ---------- 绑定 ---------- */
  const motionBtn=$('starMotionBtn');if(motionBtn)motionBtn.onclick=requestMotionPermission;
  const listBtn=$('starListBtn');if(listBtn)listBtn.onclick=()=>{env.showList();};
  const holeClose=$('starHoleClose');if(holeClose)holeClose.onclick=closeHole;
  const holeBtn=$('starHoleBtn');if(holeBtn)holeBtn.onclick=openHole;
  bindObs();

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