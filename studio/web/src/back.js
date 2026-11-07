/* 返回键的分层决策。
   宿主（EditorActivity.onBackPressed）只调 window.Studio.back()，
   不再自己内联那一串 DOM 判断——两套逻辑一定会漂移。上次真机上
   画板收尾、搜索面板关闭、逐层返回全部失效，就是因为宿主判断的是
   另一套入口，而测试打的恰好是页面这套。

   层级（从最上层开始，命中即停）：
     弹窗 → 文件抽屉 → 画板 → 搜索面板 → 首页 → 游戏大厅 → 编辑器
   编辑器里按返回先回首页；首页里按返回才是「退出」，
   所以连按两下返回就是从编辑器退出（双击退出），且中途不会被弹窗吞掉。 */

export const BACK={
  DIALOG:'dialog',
  DRAWER:'drawer',
  DRAW:'draw',
  SEARCH:'search',
  LOUNGE:'lounge',
  HOME:'home',
  OPEN:'open'
};

export function resolveBack(ctx){
  const value=ctx&&typeof ctx==='object'?ctx:{};
  if(value.dialogOpen)return {action:BACK.DIALOG};
  if(value.drawerOpen)return {action:BACK.DRAWER};
  if(value.drawing)return {action:BACK.DRAW};
  if(value.searchOpen)return {action:BACK.SEARCH};
  if(value.homeOpen)return {action:BACK.HOME};
  if(value.loungeOpen)return {action:BACK.LOUNGE};
  return {action:BACK.OPEN};
}
