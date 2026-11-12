/* 天工 · 3D 建模（手机端）
 * 参照 Blender 的核心概念做了触屏化取舍：
 *   - 物体模式：点选物体，单指转视角、双指缩放/平移（OrbitControls）
 *   - 移动/旋转/缩放：TransformControls 拖轴 + 数字微调按钮，不靠悬停
 *   - 编辑模式：点选顶点/边/面后拖动，或整面挤出，改动直接写回几何体
 *   - 修改器：镜像、阵列、细分（非破坏性，随时可关）
 * 场景保存在工作区草稿里；导出 OBJ / GLB / STL。渲染完全离线（three.js 打包在本地）。
 */
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {TransformControls} from 'three/examples/jsm/controls/TransformControls.js';
import {OBJExporter} from 'three/examples/jsm/exporters/OBJExporter.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {STLExporter} from 'three/examples/jsm/exporters/STLExporter.js';

const MAX_OBJECTS=60,MAX_VERTS=24000,MAX_HISTORY=24;
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
    if(!item||typeof item!=='object'||!PRIMS[item.type])continue;
    const id=Math.max(1,Math.floor(num(item.id,objects.length+1)));
    const pos=Array.isArray(item.pos)?item.pos.map(v=>clamp(num(v),-500,500)):null;
    const rot=Array.isArray(item.rot)?item.rot.map(v=>num(v)):null;
    const scl=Array.isArray(item.scl)?item.scl.map(v=>clamp(num(v,1),.02,50)):null;
    const verts=Array.isArray(item.verts)&&item.verts.length>=12&&item.verts.length<=MAX_VERTS*3&&item.verts.every(v=>Number.isFinite(+v))?item.verts.map(v=>+v):null;
    const vertCount=verts?verts.length/3:0;
    const faces=verts&&Array.isArray(item.faces)&&item.faces.length>=3&&item.faces.length%3===0&&item.faces.length<=MAX_VERTS*12&&item.faces.every(v=>Number.isInteger(v)&&v>=0&&v<vertCount)?item.faces.slice():null;
    objects.push({
      id,type:item.type,
      name:typeof item.name==='string'&&item.name.trim()?item.name.slice(0,30):PRIMS[item.type].name,
      pos:pos&&pos.length===3?pos:[0,.5,0],
      rot:rot&&rot.length===3?rot:[0,0,0],
      scl:scl&&scl.length===3?scl:[1,1,1],
      color:/^#[0-9a-fA-F]{6}$/.test(item.color)?item.color:PALETTE[objects.length%PALETTE.length],
      metal:clamp(num(item.metal,0),0,1),rough:clamp(num(item.rough,.65),0,1),
      visible:item.visible!==false,
      mods:{mirror:item.mods&&item.mods.mirror===true,array:clamp(Math.floor(num(item.mods&&item.mods.array,0)),0,6),subdiv:clamp(Math.floor(num(item.mods&&item.mods.subdiv,0)),0,2)},
      verts,faces
    });
  }
  const seen=new Set();
  for(const o of objects){while(seen.has(o.id))o.id++;seen.add(o.id);}
  const nextId=Math.max(1,Math.floor(num(r.nextId,1)),...objects.map(o=>o.id+1));
  const cam=r.camera&&typeof r.camera==='object'&&Array.isArray(r.camera.pos)&&Array.isArray(r.camera.target)?{pos:r.camera.pos.slice(0,3).map(v=>num(v)),target:r.camera.target.slice(0,3).map(v=>num(v))}:null;
  return {version:1,nextId,objects,camera:cam};
}

