/* 天工 · 数据备份/恢复（纯逻辑，不依赖 DOM，方便单元测试）
 * 把草稿快照 + 小说正文 + 导入题库打包成一个 JSON；导入时校验并清洗。
 * 仅本机导出/导入，不上传。 */

export const BACKUP_VERSION=1;
const APP='tiangong-studio';

export function buildBackup(snapshot,extras,now){
  return {
    app:APP,
    version:BACKUP_VERSION,
    exportedAt:now||Date.now(),
    snapshot:snapshot&&typeof snapshot==='object'?snapshot:null,
    novels:extras&&extras.novels&&typeof extras.novels==='object'?extras.novels:{},
    medquizCustom:Array.isArray(extras&&extras.medquizCustom)?extras.medquizCustom:[]
  };
}

/* 校验+清洗导入对象；非法返回 null。 */
export function parseBackup(raw){
  let obj=raw;
  if(typeof raw==='string'){
    try{obj=JSON.parse(raw);}catch(e){return null;}
  }
  if(!obj||typeof obj!=='object')return null;
  if(obj.app!==APP)return null;
  if(obj.version!==BACKUP_VERSION)return null;
  const snap=obj.snapshot;
  if(!snap||typeof snap!=='object'||snap.version!==1||!Array.isArray(snap.files)||!snap.files.length)return null;
  const novels={};
  if(obj.novels&&typeof obj.novels==='object'){
    for(const k of Object.keys(obj.novels).slice(0,40)){
      if(typeof obj.novels[k]==='string')novels[k]=obj.novels[k];
    }
  }
  const custom=Array.isArray(obj.medquizCustom)?obj.medquizCustom.filter(q=>q&&typeof q==='object'&&typeof q.q==='string'&&Array.isArray(q.options)):[];
  return {snapshot:snap,novels,medquizCustom:custom,exportedAt:obj.exportedAt||0};
}

/* 备份摘要：文件数/模块记录数，供导入前确认。 */
export function backupSummary(parsed){
  if(!parsed)return null;
  const s=parsed.snapshot;
  const count=k=>Array.isArray(s[k])?s[k].length:(s[k]&&typeof s[k]==='object'&&Array.isArray(s[k].items)?s[k].items.length:(s[k]&&typeof s[k]==='object'&&Array.isArray(s[k].books)?s[k].books.length:(s[k]&&typeof s[k]==='object'&&Array.isArray(s[k].habits)?s[k].habits.length:(s[k]&&typeof s[k]==='object'&&Array.isArray(s[k].exams)?s[k].exams.length:(s[k]&&typeof s[k]==='object'&&Array.isArray(s[k].courses)?s[k].courses.length:0)))));
  return {
    files:s.files.length,
    cards:count('cards'),
    mistakes:count('mistakes'),
    habits:count('habits'),
    exams:count('exams'),
    courses:count('schedule'),
    novels:Object.keys(parsed.novels).length,
    customQuiz:parsed.medquizCustom.length,
    exportedAt:parsed.exportedAt
  };
}