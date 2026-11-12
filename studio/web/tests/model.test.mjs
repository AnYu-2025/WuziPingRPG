import test from 'node:test';
import assert from 'node:assert/strict';
import {modelSanitize} from '../src/model3d.js';

test('empty or malformed scene data falls back to a blank scene',()=>{
  for(const raw of [null,undefined,{},[],{objects:'nope'},{version:9}]){
    const s=modelSanitize(raw);
    assert.equal(s.version,1);
    assert.ok(Array.isArray(s.objects));
    assert.ok(Number.isInteger(s.nextId)&&s.nextId>=1);
  }
  assert.deepEqual(modelSanitize(null).objects,[]);
  assert.equal(modelSanitize(null).camera,null);
});

test('unknown primitive types and non-object entries are dropped',()=>{
  const s=modelSanitize({objects:[{type:'nope'},{type:'cube'},null,42,{type:'sphere'}]});
  assert.deepEqual(s.objects.map(o=>o.type),['cube','sphere']);
});

test('transforms are clamped and invalid numbers fall back',()=>{
  const s=modelSanitize({objects:[{type:'cube',pos:['x',2,9999],rot:[NaN,0,0],scl:[0,-5,1]}]});
  const o=s.objects[0];
  assert.deepEqual(o.pos,[0,2,500]);
  assert.deepEqual(o.rot,[0,0,0]);
  assert.deepEqual(o.scl,[.02,.02,1]);
});

test('duplicate ids are made unique and nextId stays ahead',()=>{
  const s=modelSanitize({nextId:2,objects:[{type:'cube',id:1},{type:'sphere',id:1},{type:'cone',id:7}]});
  const ids=s.objects.map(o=>o.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.ok(s.nextId>Math.max(...ids));
});

test('nextId survives a large object list without call-stack overflow',()=>{
  const objects=[];
  for(let i=1;i<=60;i++)objects.push({type:'cube',id:i});
  const s=modelSanitize({nextId:1,objects});
  assert.equal(s.objects.length,60);
  assert.equal(s.nextId,61);
});

test('custom vertices keep valid face indices and drop invalid ones',()=>{
  const verts=[0,0,0,1,0,0,0,1,0,0,0,1];
  const good=modelSanitize({objects:[{type:'cube',verts,faces:[0,1,2,0,2,3]}]});
  assert.deepEqual(good.objects[0].faces,[0,1,2,0,2,3]);
  const bad=modelSanitize({objects:[{type:'cube',verts,faces:[0,1,99]}]});
  assert.equal(bad.objects[0].faces,null);
  const short=modelSanitize({objects:[{type:'cube',verts:[1,2,3]}]});
  assert.equal(short.objects[0].verts,null);
});

test('camera survives only as two finite 3-vectors',()=>{
  const ok=modelSanitize({camera:{pos:[3,2,4],target:[0,.5,0]}});
  assert.deepEqual(ok.camera,{pos:[3,2,4],target:[0,.5,0]});
  for(const camera of [{pos:[1,2]},{pos:[1,2,3]},{pos:[NaN,0,0],target:[0,0,0]},{pos:'x',target:'y'}]){
    assert.equal(modelSanitize({camera}).camera,null);
  }
  const huge=modelSanitize({camera:{pos:[1e9,0,0],target:[0,0,0]}});
  assert.deepEqual(huge.camera.pos,[1000,0,0]);
});

test('modifiers are bounded and colors validated',()=>{
  const s=modelSanitize({objects:[{type:'cube',color:'zzz',metal:5,rough:-1,mods:{mirror:true,array:99,subdiv:9}}]});
  const o=s.objects[0];
  assert.match(o.color,/^#[0-9a-fA-F]{6}$/);
  assert.equal(o.metal,1);
  assert.equal(o.rough,0);
  assert.deepEqual(o.mods,{mirror:true,array:6,subdiv:2});
});

test('sanitize is idempotent',()=>{
  const raw={nextId:5,objects:[{type:'torus',id:3,name:'  甜甜圈  ',pos:[1,2,3],mods:{array:2}}],camera:{pos:[3,2,4],target:[0,0,0]}};
  const once=modelSanitize(raw);
  const twice=modelSanitize(once);
  assert.deepEqual(twice,once);
});

test('flat shading flag is boolean and defaults false',()=>{
  assert.equal(modelSanitize({objects:[{type:'cube'}]}).objects[0].flat,false);
  assert.equal(modelSanitize({objects:[{type:'cube',flat:true}]}).objects[0].flat,true);
  assert.equal(modelSanitize({objects:[{type:'cube',flat:'yes'}]}).objects[0].flat,false);
});

test('imported mesh type requires vertex data and allows larger meshes',()=>{
  /* 没有顶点的 mesh 被丢弃 */
  assert.equal(modelSanitize({objects:[{type:'mesh'}]}).objects.length,0);
  /* 带顶点面表的 mesh 保留 */
  const verts=[0,0,0,1,0,0,0,0,1];
  const ok=modelSanitize({objects:[{type:'mesh',verts,faces:[0,1,2]}]});
  assert.equal(ok.objects.length,1);
  assert.equal(ok.objects[0].type,'mesh');
  assert.deepEqual(ok.objects[0].faces,[0,1,2]);
  /* 超过普通编辑上限但在 mesh 上限内的顶点数被接受 */
  const big=new Array(30000*3).fill(0);
  const bigMesh=modelSanitize({objects:[{type:'mesh',verts:big}]});
  assert.equal(bigMesh.objects.length,1);
  /* 超过 mesh 上限则丢弃顶点数据，mesh 无顶点被整体丢弃 */
  const huge=new Array(70000*3).fill(0);
  assert.equal(modelSanitize({objects:[{type:'mesh',verts:huge}]}).objects.length,0);
});