/* 天工 · 临床计算（纯逻辑，不依赖 DOM，方便单元测试）
 * 每个计算器 {id,name,desc,formula,unit,inputs:[{key,label,unit,step,min,max,def}],compute,interpret}。
 * compute(vals)->number；interpret(value)->{label,tone}，tone: ok/warn/bad/info。
 * 仅供学习参考，临床以最新指南与医嘱为准。 */

const num=(v,f)=>Number.isFinite(+v)?+v:f;
const round=(v,d)=>{const p=Math.pow(10,d);return Math.round(v*p)/p;};

export const CALCULATORS=[
 {id:'bmi',name:'体质指数 BMI',desc:'体重与身高平方之比，筛查胖瘦。',formula:'BMI = 体重(kg) ÷ 身高(m)²',unit:'kg/m²',
  inputs:[{key:'w',label:'体重',unit:'kg',step:0.5,min:2,max:300,def:60},{key:'h',label:'身高',unit:'cm',step:0.5,min:50,max:250,def:170}],
  compute:v=>num(v.w,0)/Math.pow(num(v.h,0)/100,2),
  interpret:x=>x<18.5?{label:'偏瘦',tone:'warn'}:x<24?{label:'正常（中国标准）',tone:'ok'}:x<28?{label:'超重',tone:'warn'}:{label:'肥胖',tone:'bad'}},
 {id:'bsa',name:'体表面积 BSA',desc:'Mosteller 公式，化疗/补液常用。',formula:'BSA = √(身高cm × 体重kg ÷ 3600)',unit:'m²',
  inputs:[{key:'h',label:'身高',unit:'cm',step:0.5,min:50,max:250,def:170},{key:'w',label:'体重',unit:'kg',step:0.5,min:2,max:300,def:60}],
  compute:v=>Math.sqrt(num(v.h,0)*num(v.w,0)/3600),
  interpret:x=>({label:'成人约 1.5–2.0 m²',tone:'info'})},
 {id:'map',name:'平均动脉压 MAP',desc:'反映器官灌注压。',formula:'MAP = (收缩压 + 2×舒张压) ÷ 3',unit:'mmHg',
  inputs:[{key:'s',label:'收缩压',unit:'mmHg',step:1,min:40,max:260,def:120},{key:'d',label:'舒张压',unit:'mmHg',step:1,min:20,max:160,def:80}],
  compute:v=>(num(v.s,0)+2*num(v.d,0))/3,
  interpret:x=>x<60?{label:'偏低，灌注不足风险',tone:'bad'}:x<=105?{label:'正常灌注',tone:'ok'}:{label:'偏高',tone:'warn'}},
 {id:'ag',name:'阴离子间隙 AG',desc:'代酸分型：高 AG vs 正常 AG。',formula:'AG = Na⁺ − (Cl⁻ + HCO₃⁻)',unit:'mmol/L',
  inputs:[{key:'na',label:'钠 Na',unit:'mmol/L',step:0.5,min:100,max:180,def:140},{key:'cl',label:'氯 Cl',unit:'mmol/L',step:0.5,min:70,max:140,def:104},{key:'hco3',label:'碳酸氢根',unit:'mmol/L',step:0.5,min:5,max:50,def:24}],
  compute:v=>num(v.na,0)-(num(v.cl,0)+num(v.hco3,0)),
  interpret:x=>x<8?{label:'偏低',tone:'warn'}:x<=16?{label:'正常 AG',tone:'ok'}:{label:'高 AG 代酸可能',tone:'bad'}},
 {id:'ca',name:'校正钙',desc:'低白蛋白时校正血钙。',formula:'校正钙 = 实测钙 + 0.02×(40 − 白蛋白g/L)',unit:'mmol/L',
  inputs:[{key:'ca',label:'实测钙',unit:'mmol/L',step:0.01,min:1,max:4,def:2.2},{key:'alb',label:'白蛋白',unit:'g/L',step:1,min:10,max:60,def:40}],
  compute:v=>num(v.ca,0)+0.02*(40-num(v.alb,0)),
  interpret:x=>x<2.1?{label:'偏低',tone:'warn'}:x<=2.55?{label:'正常',tone:'ok'}:{label:'偏高',tone:'warn'}},
 {id:'ccr',name:'肌酐清除率 Ccr',desc:'Cockcroft-Gault，估肾功/调剂量。',formula:'Ccr = (140−年龄)×体重 ÷ (72×Scr mg/dL)，女性×0.85',unit:'ml/min',
  inputs:[{key:'age',label:'年龄',unit:'岁',step:1,min:1,max:120,def:40},{key:'w',label:'体重',unit:'kg',step:0.5,min:2,max:300,def:60},{key:'scr',label:'肌酐',unit:'μmol/L',step:1,min:20,max:1500,def:80},{key:'female',label:'女性',unit:'',step:1,min:0,max:1,def:0}],
  compute:v=>{const scr=num(v.scr,0)/88.4;let r=((140-num(v.age,0))*num(v.w,0))/(72*scr);if(num(v.female,0)===1)r*=0.85;return r;},
  interpret:x=>x>=90?{label:'正常',tone:'ok'}:x>=60?{label:'轻度下降',tone:'warn'}:x>=30?{label:'中度下降',tone:'warn'}:{label:'重度下降',tone:'bad'}},
 {id:'drip',name:'静脉滴速',desc:'按滴系数算每分钟滴数。',formula:'滴速 = 液体ml × 滴系数 ÷ 时间min',unit:'滴/分',
  inputs:[{key:'vol',label:'液体量',unit:'ml',step:10,min:10,max:2000,def:500},{key:'factor',label:'滴系数',unit:'滴/ml',step:1,min:10,max:60,def:15},{key:'min',label:'时间',unit:'min',step:5,min:5,max:1440,def:120}],
  compute:v=>num(v.vol,0)*num(v.factor,0)/num(v.min,1),
  interpret:x=>({label:'一般成人 40–60 滴/分，心肺疾患宜慢',tone:'info'})},
 {id:'pump',name:'输液泵速度',desc:'毫升/小时，泵入常用。',formula:'速度 = 液体ml ÷ 时间h',unit:'ml/h',
  inputs:[{key:'vol',label:'液体量',unit:'ml',step:10,min:10,max:2000,def:500},{key:'h',label:'时间',unit:'h',step:0.5,min:0.5,max:48,def:8}],
  compute:v=>num(v.vol,0)/num(v.h,1),
  interpret:x=>({label:'按医嘱与药物性质调速',tone:'info'})},
 {id:'dose',name:'按体重剂量',desc:'mg/kg × 体重，儿科/按重给药。',formula:'剂量 = mg/kg × 体重kg',unit:'mg',
  inputs:[{key:'mgkg',label:'剂量',unit:'mg/kg',step:0.5,min:0.1,max:200,def:10},{key:'w',label:'体重',unit:'kg',step:0.5,min:2,max:300,def:60}],
  compute:v=>num(v.mgkg,0)*num(v.w,0),
  interpret:x=>({label:'核对单次/每日与最大剂量',tone:'info'})},
 {id:'osm',name:'血浆渗透压',desc:'估算有效渗透压。',formula:'渗透压 = 2×Na + 葡萄糖 + 尿素（均mmol/L）',unit:'mOsm/L',
  inputs:[{key:'na',label:'钠 Na',unit:'mmol/L',step:0.5,min:100,max:180,def:140},{key:'glu',label:'葡萄糖',unit:'mmol/L',step:0.1,min:1,max:40,def:5},{key:'urea',label:'尿素',unit:'mmol/L',step:0.1,min:1,max:40,def:5}],
  compute:v=>2*num(v.na,0)+num(v.glu,0)+num(v.urea,0),
  interpret:x=>x<280?{label:'偏低',tone:'warn'}:x<=310?{label:'正常',tone:'ok'}:{label:'偏高',tone:'warn'}}
];

export function calcById(id){return CALCULATORS.find(c=>c.id===id)||null;}

/* 计算并返回 {value,rounded,unit,label,tone}。输入非法返回 null。 */
export function runCalc(id,vals){
  const c=calcById(id);if(!c)return null;
  const v={};
  for(const inp of c.inputs){
    const x=num(vals&&vals[inp.key],NaN);
    if(!Number.isFinite(x)||x<inp.min||x>inp.max)return null;
    v[inp.key]=x;
  }
  const raw=c.compute(v);
  if(!Number.isFinite(raw))return null;
  const rounded=round(raw,2);
  const it=c.interpret(rounded)||{label:'',tone:'info'};
  return {value:raw,rounded,unit:c.unit,label:it.label,tone:it.tone};
}