/* 天工 · 学科雷达（纯逻辑，可单测）
 * 把各科刷题正确率映射为雷达顶点，供星舰雷达扫描图渲染。
 * 只读真实 bySubject 数据；未答过的科目标记 hasData=false，不臆造正确率。 */

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

/* subjects: 科目顺序；bySubject: {科目:{answered,right}}。
   返回 [{subject,rate,answered,hasData}]，rate 为 0-100。 */
export function radarData(subjects,bySubject){
  const bs=bySubject&&typeof bySubject==='object'?bySubject:{};
  return (Array.isArray(subjects)?subjects:[]).map(s=>{
    const v=bs[s]||{};
    const answered=clamp(Math.round(num(v.answered,0)),0,999999);
    const right=clamp(Math.round(num(v.right,0)),0,answered);
    const hasData=answered>0;
    return {subject:s,answered,hasData,rate:hasData?Math.round(right/answered*100):0};
  });
}

/* 顶点坐标：center(cx,cy)，半径 r，第 i/n 个顶点从正上方顺时针。
   value(0-100) 决定该顶点到中心的距离比例。 */
export function radarPoints(data,cx,cy,r){
  const n=data.length;
  return data.map((d,i)=>{
    const ang=-Math.PI/2+(i*2*Math.PI/n);
    const rr=r*clamp(d.rate,0,100)/100;
    return {x:+(cx+rr*Math.cos(ang)).toFixed(2),y:+(cy+rr*Math.sin(ang)).toFixed(2),
            lx:+(cx+r*Math.cos(ang)).toFixed(2),ly:+(cy+r*Math.sin(ang)).toFixed(2),
            subject:d.subject,rate:d.rate,hasData:d.hasData};
  });
}

/* 多边形 points 字符串（SVG polygon）。 */
export function radarPolygon(points){
  return points.map(p=>p.x+','+p.y).join(' ');
}