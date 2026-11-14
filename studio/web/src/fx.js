/* 天工 · 跃迁转场控制器
 * 只管 DOM 类名与计时，不碰业务状态；样式全在 fx.css。
 * 门控：html[data-fx="on"] + prefers-reduced-motion。关闭时所有函数都是空操作，
 * 界面行为与旧版一致。重复调用会取消上一次计时，不会叠加动画或泄漏定时器。 */

const FX_KEY='ember-studio-fx-v1';
let warpEl=null,bootEl=null,warpTimer=0,inTimer=0,bootTimer=0;
const inTargets=new Map();

export function fxPreferred(){
  try{return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}catch(e){return false;}
}
export function fxStored(){
  try{const v=localStorage.getItem(FX_KEY);return v==='off'?false:true;}catch(e){return true;}
}
export function fxEnabled(){
  return document.documentElement.getAttribute('data-fx')==='on'&&!fxPreferred();
}
export function setFx(on,persist=true){
  const enabled=!!on&&!fxPreferred();
  document.documentElement.setAttribute('data-fx',enabled?'on':'off');
  if(persist){try{localStorage.setItem(FX_KEY,enabled?'on':'off');}catch(e){}}
  if(!enabled)clearFx();
  return enabled;
}
/* 首屏绘制前调用：只读偏好，不写存储。 */
export function fxBoot(){
  document.documentElement.setAttribute('data-fx',fxStored()&&!fxPreferred()?'on':'off');
}

function ensureWarp(){
  if(warpEl&&warpEl.isConnected)return warpEl;
  warpEl=document.getElementById('fxWarp');
  if(!warpEl){
    warpEl=document.createElement('div');
    warpEl.id='fxWarp';warpEl.setAttribute('aria-hidden','true');
    for(const cls of ['fx-veil','fx-grain','fx-band','fx-scan','fx-edge']){
      const i=document.createElement('i');i.className=cls;warpEl.append(i);
    }
    document.body.append(warpEl);
  }
  return warpEl;
}

/* 跃迁扫描：覆盖层走一遍，中途不阻塞业务切换。 */
export function warp(){
  if(!fxEnabled())return;
  const el=ensureWarp();
  clearTimeout(warpTimer);
  el.classList.remove('fx-run');
  /* 强制回流以重启动画 */
  void el.offsetWidth;
  el.classList.add('fx-run');
  warpTimer=setTimeout(()=>{el.classList.remove('fx-run');},600);
}

/* 面板实体化 + 子元素错峰。target 为元素或 id。 */
export function materialize(target,staggerSelector){
  if(!fxEnabled())return;
  const el=typeof target==='string'?document.getElementById(target):target;
  if(!el)return;
  const prev=inTargets.get(el);
  if(prev)clearTimeout(prev);
  el.classList.remove('fx-in');
  void el.offsetWidth;
  el.classList.add('fx-in');
  /* HUD 角标只贴在里面的实体卡片上，不盖住整块面板 */
  hudMark(el);
  if(staggerSelector){
    const kids=el.querySelectorAll(staggerSelector);
    let i=0;
    for(const kid of kids){
      if(i>=14)break;
      kid.style.setProperty('--fx-i',String(i++));
    }
    if(i){
      el.classList.remove('fx-stagger');
      void el.offsetWidth;
      el.classList.add('fx-stagger');
    }
  }
  inTargets.set(el,setTimeout(()=>{
    el.classList.remove('fx-in','fx-stagger');
    inTargets.delete(el);
  },900));
}

/* 列表重绘后补 HUD 标记：动态生成的行/卡片也能拿到全息框。 */
const HUD_SEL='.mc-card,.mq-q,.exam-card,.ss-stage,.focus-ringwrap,.cards-face,.sched-gridwrap,.novel-book,.model-stage,.mist-item,.habit-item,.cards-row,.ss-layer,.mq-score';
/* 密集列表行只给光轨，不给四角括线 */
const ROW_SEL='.ss-layer,.cards-row,.mist-item,.habit-item';
export function hudMark(root){
  if(!fxEnabled())return;
  const el=typeof root==='string'?document.getElementById(root):root;
  if(!el)return;
  for(const card of el.querySelectorAll(HUD_SEL)){
    card.classList.add('fx-hud');
    if(card.matches(ROW_SEL))card.classList.add('fx-hud-row');
  }
}

/* 首页进场 */
export function homeIn(){
  if(!fxEnabled())return;
  const el=document.getElementById('landing');
  if(!el)return;
  clearTimeout(inTimer);
  el.classList.remove('fx-home-in');
  void el.offsetWidth;
  el.classList.add('fx-home-in');
  inTimer=setTimeout(()=>el.classList.remove('fx-home-in'),480);
}

/* 启动序列：短暂展示后自动移除，绝不阻塞交互（pointer-events:none）。 */
export function bootSequence(){
  if(!fxEnabled())return;
  if(sessionStorageSafe('ember-fx-booted'))return;
  markSession('ember-fx-booted');
  bootEl=document.getElementById('fxBoot');
  if(!bootEl){
    bootEl=document.createElement('div');
    bootEl.id='fxBoot';bootEl.setAttribute('aria-hidden','true');
    bootEl.style.pointerEvents='none';
    const core=document.createElement('div');core.className='fx-boot-core';
    const ring=document.createElement('div');ring.className='fx-boot-ring';
    const name=document.createElement('div');name.className='fx-boot-name';name.textContent='天工';
    const bar=document.createElement('div');bar.className='fx-boot-bar';bar.append(document.createElement('i'));
    const tip=document.createElement('div');tip.className='fx-boot-tip';tip.textContent='SYSTEM READY';
    core.append(ring,name,bar,tip);bootEl.append(core);document.body.append(bootEl);
  }
  bootEl.style.pointerEvents='none';
  bootEl.classList.add('fx-show');
  clearTimeout(bootTimer);
  bootTimer=setTimeout(()=>{if(bootEl){bootEl.classList.remove('fx-show');bootEl.remove();bootEl=null;}},1200);
}

export function clearFx(){
  clearTimeout(warpTimer);clearTimeout(inTimer);clearTimeout(bootTimer);
  if(warpEl)warpEl.classList.remove('fx-run');
  const landing=document.getElementById('landing');
  if(landing)landing.classList.remove('fx-home-in');
  for(const [el,t] of inTargets){clearTimeout(t);el.classList.remove('fx-in','fx-stagger');}
  inTargets.clear();
  if(bootEl){bootEl.classList.remove('fx-show');bootEl.remove();bootEl=null;}
}
function sessionStorageSafe(k){try{return sessionStorage.getItem(k)==='1';}catch(e){return false;}}
function markSession(k){try{sessionStorage.setItem(k,'1');}catch(e){}}