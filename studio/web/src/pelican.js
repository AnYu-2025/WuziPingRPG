/* 天工 · 鹈鹕骑自行车（纯逻辑，不依赖 DOM/three，方便单元测试）
 * 横版躲避小游戏：鹈鹕骑车自动前进，点按跳跃躲障碍，距离计分。
 * 状态：{y, vy, onGround, speed, distance, score, best, obstacles:[{x,w,h}],
 *        over, started, spawnIn}
 * 单位：世界坐标，地面 y=0，鹈鹕 x 固定 0，障碍从右往左移动。 */

export const PELICAN_DEFAULT=()=>({
  y:0,vy:0,onGround:true,speed:6,distance:0,score:0,best:0,
  obstacles:[],over:false,started:false,spawnIn:1.2
});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

export const GRAVITY=-22;
export const JUMP_V=9.2;
export const PELICAN_W=0.9;   /* 碰撞宽 */
export const PELICAN_H=1.1;   /* 碰撞高 */

export function pelicanSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  return {best:clamp(Math.round(num(r.best,0)),0,999999)};
}

export function pelicanStart(best){
  return {...PELICAN_DEFAULT(),best:best||0,started:true};
}

export function pelicanJump(s){
  if(s.over||!s.started)return s;
  if(!s.onGround)return s;
  return {...s,vy:JUMP_V,onGround:false};
}

/* 推进 dt 秒。返回新状态。障碍生成用确定性伪随机（基于 distance）便于测试。 */
export function pelicanTick(s,dt){
  if(!s.started||s.over)return s;
  dt=clamp(dt,0,0.05);
  let {y,vy,onGround,speed,distance,spawnIn}=s;
  /* 物理 */
  vy+=GRAVITY*dt;
  y+=vy*dt;
  if(y<=0){y=0;vy=0;onGround=true;}else onGround=false;
  /* 前进与加速 */
  distance+=speed*dt;
  speed=Math.min(14,6+distance*0.02);
  /* 障碍移动 */
  let obstacles=s.obstacles.map(o=>({...o,x:o.x-speed*dt})).filter(o=>o.x>-3);
  /* 生成障碍 */
  spawnIn-=dt;
  if(spawnIn<=0){
    const seed=Math.floor(distance*7)%97;
    const h=0.7+((seed*37)%50)/100;      /* 0.7~1.2 */
    const w=0.5+((seed*13)%40)/100;      /* 0.5~0.9 */
    obstacles.push({x:14,w,h});
    spawnIn=clamp(1.6-distance*0.004,0.7,1.6)+((seed*29)%40)/100;
  }
  /* 碰撞：鹈鹕 x∈[-W/2,W/2]，y∈[y,y+H]；障碍 x∈[o.x,o.x+w]，y∈[0,h] */
  let over=false;
  for(const o of obstacles){
    const xOverlap=o.x<PELICAN_W/2&&o.x+o.w>-PELICAN_W/2;
    const yOverlap=y<o.h;
    if(xOverlap&&yOverlap){over=true;break;}
  }
  const score=Math.floor(distance);
  return {...s,y,vy,onGround,speed,distance,spawnIn,obstacles,over,
          score,best:Math.max(s.best,score)};
}