export function initModel(env){
  const $=id=>document.getElementById(id);
  let scene=null,renderer=null,camera=null,orbit=null,gizmo=null,grid=null;
  let meshes=new Map(),selectedId=0,mode='object',editSel=null,editDrag=null;
  let active=false,dirty=false,raf=0,sheet='',history=[],editOverlay=null;
  let raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let hintTimer=0,saveTimer=0;
  const host=()=>$('modelPanel');

  /* ---------- 场景与渲染 ---------- */
  function ensureRenderer(){
    if(renderer)return true;
    const canvas=$('modelCanvas');if(!canvas)return false;
    try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});}
    catch(e){env.notify('这台设备暂时开不了 3D 画布（WebGL 不可用）。');return false;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(0x101820);
    scene=new THREE.Scene();
    scene.fog=new THREE.Fog(0x101820,30,80);
    camera=new THREE.PerspectiveCamera(50,1,.05,200);
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
    camera.aspect=w/h;camera.updateProjectionMatrix();
    dirty=true;
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
    }else{
      geo=PRIMS[o.type].make();
    }
    return geo;
  }
  /* 自定义顶点只保存位置；索引按基础体默认拓扑重建，挤出后面数变化时改用非索引渲染。 */
  function defaultIndexFor(o){
    if(o.faces&&Array.isArray(o.faces))return o.faces;
    const base=PRIMS[o.type].make();
    const idx=base.getIndex();
    const count=o.verts.length/3;
    base.dispose();
    if(idx&&idx.array.length&&Math.max(...idx.array)<count)return Array.from(idx.array);
    return null;
  }
  function materialFor(o){
    return new THREE.MeshStandardMaterial({color:new THREE.Color(o.color),metalness:o.metal,roughness:o.rough,flatShading:o.type==='ico'&&!o.verts});
  }
  function rebuildMesh(o){
    const old=meshes.get(o.id);
    if(old){disposeMesh(old);scene.remove(old);meshes.delete(o.id);}
    const group=new THREE.Group();
    group.userData.modelId=o.id;
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
    selectedId=id;editSel=null;
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
    if(chip)chip.textContent=o?(o.name+' · '+PRIMS[o.type].name+(mode==='edit'?' · 编辑中':'')):'点一个物体选中，空白处拖动转视角';
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
    const mat=new THREE.PointsMaterial({color:0x7fe0c3,size:.055,sizeAttenuation:true,depthTest:false,transparent:true,opacity:.95});
    const points=new THREE.Points(geo,mat);
    points.renderOrder=10;
    points.position.copy(g.position);points.rotation.copy(g.rotation);points.scale.copy(g.scale);
    editOverlay.add(points);
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
        if(vi>=0||face){
          editSel={vertex:vi,face};
          const g=meshOf(o.id);
          const plane=new THREE.Plane();
          const normal=new THREE.Vector3();camera.getWorldDirection(normal);
          plane.setFromNormalAndCoplanarPoint(normal,hit.point);
          editDrag={plane,start:hit.point.clone(),vi,face,moved:false};
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
    const indices=editDrag.vi>=0?[editDrag.vi]:(editDrag.face?[editDrag.face.a,editDrag.face.b,editDrag.face.c]:[]);
    const unique=[...new Set(indices)];
    for(const i of unique){
      pos.setXYZ(i,pos.getX(i)+delta.x,pos.getY(i)+delta.y,pos.getZ(i)+delta.z);
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
          const vi=pickVertex(hit,o),face=pickFace(hit);
          editSel={vertex:vi,face};
          highlightEdit(o);
          const label=$('modelEditInfo');
          if(label)label.textContent=vi>=0?'已选中顶点 #'+vi:face?'已选中一个面，可拖动或挤出':'点顶点或面选中';
          invalidate();
        }else select(id);
      }else select(id);
    }else if(mode!=='edit')select(0);
  }
  function highlightEdit(o){
    /* 选中反馈直接靠 overlay 颜色：整体点云青色，选中顶点用第二个点云标红。 */
    buildEditOverlay(o);
    if(!editSel||!editOverlay.children.length)return;
    const g=meshOf(o.id);const base=g.children[0];
    const pos=base.geometry.getAttribute('position');
    const idxs=editSel.vertex>=0?[editSel.vertex]:(editSel.face?[editSel.face.a,editSel.face.b,editSel.face.c]:[]);
    if(!idxs.length)return;
    const pts=[];
    for(const i of idxs)if(i<pos.count)pts.push(pos.getX(i),pos.getY(i),pos.getZ(i));
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
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
    const btn=$('modelUndoBtn');if(btn)btn.disabled=false;
  }
  function undo(){
    if(!history.length){env.notify('没有可撤销的操作了。');return;}
    const objects=JSON.parse(history.pop());
    const data=env.getState();
    env.setState({...data,objects});
    historyPending=false;
    rebuildAll();
    if(!findData(selectedId))selectedId=0;
    refreshSelection();syncProps();commitSoon();
    const btn=$('modelUndoBtn');if(btn)btn.disabled=!history.length;
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
  function addObject(type){
    const data=env.getState();
    if(data.objects.length>=MAX_OBJECTS){env.notify('场景最多 '+MAX_OBJECTS+' 个物体，先删掉一些。');return;}
    pushHistory();historyPending=false;
    const id=data.nextId;
    const count=data.objects.filter(o=>o.type===type).length;
    const o={id,type,name:PRIMS[type].name+(count?' '+(count+1):''),pos:[0,type==='plane'?0:.5,0],rot:[0,0,0],scl:[1,1,1],color:PALETTE[data.objects.length%PALETTE.length],metal:0,rough:.65,visible:true,mods:{mirror:false,array:0,subdiv:0},verts:null};
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
  function extrudeSelected(){
    const o=findData(selectedId);
    if(!o||!editSel||!editSel.face){env.notify('先在编辑模式点选一个面，再挤出。');return;}
    const g=meshOf(o.id);const base=g.children[0];
    const geo=base.geometry;
    const pos=geo.getAttribute('position');
    const idx=geo.getIndex();
    const {a,b,c}=editSel.face;
    if(a>=pos.count||b>=pos.count||c>=pos.count)return;
    pushHistory();historyPending=false;
    const normal=new THREE.Vector3();
    const va=new THREE.Vector3().fromBufferAttribute(pos,a),vb=new THREE.Vector3().fromBufferAttribute(pos,b),vc=new THREE.Vector3().fromBufferAttribute(pos,c);
    normal.crossVectors(vb.clone().sub(va),vc.clone().sub(va)).normalize().multiplyScalar(.4);
    const verts=[];for(let i=0;i<pos.count;i++)verts.push(pos.getX(i),pos.getY(i),pos.getZ(i));
    const na=verts.length/3;
    verts.push(va.x+normal.x,va.y+normal.y,va.z+normal.z);
    const nb=na+1,nc=na+2;
    verts.push(vb.x+normal.x,vb.y+normal.y,vb.z+normal.z);
    verts.push(vc.x+normal.x,vc.y+normal.y,vc.z+normal.z);
    const faces=idx?Array.from(idx.array):[...Array(pos.count).keys()];
    /* 原面换成新顶面，补三个侧面 */
    for(let i=0;i<faces.length;i+=3){
      if(faces[i]===a&&faces[i+1]===b&&faces[i+2]===c){faces[i]=na;faces[i+1]=nb;faces[i+2]=nc;break;}
    }
    faces.push(a,b,nb,a,nb,na, b,c,nc,b,nc,nb, c,a,na,c,na,nc);
    const next=new THREE.BufferGeometry();
    next.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    next.setIndex(faces);next.computeVertexNormals();
    base.geometry.dispose();base.geometry=next;
    syncGroupClones(o);
    storeVerts(o,next);
    editSel={vertex:-1,face:{a:na,b:nb,c:nc}};
    buildEditOverlay(o);highlightEdit(o);
    commitSoon();invalidate();
    env.notify('已挤出，继续点「挤出」可以拉长。');
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
    const actions=document.createElement('div');actions.className='model-propactions';
    const dup=document.createElement('button');dup.type='button';dup.textContent='复制';dup.onclick=duplicateSelected;
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='删除';del.onclick=deleteSelected;
    actions.append(dup,del);box.append(actions);
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

  /* ---------- 导出 ---------- */
  function exportGroup(){
    const group=new THREE.Group();
    for(const o of env.getState().objects){
      if(!o.visible)continue;
      const g=meshOf(o.id);if(!g)continue;
      const clone=g.clone(true);
      clone.traverse(c=>{if(c.isMesh)c.material=c.material.clone();});
      group.add(clone);
    }
    return group;
  }
  async function doExport(kind){
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
    }
    for(const b of document.querySelectorAll('.model-modes button')){
      b.onclick=()=>{
        const next=b.dataset.mode;
        if(next==='edit'&&!selectedId){env.notify('先点选一个物体，再进编辑模式。');return;}
        if(mode==='edit'&&next!=='edit'){
          const o=findData(selectedId);
          if(o){const g=meshOf(o.id);if(g)storeVerts(o,g.children[0].geometry);}
          commitSoon();
        }
        if(next!=='object'&&next!=='edit'&&!selectedId){env.notify('先点选一个物体。');return;}
        mode=next;editSel=null;
        const info=$('modelEditInfo');if(info)info.textContent=next==='edit'?'点顶点或面选中，选中后直接拖动；「挤出」沿面拉出新几何':'';
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
    const dupBtn=$('modelDupBtn');if(dupBtn)dupBtn.onclick=duplicateSelected;
    const delBtn=$('modelDeleteBtn');if(delBtn)delBtn.onclick=deleteSelected;
    const extBtn=$('modelExtrudeBtn');if(extBtn)extBtn.onclick=extrudeSelected;
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
    return data.objects.length+' 个物体'+(selectedId?' · 已选中':'');
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