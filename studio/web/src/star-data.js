/* 天工 · 星穹偏好数据清洗（纯数据，不依赖 three/DOM）。
 * 主 bundle 用它读写草稿；星穹渲染层在 star-home.js 里复用。 */
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function starSanitize(raw,knownIds){
  const r=raw&&typeof raw==='object'?raw:{};
  const known=new Set(Array.isArray(knownIds)?knownIds:[]);
  const starred=Array.isArray(r.starred)?[...new Set(r.starred.filter(id=>known.has(id)))]:[];
  return {starred,motion:r.motion!==false,view:r.view==='list'?'list':'sky'};
}
export {clamp};