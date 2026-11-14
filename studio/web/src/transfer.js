/* 天工 · 批量导入导出（纯逻辑，不依赖 DOM，方便单元测试）
 * 支持 CSV / TSV / 自定义分隔符，带引号转义与 BOM 处理。
 * 卡片：front,back（可含 ease/interval/reps/due/lapses 以保留复习进度）
 * 错题：subject,title,question,answer,reason,mastery
 * 导入按「正面」/「标题+题目」去重，不动已有记录的复习进度。
 * 导出用标准 CSV 转义，导出的文件能原样导回。 */

import {deckSanitize,cardSanitize,DAY} from './cards.js';
import {bookSanitize,mistakeSanitize,SUBJECTS,MASTERY} from './mistakes.js';

export const CARD_HEADERS=['front','back','ease','interval','reps','due','lapses'];
export const MISTAKE_HEADERS=['subject','title','question','answer','reason','mastery'];

/* ---------- CSV 解析（RFC4180 风格：双引号包裹、"" 转义、字段内换行） ---------- */
export function detectDelimiter(text){
  const line=String(text||'').split(/\r?\n/).find(l=>l.trim())||'';
  const counts=[[',',(line.match(/,/g)||[]).length],['\t',(line.match(/\t/g)||[]).length],[';',(line.match(/;/g)||[]).length],['|',(line.match(/\|/g)||[]).length]];
  counts.sort((a,b)=>b[1]-a[1]);
  return counts[0][1]>0?counts[0][0]:',';
}

export function parseDelimited(text,delimiter){
  const src=String(text||'').replace(/^\uFEFF/,'');
  const d=delimiter&&delimiter.length?delimiter:detectDelimiter(src);
  const rows=[];let row=[];let field='';let inQuotes=false;
  for(let i=0;i<src.length;i++){
    const ch=src[i];
    if(inQuotes){
      if(ch==='"'){
        if(src[i+1]==='"'){field+='"';i++;}
        else inQuotes=false;
      }else field+=ch;
      continue;
    }
    if(ch==='"'){inQuotes=true;continue;}
    if(ch===d){row.push(field);field='';continue;}
    if(ch==='\r'){continue;}
    if(ch==='\n'){row.push(field);field='';rows.push(row);row=[];continue;}
    field+=ch;
  }
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows.filter(r=>r.some(c=>String(c).trim().length));
}

/* 表头识别：中英文别名都认；没有表头时按默认列序。 */
const CARD_ALIAS={
  front:['front','正面','问题','单词','q','question','term'],
  back:['back','背面','答案','释义','a','answer','definition'],
  /* 进度列也要参与表头映射，否则导出再导入会丢复习进度。 */
  ease:['ease','难度系数','熟练度'],
  interval:['interval','间隔','间隔天数'],
  reps:['reps','复习次数','次数'],
  due:['due','到期','到期时间'],
  lapses:['lapses','遗忘次数']
};
const MISTAKE_ALIAS={
  subject:['subject','科目','学科'],title:['title','标题','题名'],
  question:['question','题目','题干','错题'],answer:['answer','答案','正解','解析'],
  reason:['reason','错因','原因'],mastery:['mastery','掌握度','掌握']
};
function headerMap(cells,alias,defaults){
  const map={};let matched=0;
  cells.forEach((c,i)=>{
    const key=String(c||'').trim().toLowerCase();
    for(const [field,names] of Object.entries(alias)){
      if(names.some(n=>n.toLowerCase()===key)){map[field]=i;matched++;}
    }
  });
  if(matched>=2)return {map,hasHeader:true};
  const fallback={};
  defaults.forEach((f,i)=>{fallback[f]=i;});
  return {map:fallback,hasHeader:false};
}
function pick(row,map,field){
  const i=map[field];
  return i==null?'':String(row[i]==null?'':row[i]).trim();
}

/* ---------- 卡片 ---------- */
export function parseCards(text,delimiter){
  const rows=parseDelimited(text,delimiter);
  if(!rows.length)return {items:[],errors:['文件是空的'],hasHeader:false};
  const {map,hasHeader}=headerMap(rows[0],CARD_ALIAS,['front','back']);
  const body=hasHeader?rows.slice(1):rows;
  const items=[];const errors=[];
  body.forEach((r,i)=>{
    const front=pick(r,map,'front');
    const back=pick(r,map,'back');
    if(!front||!back){errors.push('第 '+(i+1+(hasHeader?1:0))+' 行缺正面或背面');return;}
    const extra={};
    for(const f of ['ease','interval','reps','due','lapses']){
      const v=pick(r,map,f);
      if(v!==''&&Number.isFinite(+v))extra[f]=+v;
    }
    const c=cardSanitize({front,back,...extra},items.length+1);
    if(c)items.push(c);else errors.push('第 '+(i+1+(hasHeader?1:0))+' 行无效');
  });
  return {items,errors,hasHeader};
}

