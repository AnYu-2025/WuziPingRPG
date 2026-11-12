/* 天工 · 3D 网格数据操作（纯数据层，不依赖 DOM/three，方便单元测试）
 * 顶点表 verts 为扁平 [x,y,z,...]，faces 为三角形索引 [a,b,c,...]。
 * 所有操作返回新数组，不改输入。 */

export const MAX_EDIT_VERTS=24000;

export function faceKey(a,b,c){return Math.min(a,b,c)+'_'+[a,b,c].sort((x,y)=>x-y).join('_');}

/* 挤出选中面：每个面沿自身法线推出 distance，原面替换为顶面并补侧壁。
 * 返回 {verts,faces,tops}；tops 是新顶面三角形，供继续挤出。 */
export function extrudeFaces(verts,faces,selected,distance){
  const v=verts.slice(),f=faces.slice();
  const originalLen=faces.length;
  const tops=[];
  const chosen=new Set(selected.map(s=>faceKey(s.a,s.b,s.c)));
  const replace=new Map();
  for(const s of selected){
    const {a,b,c}=s;
    const ax=v[a*3],ay=v[a*3+1],az=v[a*3+2];
    const bx=v[b*3],by=v[b*3+1],bz=v[b*3+2];
    const cx=v[c*3],cy=v[c*3+1],cz=v[c*3+2];
    let nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay);
    let ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    let nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const len=Math.hypot(nx,ny,nz)||1;
    nx=nx/len*distance;ny=ny/len*distance;nz=nz/len*distance;
    const na=v.length/3;
    v.push(ax+nx,ay+ny,az+nz, bx+nx,by+ny,bz+nz, cx+nx,cy+ny,cz+nz);
    const nb=na+1,nc=na+2;
    replace.set(faceKey(a,b,c),[na,nb,nc]);
    tops.push({a:na,b:nb,c:nc});
    f.push(a,b,nb, a,nb,na, b,c,nc, b,nc,nb, c,a,na, c,na,nc);
  }
  /* 只替换原始面；新加的侧壁不参与，否则会被误当顶面替换。 */
  for(let i=0;i<originalLen;i+=3){
    const key=faceKey(f[i],f[i+1],f[i+2]);
    if(chosen.has(key)&&replace.has(key)){
      const t=replace.get(key);
      f[i]=t[0];f[i+1]=t[1];f[i+2]=t[2];
      chosen.delete(key);
    }
  }
  return {verts:v,faces:f,tops};
}

/* 内插面：选中面向内收缩 ratio（0~1），原面替换为缩小面并补一圈侧壁。 */
export function insetFaces(verts,faces,selected,ratio){
  const v=verts.slice(),f=faces.slice();
  const originalLen=faces.length;
  const tops=[];
  const chosen=new Set(selected.map(s=>faceKey(s.a,s.b,s.c)));
  const replace=new Map();
  for(const s of selected){
    const {a,b,c}=s;
    const cx=(v[a*3]+v[b*3]+v[c*3])/3,cy=(v[a*3+1]+v[b*3+1]+v[c*3+1])/3,cz=(v[a*3+2]+v[b*3+2]+v[c*3+2])/3;
    const lerp=(i)=>{
      const na=v.length/3;
      v.push(v[i*3]+(cx-v[i*3])*ratio, v[i*3+1]+(cy-v[i*3+1])*ratio, v[i*3+2]+(cz-v[i*3+2])*ratio);
      return na;
    };
    const na=lerp(a),nb=lerp(b),nc=lerp(c);
    replace.set(faceKey(a,b,c),[na,nb,nc]);
    tops.push({a:na,b:nb,c:nc});
    f.push(a,b,nb, a,nb,na, b,c,nc, b,nc,nb, c,a,na, c,na,nc);
  }
  for(let i=0;i<originalLen;i+=3){
    const key=faceKey(f[i],f[i+1],f[i+2]);
    if(chosen.has(key)&&replace.has(key)){
      const t=replace.get(key);
      f[i]=t[0];f[i+1]=t[1];f[i+2]=t[2];
      chosen.delete(key);
    }
  }
  return {verts:v,faces:f,tops};
}

