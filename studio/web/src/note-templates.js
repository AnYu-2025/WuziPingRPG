/* 笔记模板：定义、命名、工作区设置清洗、插入计算与记事本目标选择。
   本模块不碰 DOM，便于在 node:test 里直接验证。 */

export const NOTE_TEMPLATES=[
  {
    id:'blank',
    title:'空白',
    description:'从一张白纸开始',
    baseName:'模板笔记',
    content:''
  },
  {
    id:'cornell',
    title:'康奈尔',
    description:'线索、笔记、总结三段',
    baseName:'康奈尔笔记',
    content:[
      '# 康奈尔笔记',
      '',
      '日期：',
      '科目：',
      '主题：',
      '',
      '## 线索 / 问题',
      '- ',
      '',
      '## 笔记',
      '- ',
      '',
      '## 总结',
      ''
    ].join('\n')
  },
  {
    id:'outline',
    title:'大纲',
    description:'按层级整理主题',
    baseName:'大纲笔记',
    content:[
      '# 大纲笔记',
      '',
      '主题：',
      '日期：',
      '',
      '## 一、',
      '### 1.1',
      '',
      '### 1.2',
      '',
      '## 二、',
      '### 2.1',
      '',
      '## 三、',
      '### 3.1',
      '',
      '## 关键词',
      '- '
    ].join('\n')
  },
  {
    id:'wrong',
    title:'错题整理',
    description:'题目、错因、同类练习',
    baseName:'错题整理',
    content:[
      '# 错题整理',
      '',
      '日期：',
      '来源：',
      '知识点：',
      '',
      '## 题目',
      '',
      '## 我的答案',
      '',
      '## 正确答案与解法',
      '',
      '## 错因',
      '- [ ] 概念不清',
      '- [ ] 计算失误',
      '- [ ] 审题遗漏',
      '- [ ] 方法没想到',
      '',
      '## 同类练习',
      '1. '
    ].join('\n')
  }
];

export const NOTE_TEMPLATE_IDS=NOTE_TEMPLATES.map(template=>template.id);
export const NOTEPAD_FALLBACK='笔记.txt';
export const LECTURE_NOTE_PATH='课堂笔记.md';

export function templateById(id){
  return NOTE_TEMPLATES.find(template=>template.id===id)||null;
}

/** 宽松判断：.md/.txt 文档都算笔记类文件；课堂笔记也包括在内。 */
export function isNoteDocumentPath(path){
  return typeof path==='string'&&/\.(md|txt)$/i.test(path);
}

/** 普通记事本可打开的目标：笔记类文件，但课堂笔记固定归上课模式。 */
export function isNotepadNotePath(path){
  return isNoteDocumentPath(path)&&path!==LECTURE_NOTE_PATH;
}

/** 进入记事本前只有代码类文件需要记进 lastCodePath；模板/课堂笔记/文本笔记都不记。 */
export function shouldRememberCodePath(active=''){
  return typeof active==='string'&&active.length>0&&!isNoteDocumentPath(active);
}

/**
 * 进入记事本时选文件：当前 active 优先，其次本次会话最近打开的笔记，
 * 最后回退到 笔记.txt。active 可能是刷新后恢复的模板笔记，不能丢。
 * 返回 exists=false 表示调用方需要创建回退文件。
 */
export function notepadTarget({active='',lastNote='',files=[]}={}){
  const paths=new Set((Array.isArray(files)?files:[])
    .map(file=>typeof file==='string'?file:(file&&typeof file.path==='string'?file.path:''))
    .filter(Boolean));
  for(const candidate of [active,lastNote,NOTEPAD_FALLBACK]){
    if(isNotepadNotePath(candidate)&&paths.has(candidate))return {path:candidate,exists:true};
  }
  return {path:NOTEPAD_FALLBACK,exists:false};
}

/** 工作区 state.noteTemplates 的唯一入口：坏值一律回到空白模板。 */
export function sanitizeTemplateState(raw){
  const value=raw&&typeof raw==='object'?raw:{};
  return {last:NOTE_TEMPLATE_IDS.includes(value.last)?value.last:'blank'};
}

/** 文件名冲突时自动编号：康奈尔笔记.md → 康奈尔笔记-2.md → -3 … */
export function templateFileName(templateId,existingPaths=[]){
  const template=templateById(templateId)||NOTE_TEMPLATES[0];
  const used=new Set((Array.isArray(existingPaths)?existingPaths:[])
    .filter(path=>typeof path==='string')
    .map(path=>path.toLowerCase()));
  const base=template.baseName;
  let name=base+'.md';
  let seq=2;
  while(used.has(name.toLowerCase()))name=base+'-'+(seq++)+'.md';
  return name;
}

/** 把模板正文插到当前光标/选区；前后自动留空行，避免和原有段落粘在一起。 */
export function insertTemplate(existingText,template,{from,to}={}){
  const text=typeof existingText==='string'?existingText:'';
  const content=typeof template==='string'?template:(template&&template.content)||'';
  const start=Number.isFinite(from)?Math.max(0,Math.min(text.length,Math.floor(from))):text.length;
  const end=Number.isFinite(to)?Math.max(start,Math.min(text.length,Math.floor(to))):start;
  if(!content){
    return {text,insert:'',from:start,to:end,cursor:start};
  }
  const body=content.replace(/\n+$/,'');
  const before=text.slice(0,start);
  const after=text.slice(end);
  let prefix='';
  if(before.length&&!/\n\n$/.test(before))prefix=/\n$/.test(before)?'\n':'\n\n';
  let suffix='';
  if(after.length&&!/^\n\n/.test(after))suffix=/^\n/.test(after)?'\n':'\n\n';
  const insert=prefix+body+suffix;
  return {text:before+insert+after,insert,from:start,to:end,cursor:start+insert.length};
}

/** 模板动作的安全策略。课堂笔记有时间戳或正在录音时，只允许另建新文件。 */
export function noteTemplateAction({mode='notepad',action='insert',recording=false,hasStamps=false}={}){
  if(action==='create'){
    return {ok:true,action:'create',open:mode!=='lecture',reason:''};
  }
  if(mode==='lecture'&&(recording||hasStamps)){
    return {
      ok:false,
      action:'refuse',
      reason:recording?'recording':'timestamps',
      message:recording
        ? '正在录音：课堂笔记的每一行都带时间戳，插入模板会打乱时间轴。请点「新建模板笔记」另存一篇。'
        : '课堂笔记已有时间戳，插入模板会打乱复习定位。请点「新建模板笔记」另存一篇。'
    };
  }
  return {ok:true,action:'insert',open:true,reason:''};
}
