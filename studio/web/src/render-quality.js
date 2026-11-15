/* 天工 · 渲染质量自适应（纯逻辑，可单测）
 * 黑洞光线步进逐像素开销大；弱机自动降步长与分辨率，强机回升。
 * 档位 high→low；auto 模式带滞回，避免档位来回跳。 */
export const QUALITY_TIERS=[
  {id:'high',steps:72,px:2},
  {id:'med',steps:48,px:1.5},
  {id:'low',steps:32,px:1}
];
export const QUALITY_MODES=['auto','high','med','low'];
export function qualitySanitize(raw){return QUALITY_MODES.includes(raw)?raw:'auto';}
export function tierIndexOf(id){const i=QUALITY_TIERS.findIndex(t=>t.id===id);return i<0?0:i;}
/* 每秒评估一次：fps 持续低→降一档；持续高→升一档。
   holds 记连续命中次数：降档需 2 次、升档需 3 次，防单帧抖动与频繁升降。 */
export function autoTierStep(tier,fps,holds){
  const h={low:(holds&&holds.low)||0,high:(holds&&holds.high)||0};
  let next=tier;
  if(fps<42){h.low++;h.high=0;}
  else if(fps>57){h.high++;h.low=0;}
  else{h.low=0;h.high=0;}
  if(h.low>=2&&tier<QUALITY_TIERS.length-1){next=tier+1;h.low=0;h.high=0;}
  else if(h.high>=3&&tier>0){next=tier-1;h.low=0;h.high=0;}
  return {tier:next,holds:h};
}