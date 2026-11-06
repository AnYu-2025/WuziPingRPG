export const BACK={
  DIALOG:'dialog',
  DRAWER:'drawer',
  DRAW:'draw',
  SEARCH:'search',
  LANDING:'landing',
  DOUBLE:'double',
  PASS:'pass'
};

export function resolveBack(ctx){
  const value=ctx&&typeof ctx==='object'?ctx:{};
  const now=Number.isFinite(value.now)?value.now:0;
  const lastBackAt=Number.isFinite(value.lastBackAt)?value.lastBackAt:0;
  const windowMs=Number.isFinite(value.doubleWindowMs)?value.doubleWindowMs:2000;
  if(value.dialogOpen)return {action:BACK.DIALOG,nextLastBackAt:0};
  if(value.drawerOpen)return {action:BACK.DRAWER,nextLastBackAt:0};
  if(value.drawing)return {action:BACK.DRAW,nextLastBackAt:0};
  if(value.searchOpen)return {action:BACK.SEARCH,nextLastBackAt:0};
  if(value.landingOpen)return {action:BACK.LANDING,nextLastBackAt:now};
  if(now-lastBackAt<=windowMs)return {action:BACK.DOUBLE,nextLastBackAt:0};
  return {action:BACK.LANDING,nextLastBackAt:now};
}