export function importCards(deck,text,now,delimiter){
  const d=deckSanitize(deck);
  const {items,errors,hasHeader}=parseCards(text,delimiter);
  const seen=new Set(d.cards.map(c=>c.front.trim().toLowerCase()));
  let added=0,skipped=0;
  let nextId=d.nextId;
  const cards=[...d.cards];
  for(const it of items){
    const key=it.front.trim().toLowerCase();
    if(seen.has(key)){skipped++;continue;}
    seen.add(key);
    const card={...it,id:nextId++,due:it.due||now||0};
    cards.push(card);added++;
  }
  return {deck:{nextId,cards},added,skipped,parsed:items.length,errors,hasHeader};
}

/* ---------- 错题 ---------- */
function masteryFrom(v){
  const s=String(v==null?'':v).trim();
  if(s==='')return 0;
  if(Number.isFinite(+s))return Math.max(0,Math.min(2,Math.round(+s)));
  const i=MASTERY.indexOf(s);
  return i>=0?i:0;
}
export function parseMistakes(text,delimiter){
  const rows=parseDelimited(text,delimiter);
  if(!rows.length)return {items:[],errors:['文件是空的'],hasHeader:false};
  const {map,hasHeader}=headerMap(rows[0],MISTAKE_ALIAS,['subject','title','question','answer','reason','mastery']);
  const body=hasHeader?rows.slice(1):rows;
  const items=[];const errors=[];
  body.forEach((r,i)=>{
    const subjectRaw=pick(r,map,'subject');
    const subject=SUBJECTS.includes(subjectRaw)?subjectRaw:'其他';
    const title=pick(r,map,'title');
    const question=pick(r,map,'question');
    if(!title&&!question){errors.push('第 '+(i+1+(hasHeader?1:0))+' 行缺标题和题目');return;}
    const m=mistakeSanitize({subject,title,question,answer:pick(r,map,'answer'),reason:pick(r,map,'reason'),mastery:masteryFrom(pick(r,map,'mastery'))},items.length+1);
    if(m)items.push(m);else errors.push('第 '+(i+1+(hasHeader?1:0))+' 行无效');
  });
  return {items,errors,hasHeader};
}
export function importMistakes(book,text,now,delimiter){
  const b=bookSanitize(book);
  const {items,errors,hasHeader}=parseMistakes(text,delimiter);
  const key=it=>(it.title.trim()+'|'+it.question.trim()).toLowerCase();
  const seen=new Set(b.items.map(key));
  let added=0,skipped=0,nextId=b.nextId;
  const list=[...b.items];
  for(const it of items){
    const k=key(it);
    if(seen.has(k)){skipped++;continue;}
    seen.add(k);
    list.push({...it,id:nextId++,created:now||0,updated:now||0});added++;
  }
  return {book:{nextId,items:list},added,skipped,parsed:items.length,errors,hasHeader};
}

/* ---------- 导出 ---------- */
export function csvCell(v){
  const s=String(v==null?'':v);
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
export function toCSV(headers,rows){
  const out=[headers.map(csvCell).join(',')];
  for(const r of rows)out.push(headers.map(h=>csvCell(r[h])).join(','));
  return out.join('\r\n')+'\r\n';
}
export function exportCards(deck){
  const d=deckSanitize(deck);
  return toCSV(CARD_HEADERS,d.cards);
}
export function exportMistakes(book){
  const b=bookSanitize(book);
  return toCSV(MISTAKE_HEADERS,b.items.map(it=>({...it,mastery:MASTERY[it.mastery]||'未掌握'})));
}

/* 卡片编辑：只改正面/背面，保留复习进度。 */
export function updateCard(deck,id,front,back){
  const d=deckSanitize(deck);
  const f=String(front||'').trim().slice(0,500);
  const b=String(back||'').trim().slice(0,1000);
  if(!f||!b)return {deck:d,ok:false};
  let ok=false;
  const cards=d.cards.map(c=>{
    if(c.id!==id)return c;
    ok=true;return {...c,front:f,back:b};
  });
  return {deck:{nextId:d.nextId,cards},ok};
}

/* 供 UI 展示的导入摘要 */
export function importSummary(res){
  if(!res)return '';
  const bits=['新增 '+res.added+' 条'];
  if(res.skipped)bits.push('重复跳过 '+res.skipped+' 条');
  if(res.errors&&res.errors.length)bits.push(res.errors.length+' 行有问题');
  return bits.join(' · ');
}
export {DAY};