// 口语解析器 v2：纯本地关键词规则，无需联网。第二步可替换为AI大模型接口。
// 预留：window.KOUYU_AI_HOOK = async (text) => {...} 以后接大模型
window.parseKouyu = function (text) {
  const t = text.trim();
  const actions = [];
  const has = (...ws) => ws.some(w => t.includes(w));

  const hasH = has('横着拼', '横向拼', '左右拼');
  const hasV = has('竖着拼', '竖向拼', '上下拼');
  if (hasH) actions.push({ type: 'mode', mode: 'h', tip: '已切换：横着拼' });
  if (hasV) actions.push({ type: 'mode', mode: 'v', tip: '已切换：竖着拼' });
  // 通用“拼起来”只在没指明方向、且不是切图时才按网格处理，避免“横着拼起来”被覆盖、“切四宫格”串到拼接
  if (!hasH && !hasV && !has('切') && has('网格', '四宫格', '拼起来', '拼接')) actions.push({ type: 'mode', mode: 'grid', tip: '已切换：网格拼' });
  if (has('单图', '一张', '精修')) actions.push({ type: 'mode', mode: 'single', tip: '已切换：单图精修' });
  if (has('切四宫', '四宫格切') || (has('切') && has('2x2', '二宫', '四宫'))) actions.push({ type: 'mode', mode: 'cut', cols: 2, rows: 2, tip: '已切换：四宫格切图' });
  else if (has('切图', '切九宫', '九宫格')) actions.push({ type: 'mode', mode: 'cut', cols: 3, rows: 3, tip: '已切换：九宫格切图' });

  if (has('雨天暗黑', '暗色调浓重', '暗黑浓重', '雨天感', '阴雨')) actions.push({ type: 'preset', key: 'rainy_dark', tip: '已套用：雨天暗黑浓重' });
  // “雨天+暗/浓重”分开说也要能命中，比如“雨天再暗一点，有浓重感”
  else if (has('雨天') && has('暗', '浓重', '浓郁', '氛围', '阴')) actions.push({ type: 'preset', key: 'rainy_dark', tip: '已套用：雨天暗黑浓重' });
  if (has('去灰', '通透', '去雾')) actions.push({ type: 'preset', key: 'rainy_clear', tip: '已套用：去灰通透' });
  if (has('胶片', '复古')) actions.push({ type: 'preset', key: 'film', tip: '已套用：胶片暖' });
  if (has('黑白', '高级灰')) actions.push({ type: 'preset', key: 'bw', tip: '已套用：黑白高级' });
  if (has('夜景', '霓虹')) actions.push({ type: 'preset', key: 'neon', tip: '已套用：夜景霓虹' });
  if (has('蓝调')) actions.push({ type: 'preset', key: 'nightblue', tip: '已套用：雨夜蓝调' });
  if (has('人像', '柔光')) actions.push({ type: 'preset', key: 'portrait', tip: '已套用：人像柔光' });
  if (has('美食', '鲜艳', '好吃')) actions.push({ type: 'preset', key: 'food', tip: '已套用：美食鲜艳' });
  if (has('落日', '黄昏', '金色')) actions.push({ type: 'preset', key: 'sunset', tip: '已套用：落日金' });
  if (has('还原', '原图参数', '重来', '清除')) actions.push({ type: 'preset', key: 'none', tip: '已还原' });

  const adj = {};
  if (has('暗一点', '更暗', '压暗', '暗黑')) { adj.brightness = -12; adj.exposure = -10; adj.vignette = 10; }
  if (has('亮一点', '更亮', '提亮')) { adj.brightness = 12; adj.exposure = 10; }
  if (has('浓重', '浓郁', '重一点', '对比强')) { adj.contrast = 12; adj.saturate = -8; }
  if (has('淡一点')) adj.contrast = -10;
  if (has('暖一点', '暖和')) adj.warm = 12;
  if (has('冷一点', '冷色')) adj.warm = -12;
  if (has('颗粒', '胶片感')) adj.grain = 12;
  if (has('暗角', '氛围感')) adj.vignette = 15;
  if (has('曝光高', '曝光多', '曝光亮', '曝光强')) adj.exposure = 15;
  if (has('曝光低', '曝光少', '曝光暗', '曝光弱')) adj.exposure = -15;
  if (has('锐化', '更清晰', '清楚一点', '清晰一点')) adj.sharpen = 15;
  if (has('磨皮', '美颜', '皮肤好', '柔肤')) { adj.soften = 20; }
  if (has('下雨', '雨丝', '雨景')) adj.rain = 30;
  if (has('雾气', '起雾', '朦胧')) adj.fog = 30;
  // 分色微调：颜色词+饱和/明暗（避开预设词：蓝调/黄昏落日/印章贴纸不串）
  const COLMAP = [['红', 'red'], ['橙', 'orange'], ['黄', 'yellow'], ['绿', 'green'], ['青', 'cyan'], ['蓝', 'blue'], ['紫', 'purple'], ['品红', 'magenta'], ['玫红', 'magenta']];
  for(const [w, k] of COLMAP){
    if(!has(w)) continue;
    if(k === 'blue' && has('蓝调')) continue;
    if(k === 'yellow' && has('黄昏', '落日', '金色')) continue;
    if(k === 'red' && has('印章', '贴纸')) continue;
    const d = {};
    if(has('饱和', '鲜艳', '浓')) d.s = 18;
    if(has('灰', '淡', '褪色')) d.s = -18;
    if(has('亮', '提亮', '透')) d.l = 12;
    if(has('暗', '压暗', '沉')) d.l = -12;
    if(Object.keys(d).length){ actions.push({ type: 'hsl', k, d, tip: `已调${w}` }); break; }
  }
  if (Object.keys(adj).length) actions.push({ type: 'adjust', adj, tip: '已按你的话微调' });

  if (has('镜像', '翻转', '反一下')) actions.push({ type: 'flip', tip: '已镜像' });
  if (has('效果弱', '效果轻', '轻一点', '太重了')) actions.push({ type: 'intensity', k: 55, tip: '效果已调轻' });
  if (has('效果强', '效果重')) actions.push({ type: 'intensity', k: 100, tip: '效果已拉满' });

  if (has('旋转') || (has('转一下') && !has('翻转', '镜像'))) actions.push({ type: 'rotate', tip: '已旋转' });
  if (has('视频模式', '打开视频', '切到视频', '视频页')) actions.push({ type: 'vtab', tab: 'vid', tip: '已切到视频' });
  else if (has('回到图片', '图片模式', '切到图片')) actions.push({ type: 'vtab', tab: 'img', tip: '已切回图片' });
  const tm = t.match(/(\d+(?:\.\d+)?)\s*秒?\s*(?:到|[-~～])\s*(\d+(?:\.\d+)?)\s*秒/);
  if (tm) actions.push({ type: 'vtrim', a: +tm[1], b: +tm[2], tip: `已定段 ${tm[1]}-${tm[2]}秒` });
  if (has('设起点', '起点设', '从这里开始')) actions.push({ type: 'vmark', which: 'a', tip: '起点=当前' });
  if (has('设终点', '终点设', '到这里结束')) actions.push({ type: 'vmark', which: 'b', tip: '终点=当前' });
  if (has('背景虚化', '虚化背景', '虚化底')) actions.push({ type: 'bgmode', bg: 'blur', tip: '拼图底已切虚化' });
  else if (has('纯色背景', '纯色底')) actions.push({ type: 'bgmode', bg: 'color', tip: '拼图底已切纯色' });
  if (has('适应窗口', '适应一下', '显示全图')) actions.push({ type: 'zoom', z: 'fit', tip: '已适应窗口' });
  else if (has('100%', '原大小', '实际像素')) actions.push({ type: 'zoom', z: 'one', tip: '已按100%显示' });
  else {
    if (has('放大')) actions.push({ type: 'zoom', z: 'in', tip: '已放大' });
    if (has('缩小', '小一点')) actions.push({ type: 'zoom', z: 'out', tip: '已缩小' });
  }
  if (has('自动增强', '一键增强', '救一下', '救废片')) actions.push({ type: 'auto', tip: '已自动增强' });
  if (has('裁剪', '裁一下', '构图')) actions.push({ type: 'crop', tip: '已进入裁剪，在图上框选' });
  if (has('对比', '原图看看', '看看原图')) actions.push({ type: 'compare', tip: '按住“看原图”可对比' });
  if (has('撤销', '后悔', '上一步')) actions.push({ type: 'undo', tip: '已撤销' });
  if (has('删除这张', '删掉这张', '删除当前')) actions.push({ type: 'delcur', tip: '已删除当前' });
  const hasBatch = has('批量', '全部导出', '一张张导', '打包', 'zip', 'ZIP');
  if (hasBatch) actions.push({ type: 'batch', tip: '开始批量导出' });
  // 批量已含导出，避免“批量导出”触发两次；视频的导出走视频通道
  if (has('视频') && has('导出', '保存', '存')) actions.push({ type: 'vexport', tip: '开始导出视频' });
  else if (!hasBatch && has('导出', '保存', '下载')) actions.push({ type: 'export', tip: '已导出' });
  if (has('视频封面', '封面导出', '存封面')) actions.push({ type: 'vcover', tip: '正在存视频封面' });

  if (has('朋友圈')) actions.push({ type: 'use', use: 'moment', tip: '已切朋友圈设置' });
  else if (has('清晰小图', '小图', '压缩一下', '压小一点')) actions.push({ type: 'use', use: 'small', tip: '已切小图设置' });
  else if (has('打印', '无损', '原图尺寸')) actions.push({ type: 'use', use: 'print', tip: '已切打印存档设置' });

  return actions;
};
