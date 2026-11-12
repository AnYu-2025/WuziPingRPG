/* 天工 · 3D 建模（手机端）
 * 参照 Blender 的核心概念做了触屏化取舍：
 *   - 物体模式：点选物体，单指转视角、双指缩放/平移（OrbitControls）
 *   - 移动/旋转/缩放：TransformControls 拖轴（可吸附网格）+ 数字微调按钮
 *   - 编辑模式：顶点/面选择（面可多选），拖动、挤出、内插、删面、焊接
 *   - 修改器：镜像、阵列、细分（非破坏性，随时可关）
 *   - 导入 OBJ / GLB / STL 继续编辑；导出同三种格式
 *   - 线框、正交视图、一键落地、变换重置
 * 场景保存在工作区草稿里。渲染与解析完全离线（three.js 打包在本地）。
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import {OBJExporter} from 'three/examples/jsm/exporters/OBJExporter.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {STLExporter} from 'three/examples/jsm/exporters/STLExporter.js';
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js';
import {mergeGeometries,mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {SimplifyModifier} from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import {extrudeFaces,insetFaces,deleteFaces,weldVertices,extractGeometry,faceKey,uniqueEdges,separateComponents,flipNormals,mergeObjects,recenterOrigin,transformPoint} from './mesh-ops.js';

const MAX_OBJECTS=60,MAX_VERTS=24000,MAX_HISTORY=24;
/* 导入的 mesh 允许更大面数（只渲染不逐点编辑）；可编辑上限仍是 MAX_VERTS。 */
const MAX_MESH_VERTS=60000,IMPORT_TARGET_FACES=16000;
const typeName=t=>t==='mesh'?'导入模型':t==='light'?'灯光':(PRIMS[t]?PRIMS[t].name:t);
const PALETTE=['#4f8f7b','#c2703e','#5b7fc7','#b04a5a','#8a6fc0','#c7a24b','#657a86','#d8d2c4'];
const PRIMS={
  cube:{name:'立方体',glyph:'▢',make:()=>new THREE.BoxGeometry(1,1,1)},
  sphere:{name:'球体',glyph:'◯',make:()=>new THREE.SphereGeometry(.6,24,16)},
  cylinder:{name:'圆柱',glyph:'⬭',make:()=>new THREE.CylinderGeometry(.5,.5,1.2,24)},
  cone:{name:'圆锥',glyph:'△',make:()=>new THREE.ConeGeometry(.6,1.2,24)},
  torus:{name:'圆环',glyph:'◎',make:()=>new THREE.TorusGeometry(.5,.2,14,28)},
  plane:{name:'平面',glyph:'▭',make:()=>new THREE.PlaneGeometry(1.6,1.6,4,4)},
  ico:{name:'二十面体',glyph:'⬡',make:()=>new THREE.IcosahedronGeometry(.65,0)},
  capsule:{name:'胶囊',glyph:'⬮',make:()=>new THREE.CapsuleGeometry(.35,.6,6,16)}
};
const DEFAULT_SCENE=()=>({version:1,nextId:1,objects:[],camera:null});
const num=(v,fallback=0)=>Number.isFinite(+v)?+v:fallback;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

export function modelSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:DEFAULT_SCENE();
  const objects=[];
  for(const item of Array.isArray(r.objects)?r.objects.slice(0,MAX_OBJECTS):[]){
    if(!item||typeof item!=='object'||(!PRIMS[item.type]&&item.type!=='mesh'&&item.type!=='light'))continue;
    /* mesh（导入模型）必须自带顶点数据，否则丢弃。 */
    if(item.type==='mesh'&&(!Array.isArray(item.verts)||item.verts.length<9))continue;
    const id=Math.max(1,Math.floor(num(item.id,objects.length+1)));
    const pos=Array.isArray(item.pos)?item.pos.map(v=>clamp(num(v),-500,500)):null;
    const rot=Array.isArray(item.rot)?item.rot.map(v=>num(v)):null;
    const scl=Array.isArray(item.scl)?item.scl.map(v=>clamp(num(v,1),.02,50)):null;
    const vertLimit=item.type==='mesh'?MAX_MESH_VERTS:MAX_VERTS;
    const verts=Array.isArray(item.verts)&&item.verts.length>=9&&item.verts.length<=vertLimit*3&&item.verts.length%3===0&&item.verts.every(v=>Number.isFinite(+v))?item.verts.map(v=>+v):null;
    /* mesh 完全依赖顶点数据；无效（含超限）就整体丢弃，不能留一个空壳渲染成假立方体。 */
    if(item.type==='mesh'&&!verts)continue;
    const vertCount=verts?verts.length/3:0;
    const faces=verts&&Array.isArray(item.faces)&&item.faces.length>=3&&item.faces.length%3===0&&item.faces.length<=vertLimit*12&&item.faces.every(v=>Number.isInteger(v)&&v>=0&&v<vertCount)?item.faces.slice():null;
    objects.push({
      id,type:item.type,
      name:typeof item.name==='string'&&item.name.trim()?item.name.slice(0,30):typeName(item.type),
      pos:pos&&pos.length===3?pos:[0,.5,0],
      rot:rot&&rot.length===3?rot:[0,0,0],
      scl:scl&&scl.length===3?scl:[1,1,1],
      color:/^#[0-9a-fA-F]{6}$/.test(item.color)?item.color:PALETTE[objects.length%PALETTE.length],
      metal:clamp(num(item.metal,0),0,1),rough:clamp(num(item.rough,.65),0,1),
      flat:item.flat===true,
      visible:item.visible!==false,
      /* 灯光专属：类型（point/spot）、强度、颜色、距离、聚光角度 */
      lightKind:item.lightKind==='spot'?'spot':'point',
      lightIntensity:clamp(num(item.lightIntensity,1),0,10),
      lightColor:/^#[0-9a-fA-F]{6}$/.test(item.lightColor)?item.lightColor:'#ffffff',
      lightDistance:clamp(num(item.lightDistance,12),1,50),
      lightAngle:clamp(num(item.lightAngle,35),5,80),
      mods:{mirror:item.mods&&item.mods.mirror===true,array:clamp(Math.floor(num(item.mods&&item.mods.array,0)),0,6),subdiv:clamp(Math.floor(num(item.mods&&item.mods.subdiv,0)),0,2)},
      verts,faces
    });
  }
  const seen=new Set();
  for(const o of objects){while(seen.has(o.id))o.id++;seen.add(o.id);}
  /* 不用 Math.max(...arr)：对象多时展开会超出调用栈参数上限，循环取最大值。 */
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const o of objects)nextId=Math.max(nextId,o.id+1);
  const vec3=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(+x))?v.map(x=>clamp(+x,-1000,1000)):null;
  const camPos=r.camera&&typeof r.camera==='object'?vec3(r.camera.pos):null;
  const camTarget=r.camera&&typeof r.camera==='object'?vec3(r.camera.target):null;
  const cam=camPos&&camTarget?{pos:camPos,target:camTarget}:null;
  return {version:1,nextId,objects,camera:cam};
}

