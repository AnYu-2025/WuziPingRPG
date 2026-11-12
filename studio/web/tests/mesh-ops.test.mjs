import test from 'node:test';
import assert from 'node:assert/strict';
import {extrudeFaces,insetFaces,deleteFaces,weldVertices,simplifyMesh,faceKey,uniqueEdges,separateComponents,flipNormals,mergeObjects,recenterOrigin,transformPoint} from '../src/mesh-ops.js';

/* 单个朝上的三角形 */
const TRI={verts:[0,0,0, 1,0,0, 0,0,1],faces:[0,1,2]};
/* 两个三角形拼成的正方形（共享边 1-2） */
const QUAD={verts:[0,0,0, 1,0,0, 1,0,1, 0,0,1],faces:[0,1,2, 0,2,3]};

function triCount(faces){return faces.length/3;}
function validIndices(verts,faces){
  const n=verts.length/3;
  return faces.every(i=>Number.isInteger(i)&&i>=0&&i<n);
}

test('extrude one face: adds 3 verts, replaces top, adds 6 side triangles',()=>{
  const r=extrudeFaces(TRI.verts,TRI.faces,[{a:0,b:1,c:2}],.4);
  assert.equal(r.verts.length/3,6);
  /* 1 顶面 + 3 条边 × 2 个侧壁三角形 = 7 */
  assert.equal(triCount(r.faces),7);
  assert.ok(validIndices(r.verts,r.faces));
  assert.equal(r.tops.length,1);
  /* 顶面沿面自身法线推出：(1,0,0)×(0,0,1) = (0,-1,0)，即 -Y */
  const top=r.tops[0];
  assert.ok(Math.abs(r.verts[top.a*3+1]+.4)<1e-9);
  /* 输入不被修改 */
  assert.equal(TRI.verts.length,9);
});

test('extrude two adjacent faces keeps shared wall consistent',()=>{
  const sel=[{a:0,b:1,c:2},{a:0,b:2,c:3}];
  const r=extrudeFaces(QUAD.verts,QUAD.faces,sel,.5);
  assert.equal(r.verts.length/3,4+6);
  /* 2 顶面 + 2 面 × 6 侧壁 = 14 */
  assert.equal(triCount(r.faces),2+12);
  assert.ok(validIndices(r.verts,r.faces));
  assert.equal(r.tops.length,2);
});

test('extrude with empty selection is a no-op copy',()=>{
  const r=extrudeFaces(TRI.verts,TRI.faces,[],.4);
  assert.deepEqual(r.verts,TRI.verts);
  assert.deepEqual(r.faces,TRI.faces);
});

test('inset shrinks face toward centroid and keeps wall ring',()=>{
  const r=insetFaces(TRI.verts,TRI.faces,[{a:0,b:1,c:2}],.5);
  assert.equal(r.verts.length/3,6);
  assert.equal(triCount(r.faces),7);
  const top=r.tops[0];
  /* 新顶点在原顶点与重心之间 */
  const cx=1/3,cz=1/3;
  const nx=r.verts[top.a*3],nz=r.verts[top.a*3+2];
  assert.ok(Math.abs(nx-cx/2)<1e-9&&Math.abs(nz-cz/2)<1e-9);
});

test('delete face drops orphans and remaps indices',()=>{
  const r=deleteFaces(QUAD.verts,QUAD.faces,[{a:0,b:1,c:2}]);
  assert.equal(triCount(r.faces),1);
  assert.equal(r.verts.length/3,3);
  assert.ok(validIndices(r.verts,r.faces));
});

test('delete face can keep orphan vertices',()=>{
  const r=deleteFaces(QUAD.verts,QUAD.faces,[{a:0,b:1,c:2}],{dropOrphans:false});
  assert.equal(triCount(r.faces),1);
  assert.equal(r.verts.length/3,4);
});

test('weld merges coincident vertices and drops degenerate faces',()=>{
  /* 顶点 3 与 0 重合；面 (0,1,3) 焊接后退化 */
  const verts=[0,0,0, 1,0,0, 0,0,1, 0,0,0];
  const faces=[0,1,2, 0,1,3];
  const r=weldVertices(verts,faces,1e-4);
  assert.equal(r.welded,1);
  assert.equal(r.verts.length/3,3);
  assert.equal(triCount(r.faces),1);
  assert.ok(validIndices(r.verts,r.faces));
});

test('weld dedupes identical faces regardless of winding',()=>{
  const verts=[0,0,0, 1,0,0, 0,0,1];
  const faces=[0,1,2, 2,0,1];
  const r=weldVertices(verts,faces);
  assert.equal(triCount(r.faces),1);
});

test('simplify reduces face count and stays valid',()=>{
  /* 8 面的扇形网格 */
  const verts=[0,0,0];
  const faces=[];
  const N=8;
  for(let i=0;i<N;i++){
    const a=i/N*Math.PI*2,b=(i+1)/N*Math.PI*2;
    verts.push(Math.cos(a),0,Math.sin(a));
    verts.push(Math.cos(b),0,Math.sin(b));
  }
  /* 用共享环顶点重建 */
  const ring=[0];
  const v2=[0,0,0];
  for(let i=0;i<N;i++){const a=i/N*Math.PI*2;v2.push(Math.cos(a),0,Math.sin(a));ring.push(i+1);}
  const f2=[];
  for(let i=0;i<N;i++)f2.push(0,ring[i+1],ring[(i+1)%N+1]);
  const r=simplifyMesh(v2,f2,4);
  assert.ok(triCount(r.faces)<=4,triCount(r.faces));
  assert.ok(triCount(r.faces)>=1);
  assert.ok(validIndices(r.verts,r.faces));
});

