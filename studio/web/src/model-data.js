/* 天工 · 3D 场景数据清洗（纯数据，不依赖 three/DOM）。
 * 主 bundle 用它读写草稿；three 渲染层在 model3d.js 里复用同一份逻辑，
 * 保证旧设备主界面不加载 three 也能正常保存/恢复场景。 */
const MAX_OBJECTS=60,MAX_VERTS=24000,MAX_MESH_VERTS=60000;
const PRIMS={cube:1,sphere:1,cylinder:1,cone:1,torus:1,plane:1,ico:1,capsule:1,torusKnot:1,tetra:1,octa:1};
const PALETTE=['#4f8f7b','#c2703e','#5b7fc7','#b04a5a','#8a6fc0','#c7a24b','#657a86','#d8d2c4'];
const num=(v,fallback=0)=>Number.isFinite(+v)?+v:fallback;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const DEFAULT_SCENE=()=>({version:1,nextId:1,objects:[],camera:null});

export function modelSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:DEFAULT_SCENE();
  const objects=[];
  for(const item of Array.isArray(r.objects)?r.objects.slice(0,MAX_OBJECTS):[]){
    if(!item||typeof item!=='object'||(!PRIMS[item.type]&&item.type!=='mesh'&&item.type!=='light'))continue;
    if(item.type==='mesh'&&(!Array.isArray(item.verts)||item.verts.length<9))continue;
    const id=Math.max(1,Math.floor(num(item.id,objects.length+1)));
    const pos=Array.isArray(item.pos)?item.pos.map(v=>clamp(num(v),-500,500)):null;
    const rot=Array.isArray(item.rot)?item.rot.map(v=>num(v)):null;
    const scl=Array.isArray(item.scl)?item.scl.map(v=>clamp(num(v,1),.02,50)):null;
    const vertLimit=item.type==='mesh'?MAX_MESH_VERTS:MAX_VERTS;
    const verts=Array.isArray(item.verts)&&item.verts.length>=9&&item.verts.length<=vertLimit*3&&item.verts.length%3===0&&item.verts.every(v=>Number.isFinite(+v))?item.verts.map(v=>+v):null;
    if(item.type==='mesh'&&!verts)continue;
    const vertCount=verts?verts.length/3:0;
    const faces=verts&&Array.isArray(item.faces)&&item.faces.length>=3&&item.faces.length%3===0&&item.faces.length<=vertLimit*12&&item.faces.every(v=>Number.isInteger(v)&&v>=0&&v<vertCount)?item.faces.slice():null;
    objects.push({
      id,type:item.type,
      name:typeof item.name==='string'&&item.name.trim()?item.name.slice(0,30):(item.type==='mesh'?'导入模型':item.type==='light'?'灯光':item.type),
      pos:pos&&pos.length===3?pos:[0,.5,0],
      rot:rot&&rot.length===3?rot:[0,0,0],
      scl:scl&&scl.length===3?scl:[1,1,1],
      color:/^#[0-9a-fA-F]{6}$/.test(item.color)?item.color:PALETTE[objects.length%PALETTE.length],
      metal:clamp(num(item.metal,0),0,1),rough:clamp(num(item.rough,.65),0,1),
      flat:item.flat===true,
      visible:item.visible!==false,
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
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const o of objects)nextId=Math.max(nextId,o.id+1);
  const vec3=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(+x))?v.map(x=>clamp(+x,-1000,1000)):null;
  const camPos=r.camera&&typeof r.camera==='object'?vec3(r.camera.pos):null;
  const camTarget=r.camera&&typeof r.camera==='object'?vec3(r.camera.target):null;
  const cam=camPos&&camTarget?{pos:camPos,target:camTarget}:null;
  return {version:1,nextId,objects,camera:cam};
}