/* 删除选中面；可选丢弃不再被引用的孤立顶点。返回 {verts,faces}。 */
export function deleteFaces(verts,faces,selected,{dropOrphans=true}={}){
  const chosen=new Set(selected.map(s=>faceKey(s.a,s.b,s.c)));
  const kept=[];
  for(let i=0;i<faces.length;i+=3){
    if(!chosen.has(faceKey(faces[i],faces[i+1],faces[i+2])))kept.push(faces[i],faces[i+1],faces[i+2]);
  }
  if(!dropOrphans)return {verts:verts.slice(),faces:kept};
  const used=new Set(kept);
  const remap=new Map();
  const v=[];
  for(let i=0;i<verts.length/3;i++){
    if(!used.has(i))continue;
    remap.set(i,v.length/3);
    v.push(verts[i*3],verts[i*3+1],verts[i*3+2]);
  }
  return {verts:v,faces:kept.map(i=>remap.get(i))};
}

/* 焊接重合顶点（距离 < tolerance），重建面索引，丢弃退化三角形。 */
export function weldVertices(verts,faces,tolerance=1e-4){
  const tol2=tolerance*tolerance;
  const remap=new Array(verts.length/3);
  const v=[];
  for(let i=0;i<verts.length/3;i++){
    const x=verts[i*3],y=verts[i*3+1],z=verts[i*3+2];
    let found=-1;
    for(let j=0;j<v.length/3;j++){
      const dx=v[j*3]-x,dy=v[j*3+1]-y,dz=v[j*3+2]-z;
      if(dx*dx+dy*dy+dz*dz<tol2){found=j;break;}
    }
    if(found>=0)remap[i]=found;
    else{remap[i]=v.length/3;v.push(x,y,z);}
  }
  const f=[];
  const seen=new Set();
  for(let i=0;i<faces.length;i+=3){
    const a=remap[faces[i]],b=remap[faces[i+1]],c=remap[faces[i+2]];
    if(a===b||b===c||a===c)continue;
    const key=faceKey(a,b,c);
    if(seen.has(key))continue;
    seen.add(key);
    f.push(a,b,c);
  }
  return {verts:v,faces:f,welded:verts.length/3-v.length/3};
}

/* 贪心面数简化：每轮合并代价最小（边长最短）的相邻顶点对，直到面数达标。
 * 代价用边长平方近似；保持拓扑流形不做严格校验，手机场景够用。 */
export function simplifyMesh(verts,faces,targetFaces){
  let v=verts.slice(),f=faces.slice();
  if(f.length/3<=targetFaces)return {verts:v,faces:f};
  let guard=0;
  while(f.length/3>targetFaces&&guard++<20000){
    /* 统计每个顶点的邻接面与邻居 */
    const neighbors=new Map();
    const addN=(a,b)=>{if(!neighbors.has(a))neighbors.set(a,new Set());neighbors.get(a).add(b);};
    for(let i=0;i<f.length;i+=3){
      const a=f[i],b=f[i+1],c=f[i+2];
      addN(a,b);addN(a,c);addN(b,a);addN(b,c);addN(c,a);addN(c,b);
    }
    /* 找最短边 */
    let best=-1,bestJ=-1,bestD=Infinity;
    for(const [a,set] of neighbors){
      for(const b of set){
        if(b<=a)continue;
        const dx=v[a*3]-v[b*3],dy=v[a*3+1]-v[b*3+1],dz=v[a*3+2]-v[b*3+2];
        const d=dx*dx+dy*dy+dz*dz;
        if(d<bestD){bestD=d;best=a;bestJ=b;}
      }
    }
    if(best<0)break;
    /* b 并入 a（取中点），重写索引，丢退化面 */
    v[best*3]=(v[best*3]+v[bestJ*3])/2;
    v[best*3+1]=(v[best*3+1]+v[bestJ*3+1])/2;
    v[best*3+2]=(v[best*3+2]+v[bestJ*3+2])/2;
    const nf=[];
    for(let i=0;i<f.length;i+=3){
      const tri=[f[i],f[i+1],f[i+2]].map(x=>x===bestJ?best:x);
      if(tri[0]===tri[1]||tri[1]===tri[2]||tri[0]===tri[2])continue;
      nf.push(tri[0],tri[1],tri[2]);
    }
    f=nf;
    /* 压缩顶点表 */
    const used=new Set(f);
    const remap=new Map();
    const nv=[];
    for(let i=0;i<v.length/3;i++){
      if(!used.has(i))continue;
      remap.set(i,nv.length/3);
      nv.push(v[i*3],v[i*3+1],v[i*3+2]);
    }
    v=nv;f=f.map(i=>remap.get(i));
  }
  return {verts:v,faces:f};
}

