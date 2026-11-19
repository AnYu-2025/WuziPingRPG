/* 读写旧版工作区备份中的星穹偏好。 */
export function starSanitize(raw,knownIds){
  const r=raw&&typeof raw==='object'?raw:{};
  const known=new Set(Array.isArray(knownIds)?knownIds:[]);
  const starred=Array.isArray(r.starred)?[...new Set(r.starred.filter(id=>known.has(id)))]:[];
  return {starred,motion:r.motion!==false,view:r.view==='list'?'list':'sky'};
}
