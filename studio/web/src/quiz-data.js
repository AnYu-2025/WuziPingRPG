/* 天工 · 医学生刷题题库（分科文件 + 合并去重 + 外部导入）
 * 内置题按科放在 quiz-bank-*.js；运行时与用户导入题合并、按规范化题干去重。
 * 每题 {id,subject,q,options,answer,explain,difficulty:1基础|2进阶|3偏难,tag:'重点'|'偏'|'难'|''}。
 * 仅供学习自测，临床请以最新教材与指南为准。 */

import {BANK_ANATOMY} from './quiz-bank-anatomy.js';
import {BANK_PHYSIO} from './quiz-bank-physio.js';
import {BANK_BIOCHEM} from './quiz-bank-biochem.js';
import {BANK_PATHO} from './quiz-bank-patho.js';
import {BANK_PHARM} from './quiz-bank-pharm.js';
import {BANK_MICRO} from './quiz-bank-micro.js';
import {BANK_IMMUNO} from './quiz-bank-immuno.js';
import {BANK_DIAG} from './quiz-bank-diag.js';

export const QUIZ_SUBJECTS=['解剖','生理','生化','病理','药理','微生物','免疫','诊断'];
export const DIFF_LABELS={1:'基础',2:'进阶',3:'偏难'};

const norm=s=>String(s||'').toLowerCase().replace(/[\s　]/g,'').replace(/[，。？！、；：,.?!;:"'’‘“”()（）【】\[\]<>《》\-—_·]/g,'');
export function qKey(q){return norm(q);}

export function qSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const q=typeof r.q==='string'?r.q.trim().slice(0,300):'';
  if(!q)return null;
  const options=Array.isArray(r.options)?r.options.slice(0,6).map(o=>String(o==null?'':o).slice(0,120)).filter(o=>o.trim()):[];
  if(options.length<2)return null;
  const answer=Math.max(0,Math.min(options.length-1,Math.round(Number(r.answer)||0)));
  return {
    id:typeof r.id==='string'&&r.id?r.id:('q'+fallbackId),
    subject:QUIZ_SUBJECTS.includes(r.subject)?r.subject:'诊断',
    q,options,answer,
    explain:typeof r.explain==='string'?r.explain.slice(0,600):'',
    difficulty:[1,2,3].includes(+r.difficulty)?+r.difficulty:2,
    tag:['重点','偏','难'].includes(r.tag)?r.tag:''
  };
}

/* 合并去重：先内置后导入；题干规范化相同即视为重复，保留先者。 */
export function mergeBank(builtin,custom){
  const seen=new Set();const out=[];
  const push=(list,src)=>{
    for(const raw of (list||[])){
      const q=qSanitize(raw,out.length+1);
      if(!q)continue;
      const k=qKey(q.q);
      if(seen.has(k))continue;
      seen.add(k);
      out.push({...q,id:src+':'+q.id});
    }
  };
  push(builtin,'b');
  push(custom,'c');
  return out;
}

const BUILTIN=[...BANK_ANATOMY,...BANK_PHYSIO,...BANK_BIOCHEM,...BANK_PATHO,...BANK_PHARM,...BANK_MICRO,...BANK_IMMUNO,...BANK_DIAG];
let CACHE=null,CACHE_KEY='';
export function getBank(custom){
  const key=(custom||[]).length+':'+((custom||[])[0]&& (custom||[])[0].id||'');
  if(CACHE&&CACHE_KEY===key)return CACHE;
  CACHE=mergeBank(BUILTIN,custom);
  CACHE_KEY=key;
  return CACHE;
}
export function builtinCount(){return BUILTIN.length;}

/* 外部题库解析：支持 JSON 数组 / {questions:[...]} / JSONL。返回 {list,errors}。 */
export function parseBankText(text){
  const t=String(text||'').trim();
  if(!t)return {list:[],errors:['文件是空的']};
  let arr=null;
  try{
    const j=JSON.parse(t);
    arr=Array.isArray(j)?j:(Array.isArray(j.questions)?j.questions:null);
  }catch(e){arr=null;}
  if(!arr){
    arr=[];
    for(const line of t.split(/\r?\n/)){
      const s=line.trim();if(!s)continue;
      try{arr.push(JSON.parse(s));}catch(e){/* 跳过坏行 */}
    }
  }
  const list=[];const errors=[];
  (arr||[]).forEach((raw,i)=>{
    const q=qSanitize(raw,i+1);
    if(q)list.push(q);else errors.push('第'+(i+1)+'条格式不对');
  });
  return {list,errors};
}

/* 兼容旧接口 */
export const QUIZ_BANK=getBank([]);
export function quizById(id){return getBank([]).find(q=>q.id===id)||null;}
export function bankCount(subject){
  const b=getBank([]);
  return subject&&subject!=='全部'?b.filter(q=>q.subject===subject).length:b.length;
}