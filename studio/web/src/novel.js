/* 天工 · 小说阅读器（纯逻辑，不依赖 DOM，方便单元测试）
 * 只负责分章与设置清洗；正文由调用方存本机（localStorage 独立键，防配额）。
 * 分章识别「第X章/节/回/卷/集/部/篇」；没有章节标记时按段落切成约 4000 字一段。 */

export const NOVEL_THEMES=['paper','green','night'];
export const DEFAULT_NOVEL_SETTINGS=()=>({fontSize:18,theme:'paper',line:1.9});
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const num=(v,f)=>Number.isFinite(+v)?+v:f;

export function novelSettingsSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  return {
    fontSize:clamp(Math.round(num(r.fontSize,18)),12,30),
    theme:NOVEL_THEMES.includes(r.theme)?r.theme:'paper',
    line:clamp(num(r.line,1.9),1.4,2.6)
  };
}

const CH_RE=/^[ \t]*(第[0-9一二三四五六七八九十百千零两]+[章节回卷集部篇][^\n]{0,40})[ \t]*$/gm;

export function splitChapters(text){
  const t=String(text||'').replace(/\r\n?/g,'\n');
  if(!t.trim())return [];
  const marks=[];let m;
  CH_RE.lastIndex=0;
  while((m=CH_RE.exec(t)))marks.push({title:m[1].trim(),index:m.index});
  const chapters=[];
  if(!marks.length){
    /* 无章节标记：按空行/换行边界切 ~4000 字 */
    let pos=0,part=1;
    while(pos<t.length){
      let end=Math.min(t.length,pos+4000);
      if(end<t.length){
        const nl=t.lastIndexOf('\n',end);
        if(nl>pos+800)end=nl;
      }
      const body=t.slice(pos,end).trim();
      if(body)chapters.push({title:'第 '+part+' 段',body});
      pos=end;part++;
    }
    return chapters;
  }
  if(marks[0].index>0){
    const pre=t.slice(0,marks[0].index).trim();
    if(pre)chapters.push({title:'前言',body:pre});
  }
  for(let i=0;i<marks.length;i++){
    const start=marks[i].index;
    const end=i+1<marks.length?marks[i+1].index:t.length;
    let body=t.slice(start,end);
    const nl=body.indexOf('\n');
    body=(nl>=0?body.slice(nl+1):'').trim();
    chapters.push({title:marks[i].title,body});
  }
  return chapters;
}

export function bookSanitize(raw,fallbackId){
  const r=raw&&typeof raw==='object'?raw:{};
  const title=typeof r.title==='string'?r.title.trim().slice(0,60):'';
  if(!title)return null;
  const chapterCount=clamp(Math.round(num(r.chapterCount,0)),0,9999);
  return {
    id:Math.max(1,Math.floor(num(r.id,fallbackId))),
    title,
    author:typeof r.author==='string'?r.author.slice(0,40):'',
    addedAt:Math.max(0,num(r.addedAt,0)),
    chapterCount,
    chars:clamp(Math.round(num(r.chars,0)),0,99999999),
    ch:clamp(Math.round(num(r.ch,0)),0,Math.max(0,chapterCount-1))
  };
}

export function shelfSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  const books=[];
  const list=Array.isArray(r.books)?r.books.slice(0,20):[];
  for(const b of list){const s=bookSanitize(b,books.length+1);if(s)books.push(s);}
  const seen=new Set();
  for(const b of books){while(seen.has(b.id))b.id++;seen.add(b.id);}
  let nextId=Math.max(1,Math.floor(num(r.nextId,1)));
  for(const b of books)nextId=Math.max(nextId,b.id+1);
  const current=books.some(b=>b.id===r.current)?r.current:null;
  return {nextId,current,books,settings:novelSettingsSanitize(r.settings)};
}

export function progressText(book){
  if(!book||!book.chapterCount)return '未开始';
  const pct=Math.round((book.ch+1)/book.chapterCount*100);
  return '读到第 '+(book.ch+1)+'/'+book.chapterCount+' 章 · '+pct+'%';
}