test('simplify below target is a no-op',()=>{
  const r=simplifyMesh(TRI.verts,TRI.faces,10);
  assert.deepEqual(r.faces,TRI.faces);
});

test('faceKey is winding-independent',()=>{
  assert.equal(faceKey(0,1,2),faceKey(2,0,1));
  assert.notEqual(faceKey(0,1,2),faceKey(0,1,3));
});

test('uniqueEdges dedupes shared edges with a<b ordering',()=>{
  /* 两个三角形共享边 1-2：共 5 条唯一边 */
  const edges=uniqueEdges([0,1,2, 0,2,3]);
  assert.equal(edges.length,5);
  for(const [a,b] of edges)assert.ok(a<b);
  assert.ok(edges.some(([a,b])=>a===1&&b===2));
  assert.deepEqual(uniqueEdges([]),[]);
});

test('separateComponents splits disconnected islands',()=>{
  /* 两个不相连的三角形：顶点 0,1,2 与 3,4,5 */
  const verts=[0,0,0, 1,0,0, 0,0,1, 5,0,5, 6,0,5, 5,0,6];
  const faces=[0,1,2, 3,4,5];
  const parts=separateComponents(verts,faces);
  assert.equal(parts.length,2);
  for(const p of parts){
    assert.equal(p.verts.length/3,3);
    assert.equal(p.faces.length,3);
    assert.ok(validIndices(p.verts,p.faces));
  }
  /* 第一块坐标应还原为原始三角形 */
  assert.deepEqual(parts[0].verts,[0,0,0, 1,0,0, 0,0,1]);
});

test('separateComponents keeps connected mesh as one part',()=>{
  const parts=separateComponents(QUAD.verts,QUAD.faces);
  assert.equal(parts.length,1);
  assert.equal(parts[0].verts.length/3,4);
  assert.equal(triCount(parts[0].faces),2);
});

test('separateComponents drops orphan vertices and handles empty',()=>{
  /* 顶点 3 不被任何面引用 */
  const verts=[0,0,0, 1,0,0, 0,0,1, 9,9,9];
  const parts=separateComponents(verts,[0,1,2]);
  assert.equal(parts.length,1);
  assert.equal(parts[0].verts.length/3,3);
  assert.deepEqual(separateComponents([],[]),[]);
  assert.deepEqual(separateComponents([0,0,0],[]),[]);
});

test('flipNormals reverses winding without moving vertices',()=>{
  const r=flipNormals(TRI.verts,TRI.faces);
  assert.deepEqual(r.verts,TRI.verts);
  assert.deepEqual(r.faces,[0,2,1]);
  /* 翻转两次回到原样 */
  const twice=flipNormals(r.verts,r.faces);
  assert.deepEqual(twice.faces,TRI.faces);
  /* 输入不被修改 */
  assert.deepEqual(TRI.faces,[0,1,2]);
});

test('transformPoint applies scale then rotation (no translation)',()=>{
  /* 无旋转：只缩放 */
  assert.deepEqual(transformPoint([1,2,3],[0,0,0],[2,2,2]),[2,4,6]);
  /* 绕 Z 转 90°：(1,0,0)→(0,1,0) */
  const r=transformPoint([1,0,0],[0,0,Math.PI/2],[1,1,1]);
  assert.ok(Math.abs(r[0])<1e-9&&Math.abs(r[1]-1)<1e-9&&Math.abs(r[2])<1e-9);
  /* 绕 X 转 90°：(0,1,0)→(0,0,1) */
  const rx=transformPoint([0,1,0],[Math.PI/2,0,0],[1,1,1]);
  assert.ok(Math.abs(rx[1])<1e-9&&Math.abs(rx[2]-1)<1e-9);
});

test('mergeObjects bakes transforms and offsets indices',()=>{
  const a={verts:[0,0,0, 1,0,0, 0,0,1],faces:[0,1,2],pos:[0,0,0],rot:[0,0,0],scl:[1,1,1]};
  const b={verts:[0,0,0, 1,0,0, 0,0,1],faces:[0,1,2],pos:[5,0,0],rot:[0,0,0],scl:[1,1,1]};
  const m=mergeObjects([a,b]);
  assert.equal(m.verts.length/3,6);
  assert.equal(m.faces.length,6);
  assert.ok(validIndices(m.verts,m.faces));
  /* 第二块顶点应平移 +5 */
  assert.equal(m.verts[3*3],5);
  /* 第二块面索引应偏移 +3 */
  assert.deepEqual(m.faces.slice(3),[3,4,5]);
});

test('mergeObjects handles empty and skips invalid parts',()=>{
  assert.deepEqual(mergeObjects([]),{verts:[],faces:[]});
  assert.deepEqual(mergeObjects([null,{verts:[0,0,0]}]),{verts:[],faces:[]});
});

test('recenterOrigin centers bbox and returns offset',()=>{
  /* 三角形 x:0..1 y:0 z:0..1 → 中心 (0.5,0,0.5) */
  const r=recenterOrigin(TRI.verts,TRI.faces);
  assert.deepEqual(r.center,[0.5,0,0.5]);
  assert.equal(r.verts.length,9);
  /* 新顶点 bbox 中心应为 0 */
  let minx=Infinity,maxx=-Infinity;
  for(let i=0;i<r.verts.length;i+=3){minx=Math.min(minx,r.verts[i]);maxx=Math.max(maxx,r.verts[i]);}
  assert.ok(Math.abs((minx+maxx)/2)<1e-9);
  assert.deepEqual(r.faces,TRI.faces);
  /* 输入不被修改 */
  assert.equal(TRI.verts[0],0);
});

test('recenterOrigin on empty returns zero center',()=>{
  const r=recenterOrigin([],[]);
  assert.deepEqual(r.center,[0,0,0]);
  assert.deepEqual(r.verts,[]);
});