export function initModel(env){
  const $=id=>document.getElementById(id);
  let scene=null,renderer=null,camera=null,perspCamera=null,orthoCamera=null,orbit=null,gizmo=null,grid=null;
  let orthoHalfH=3,wireframe=false;
  let meshes=new Map(),selectedId=0,mode='object',editSel=null,editDrag=null;
  let active=false,dirty=false,raf=0,sheet='',history=[],redoStack=[],editOverlay=null,mirrorEdit=false;
  let editSub='vertex',editEdge=null;
  let raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let hintTimer=0,saveTimer=0;
  const host=()=>$('modelPanel');

  /* ---------- 场景与渲染 ---------- */
  function ensureRenderer(){
    if(renderer)return true;
    const canvas=$('modelCanvas');if(!canvas)return false;
    try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});}
    catch(e){env.notify('这台设备暂时开不了 3D 画布（WebGL 不可用）。');return false;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0x101820);
    scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x101820,30,80);
    perspCamera=new THREE.PerspectiveCamera(50,1,.05,200);
    orthoCamera=new THREE.OrthographicCamera(-3,3,3,-3,-100,200);
    camera=perspCamera;
    camera.position.set(3.2,2.6,4.2);
    const hemi=new THREE.HemisphereLight(0xdfeee9,0x2a343c,1.05);scene.add(hemi);
    const sun=new THREE.DirectionalLight(0xfff4e0,1.6);sun.position.set(4,7,3);scene.add(sun);
    const fill=new THREE.DirectionalLight(0x9fc4d8,.4);fill.position.set(-5,3,-4);scene.add(fill);
    grid=new THREE.GridHelper(20,20,0x2e4a44,0x1c2a30);grid.position.y=0;scene.add(grid);
    orbit=new OrbitControls(camera,canvas);
    orbit.enableDamping=true;orbit.dampingFactor=.08;
    orbit.minDistance=.8;orbit.maxDistance=40;orbit.maxPolarAngle=Math.PI*.96;
    orbit.target.set(0,.5,0);
    orbit.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
    gizmo=new TransformControls(camera,canvas);
    gizmo.setSize(.85);
    gizmo.addEventListener('dragging-changed',e=>{orbit.enabled=!e.value;if(e.value)pushHistory();else{applyTransformToData();syncProps();}});
    gizmo.addEventListener('objectChange',()=>{applyTransformToData();dirty=true;});
    scene.add(gizmo.getHelper());
    editOverlay=new THREE.Group();scene.add(editOverlay);
    canvas.addEventListener('pointerdown',onPointerDown);
    canvas.addEventListener('pointermove',onPointerMove);
    canvas.addEventListener('pointerup',onPointerUp);
    canvas.addEventListener('pointercancel',onPointerUp);
    window.addEventListener('resize',resize);
    resize();
    return true;
  }
  function resize(){
    const stage=document.querySelector('.model-stage');
    if(!stage||!renderer)return;
    const w=Math.max(1,stage.clientWidth),h=Math.max(1,stage.clientHeight);
    renderer.setSize(w,h,false);
    perspCamera.aspect=w/h;perspCamera.updateProjectionMatrix();
    const aspect=w/h;
    orthoCamera.left=-orthoHalfH*aspect;orthoCamera.right=orthoHalfH*aspect;
    orthoCamera.top=orthoHalfH;orthoCamera.bottom=-orthoHalfH;
    orthoCamera.updateProjectionMatrix();
    dirty=true;
  }
  /* 透视 ↔ 正交：正交适合对齐和看比例，透视适合看整体。 */
  function toggleProjection(){
    const toOrtho=camera===perspCamera;
    const next=toOrtho?orthoCamera:perspCamera;
    next.position.copy(camera.position);
    next.quaternion.copy(camera.quaternion);
    if(toOrtho){
      const dist=camera.position.distanceTo(orbit.target)||5;
      orthoHalfH=Math.tan(THREE.MathUtils.degToRad(perspCamera.fov/2))*dist;
      const stage=document.querySelector('.model-stage');
      const aspect=stage?Math.max(1,stage.clientWidth)/Math.max(1,stage.clientHeight):1;
      orthoCamera.left=-orthoHalfH*aspect;orthoCamera.right=orthoHalfH*aspect;
      orthoCamera.top=orthoHalfH;orthoCamera.bottom=-orthoHalfH;
      orthoCamera.updateProjectionMatrix();
    }
    camera=next;
    orbit.object=camera;
    gizmo.camera=camera;
    orbit.update();
    const btn=$('modelProjBtn');if(btn){btn.textContent=toOrtho?'正交':'透视';btn.classList.toggle('active',toOrtho);}
    invalidate();
  }
  function toggleWireframe(){
    wireframe=!wireframe;
    for(const [,g] of meshes)g.traverse(c=>{if(c.isMesh&&c.material)c.material.wireframe=wireframe;});
    const btn=$('modelWireBtn');if(btn)btn.classList.toggle('active',wireframe);
    invalidate();
  }
  function toggleSnap(){
    if(!gizmo)return;
    const on=gizmo.translationSnap===null;
    gizmo.translationSnap=on?.25:null;
    gizmo.rotationSnap=on?THREE.MathUtils.degToRad(15):null;
    gizmo.scaleSnap=on?.1:null;
    const btn=$('modelSnapBtn');if(btn)btn.classList.toggle('active',on);
    env.notify(on?'已开吸附：移动按 0.25 格、旋转按 15°、缩放按 0.1。':'已关吸附，自由拖动。');
  }
  /* 聚焦选中：把相机和轨道目标移到物体中心，距离按包围盒大小自适应。 */
  function focusSelected(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体，再聚焦。');return;}
    const g=meshOf(o.id);if(!g)return;
    const box=new THREE.Box3().setFromObject(g);
    if(box.isEmpty()){env.notify('这个物体没有可见几何。');return;}
    const center=box.getCenter(new THREE.Vector3());
    const size=box.getSize(new THREE.Vector3());
    const radius=Math.max(size.x,size.y,size.z,0.2)/2;
    /* 保持当前观察方向，只改距离与目标。 */
    const dir=camera.position.clone().sub(orbit.target);
    if(dir.lengthSq()<1e-6)dir.set(1,.8,1);
    dir.normalize();
    const dist=radius/Math.tan(THREE.MathUtils.degToRad(perspCamera.fov/2))*1.5+radius;
    orbit.target.copy(center);
    camera.position.copy(center).addScaledVector(dir,dist);
    if(camera.isOrthographicCamera){
      orthoHalfH=radius*1.6;
      const stage=document.querySelector('.model-stage');
      const aspect=stage?Math.max(1,stage.clientWidth)/Math.max(1,stage.clientHeight):1;
      camera.left=-orthoHalfH*aspect;camera.right=orthoHalfH*aspect;
      camera.top=orthoHalfH;camera.bottom=-orthoHalfH;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(center);
    orbit.update();
    invalidate();
  }
  /* 一键落地：把选中物体底面贴到网格平面（y=0）。 */
  function dropToFloor(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体。');return;}
    const g=meshOf(o.id);if(!g)return;
    const box=new THREE.Box3().setFromObject(g);
    const dy=-box.min.y;
    if(Math.abs(dy)<1e-4){env.notify('已经贴地了。');return;}
    pushHistory();historyPending=false;
    g.position.y+=dy;
    applyTransformToData();syncProps();invalidate();
    env.notify('已落到网格平面上。');
  }
  function resetTransform(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体。');return;}
    pushHistory();historyPending=false;
    mutate(next=>{
      const t=next.objects.find(x=>x.id===o.id);
      t.rot=[0,0,0];t.scl=[1,1,1];
    },{history:false});
    const g=meshOf(o.id);
    if(g){g.rotation.set(0,0,0);g.scale.set(1,1,1);}
    syncProps();invalidate();
    env.notify('旋转和缩放已重置。');
  }
  function loop(){
    if(!active)return;
    raf=requestAnimationFrame(loop);
    orbit.update();
    if(dirty){renderer.render(scene,camera);dirty=false;}
  }
  function invalidate(){dirty=true;}

  /* ---------- 物体构建 ---------- */
  function buildGeometry(o){
    let geo;
    if(o.verts){
      geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(o.verts,3));
      geo.setIndex(defaultIndexFor(o));
      geo.computeVertexNormals();
    }else if(PRIMS[o.type]){
      geo=PRIMS[o.type].make();
    }else{
      /* mesh 没有顶点数据属于异常，兜底一个立方体避免整页崩溃。 */
      geo=PRIMS.cube.make();
    }
    return geo;
  }
  /* 自定义顶点只保存位置；索引优先用保存的面表，其次按基础体默认拓扑重建。 */
  function defaultIndexFor(o){
    if(o.faces&&Array.isArray(o.faces))return o.faces;
    if(!PRIMS[o.type])return null;
    const base=PRIMS[o.type].make();
    const idx=base.getIndex();
    const count=o.verts.length/3;
    base.dispose();
    if(idx&&idx.array.length){
      let maxIdx=0;
      for(let i=0;i<idx.array.length;i++)if(idx.array[i]>maxIdx)maxIdx=idx.array[i];
      if(maxIdx<count)return Array.from(idx.array);
    }
    return null;
  }
  function materialFor(o){
    return new THREE.MeshStandardMaterial({
      color:new THREE.Color(o.color),metalness:o.metal,roughness:o.rough,
      flatShading:o.flat||(o.type==='ico'&&!o.verts),
      /* 双面：删面/开壳模型从内侧也能看见，不会"消失"。 */
      side:THREE.DoubleSide
    });
  }
  function rebuildMesh(o){
    const old=meshes.get(o.id);
    if(old){disposeMesh(old);scene.remove(old);meshes.delete(o.id);}
    const group=new THREE.Group();
    group.userData.modelId=o.id;
    if(o.type==='light'){
      /* 灯光：一个小发光手柄（可点选、可见）+ 真实光源。手柄不参与导出。 */
      const handle=new THREE.Mesh(
        new THREE.SphereGeometry(.13,16,12),
        new THREE.MeshBasicMaterial({color:new THREE.Color(o.lightColor),depthTest:false,transparent:true,opacity:.95})
      );
      handle.renderOrder=12;handle.userData.modelId=o.id;handle.userData.isHandle=true;
      group.add(handle);
      const ring=new THREE.Mesh(
        new THREE.SphereGeometry(.19,16,12),
        new THREE.MeshBasicMaterial({color:new THREE.Color(o.lightColor),wireframe:true,depthTest:false,transparent:true,opacity:.5})
      );
      ring.renderOrder=12;ring.userData.modelId=o.id;ring.userData.isHandle=true;
      group.add(ring);
      const light=o.lightKind==='spot'
        ? new THREE.SpotLight(new THREE.Color(o.lightColor),o.lightIntensity*4,o.lightDistance,THREE.MathUtils.degToRad(o.lightAngle),.35,1.4)
        : new THREE.PointLight(new THREE.Color(o.lightColor),o.lightIntensity*4,o.lightDistance,1.6);
      light.userData.isLight=true;
      /* 聚光要有照射目标：挂在手柄下方一点。 */
      const target=new THREE.Object3D();target.position.set(0,-2,0);target.userData.isLight=true;
      group.add(light);group.add(target);
      if(o.lightKind==='spot')light.target=target;
      group.position.fromArray(o.pos);
      group.rotation.set(o.rot[0],o.rot[1],o.rot[2]);
      group.visible=o.visible;
      scene.add(group);
      meshes.set(o.id,group);
      return group;
    }
    const geo=buildGeometry(o);
    const mat=materialFor(o);
    const base=new THREE.Mesh(geo,mat);
    base.userData.modelId=o.id;
    group.add(base);
    /* 修改器：镜像 / 阵列 / 细分，全部用克隆体实现，关掉即消失，不动原始数据。 */
    if(o.mods.mirror){
      const m=new THREE.Mesh(geo,mat);m.scale.x=-1;m.userData.modelId=o.id;group.add(m);
    }
    for(let i=1;i<=o.mods.array;i++){
      const m=new THREE.Mesh(geo,mat);m.position.x=i*1.3;m.userData.modelId=o.id;group.add(m);
    }
    if(o.mods.subdiv>0){
      base.geometry=smoothGeometry(geo,o.mods.subdiv);
      group.children.forEach((c,i)=>{if(i>0)c.geometry=base.geometry;});
    }
    group.position.fromArray(o.pos);
    group.rotation.set(o.rot[0],o.rot[1],o.rot[2]);
    group.scale.fromArray(o.scl);
    group.visible=o.visible;
    if(wireframe)group.traverse(c=>{if(c.isMesh&&c.material)c.material.wireframe=true;});
    scene.add(group);
    meshes.set(o.id,group);
    return group;
  }
  function smoothGeometry(geo,levels){
    /* 轻量细分：Loop 太贵，手机上用「取面心拉开」的近似细分，两级封顶。 */
    let current=geo;
    for(let l=0;l<levels;l++){
      const pos=current.getAttribute('position');
      const idx=current.getIndex();
      const verts=[];const faces=[];
      const midCache=new Map();
      const getMid=(a,b)=>{
        const key=Math.min(a,b)+'_'+Math.max(a,b);
        if(midCache.has(key))return midCache.get(key);
        const i=verts.length/3;
        verts.push((pos.getX(a)+pos.getX(b))/2,(pos.getY(a)+pos.getY(b))/2,(pos.getZ(a)+pos.getZ(b))/2);
        midCache.set(key,i);return i;
      };
      for(let i=0;i<pos.count;i++)verts.push(pos.getX(i),pos.getY(i),pos.getZ(i));
      const triCount=idx?idx.count/3:pos.count/3;
      for(let t=0;t<triCount;t++){
        const a=idx?idx.getX(t*3):t*3,b=idx?idx.getX(t*3+1):t*3+1,c=idx?idx.getX(t*3+2):t*3+2;
        const ab=getMid(a,b),bc=getMid(b,c),ca=getMid(c,a);
        faces.push(a,ab,ca,ab,b,bc,ca,bc,c,ab,bc,ca);
      }
      const next=new THREE.BufferGeometry();
      next.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
      next.setIndex(faces);next.computeVertexNormals();
      if(current!==geo)current.dispose();
      current=next;
      if(current.getAttribute('position').count>MAX_VERTS)break;
    }
    return current;
  }
  function disposeMesh(group){
    const geos=new Set();
    group.traverse(c=>{if(c.isMesh){geos.add(c.geometry);if(c.material)c.material.dispose();}});
    geos.forEach(g=>g.dispose());
  }
  function rebuildAll(){
    for(const [,g] of meshes){disposeMesh(g);scene.remove(g);}
    meshes.clear();
    const data=env.getState();
    for(const o of data.objects)rebuildMesh(o);
    refreshSelection();refreshSceneList();updateEmpty();invalidate();
  }
  function findData(id){return env.getState().objects.find(o=>o.id===id)||null;}
  function meshOf(id){return meshes.get(id)||null;}

  /* ---------- 选择 ---------- */
  function pickAt(clientX,clientY){
    const canvas=$('modelCanvas'),rect=canvas.getBoundingClientRect();
    pointer.set(((clientX-rect.left)/rect.width)*2-1,-((clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(pointer,camera);
    const targets=[];
    for(const [,g] of meshes)if(g.visible)g.traverse(c=>{if(c.isMesh)targets.push(c);});
    const hits=raycaster.intersectObjects(targets,false);
    if(!hits.length)return null;
    return hits[0];
  }
  function select(id,{silent=false}={}){
    selectedId=id;editSel=null;editFaces=[];editEdge=null;
    /* 灯光没有网格：若正处编辑模式，自动退回物体模式。 */
    if(mode==='edit'&&id){const cur=findData(id);if(cur&&cur.type==='light'){mode='object';const sub=$('modelSubRow');if(sub)sub.hidden=true;const et=$('modelEditTools');if(et)et.hidden=true;}}
    refreshSelection();refreshSceneList();syncProps();
    if(!silent)invalidate();
  }
  function refreshSelection(){
    for(const [id,g] of meshes){
      g.traverse(c=>{
        if(c.isMesh&&c.material){
          c.material.emissive=c.material.emissive||new THREE.Color();
          c.material.emissive.setHex(id===selectedId?0x0d3a33:0x000000);
        }
      });
    }
    const o=findData(selectedId);
    const chip=$('modelSelChip');
    if(chip)chip.textContent=o?(o.name+' · '+typeName(o.type)+(mode==='edit'?' · 编辑中':'')):'点一个物体选中，空白处拖动转视角';
    if(gizmo){
      if(o&&mode!=='object'&&mode!=='edit'){
        const g=meshOf(o.id);
        if(g){gizmo.attach(g);gizmo.setMode(mode==='move'?'translate':mode==='rotate'?'rotate':'scale');gizmo.visible=true;}
      }else{gizmo.detach();gizmo.visible=false;}
    }
    if(mode==='edit'&&o)buildEditOverlay(o);else clearEditOverlay();
    for(const b of document.querySelectorAll('.model-modes button'))b.classList.toggle('active',b.dataset.mode===mode);
    const del=$('modelDeleteBtn');if(del)del.disabled=!o;
    const dup=$('modelDupBtn');if(dup)dup.disabled=!o;
    invalidate();
  }

  /* ---------- 编辑模式（顶点/面） ---------- */
  function clearEditOverlay(){
    if(!editOverlay)return;
    while(editOverlay.children.length){
      const c=editOverlay.children.pop();
      if(c.geometry)c.geometry.dispose();
      if(c.material)c.material.dispose();
    }
  }
  /* 编辑选择：顶点单选 + 面多选。faces 存三角形顶点索引。 */
  let editFaces=[];
  function selectedFaceKeys(){return new Set(editFaces.map(f=>faceKey(f.a,f.b,f.c)));}
  function buildEditOverlay(o){
    clearEditOverlay();
    const g=meshOf(o.id);if(!g)return;
    const base=g.children[0];
    const pos=base.geometry.getAttribute('position');
    if(!pos||pos.count>MAX_VERTS)return;
    const pts=new Float32Array(pos.count*3);
    for(let i=0;i<pos.count;i++){pts[i*3]=pos.getX(i);pts[i*3+1]=pos.getY(i);pts[i*3+2]=pos.getZ(i);}
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pts,3));
    const mat=new THREE.PointsMaterial({color:0x7fe0c3,size:.055,sizeAttenuation:true,depthTest:false,transparent:true,opacity:editSub==='face'?.3:.95});
    const points=new THREE.Points(geo,mat);
    points.renderOrder=10;
    points.position.copy(g.position);points.rotation.copy(g.rotation);points.scale.copy(g.scale);
    editOverlay.add(points);
    /* 选中边用橙色线段高亮。 */
    if(editEdge&&editSub==='edge'&&editEdge.a<pos.count&&editEdge.b<pos.count){
      const eg=new THREE.BufferGeometry();
      eg.setAttribute('position',new THREE.Float32BufferAttribute([
        pos.getX(editEdge.a),pos.getY(editEdge.a),pos.getZ(editEdge.a),
        pos.getX(editEdge.b),pos.getY(editEdge.b),pos.getZ(editEdge.b)
      ],3));
      const line=new THREE.Line(eg,new THREE.LineBasicMaterial({color:0xffb454,depthTest:false,transparent:true,opacity:.95}));
      line.renderOrder=11;
      line.position.copy(g.position);line.rotation.copy(g.rotation);line.scale.copy(g.scale);
      editOverlay.add(line);
    }
    /* 选中面用半透明橙色面片高亮，比只标顶点直观。 */
    if(editFaces.length){
      const fv=[];
      for(const f of editFaces){
        for(const i of [f.a,f.b,f.c]){
          if(i<pos.count)fv.push(pos.getX(i),pos.getY(i),pos.getZ(i));
        }
      }
      if(fv.length){
        const fg=new THREE.BufferGeometry();
        fg.setAttribute('position',new THREE.Float32BufferAttribute(fv,3));
        fg.computeVertexNormals();
        const fm=new THREE.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:.4,side:THREE.DoubleSide,depthTest:false});
        const faceMesh=new THREE.Mesh(fg,fm);
        faceMesh.renderOrder=9;
        faceMesh.position.copy(g.position);faceMesh.rotation.copy(g.rotation);faceMesh.scale.copy(g.scale);
        editOverlay.add(faceMesh);
      }
    }
  }
  function editInfoText(){
    const label=$('modelEditInfo');if(!label)return;
    if(editSub==='edge'){
      label.textContent=editEdge?'已选中一条边，直接拖动两端':'点边选中，再点取消；拖动移动整条边';
      return;
    }
    if(editSel&&editSel.vertex>=0)label.textContent='已选中顶点 #'+editSel.vertex+'，直接拖动';
    else if(editFaces.length)label.textContent='已选 '+editFaces.length+' 个面：可拖动、挤出、内插、删除';
    else label.textContent=editSub==='face'?'点面选中（可多选）；再点已选面取消':'点顶点选中，直接拖动';
  }
  function pickVertex(hit,o){
    const g=meshOf(o.id);if(!g)return -1;
    const base=g.children[0];
    const pos=base.geometry.getAttribute('position');
    if(!pos)return -1;
    const local=g.worldToLocal(hit.point.clone());
    let best=-1,bestD=Infinity;
    for(let i=0;i<pos.count;i++){
      const dx=pos.getX(i)-local.x,dy=pos.getY(i)-local.y,dz=pos.getZ(i)-local.z;
      const d=dx*dx+dy*dy+dz*dz;
      if(d<bestD){bestD=d;best=i;}
    }
    const tolerance=Math.max(.09,.09*g.scale.length()/1.7);
    return bestD<tolerance*tolerance?best:-1;
  }
  function pickFace(hit){
    return hit.face?{a:hit.face.a,b:hit.face.b,c:hit.face.c,normal:hit.face.normal.clone()}:null;
  }
  /* 边拾取：在命中面的三条边里找离命中点最近的；顶点优先（避免角上误选边）。 */
  function pickEdge(hit,o){
    const g=meshOf(o.id);if(!g||!hit.face)return null;
    const base=g.children[0];
    const pos=base.geometry.getAttribute('position');
    if(!pos)return null;
    const local=g.worldToLocal(hit.point.clone());
    const va=new THREE.Vector3(),vb=new THREE.Vector3(),p=new THREE.Vector3();
    let best=null,bestD=Infinity;
    const tri=[hit.face.a,hit.face.b,hit.face.c];
    for(let j=0;j<3;j++){
      const a=tri[j],b=tri[(j+1)%3];
      if(a>=pos.count||b>=pos.count)continue;
      va.fromBufferAttribute(pos,a);vb.fromBufferAttribute(pos,b);
      const ab=vb.clone().sub(va);
      const t=clamp(local.clone().sub(va).dot(ab)/(ab.lengthSq()||1),0,1);
      p.copy(va).addScaledVector(ab,t);
      const d=p.distanceTo(local);
      if(d<bestD){bestD=d;best={a:Math.min(a,b),b:Math.max(a,b)};}
    }
    const tolerance=Math.max(.07,.07*g.scale.length()/1.7);
    return best&&bestD<tolerance?best:null;
  }

  /* ---------- 指针交互 ---------- */
  let downInfo=null;
  function onPointerDown(e){
    fadeHint();
    if(gizmo&&gizmo.dragging)return;
    downInfo={x:e.clientX,y:e.clientY,t:Date.now(),moved:false};
    if(mode==='edit'&&selectedId){
      const o=findData(selectedId);
      const hit=pickAt(e.clientX,e.clientY);
      if(o&&hit&&hit.object.userData.modelId===selectedId){
        const vi=pickVertex(hit,o);
        const face=pickFace(hit);
        let dragKind=null;
        if(editSub==='vertex'&&vi>=0)dragKind='vertex';
        else if(editSub==='edge'){
          const edge=pickEdge(hit,o);
          if(edge&&editEdge&&edge.a===editEdge.a&&edge.b===editEdge.b)dragKind='edge';
        }else if(editSub==='face'&&face&&selectedFaceKeys().has(faceKey(face.a,face.b,face.c)))dragKind='face';
        if(dragKind){
          editSel=dragKind==='vertex'?{vertex:vi,face}:null;
          const plane=new THREE.Plane();
          const normal=new THREE.Vector3();camera.getWorldDirection(normal);
          plane.setFromNormalAndCoplanarPoint(normal,hit.point);
          editDrag={plane,start:hit.point.clone(),vi:dragKind==='vertex'?vi:-1,kind:dragKind,moved:false};
          orbit.enabled=false;
          $('modelCanvas').setPointerCapture(e.pointerId);
          highlightEdit(o);
          e.preventDefault();
          return;
        }
      }
    }
  }
  function onPointerMove(e){
    if(downInfo&&Math.hypot(e.clientX-downInfo.x,e.clientY-downInfo.y)>8)downInfo.moved=true;
    if(!editDrag||mode!=='edit')return;
    const o=findData(selectedId);if(!o)return;
    const canvas=$('modelCanvas'),rect=canvas.getBoundingClientRect();
    pointer.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(pointer,camera);
    const point=new THREE.Vector3();
    if(!raycaster.ray.intersectPlane(editDrag.plane,point))return;
    const g=meshOf(o.id);if(!g)return;
    const local=g.worldToLocal(point.clone());
    const startLocal=g.worldToLocal(editDrag.start.clone());
    const delta=local.sub(startLocal);
    if(delta.length()<1e-5)return;
    editDrag.moved=true;
    pushHistoryOnce();
    const base=g.children[0];
    const pos=base.geometry.getAttribute('position');
    const indices=editDrag.kind==='vertex'?[editDrag.vi]:editDrag.kind==='edge'&&editEdge?[editEdge.a,editEdge.b]:editFaces.flatMap(f=>[f.a,f.b,f.c]);
    const unique=[...new Set(indices)];
    /* 镜像编辑：拖点/边时，X 对称位置的顶点反向跟着动。 */
    const mirrorPairs=[];
    if(mirrorEdit&&(editDrag.kind==='vertex'||editDrag.kind==='edge')){
      for(const src of unique){
        const sx=-pos.getX(src),sy=pos.getY(src),sz=pos.getZ(src);
        for(let i=0;i<pos.count;i++){
          if(unique.includes(i))continue;
          const dx=pos.getX(i)-sx,dy=pos.getY(i)-sy,dz=pos.getZ(i)-sz;
          if(dx*dx+dy*dy+dz*dz<1e-6&&!mirrorPairs.includes(i))mirrorPairs.push(i);
        }
      }
    }
    for(const i of unique){
      pos.setXYZ(i,pos.getX(i)+delta.x,pos.getY(i)+delta.y,pos.getZ(i)+delta.z);
    }
    for(const i of mirrorPairs){
      pos.setXYZ(i,pos.getX(i)-delta.x,pos.getY(i)+delta.y,pos.getZ(i)+delta.z);
    }
    pos.needsUpdate=true;
    base.geometry.computeVertexNormals();
    syncGroupClones(o);
    editDrag.start=point.clone();
    buildEditOverlay(o);
    storeVerts(o,base.geometry);
    invalidate();
  }
  function onPointerUp(e){
    if(editDrag){
      const moved=editDrag.moved;
      editDrag=null;orbit.enabled=true;
      /* 一次拖动只记一条撤销历史；松手后重置，下一次拖动重新记录。 */
      historyPending=false;
      if(moved){commitSoon();downInfo=null;return;}
    }
    if(!downInfo)return;
    const wasTap=!downInfo.moved&&Date.now()-downInfo.t<600;
    downInfo=null;
    if(!wasTap||gizmo&&gizmo.dragging)return;
    if(gizmo&&gizmo.axis)return;
    const hit=pickAt(e.clientX,e.clientY);
    if(hit){
      const id=hit.object.userData.modelId;
      if(mode==='edit'){
        if(id===selectedId){
          const o=findData(id);
          if(editSub==='edge'){
            const edge=pickEdge(hit,o);
            editEdge=edge&&editEdge&&edge.a===editEdge.a&&edge.b===editEdge.b?null:edge;
            editSel=null;
          }else if(editSub==='face'){
            const face=pickFace(hit);
            if(face){
              /* 面多选：再点已选面取消，点新面加入。 */
              const key=faceKey(face.a,face.b,face.c);
              const at=editFaces.findIndex(f=>faceKey(f.a,f.b,f.c)===key);
              if(at>=0)editFaces.splice(at,1);else editFaces.push(face);
              editSel={vertex:-1,face};
            }else editSel=null;
          }else{
            const vi=pickVertex(hit,o);
            editSel=vi>=0?{vertex:vi,face:pickFace(hit)}:null;
          }
          highlightEdit(o);
          editInfoText();
          invalidate();
        }else select(id);
      }else select(id);
    }else if(mode!=='edit')select(0);
  }
  function highlightEdit(o){
    /* 整体点云青色 + 选中面橙色面片（buildEditOverlay 内）+ 选中顶点亮橙点。 */
    buildEditOverlay(o);
    if(!editSel||editSel.vertex<0||!editOverlay.children.length)return;
    const g=meshOf(o.id);const base=g.children[0];
    const pos=base.geometry.getAttribute('position');
    const i=editSel.vertex;
    if(i>=pos.count)return;
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute([pos.getX(i),pos.getY(i),pos.getZ(i)],3));
    const mat=new THREE.PointsMaterial({color:0xffb454,size:.085,sizeAttenuation:true,depthTest:false});
    const p=new THREE.Points(geo,mat);p.renderOrder=11;
    p.position.copy(g.position);p.rotation.copy(g.rotation);p.scale.copy(g.scale);
    editOverlay.add(p);
  }
  function syncGroupClones(o){
    const g=meshOf(o.id);if(!g)return;
    const base=g.children[0];
    for(let i=1;i<g.children.length;i++)g.children[i].geometry=base.geometry;
  }
  function storeVerts(o,geometry){
    const pos=geometry.getAttribute('position');
    if(pos.count>MAX_VERTS)return;
    const arr=new Array(pos.count*3);
    for(let i=0;i<pos.count;i++){arr[i*3]=pos.getX(i);arr[i*3+1]=pos.getY(i);arr[i*3+2]=pos.getZ(i);}
    o.verts=arr;
    const idx=geometry.getIndex();
    if(idx)o.faces=Array.from(idx.array);else o.faces=null;
  }

  /* ---------- 历史（撤销） ---------- */
  let historyPending=false;
  function pushHistoryOnce(){
    if(historyPending)return;
    historyPending=true;
    pushHistory();
  }
  function pushHistory(){
    history.push(JSON.stringify(env.getState().objects));
    if(history.length>MAX_HISTORY)history.shift();
    /* 新的改动会让重做链失效。 */
    redoStack.length=0;
    syncHistoryButtons();
  }
  function syncHistoryButtons(){
    const u=$('modelUndoBtn');if(u)u.disabled=!history.length;
    const r=$('modelRedoBtn');if(r)r.disabled=!redoStack.length;
  }
  function restoreObjects(objects){
    const data=env.getState();
    env.setState({...data,objects});
    historyPending=false;
    rebuildAll();
    if(!findData(selectedId))selectedId=0;
    refreshSelection();syncProps();commitSoon();
    syncHistoryButtons();
  }
  function undo(){
    if(!history.length){env.notify('没有可撤销的操作了。');return;}
    redoStack.push(JSON.stringify(env.getState().objects));
    if(redoStack.length>MAX_HISTORY)redoStack.shift();
    restoreObjects(JSON.parse(history.pop()));
  }
  function redo(){
    if(!redoStack.length){env.notify('没有可重做的操作了。');return;}
    history.push(JSON.stringify(env.getState().objects));
    if(history.length>MAX_HISTORY)history.shift();
    restoreObjects(JSON.parse(redoStack.pop()));
  }

  /* ---------- 数据操作 ---------- */
  function mutate(fn,{history:record=true}={}){
    if(record)pushHistory();
    historyPending=false;
    const data=env.getState();
    const next={...data,objects:data.objects.map(o=>({...o,pos:[...o.pos],rot:[...o.rot],scl:[...o.scl],mods:{...o.mods},verts:o.verts?[...o.verts]:null,faces:o.faces?[...o.faces]:null}))};
    fn(next);
    env.setState(next);
    commitSoon();
  }
  /* 场景预设：一组摆好位置的基础体，落地即可继续编辑。 */
  const PRESETS={
    table:{name:'桌子',parts:[
      {type:'cube',pos:[0,.78,0],scl:[1.7,.08,1],color:'#8a6fc0'},
      {type:'cube',pos:[-.75,.37,-.4],scl:[.09,.74,.09],color:'#6b5a9e'},
      {type:'cube',pos:[.75,.37,-.4],scl:[.09,.74,.09],color:'#6b5a9e'},
      {type:'cube',pos:[-.75,.37,.4],scl:[.09,.74,.09],color:'#6b5a9e'},
      {type:'cube',pos:[.75,.37,.4],scl:[.09,.74,.09],color:'#6b5a9e'}
    ]},
    chair:{name:'椅子',parts:[
      {type:'cube',pos:[0,.45,0],scl:[.55,.06,.5],color:'#c2703e'},
      {type:'cube',pos:[0,.78,-.23],scl:[.55,.62,.06],color:'#c2703e'},
      {type:'cube',pos:[-.23,.21,-.2],scl:[.06,.42,.06],color:'#9e5a30'},
      {type:'cube',pos:[.23,.21,-.2],scl:[.06,.42,.06],color:'#9e5a30'},
      {type:'cube',pos:[-.23,.21,.2],scl:[.06,.42,.06],color:'#9e5a30'},
      {type:'cube',pos:[.23,.21,.2],scl:[.06,.42,.06],color:'#9e5a30'}
    ]},
    cup:{name:'杯子',parts:[
      {type:'cylinder',pos:[0,.5,0],scl:[.62,1,.62],color:'#5b7fc7'},
      {type:'torus',pos:[.42,.5,0],rot:[0,0,0],scl:[.42,.42,.42],color:'#5b7fc7'}
    ]},
    snowman:{name:'雪人',parts:[
      {type:'sphere',pos:[0,.55,0],scl:[1.1,1.1,1.1],color:'#d8d2c4'},
      {type:'sphere',pos:[0,1.35,0],scl:[.78,.78,.78],color:'#e4dfd4'},
      {type:'sphere',pos:[0,1.95,0],scl:[.5,.5,.5],color:'#efeae0'},
      {type:'cone',pos:[0,1.95,.28],rot:[Math.PI/2,0,0],scl:[.12,.3,.12],color:'#c2703e'}
    ]},
    rocket:{name:'火箭',parts:[
      {type:'cylinder',pos:[0,.9,0],scl:[.5,1.5,.5],color:'#d8d2c4'},
      {type:'cone',pos:[0,1.95,0],scl:[.5,.7,.5],color:'#b04a5a'},
      {type:'cube',pos:[-.3,.25,0],rot:[0,0,.35],scl:[.08,.5,.3],color:'#b04a5a'},
      {type:'cube',pos:[.3,.25,0],rot:[0,0,-.35],scl:[.08,.5,.3],color:'#b04a5a'},
      {type:'sphere',pos:[0,1.15,.26],scl:[.22,.22,.1],color:'#5b7fc7'}
    ]}
  };
  function addPreset(key){
    const preset=PRESETS[key];if(!preset)return;
    const data=env.getState();
    if(data.objects.length+preset.parts.length>MAX_OBJECTS){env.notify('场景放不下整个'+preset.name+'，先删掉一些物体。');return;}
    pushHistory();historyPending=false;
    const objects=[...data.objects];
    let nextId=data.nextId;
    preset.parts.forEach((p,i)=>{
      objects.push({
        id:nextId++,type:p.type,
        name:preset.name+(i===0?'':' '+(i+1)),
        pos:[...p.pos],rot:p.rot?[...p.rot]:[0,0,0],scl:[...p.scl],
        color:p.color,metal:0,rough:.65,visible:true,
        mods:{mirror:false,array:0,subdiv:0},verts:null,faces:null
      });
    });
    env.setState({...data,nextId,objects});
    for(const o of objects.slice(data.objects.length))rebuildMesh(o);
    select(objects[data.objects.length].id);
    closeSheet();commitSoon();updateEmpty();
    env.notify('已添加'+preset.name+'，每个部件都能单独编辑。');
  }
  function addObject(type){
    const data=env.getState();
    if(data.objects.length>=MAX_OBJECTS){env.notify('场景最多 '+MAX_OBJECTS+' 个物体，先删掉一些。');return;}
    pushHistory();historyPending=false;
    const id=data.nextId;
    const count=data.objects.filter(o=>o.type===type).length;
    if(type==='light'){
      const o={id,type:'light',name:'灯光'+(count?' '+(count+1):''),pos:[0,2.2,0],rot:[0,0,0],scl:[1,1,1],color:'#ffffff',metal:0,rough:.65,flat:false,visible:true,mods:{mirror:false,array:0,subdiv:0},verts:null,faces:null,lightKind:'point',lightIntensity:1,lightColor:'#fff2d8',lightDistance:12,lightAngle:35};
      env.setState({...data,nextId:id+1,objects:[...data.objects,o]});
      rebuildMesh(o);select(id);closeSheet();commitSoon();updateEmpty();
      env.notify('已加点光源，拖到物体旁边照亮它；属性里可换聚光灯、调强度颜色。');
      return;
    }
    const o={id,type,name:PRIMS[type].name+(count?' '+(count+1):''),pos:[0,type==='plane'?0:.5,0],rot:[0,0,0],scl:[1,1,1],color:PALETTE[data.objects.length%PALETTE.length],metal:0,rough:.65,flat:false,visible:true,mods:{mirror:false,array:0,subdiv:0},verts:null};
    env.setState({...data,nextId:id+1,objects:[...data.objects,o]});
    rebuildMesh(o);
    select(id);
    closeSheet();
    commitSoon();updateEmpty();
    env.notify('已添加'+PRIMS[type].name+'，切到「移动」可以拖轴摆位置。');
  }
  function deleteSelected(){
    const o=findData(selectedId);if(!o)return;
    mutate(next=>{next.objects=next.objects.filter(x=>x.id!==o.id);});
    const g=meshOf(o.id);if(g){disposeMesh(g);scene.remove(g);meshes.delete(o.id);}
    select(0);refreshSceneList();updateEmpty();
    env.notify('已删除「'+o.name+'」，可点撤销找回。');
  }
  function duplicateSelected(){
    const o=findData(selectedId);if(!o)return;
    const data=env.getState();
    if(data.objects.length>=MAX_OBJECTS){env.notify('场景最多 '+MAX_OBJECTS+' 个物体。');return;}
    pushHistory();historyPending=false;
    const id=data.nextId;
    const copy={...o,id,name:o.name+' 副本',pos:[o.pos[0]+.8,o.pos[1],o.pos[2]],mods:{...o.mods},verts:o.verts?[...o.verts]:null,faces:o.faces?[...o.faces]:null};
    env.setState({...data,nextId:id+1,objects:[...data.objects,copy]});
    rebuildMesh(copy);select(id);refreshSceneList();commitSoon();
  }
  /* 几何操作统一入口：取当前几何 → 纯函数变换 → 重建网格 → 更新选择与历史。 */
  function applyGeometryOp(o,fn){
    const g=meshOf(o.id);if(!g)return false;
    const base=g.children[0];
    const data=extractGeometry(base.geometry);
    if(!data)return false;
    const result=fn(data.verts,data.faces);
    if(!result)return false;
    if(result.verts.length/3>MAX_VERTS){env.notify('改动后顶点超过 '+MAX_VERTS+'，手机上带不动，这一步没有执行。');return false;}
    pushHistory();historyPending=false;
    const next=new THREE.BufferGeometry();
    next.setAttribute('position',new THREE.Float32BufferAttribute(result.verts,3));
    next.setIndex(result.faces);next.computeVertexNormals();
    base.geometry.dispose();base.geometry=next;
    syncGroupClones(o);
    storeVerts(o,next);
    commitSoon();invalidate();
    return result;
  }
  function extrudeSelected(){
    const o=findData(selectedId);
    if(!o||!editFaces.length){env.notify('先在编辑模式点选一个或多个面，再挤出。');return;}
    const picked=editFaces.slice();
    const result=applyGeometryOp(o,(v,f)=>extrudeFaces(v,f,picked,.4));
    if(!result)return;
    editFaces=result.tops;
    editSel={vertex:-1,face:result.tops[0]||null};
    highlightEdit(o);editInfoText();
    env.notify('已挤出 '+picked.length+' 个面，继续点「挤出」可以拉长。');
  }
  function insetSelected(){
    const o=findData(selectedId);
    if(!o||!editFaces.length){env.notify('先点选一个或多个面，再内插。');return;}
    const picked=editFaces.slice();
    const result=applyGeometryOp(o,(v,f)=>insetFaces(v,f,picked,.35));
    if(!result)return;
    editFaces=result.tops;
    editSel={vertex:-1,face:result.tops[0]||null};
    highlightEdit(o);editInfoText();
    env.notify('已内插，选中面缩小了一圈；接着挤出就是凹槽。');
  }
  function deleteSelectedFaces(){
    const o=findData(selectedId);
    if(!o||!editFaces.length){env.notify('先点选要删除的面。');return;}
    const count=editFaces.length;
    const picked=editFaces.slice();
    const result=applyGeometryOp(o,(v,f)=>deleteFaces(v,f,picked));
    if(!result)return;
    editFaces=[];editSel=null;
    buildEditOverlay(o);editInfoText();
    env.notify('已删除 '+count+' 个面，可点撤销找回。');
  }
  function weldSelected(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体。');return;}
    const result=applyGeometryOp(o,(v,f)=>weldVertices(v,f,1e-3));
    if(!result)return;
    editFaces=[];editSel=null;
    buildEditOverlay(o);editInfoText();
    env.notify(result.welded>0?'已焊接 '+result.welded+' 个重合顶点。':'没有发现重合顶点。');
  }
  function flipSelectedNormals(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体。');return;}
    if(o.type==='light'){env.notify('灯光没有面，不需要翻转法线。');return;}
    const result=applyGeometryOp(o,(v,f)=>flipNormals(v,f));
    if(!result)return;
    buildEditOverlay(o);
    env.notify('已翻转法线，面的朝向反过来了。');
  }
  /* 按松散部件分离：把不相连的网格块拆成独立物体，继承原物体的变换/颜色。 */
  function separateSelected(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体。');return;}
    if(o.type==='light'){env.notify('灯光不能分离。');return;}
    const g=meshOf(o.id);if(!g)return;
    const data0=extractGeometry(g.children[0].geometry);
    if(!data0){env.notify('这个物体没有可分离的网格。');return;}
    const parts=separateComponents(data0.verts,data0.faces);
    if(parts.length<=1){env.notify('这是一个连通的整体，没有可分离的松散部件。');return;}
    const data=env.getState();
    /* 原物体替换为第一块，其余新建；总数不能超上限。 */
    const extra=parts.length-1;
    if(data.objects.length+extra>MAX_OBJECTS){env.notify('分离后会有 '+parts.length+' 个物体，超过上限 '+MAX_OBJECTS+'，先删掉一些。');return;}
    pushHistory();historyPending=false;
    let nextId=data.nextId;
    const newObjs=[];
    parts.forEach((p,i)=>{
      if(i===0){
        newObjs.push({...o,verts:p.verts,faces:p.faces});
      }else{
        newObjs.push({...o,id:nextId++,name:(o.name+' 部件'+(i+1)).slice(0,30),verts:p.verts,faces:p.faces,mods:{...o.mods}});
      }
    });
    const objects=data.objects.map(x=>x.id===o.id?newObjs[0]:x).concat(newObjs.slice(1));
    env.setState({...data,nextId,objects});
    rebuildAll();
    select(o.id);
    closeSheet();commitSoon();
    env.notify('已分离成 '+parts.length+' 个独立物体，可分别移动编辑。');
  }
  /* 合并所有物体为一个：把每个非灯光物体的网格烘焙到世界坐标后拼成单一网格。
     修改器（镜像/阵列/细分）会先烘进几何，合并后不可再单独调。 */
  function mergeAll(){
    const data=env.getState();
    const solids=data.objects.filter(o=>o.type!=='light');
    if(solids.length<2){env.notify('至少需要两个物体才能合并。');return;}
    const parts=[];
    for(const o of solids){
      const g=meshOf(o.id);if(!g)continue;
      const ex=extractGeometry(g.children[0].geometry);
      if(!ex||!ex.faces.length)continue;
      parts.push({verts:ex.verts,faces:ex.faces,pos:o.pos,rot:o.rot,scl:o.scl});
    }
    if(parts.length<2){env.notify('没有足够可合并的网格。');return;}
    const merged=mergeObjects(parts);
    if(merged.verts.length/3>MAX_MESH_VERTS){env.notify('合并后顶点超过 '+MAX_MESH_VERTS+'，手机上带不动，没有执行。');return;}
    pushHistory();historyPending=false;
    const id=data.nextId;
    const first=solids[0];
    const obj={id,type:'mesh',name:'合并物体',pos:[0,0,0],rot:[0,0,0],scl:[1,1,1],color:first.color,metal:first.metal,rough:first.rough,flat:first.flat,visible:true,mods:{mirror:false,array:0,subdiv:0},verts:merged.verts,faces:merged.faces,lightKind:'point',lightIntensity:1,lightColor:'#ffffff',lightDistance:12,lightAngle:35};
    const lights=data.objects.filter(o=>o.type==='light');
    env.setState({...data,nextId:id+1,objects:[obj,...lights]});
    rebuildAll();
    select(id);
    closeSheet();commitSoon();
    env.notify('已把 '+parts.length+' 个物体合并为一个，可整体编辑。');
  }
  /* 原点居中：把几何原点移到包围盒中心，同时补偿 pos 保持世界位置不变。 */
  function recenterSelected(){
    const o=findData(selectedId);
    if(!o){env.notify('先点选一个物体。');return;}
    if(o.type==='light'){env.notify('灯光没有网格，不需要原点居中。');return;}
    const g=meshOf(o.id);if(!g)return;
    const ex=extractGeometry(g.children[0].geometry);
    if(!ex||!ex.verts.length){env.notify('这个物体没有网格。');return;}
    const r=recenterOrigin(ex.verts,ex.faces);
    if(r.center.every(c=>Math.abs(c)<1e-6)){env.notify('原点已经在中心了。');return;}
    pushHistory();historyPending=false;
    /* 局部中心偏移经 缩放→旋转 换算到世界，加到 pos 上，世界位置不变。 */
    const world=transformPoint(r.center,o.rot,o.scl);
    const newPos=[o.pos[0]+world[0],o.pos[1]+world[1],o.pos[2]+world[2]];
    mutate(next=>{
      const t=next.objects.find(x=>x.id===o.id);
      t.verts=r.verts;t.faces=r.faces;t.pos=newPos;
    },{history:false});
    rebuildMesh(findData(o.id));
    refreshSelection();syncProps();commitSoon();
    env.notify('原点已移到物体中心，旋转/缩放会绕中心进行。');
  }
  function applyTransformToData(){
    const o=findData(selectedId);if(!o)return;
    const g=meshOf(o.id);if(!g)return;
    const data=env.getState();
    env.setState({...data,objects:data.objects.map(x=>x.id===o.id?{...x,pos:[g.position.x,g.position.y,g.position.z],rot:[g.rotation.x,g.rotation.y,g.rotation.z],scl:[g.scale.x,g.scale.y,g.scale.z]}:x)});
    commitSoon();
  }

  /* ---------- 面板 ---------- */
  function openSheet(name){
    sheet=name;
    for(const s of document.querySelectorAll('.model-sheet'))s.classList.toggle('open',s.dataset.sheet===name);
    if(name==='props')syncProps();
    if(name==='scene')refreshSceneList();
  }
  function closeSheet(){
    sheet='';
    for(const s of document.querySelectorAll('.model-sheet'))s.classList.remove('open');
  }
  function syncProps(){
    const o=findData(selectedId);
    const box=$('modelPropsBody');if(!box)return;
    if(!o){box.replaceChildren();const p=document.createElement('p');p.className='model-note';p.textContent='先点选一个物体，再调它的位置、颜色。';box.append(p);return;}
    const g=meshOf(o.id);
    const live=g?{pos:[g.position.x,g.position.y,g.position.z],rot:[g.rotation.x,g.rotation.y,g.rotation.z],scl:[g.scale.x,g.scale.y,g.scale.z]}:{pos:o.pos,rot:o.rot,scl:o.scl};
    const deg=r=>Math.round(r*180/Math.PI);
    const fmt=v=>Math.abs(v)<.005?'0':String(Math.round(v*100)/100);
    const group=(title,key,rows,isDeg=false)=>{
      const wrap=document.createElement('div');wrap.className='model-propgroup';
      const label=document.createElement('label');label.textContent=title;wrap.append(label);
      const xyz=document.createElement('div');xyz.className='model-xyz';
      rows.forEach((v,i)=>{
        const l=document.createElement('label');l.textContent='XYZ'[i];
        const input=document.createElement('input');input.type='number';input.step='0.1';input.value=fmt(v);input.inputMode='decimal';
        input.onchange=()=>{
          const value=num(input.value,v);
          pushHistory();historyPending=false;
          const data=env.getState();
          const values=rows.map((old,j)=>{const raw=j===i?value:old;return isDeg?raw*Math.PI/180:raw;});
          const next={...data,objects:data.objects.map(x=>x.id===o.id?{...x,[key]:values}:x)};
          env.setState(next);
          const target=meshOf(o.id);
          if(target){
            const t=next.objects.find(x=>x.id===o.id);
            target.position.fromArray(t.pos);target.rotation.set(...t.rot);target.scale.fromArray(t.scl);
          }
          commitSoon();invalidate();
        };
        l.append(input);xyz.append(l);
      });
      wrap.append(xyz);
      return wrap;
    };
    const lightOf=()=>{const g=meshOf(o.id);let l=null;if(g)g.traverse(c=>{if(c.isLight&&!l)l=c;});return l;};
    const handleMats=()=>{const g=meshOf(o.id);const out=[];if(g)g.traverse(c=>{if(c.isMesh&&c.material&&c.userData.isHandle)out.push(c.material);});return out;};
    const buildActions=()=>{
      const frag=document.createDocumentFragment();
      const align=document.createElement('div');align.className='model-propactions';
      const floor=document.createElement('button');floor.type='button';floor.id='modelFloorBtn';floor.textContent='⬇ 落地';floor.onclick=dropToFloor;
      const resetT=document.createElement('button');resetT.type='button';resetT.id='modelResetTBtn';resetT.textContent='↺ 重置变换';resetT.onclick=resetTransform;
      align.append(floor,resetT);frag.append(align);
      const actions=document.createElement('div');actions.className='model-propactions';
      const dup=document.createElement('button');dup.type='button';dup.textContent='复制';dup.onclick=duplicateSelected;
      const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='删除';del.onclick=deleteSelected;
      actions.append(dup,del);frag.append(actions);
      return frag;
    };
    const lightControls=()=>{
      const frag=document.createDocumentFragment();
      const grp=document.createElement('div');grp.className='model-propgroup';
      const label=document.createElement('label');label.textContent='灯光';grp.append(label);
      const kindRow=document.createElement('div');kindRow.className='model-colorrow';
      for(const [k,kn] of [['point','点光源'],['spot','聚光灯']]){
        const b=document.createElement('button');b.type='button';b.textContent=kn;
        b.className='model-kindbtn'+(o.lightKind===k?' active':'');
        b.onclick=()=>{mutate(next=>{next.objects.find(x=>x.id===o.id).lightKind=k;});rebuildMesh(findData(o.id));refreshSelection();syncProps();invalidate();};
        kindRow.append(b);
      }
      grp.append(kindRow);
      const cRow=document.createElement('div');cRow.className='model-sliderrow';
      const cName=document.createElement('span');cName.textContent='颜色';cName.className='model-slidername';
      const cp=document.createElement('input');cp.type='color';cp.value=o.lightColor;cp.setAttribute('aria-label','灯光颜色');
      cp.oninput=()=>{const c=cp.value;mutate(next=>{next.objects.find(x=>x.id===o.id).lightColor=c;},{history:false});const l=lightOf();if(l)l.color.set(c);for(const m of handleMats())m.color.set(c);invalidate();};
      cp.onchange=()=>commitSoon();
      cRow.append(cName,cp);grp.append(cRow);
      const sliders=[['lightIntensity','强度',0,10,.1,v=>(+v).toFixed(1)],['lightDistance','距离',1,50,1,v=>String(Math.round(v))],['lightAngle','角度',5,80,1,v=>Math.round(v)+'°']];
      for(const [key,name,min,max,step,fmtv] of sliders){
        if(key==='lightAngle'&&o.lightKind!=='spot')continue;
        const row=document.createElement('div');row.className='model-sliderrow';
        const nm=document.createElement('span');nm.textContent=name;nm.className='model-slidername';
        const range=document.createElement('input');range.type='range';range.min=String(min);range.max=String(max);range.step=String(step);range.value=String(o[key]);
        const out=document.createElement('output');out.textContent=fmtv(o[key]);
        range.oninput=()=>{const v=+range.value;out.textContent=fmtv(v);mutate(next=>{next.objects.find(x=>x.id===o.id)[key]=v;},{history:false});const l=lightOf();if(l){if(key==='lightIntensity')l.intensity=v*4;else if(key==='lightDistance')l.distance=v;else if(key==='lightAngle'&&l.isSpotLight)l.angle=THREE.MathUtils.degToRad(v);}invalidate();};
        range.onchange=()=>commitSoon();
        row.append(nm,range,out);grp.append(row);
      }
      frag.append(grp);
      return frag;
    };
    box.replaceChildren();
    box.append(group('位置','pos',live.pos));
    /* 微调按钮：手指点一下走 0.1，比拖轴更稳 */
    const nudge=document.createElement('div');nudge.className='model-nudge';
    for(const [label,axis,delta] of [['X−',0,-.1],['X＋',0,.1],['Y−',1,-.1],['Y＋',1,.1],['Z−',2,-.1],['Z＋',2,.1]]){
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.onclick=()=>{
        pushHistory();historyPending=false;
        const data=env.getState();
        const next={...data,objects:data.objects.map(x=>{if(x.id!==o.id)return x;const pos=[...x.pos];pos[axis]=Math.round((pos[axis]+delta)*100)/100;return {...x,pos};})};
        env.setState(next);
        const t=meshOf(o.id);if(t)t.position.fromArray(next.objects.find(x=>x.id===o.id).pos);
        commitSoon();syncProps();invalidate();
      };
      nudge.append(b);
    }
    box.append(nudge);
    box.append(group('旋转（度）','rot',live.rot.map(deg),true));
    /* 灯光：只有位置/朝向 + 灯光参数，没有缩放、材质、修改器。 */
    if(o.type==='light'){
      box.append(lightControls());
      box.append(buildActions());
      return;
    }
    box.append(group('缩放','scl',live.scl));
    /* 颜色 */
    const colorGroup=document.createElement('div');colorGroup.className='model-propgroup';
    const colorLabel=document.createElement('label');colorLabel.textContent='颜色';colorGroup.append(colorLabel);
    const colorRow=document.createElement('div');colorRow.className='model-colorrow';
    for(const c of PALETTE){
      const b=document.createElement('button');b.type='button';b.className='model-swatch'+(c===o.color?' active':'');b.style.background=c;b.setAttribute('aria-label','颜色 '+c);
      b.onclick=()=>{mutate(next=>{next.objects.find(x=>x.id===o.id).color=c;});const t=meshOf(o.id);if(t)t.traverse(m=>{if(m.isMesh)m.material.color.set(c);});syncProps();invalidate();};
      colorRow.append(b);
    }
    const picker=document.createElement('input');picker.type='color';picker.value=o.color;picker.setAttribute('aria-label','自定义颜色');
    picker.oninput=()=>{const c=picker.value;mutate(next=>{next.objects.find(x=>x.id===o.id).color=c;},{history:false});const t=meshOf(o.id);if(t)t.traverse(m=>{if(m.isMesh)m.material.color.set(c);});invalidate();};
    picker.onchange=()=>commitSoon();
    colorRow.append(picker);colorGroup.append(colorRow);box.append(colorGroup);
    /* 材质滑杆 */
    const matGroup=document.createElement('div');matGroup.className='model-propgroup';
    const matLabel=document.createElement('label');matLabel.textContent='质感';matGroup.append(matLabel);
    for(const [key,label] of [['metal','金属感'],['rough','粗糙度']]){
      const row=document.createElement('div');row.className='model-sliderrow';
      const name=document.createElement('span');name.textContent=label;name.style.fontSize='12px';name.style.color='var(--muted)';name.style.flex='none';name.style.width='48px';
      const range=document.createElement('input');range.type='range';range.min='0';range.max='1';range.step='0.05';range.value=String(o[key]);
      const out=document.createElement('output');out.textContent=Math.round(o[key]*100)+'%';
      range.oninput=()=>{const v=+range.value;out.textContent=Math.round(v*100)+'%';mutate(next=>{next.objects.find(x=>x.id===o.id)[key]=v;},{history:false});const t=meshOf(o.id);if(t)t.traverse(m=>{if(m.isMesh){if(key==='metal')m.material.metalness=v;else m.material.roughness=v;}});invalidate();};
      range.onchange=()=>commitSoon();
      row.append(name,range,out);matGroup.append(row);
    }
    const flatLabel=document.createElement('label');flatLabel.className='model-check';
    const flatCheck=document.createElement('input');flatCheck.type='checkbox';flatCheck.checked=!!o.flat;
    flatCheck.onchange=()=>{
      mutate(next=>{next.objects.find(x=>x.id===o.id).flat=flatCheck.checked;});
      const t=meshOf(o.id);
      if(t)t.traverse(m=>{if(m.isMesh){m.material.flatShading=flatCheck.checked;m.material.needsUpdate=true;}});
      invalidate();
    };
    flatLabel.append(flatCheck,document.createTextNode('平直着色（硬边低多边形感）'));
    matGroup.append(flatLabel);
    box.append(matGroup);
    /* 修改器 */
    const modGroup=document.createElement('div');modGroup.className='model-propgroup';
    const modLabel=document.createElement('label');modLabel.textContent='修改器（可随时关）';modGroup.append(modLabel);
    const mirror=document.createElement('label');mirror.className='model-check';
    const mirrorCheck=document.createElement('input');mirrorCheck.type='checkbox';mirrorCheck.checked=o.mods.mirror;
    mirrorCheck.onchange=()=>{mutate(next=>{next.objects.find(x=>x.id===o.id).mods.mirror=mirrorCheck.checked;});rebuildMesh(findData(o.id));refreshSelection();};
    mirror.append(mirrorCheck,document.createTextNode('左右镜像'));modGroup.append(mirror);
    for(const [key,label,max] of [['array','阵列数量',6],['subdiv','细分级别',2]]){
      const row=document.createElement('div');row.className='model-sliderrow';
      const name=document.createElement('span');name.textContent=label;name.style.fontSize='12px';name.style.color='var(--muted)';name.style.flex='none';name.style.width='60px';
      const range=document.createElement('input');range.type='range';range.min='0';range.max=String(max);range.step='1';range.value=String(o.mods[key]);
      const out=document.createElement('output');out.textContent=String(o.mods[key]);
      range.onchange=()=>{const v=+range.value;out.textContent=String(v);mutate(next=>{next.objects.find(x=>x.id===o.id).mods[key]=v;});rebuildMesh(findData(o.id));refreshSelection();};
      row.append(name,range,out);modGroup.append(row);
    }
    box.append(modGroup);
    /* 操作 */
    box.append(buildActions());
  }
  function refreshSceneList(){
    const box=$('modelSceneBody');if(!box)return;
    box.replaceChildren();
    const data=env.getState();
    if(!data.objects.length){
      const p=document.createElement('p');p.className='model-note';p.textContent='场景还是空的。点下方「添加」放第一个形体。';box.append(p);return;
    }
    const list=document.createElement('div');list.className='model-scenelist';
    for(const o of data.objects){
      const row=document.createElement('div');row.className='model-scenerow'+(o.id===selectedId?' active':'');
      const dot=document.createElement('span');dot.className='dot';dot.style.background=o.color;
      const name=document.createElement('span');name.className='name';name.textContent=o.name;
      const eye=document.createElement('button');eye.type='button';eye.textContent=o.visible?'👁':'—';eye.className=o.visible?'':'off';eye.setAttribute('aria-label',o.visible?'隐藏':'显示');
      eye.onclick=ev=>{ev.stopPropagation();mutate(next=>{const t=next.objects.find(x=>x.id===o.id);t.visible=!t.visible;});const g=meshOf(o.id);if(g)g.visible=!g.visible;refreshSceneList();invalidate();};
      const rename=document.createElement('button');rename.type='button';rename.textContent='✎';rename.setAttribute('aria-label','重命名');
      rename.onclick=ev=>{ev.stopPropagation();openRename(o);};
      row.append(dot,name,eye,rename);
      row.onclick=()=>{select(o.id);};
      list.append(row);
    }
    box.append(list);
    const note=document.createElement('p');note.className='model-note';note.textContent='点行选中；👁 切换显示。物体最多 '+MAX_OBJECTS+' 个。';
    box.append(note);
  }
  function updateEmpty(){
    const el=$('modelEmpty');if(!el)return;
    el.hidden=env.getState().objects.length>0;
  }
  let renameTarget=0;
  function openRename(o){
    renameTarget=o.id;
    const dlg=$('modelRenameDialog'),input=$('modelRenameInput');
    if(!dlg||!input)return;
    input.value=o.name;
    dlg.showModal();
    setTimeout(()=>input.select(),50);
  }
  function bindRename(){
    const dlg=$('modelRenameDialog');if(!dlg)return;
    dlg.addEventListener('close',()=>{
      if(dlg.returnValue!=='ok')return;
      const value=($('modelRenameInput').value||'').trim();
      if(!value||!renameTarget)return;
      mutate(next=>{const t=next.objects.find(x=>x.id===renameTarget);if(t)t.name=value.slice(0,30);});
      refreshSceneList();refreshSelection();
    });
    dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close('cancel');});
  }
  function fadeHint(){
    const hint=$('modelHint');if(!hint)return;
    clearTimeout(hintTimer);
    hintTimer=setTimeout(()=>hint.classList.add('faded'),4000);
  }

  /* ---------- 导入（OBJ / GLB / STL，全部本地解析） ---------- */
  const MAX_IMPORT_BYTES=12*1024*1024;
  function collectMeshes(root){
    /* 把场景树里的所有网格烘焙世界变换后取出。 */
    root.updateMatrixWorld(true);
    const out=[];
    root.traverse(c=>{
      if(c.isMesh&&c.geometry&&c.geometry.getAttribute('position')){
        const geo=c.geometry.clone();
        geo.applyMatrix4(c.matrixWorld);
        out.push(geo);
      }
    });
    return out;
  }
  function unifyAttributes(geos){
    /* mergeGeometries 要求属性一致：统一只留 position（索引化）。 */
    return geos.map(g=>{
      let geo=g;
      if(!geo.getIndex())geo=mergeVertices(geo);
      const clean=new THREE.BufferGeometry();
      clean.setAttribute('position',geo.getAttribute('position'));
      clean.setIndex(geo.getIndex());
      if(geo!==g)geo.dispose();
      return clean;
    });
  }
  async function importFile(file){
    if(!file)return;
    if(file.size>MAX_IMPORT_BYTES){env.notify('文件超过 12 MB，手机上解析不动，先在外面缩小。');return;}
    const data=env.getState();
    if(data.objects.length>=MAX_OBJECTS){env.notify('场景最多 '+MAX_OBJECTS+' 个物体，先删掉一些。');return;}
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(!['obj','glb','gltf','stl'].includes(ext)){env.notify('支持 .obj / .glb / .gltf / .stl，这个是 .'+ext+'。');return;}
    env.notify('正在解析 '+file.name+'…');
    try{
      const buffer=await file.arrayBuffer();
      let geos=[];
      if(ext==='obj'){
        const root=new OBJLoader().parse(new TextDecoder().decode(buffer));
        geos=collectMeshes(root);
      }else if(ext==='stl'){
        const geo=new STLLoader().parse(buffer);
        geos=[geo];
      }else{
        const gltf=await new Promise((resolve,reject)=>new GLTFLoader().parse(buffer,'',resolve,reject));
        geos=collectMeshes(gltf.scene);
      }
      if(!geos.length){env.notify('文件里没有可用的网格。');return;}
      let geo=geos.length===1?geos[0]:mergeGeometries(unifyAttributes(geos),false);
      if(!geo){env.notify('网格合并失败，文件可能包含不兼容的数据。');return;}
      if(!geo.getIndex())geo=mergeVertices(geo);
      let simplified=false;
      const faceCount=geo.getIndex().count/3;
      if(faceCount>IMPORT_TARGET_FACES){
        /* 大模型自动降面到可编辑规模，形状尽量保住。 */
        const modifier=new SimplifyModifier();
        const removeCount=Math.max(0,geo.getAttribute('position').count-Math.floor(IMPORT_TARGET_FACES*.55));
        geo=await modifier.modify(geo,removeCount);
        simplified=true;
      }
      const extracted=extractGeometry(geo);
      geo.dispose();
      if(!extracted||extracted.verts.length/3<3){env.notify('解析出的网格是空的。');return;}
      if(extracted.verts.length/3>MAX_MESH_VERTS){env.notify('降面后仍然太大（'+Math.floor(extracted.verts.length/3)+' 顶点），换个更简单的模型。');return;}
      /* 归一化：最长边缩到 2，中心移到原点，底面贴地。 */
      const v=extracted.verts;
      let minx=Infinity,miny=Infinity,minz=Infinity,maxx=-Infinity,maxy=-Infinity,maxz=-Infinity;
      for(let i=0;i<v.length;i+=3){
        minx=Math.min(minx,v[i]);maxx=Math.max(maxx,v[i]);
        miny=Math.min(miny,v[i+1]);maxy=Math.max(maxy,v[i+1]);
        minz=Math.min(minz,v[i+2]);maxz=Math.max(maxz,v[i+2]);
      }
      const span=Math.max(maxx-minx,maxy-miny,maxz-minz)||1;
      const scale=2/span;
      const cx=(minx+maxx)/2,cz=(minz+maxz)/2;
      const verts=v.map((x,i)=>i%3===0?(x-cx)*scale:i%3===1?(x-miny)*scale:(x-cz)*scale);
      pushHistory();historyPending=false;
      const id=data.nextId;
      const baseName=file.name.replace(/\.[^.]+$/,'').slice(0,24)||'导入模型';
      const o={id,type:'mesh',name:baseName,pos:[0,0,0],rot:[0,0,0],scl:[1,1,1],color:PALETTE[data.objects.length%PALETTE.length],metal:0,rough:.65,visible:true,mods:{mirror:false,array:0,subdiv:0},verts,faces:extracted.faces};
      env.setState({...data,nextId:id+1,objects:[...data.objects,o]});
      rebuildMesh(o);
      select(id);
      closeSheet();
      commitSoon();updateEmpty();
      env.notify('已导入「'+baseName+'」'+(simplified?'（面数较多，已自动简化）':'')+'，可直接编辑。');
    }catch(e){
      env.notify('导入失败：'+(e&&e.message||e));
    }
  }

  /* ---------- 场景工程（.tgscene：整场景 JSON，可备份/分享/恢复） ---------- */
  function exportSceneProject(){
    const data=env.getState();
    if(!data.objects.length){env.notify('场景是空的，先添加一个形体。');return;}
    const payload=JSON.stringify({app:'tiangong-model',version:1,savedAt:Date.now(),scene:modelSanitize(data)});
    env.exportBinary('天工场景.tgscene',new TextEncoder().encode(payload),'application/json');
  }
  async function importSceneProject(file){
    if(!file)return;
    if(file.size>MAX_IMPORT_BYTES){env.notify('工程文件太大，手机上解析不动。');return;}
    try{
      const text=new TextDecoder().decode(await file.arrayBuffer());
      const raw=JSON.parse(text);
      if(!raw||raw.app!=='tiangong-model'||!raw.scene){env.notify('这不是天工场景工程文件（.tgscene）。');return;}
      const scene=modelSanitize(raw.scene);
      if(!scene.objects.length){env.notify('工程里没有物体。');return;}
      pushHistory();historyPending=false;
      env.setState(scene);
      selectedId=0;editSel=null;editFaces=[];editEdge=null;
      rebuildAll();
      if(scene.camera&&camera&&orbit){camera.position.fromArray(scene.camera.pos);orbit.target.fromArray(scene.camera.target);}
      closeSheet();commitSoon();
      env.notify('已恢复场景（'+scene.objects.length+' 个物体），可撤销回到之前。');
    }catch(e){
      env.notify('工程解析失败：'+(e&&e.message||e));
    }
  }

  /* ---------- 导出 ---------- */
  function exportGroup(){
    const group=new THREE.Group();
    for(const o of env.getState().objects){
      if(!o.visible)continue;
      /* 灯光是场景照明，不是几何体，导出模型时跳过。 */
      if(o.type==='light')continue;
      const g=meshOf(o.id);if(!g)continue;
      const clone=g.clone(true);
      clone.traverse(c=>{if(c.isMesh)c.material=c.material.clone();});
      group.add(clone);
    }
    return group;
  }
  async function doExport(kind){
    if(kind==='png'){exportSnapshot();return;}
    const data=env.getState();
    if(!data.objects.length){env.notify('场景是空的，先添加一个形体。');return;}
    const group=exportGroup();
    if(!group.children.length){env.notify('可见物体为空，先把要导出的物体设为显示。');return;}
    try{
      if(kind==='obj'){
        const text=new OBJExporter().parse(group);
        env.exportBinary('天工模型.obj',new TextEncoder().encode(text),'model/obj');
      }else if(kind==='stl'){
        const buffer=new STLExporter().parse(group,{binary:true});
        const bytes=buffer instanceof DataView?new Uint8Array(buffer.buffer,buffer.byteOffset,buffer.byteLength):new Uint8Array(buffer);
        env.exportBinary('天工模型.stl',bytes,'model/stl');
      }else{
        const exporter=new GLTFExporter();
        const result=await exporter.parseAsync(group,{binary:true});
        env.exportBinary('天工模型.glb',new Uint8Array(result),'model/gltf-binary');
      }
      closeSheet();
    }catch(e){env.notify('导出失败：'+(e&&e.message||e));}
  }
  /* 当前视角截图：临时藏掉编辑点云、坐标轴手柄、网格，渲染一帧后读像素。 */
  function exportSnapshot(){
    if(!renderer||!active){env.notify('画面还没准备好，稍等再试。');return;}
    const hadOverlay=editOverlay?editOverlay.visible:true;
    const hadGizmo=gizmo?gizmo.visible:true;
    const hadGrid=grid?grid.visible:true;
    /* 灯光手柄球只是编辑器里的定位标记，截图作品时藏起来。 */
    const handles=[];
    for(const [,g] of meshes)g.traverse(c=>{if(c.isMesh&&c.userData.isHandle)handles.push(c);});
    try{
      if(editOverlay)editOverlay.visible=false;
      if(gizmo)gizmo.visible=false;
      if(grid)grid.visible=false;
      for(const h of handles)h.visible=false;
      renderer.render(scene,camera);
      const url=renderer.domElement.toDataURL('image/png');
      const bin=atob(url.split(',')[1]||'');
      const bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
      env.exportBinary('天工截图.png',bytes,'image/png');
      closeSheet();
    }catch(e){
      env.notify('截图失败：'+(e&&e.message||e));
    }finally{
      if(editOverlay)editOverlay.visible=hadOverlay;
      if(gizmo)gizmo.visible=hadGizmo;
      if(grid)grid.visible=hadGrid;
      for(const h of handles)h.visible=true;
      invalidate();
    }
  }

  /* ---------- 保存 ---------- */
  function commitSoon(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{
      const data=env.getState();
      if(camera&&orbit){
        env.setState({...data,camera:{pos:camera.position.toArray(),target:orbit.target.toArray()}});
      }
      env.scheduleSave();
    },400);
  }

  /* ---------- 生命周期 ---------- */
  function enter(){
    if(!host())return;
    if(!ensureRenderer())return;
    active=true;
    rebuildAll();
    const cam=env.getState().camera;
    if(cam){camera.position.fromArray(cam.pos);orbit.target.fromArray(cam.target);}
    resize();
    cancelAnimationFrame(raf);
    loop();
    const hint=$('modelHint');if(hint){hint.classList.remove('faded');fadeHint();}
  }
  function leave(){
    active=false;
    cancelAnimationFrame(raf);
    if(gizmo)gizmo.detach();
    closeSheet();
    commitSoon();
  }

  /* ---------- UI 绑定 ---------- */
  function bind(){
    const addGrid=$('modelAddGrid');
    if(addGrid){
      addGrid.replaceChildren();
      for(const [type,def] of Object.entries(PRIMS)){
        const b=document.createElement('button');b.type='button';
        const glyph=document.createElement('span');glyph.className='glyph';glyph.textContent=def.glyph;
        const name=document.createElement('span');name.textContent=def.name;
        b.append(glyph,name);
        b.onclick=()=>addObject(type);
        addGrid.append(b);
      }
      const light=document.createElement('button');light.type='button';
      const lg=document.createElement('span');lg.className='glyph';lg.textContent='☀';
      const ln=document.createElement('span');ln.textContent='灯光';
      light.append(lg,ln);
      light.onclick=()=>addObject('light');
      addGrid.append(light);
    }
    for(const b of document.querySelectorAll('.model-modes button')){
      b.onclick=()=>{
        const next=b.dataset.mode;
        if(next==='edit'&&!selectedId){env.notify('先点选一个物体，再进编辑模式。');return;}
        if(next==='edit'){const cur=findData(selectedId);if(cur&&cur.type==='light'){env.notify('灯光没有网格，不能进点/线/面编辑；切「移动」可以摆位置。');return;}}
        if(mode==='edit'&&next!=='edit'){
          const o=findData(selectedId);
          if(o){const g=meshOf(o.id);if(g)storeVerts(o,g.children[0].geometry);}
          commitSoon();
        }
        if(next!=='object'&&next!=='edit'&&!selectedId){env.notify('先点选一个物体。');return;}
        mode=next;editSel=null;editFaces=[];editEdge=null;
        const info=$('modelEditInfo');if(info)info.textContent=next==='edit'?'下方选点/线/面；选中后直接拖动；挤出/内插/删面在工具条':'';
        const editTools=$('modelEditTools');if(editTools)editTools.hidden=next!=='edit';
        const subRow=$('modelSubRow');if(subRow)subRow.hidden=next!=='edit';
        refreshSelection();
      };
    }
    for(const b of document.querySelectorAll('.model-views button')){
      b.onclick=()=>{
        const v=b.dataset.view;
        const t=orbit.target.clone();
        const d=camera.position.distanceTo(t)||5;
        if(v==='top')camera.position.set(t.x,t.y+d,t.z+.001);
        else if(v==='front')camera.position.set(t.x,t.y,t.z+d);
        else if(v==='side')camera.position.set(t+d,t.y,t.z);
        else{camera.position.set(t.x+d*.6,t.y+d*.5,t.z+d*.8);}
        camera.lookAt(t);invalidate();
      };
    }
    const dockButtons={modelAddBtn:'add',modelPropsBtn:'props',modelSceneBtn:'scene',modelExportBtn:'export'};
    for(const [id,name] of Object.entries(dockButtons)){
      const el=$(id);if(el)el.onclick=()=>{sheet===name?closeSheet():openSheet(name);};
    }
    for(const b of document.querySelectorAll('.model-sheethead button'))b.onclick=closeSheet;
    const undoBtn=$('modelUndoBtn');if(undoBtn){undoBtn.disabled=true;undoBtn.onclick=undo;}
    const redoBtn=$('modelRedoBtn');if(redoBtn){redoBtn.disabled=true;redoBtn.onclick=redo;}
    const mirrorBtn=$('modelMirrorEditBtn');
    if(mirrorBtn)mirrorBtn.onclick=()=>{mirrorEdit=!mirrorEdit;mirrorBtn.classList.toggle('active',mirrorEdit);env.notify(mirrorEdit?'镜像编辑开：拖点/边时 X 对称点跟着动。':'镜像编辑关。');};
    for(const b of document.querySelectorAll('#modelSubRow button')){
      b.onclick=()=>{
        editSub=b.dataset.sub;editSel=null;editFaces=[];editEdge=null;
        for(const x of document.querySelectorAll('#modelSubRow button'))x.classList.toggle('active',x===b);
        const o=findData(selectedId);if(o)highlightEdit(o);
        editInfoText();invalidate();
      };
    }
    const sceneExportBtn=$('modelSceneExportBtn');if(sceneExportBtn)sceneExportBtn.onclick=exportSceneProject;
    const sceneImportBtn=$('modelSceneImportBtn');
    const sceneInput=$('modelSceneInput');
    if(sceneImportBtn&&sceneInput){
      sceneImportBtn.onclick=()=>sceneInput.click();
      sceneInput.onchange=()=>{const f=sceneInput.files&&sceneInput.files[0];sceneInput.value='';importSceneProject(f);};
    }
    const presetRow=$('modelPresetRow');
    if(presetRow){
      presetRow.replaceChildren();
      for(const [key,p] of Object.entries(PRESETS)){
        const b=document.createElement('button');b.type='button';b.textContent=p.name;
        b.onclick=()=>addPreset(key);
        presetRow.append(b);
      }
    }
    const dupBtn=$('modelDupBtn');if(dupBtn)dupBtn.onclick=duplicateSelected;
    const delBtn=$('modelDeleteBtn');if(delBtn)delBtn.onclick=deleteSelected;
    const extBtn=$('modelExtrudeBtn');if(extBtn)extBtn.onclick=extrudeSelected;
    const insetBtn=$('modelInsetBtn');if(insetBtn)insetBtn.onclick=insetSelected;
    const delFaceBtn=$('modelDelFaceBtn');if(delFaceBtn)delFaceBtn.onclick=deleteSelectedFaces;
    const weldBtn=$('modelWeldBtn');if(weldBtn)weldBtn.onclick=weldSelected;
    const separateBtn=$('modelSeparateBtn');if(separateBtn)separateBtn.onclick=separateSelected;
    const flipBtn=$('modelFlipBtn');if(flipBtn)flipBtn.onclick=flipSelectedNormals;
    const recenterBtn=$('modelRecenterBtn');if(recenterBtn)recenterBtn.onclick=recenterSelected;
    const mergeBtn=$('modelMergeBtn');if(mergeBtn)mergeBtn.onclick=mergeAll;
    const focusBtn=$('modelFocusBtn');if(focusBtn)focusBtn.onclick=focusSelected;
    const projBtn=$('modelProjBtn');if(projBtn)projBtn.onclick=toggleProjection;
    const wireBtn=$('modelWireBtn');if(wireBtn)wireBtn.onclick=toggleWireframe;
    const snapBtn=$('modelSnapBtn');if(snapBtn)snapBtn.onclick=toggleSnap;
    const floorBtn=$('modelFloorBtn');if(floorBtn)floorBtn.onclick=dropToFloor;
    const resetTBtn=$('modelResetTBtn');if(resetTBtn)resetTBtn.onclick=resetTransform;
    const importInput=$('modelImportInput');
    if(importInput){
      for(const id of ['modelImportBtn','modelImportBtn2']){
        const btn=$(id);if(btn)btn.onclick=()=>importInput.click();
      }
      importInput.onchange=()=>{const f=importInput.files&&importInput.files[0];importInput.value='';importFile(f);};
    }
    for(const b of document.querySelectorAll('[data-export]'))b.onclick=()=>doExport(b.dataset.export);
    const resetBtn=$('modelResetCam');if(resetBtn)resetBtn.onclick=()=>{camera.position.set(3.2,2.6,4.2);orbit.target.set(0,.5,0);invalidate();};
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)commitSoon();});
  }
  bind();
  bindRename();

  /* ---------- 对外接口 ---------- */
  api.serialize=()=>{
    const data=env.getState();
    return modelSanitize(data);
  };
  api.enter=enter;
  api.leave=leave;
  api.status=()=>{
    const data=env.getState();
    let verts=0,faces=0;
    for(const o of data.objects){
      if(o.verts){verts+=o.verts.length/3;faces+=o.faces?o.faces.length/3:0;}
      else if(PRIMS[o.type]){
        const g=PRIMS[o.type].make();
        verts+=g.getAttribute('position').count;
        faces+=g.getIndex()?g.getIndex().count/3:g.getAttribute('position').count/3;
        g.dispose();
      }
    }
    return data.objects.length+' 个物体 · '+verts+' 顶点 / '+faces+' 面'+(selectedId?' · 已选中':'');
  };
  api.panelOpen=()=>!!sheet;
  api.closePanel=closeSheet;
  api.debug=()=>({objects:env.getState().objects.length,selected:selectedId,mode,sheet,active});
}

/* initModel 的返回集合：app.js 按名字取用。 */
const api={serialize:()=>DEFAULT_SCENE(),enter:()=>{},leave:()=>{},status:()=>'',panelOpen:()=>false,closePanel:()=>{},debug:()=>({})};
export function modelSerialize(){return api.serialize();}
export function modelModeEnter(){api.enter();}
export function modelModeLeave(){api.leave();}
export function modelStatusText(){return api.status();}
export function modelPanelOpen(){return api.panelOpen();}
export function modelClosePanel(){api.closePanel();}
export const modelDebug=()=>api.debug();