/* 从面表提取唯一边（无向，a<b）。 */
export function uniqueEdges(faces){
  const seen=new Set();
  const out=[];
  for(let i=0;i<faces.length;i+=3){
    const tri=[faces[i],faces[i+1],faces[i+2]];
    for(let j=0;j<3;j++){
      const a=tri[j],b=tri[(j+1)%3];
      const lo=Math.min(a,b),hi=Math.max(a,b);
      const key=lo+'_'+hi;
      if(seen.has(key))continue;
      seen.add(key);
      out.push([lo,hi]);
    }
  }
  return out;
}

/* 从 three 几何体（索引或非索引）提取 {verts,faces}。 */
export function extractGeometry(geometry){
  const pos=geometry.getAttribute('position');
  if(!pos)return null;
  const idx=geometry.getIndex();
  const verts=new Array(pos.count*3);
  for(let i=0;i<pos.count;i++){verts[i*3]=pos.getX(i);verts[i*3+1]=pos.getY(i);verts[i*3+2]=pos.getZ(i);}
  const faces=idx?Array.from(idx.array):[...Array(pos.count).keys()];
  return {verts,faces};
}

/* 按连通分量把网格拆成多个独立部件（共享顶点的三角形算同一块）。
 * 返回 [{verts,faces}]，每块顶点已压缩重映射；孤立顶点丢弃。
 * 空网格返回 []。 */
export function separateComponents(verts,faces){
  const n=verts.length/3;
  if(!n||!faces.length)return [];
  /* 并查集：把每个三角形的三个顶点并到一起。 */
  const parent=new Array(n);
  for(let i=0;i<n;i++)parent[i]=i;
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const union=(a,b)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent[ra]=rb;};
  for(let i=0;i<faces.length;i+=3)union(faces[i],faces[i+1]),union(faces[i],faces[i+2]);
  /* 按根分组三角形。 */
  const groups=new Map();
  for(let i=0;i<faces.length;i+=3){
    const root=find(faces[i]);
    if(!groups.has(root))groups.set(root,[]);
    groups.get(root).push(faces[i],faces[i+1],faces[i+2]);
  }
  const out=[];
  for(const gf of groups.values()){
    const used=new Set(gf);
    const remap=new Map();
    const v=[];
    for(let i=0;i<n;i++){
      if(!used.has(i))continue;
      remap.set(i,v.length/3);
      v.push(verts[i*3],verts[i*3+1],verts[i*3+2]);
    }
    out.push({verts:v,faces:gf.map(i=>remap.get(i))});
  }
  return out;
}

/* 翻转法线：交换每个三角形后两个顶点，绕序反向 → 法线朝里/朝外翻转。
 * 顶点不变。用于导入模型法线朝内、或想翻面时。 */
export function flipNormals(verts,faces){
  const f=faces.slice();
  for(let i=0;i<f.length;i+=3){const t=f[i+1];f[i+1]=f[i+2];f[i+2]=t;}
  return {verts:verts.slice(),faces:f};
}