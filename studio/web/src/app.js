import {EditorView,basicSetup} from 'codemirror';
import {EditorState,Compartment} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {indentWithTab,undo,redo,indentMore} from '@codemirror/commands';
import {python} from '@codemirror/lang-python';
import {javascript} from '@codemirror/lang-javascript';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {json} from '@codemirror/lang-json';
import {cpp} from '@codemirror/lang-cpp';
import {java} from '@codemirror/lang-java';
import {markdown} from '@codemirror/lang-markdown';
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {closeSearchPanel,openSearchPanel} from '@codemirror/search';
import {initLecture,lectureExtensions,lectureSerialize,lectureSanitize,lectureAfterRestore,lectureViewCreated,lectureModeEnter,lectureModeLeave,lectureBusy,lectureStatusText,lectureMediaMessage,lectureStampCount,lectureDebug} from './lecture.js';
import {initTTS,ttsExtensions,ttsSerialize,ttsSanitize,ttsAfterRestore,ttsModeEnter,ttsModeLeave,ttsHideBar,ttsShowBar,ttsDocumentChanged,ttsStatusText,ttsReceive,ttsDebug} from './tts.js';
import {initDraw,ensureDrawUI,enterDrawMode,exitDrawMode,isDrawMode,getDrawStrokes,loadDrawStrokes,getDrawView,loadDrawView} from './draw.js';
import {initAI,aiSerialize,aiSanitize,aiRestore,aiModeEnter,aiModeLeave,aiHidePanel,aiEnterPanel,aiStatusText,aiReceive,aiDebug} from './ai.js';
import {BACK,resolveBack,canLeaveMode,resumeCard,exitCopy,unsavedOriginals,HOME_ACTIONS,HOME_ACTIONS as MODULES,moduleById,isNativeModule,moduleAvailability} from './back.js';
import {NOTE_TEMPLATES,templateById,templateFileName,sanitizeTemplateState,insertTemplate,noteTemplateAction,notepadTarget,isNotepadNotePath,shouldRememberCodePath} from './note-templates.js';
import {createQuizRequester,quizAIAvailability,normalizeQuizCount,gradeQuiz,retryWrongQuiz,quizToMarkdown,quizFileName,QUIZ_TYPE_LABELS,QUIZ_NOTE_LIMIT} from './quiz.js';
import {modelSanitize} from './model-data.js';
import {init as initModel} from './model3d.js';
import {readStoredTheme,sanitizeTheme,writeStoredTheme,themeFromSettings,applyTheme,themeColor} from './theme.js';
import {starSanitize} from './star-data.js';
import {init as initStar} from './star-home.js';
import {splitLocations} from './error-loc.js';
import {snippetsFor,snippetById} from './snippets.js';
import {searchProject} from './project-search.js';
import {renderMarkdown} from './markdown.js';
import {DEFAULT_FOCUS,focusSanitize,focusToggle,focusReset,focusSkip,focusTick,focusSetMinutes,fmtTime,lastNDays} from './focus.js';
import {deckSanitize,addCard,removeCard,reviewCard,dueCards,deckStats} from './cards.js';
import {SUBJECTS,MASTERY,bookSanitize,addMistake,updateMistake,setMastery,removeMistake,filterMistakes,bookStats} from './mistakes.js';
import {habitsSanitize,addHabit,removeHabit,isChecked,toggleCheck,currentStreak,bestStreak,totalChecks,lastNDaysChecks,habitsStats} from './habits.js';
import {DAYS,PERIODS,COURSE_COLORS,scheduleSanitize,addCourse,updateCourse,removeCourse,coursesOnDay,nowInfo,currentStatus,fmtMin,weeksText} from './schedule.js';
import {splitChapters,shelfSanitize,novelSettingsSanitize,progressText} from './novel.js';
import {QUIZ_SUBJECTS,bankCount,quizById} from './quiz-data.js';
import {quizStatsSanitize,buildQuiz as mqBuild,answerQuiz as mqAnswerFn,nextQuiz as mqNextFn,gradeQuiz as mqGrade,accuracy as mqAccuracy,sessionSummary as mqSummary} from './medquiz.js';
import {init as initPelican} from './pelican3d.js';
import {pelicanSanitize} from './pelican.js';

const $=id=>document.getElementById(id),native=!!window.StudioBridge,MAX_FILE=2*1024*1024;
/* 原生工作区快照的硬上限（EditorActivity 里是同一个数）。
   以前超限是静默丢弃整份草稿，现在先在页面里算清楚再明确报错。 */
const WORKSPACE_LIMIT=30*1024*1024;

/* Light editor surface: calm paper background, quiet gutters, GitHub-like syntax colours. */
const codeTheme=EditorView.theme({
  '&':{backgroundColor:'var(--code)',color:'var(--text)',height:'100%'},
  '.cm-content':{caretColor:'var(--accent)'},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'var(--accent)'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,.cm-content ::selection':{backgroundColor:'var(--accent-soft)'},
  '.cm-gutters':{backgroundColor:'var(--code)',color:'var(--faint)',border:'none'},
  '.cm-activeLine':{backgroundColor:'var(--accent-soft)'},
  '.cm-activeLineGutter':{backgroundColor:'var(--accent-soft)',color:'var(--muted)'},
  '.cm-panels':{backgroundColor:'var(--surface-2)',color:'var(--text)'},
  '.cm-searchMatch':{backgroundColor:'#fde68a'},
  '.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#fca5a5'},
  '.cm-tooltip':{backgroundColor:'var(--surface)',border:'1px solid var(--line)',color:'var(--text)'},
  '.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'var(--accent-soft)',color:'var(--accent-strong)'}
},{dark:false});
const codeHighlight=HighlightStyle.define([
  {tag:tags.comment,color:'var(--syn-comment)',fontStyle:'italic'},
  {tag:[tags.keyword,tags.operatorKeyword,tags.modifier,tags.controlKeyword],color:'var(--syn-keyword)'},
  {tag:[tags.string,tags.special(tags.string),tags.regexp],color:'var(--syn-string)'},
  {tag:[tags.number,tags.bool,tags.null],color:'var(--syn-number)'},
  {tag:[tags.function(tags.variableName),tags.definition(tags.function(tags.variableName))],color:'var(--syn-function)'},
  {tag:[tags.className,tags.typeName,tags.namespace],color:'var(--syn-type)'},
  {tag:[tags.propertyName,tags.attributeName],color:'var(--syn-property)'},
  {tag:[tags.tagName],color:'var(--syn-property)'},
  {tag:tags.heading,color:'var(--syn-heading)',fontWeight:'600'},
  {tag:[tags.link,tags.url],color:'var(--syn-link)',textDecoration:'underline'},
  {tag:tags.invalid,color:'var(--syn-invalid)'}
]);
const langs={py:['Python',python],js:['JavaScript',javascript],mjs:['JavaScript',javascript],ts:['TypeScript',()=>javascript({typescript:true})],html:['HTML',html],htm:['HTML',html],css:['CSS',css],json:['JSON',json],c:['C',cpp],h:['C/C++',cpp],cpp:['C++',cpp],cc:['C++',cpp],java:['Java',java],md:['Markdown',markdown]};
const extension=path=>(path.split('.').pop()||'').toLowerCase();
const validPath=path=>typeof path==='string'&&path.length>0&&path.length<=200&&!path.startsWith('/')&&!path.split('/').some(v=>!v||v==='.'||v==='..')&&!/[\x00-\x1f\\:*?"<>|]/.test(path);
const makeFile=(path,text,uri='',encoding='UTF-8')=>({path,text,uri,encoding,savedText:text});
const defaults=()=>({version:1,files:[makeFile('main.py','# 点右上「运行」试试。要输入内容时，先在终端的「输入」页填好\nfrom geometry import rectangle_area\nimport json\n\nname = input("你的名字：")\nprint(f"你好，{name}！")\n\nwith open("data.json", encoding="utf-8") as f:\n    shape = json.load(f)\n\narea = rectangle_area(shape["width"], shape["height"])\nprint(f"长方形面积：{area}")\n'),makeFile('geometry.py','def rectangle_area(width, height):\n    """计算长方形面积。"""\n    return width * height\n'),makeFile('data.json','{\n  "width": 8,\n  "height": 5\n}\n'),makeFile('main.cpp','// C++ 也能直接运行：和 Python 共用这套文件\n// 工作区里的其他 .cpp 会一起编译，头文件直接 include\n#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    std::cout << "你的名字：";\n    std::getline(std::cin, name);\n    std::cout << "你好，" << name << "！\\n";\n\n    int sum = 0;\n    for (int i = 1; i <= 100; ++i) sum += i;\n    std::cout << "1 加到 100 = " << sum << std::endl;\n    return 0;\n}\n'),makeFile('index.html','<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{background:#142330;color:#b2ebda;font:18px system-ui;padding:30px}button{padding:12px;border-radius:8px}</style>\n<h1>你好，天工！</h1>\n<p>这个页面是在手机上写的。</p>\n<button onclick="this.textContent=\'点到了！\'">点我一下</button>\n</html>\n')],active:'main.py',opened:['main.py','geometry.py'],stdin:'伍子平\n',settings:{fontSize:15,wrap:true,timeLimit:15,appearance:'system',accent:'teal'},drawStrokes:[],drawView:null,tts:{voice:'',locale:'en-US',rate:1},noteTemplates:sanitizeTemplateState(),ai:aiSerialize(),model:modelSanitize(null),star:{starred:[],motion:true},focus:DEFAULT_FOCUS(),pelican:{best:0},cards:deckSanitize(null),mistakes:bookSanitize(null),habits:habitsSanitize(null),schedule:scheduleSanitize(null),novel:shelfSanitize(null),medquiz:quizStatsSanitize(null)});
let state=defaults(),view,restoring=false,worker=null,cppWorker=null,runToken=0,timeout=null,saveTimer=null,revision=0,latestSaved=0,renamePath=null,ready=false,toastTimer,pendingSaves=new Map(),runFiles=[];
/* 麦克风预热请求：id → resolve(granted)。设置超时兜底，别让录音按钮卡住。 */
const micWaiters=new Map();let micSeq=0;
function requestMic(){
  if(!native)return Promise.resolve(true);
  return new Promise(resolve=>{
    const id=++micSeq;
    micWaiters.set(id,resolve);
    send('micPermission',{id});
    setTimeout(()=>{if(micWaiters.has(id)){micWaiters.delete(id);resolve(true);}},20000);
  });
}
const langConfig=new Compartment(),wrapConfig=new Compartment(),editConfig=new Compartment();
let editorStates=new Map();
function active(){return state.files.find(f=>f.path===state.active)||state.files[0];}
function language(path){return langs[extension(path)]||['纯文本',()=>[]];}
function notify(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function send(type,data={}){if(native)window.StudioBridge.postMessage(JSON.stringify({type,...data}));}
function snapshot(){return {version:1,files:state.files,active:state.active,opened:state.opened,stdin:$('stdin').value,settings:state.settings,noteTemplates:sanitizeTemplateState(state.noteTemplates),lecture:lectureSerialize(),tts:ttsSerialize(),drawStrokes:state.drawStrokes||[],drawView:getDrawView(),ai:aiSerialize(),model:modelSanitize(state.model),star:starSanitize(state.star,MODULES.map(m=>m.id)),focus:focusSanitize(state.focus),pelican:pelicanSanitize(state.pelican),cards:deckSanitize(state.cards),mistakes:bookSanitize(state.mistakes),habits:habitsSanitize(state.habits),schedule:scheduleSanitize(state.schedule),novel:shelfSanitize(state.novel),medquiz:quizStatsSanitize(state.medquiz)};}
/* 保存前先做体积预算：超限就明确告诉用户“哪一部分太大、要删什么”，
   不再让原生静默 return 掉整份草稿。 */
function mb(bytes){return (bytes/1048576).toFixed(1);}
function flush(){
  clearTimeout(saveTimer);
  if(!ready)return;
  state.stdin=$('stdin').value;
  const data=snapshot(),id=++revision;
  $('saveState').textContent='正在保存草稿…';
  if(native){
    let text='';
    try{text=JSON.stringify(data);}
    catch(e){$('saveState').textContent='草稿保存失败';notify('草稿序列化失败：'+(e.message||e));return;}
    if(text.length>WORKSPACE_LIMIT){
      $('saveState').textContent='草稿过大，未保存';
      notify('草稿体积 '+mb(text.length)+' MB，超过 '+mb(WORKSPACE_LIMIT)+' MB 上限，这次改动没有写入。请到「上课」里删掉一些 PPT 页面，或把重要内容另存后再清理。');
      return;
    }
    window.StudioBridge.postMessage('{"type":"snapshot","id":'+id+',"data":'+text+'}');
    return;
  }
  try{localStorage.setItem('ember-studio-v1',JSON.stringify(data));latestSaved=id;$('saveState').textContent='草稿已保存';}
  catch(e){$('saveState').textContent='草稿保存失败';notify('空间不足，请先另存重要文件。');}
}
function scheduleSave(){if(restoring)return;$('saveState').textContent='草稿待保存';clearTimeout(saveTimer);saveTimer=setTimeout(flush,450);}
function changed(){renderFiles();scheduleSave();}
function loadState(data){
  if(!data||data.version!==1||!Array.isArray(data.files)||!data.files.length)throw Error('无有效工作区');
  const unique=new Set();const files=data.files.filter(f=>validPath(f.path)&&typeof f.text==='string'&&f.text.length<=MAX_FILE&&!unique.has(f.path)&&unique.add(f.path)).slice(0,160).map(f=>({...f,uri:typeof f.uri==='string'?f.uri:'',encoding:f.encoding||'UTF-8',savedText:typeof f.savedText==='string'?f.savedText:f.text}));
  if(!files.length)throw Error('工作区文件无法读取');
  state={...defaults(),...data,files,settings:{...defaults().settings,...data.settings}};
  state.lecture=lectureSanitize(data.lecture);
  state.tts=ttsSanitize(data.tts);
  state.ai=(data&&data.ai&&typeof data.ai==='object')?data.ai:aiSerialize();
  state.noteTemplates=sanitizeTemplateState(data.noteTemplates);
  state.drawStrokes=Array.isArray(data.drawStrokes)?data.drawStrokes:[];
  state.drawView=(data&&data.drawView&&typeof data.drawView==='object')?data.drawView:null;
  state.model=modelSanitize(data.model);
  state.star=starSanitize(data.star,MODULES.map(m=>m.id));
  state.focus=focusSanitize(data.focus);
  /* 恢复时不自动继续计时，避免后台偷跑。 */
  state.focus.running=false;
  state.pelican=pelicanSanitize(data.pelican);
  state.cards=deckSanitize(data.cards);
  state.mistakes=bookSanitize(data.mistakes);
  state.habits=habitsSanitize(data.habits);
  state.schedule=scheduleSanitize(data.schedule);
  state.novel=shelfSanitize(data.novel);
  state.medquiz=quizStatsSanitize(data.medquiz);
  state.settings.fontSize=Math.max(12,Math.min(24,Number(state.settings.fontSize)||15));state.settings.timeLimit=[15,30,60].includes(+state.settings.timeLimit)?+state.settings.timeLimit:15;if(window.innerWidth<700)state.settings.wrap=true;
  adoptTheme(data.settings);
  state.active=files.some(f=>f.path===state.active)?state.active:files[0].path;state.opened=Array.isArray(state.opened)?state.opened.filter(p=>files.some(f=>f.path===p)):[];if(!state.opened.includes(state.active))state.opened.push(state.active);
}
function restore(data){try{loadState(data);}catch(e){if(data)notify('工作区格式无法读取；原备份未被覆盖，请先导出或检查。');}if(isNotepadNotePath(state.active))lastNotePath=state.active;restoring=true;editorStates.clear();$('stdin').value=state.stdin||'';createEditor();restoring=false;ready=true;renderFiles();applySettings();markLandingReady();lectureAfterRestore();ttsAfterRestore();aiRestore(state.ai);loadDrawView(state.drawView);if(state.drawStrokes&&state.drawStrokes.length)loadDrawStrokes(state.drawStrokes);}
function createEditor(){
 if(view)view.destroy();
 const config={doc:active().text,extensions:[
   basicSetup,
   codeTheme,
   syntaxHighlighting(codeHighlight),
   ...lectureExtensions,
   ...ttsExtensions,
   keymap.of([indentWithTab]),
   langConfig.of(language(active().path)[1]()),
   wrapConfig.of(state.settings.wrap?EditorView.lineWrapping:[]),
   editConfig.of(EditorState.readOnly.of(!!worker)),
   EditorView.contentAttributes.of({autocapitalize:'off',autocorrect:'off',spellcheck:'false',enterkeyhint:'enter',inputmode:'text'}),
   EditorView.updateListener.of(update=>{
     if(update.docChanged&&!restoring){const f=active();f.text=update.state.doc.toString();scheduleSave();refreshBadges();ttsDocumentChanged('edited');updateMdPreview();}
     if(update.selectionSet||update.docChanged)position();
   })
 ]};
 view=new EditorView({state:EditorState.create(config),parent:$('editor')});view.dom.style.fontSize=state.settings.fontSize+'px';editorStates.set(active().path,view.state);position();lectureViewCreated();
}
function position(){if(!view)return;const pos=view.state.selection.main.head,line=view.state.doc.lineAt(pos);$('position').textContent=`第 ${line.number} 行，第 ${pos-line.from+1} 列`;const note=$('noteCount');if(note&&document.body.classList.contains('notepad'))note.textContent=view.state.doc.length+' 字 · '+view.state.doc.lines+' 行';else if(note&&document.body.classList.contains('lecture'))note.textContent=lectureStatusText();else if(note&&document.body.classList.contains('tts'))note.textContent=ttsStatusText();else if(note&&document.body.classList.contains('aiview'))note.textContent=aiStatusText();else if(note&&document.body.classList.contains('modelview'))note.textContent=modelApi?modelApi.status():'';const empty=$('noteEmpty');if(empty){const blank=document.body.classList.contains('notepad')||document.body.classList.contains('lecture');empty.classList.toggle('show',blank&&view.state.doc.length===0);}}
function renderFiles(){
 const list=$('fileList');list.replaceChildren();for(const f of state.files){const row=document.createElement('div');row.className='fileitem'+(f.path===state.active?' active':'');const b=document.createElement('button');b.className='fileopen';b.title=f.path;b.dataset.path=f.path;const glyph=document.createElement('span');glyph.className='fileglyph';glyph.textContent=extension(f.path).slice(0,3);const name=document.createElement('span');name.textContent=f.path+(f.text!==f.savedText?' •':'');b.append(glyph,name);b.onclick=()=>switchFile(f.path);const menu=document.createElement('button');menu.className='filemenu';menu.textContent='⋯';menu.setAttribute('aria-label','重命名 '+f.path);menu.onclick=()=>nameDialog(f.path);row.append(b,menu);list.append(row);}
 refreshBadges();
}
function refreshBadges(){
 const f=active();if(!f)return;
 $('activePath').textContent=f.path;$('dirtyFlag').textContent=f.uri?(f.text===f.savedText?'已保存到原文件':'有修改 · 保存写回'):'本地草稿 · 自动保存';$('language').textContent=document.body.classList.contains('drawing')?'画画':language(f.path)[0];$('encoding').textContent=f.encoding||'UTF-8';$('runButton').textContent=['html','htm'].includes(extension(f.path))?'↗ 预览':'▶ 运行';
 for(const b of $('fileList').querySelectorAll('.fileopen')){const p=b.dataset.path,t=state.files.find(x=>x.path===p);if(!t)continue;const name=b.lastElementChild;if(name)name.textContent=p+(t.text!==t.savedText?' •':'');b.closest('.fileitem').classList.toggle('active',p===state.active);}
}
function switchFile(path){if(worker){notify('请先停止运行，再切换文件。');return;}const f=state.files.find(f=>f.path===path);if(!f)return;if(isNotepadNotePath(path)&&(workspaceMode==='notepad'||workspaceMode==='python'))lastNotePath=path;if(workspaceMode==='tts')lastTtsPath=path;editorStates.set(state.active,view.state);state.active=path;if(!state.opened.includes(path))state.opened.push(path);restoring=true;const previous=editorStates.get(path);if(previous&&previous.doc.toString()===f.text){view.setState(previous);view.dispatch({effects:[langConfig.reconfigure(language(path)[1]()),wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[]),editConfig.reconfigure(EditorState.readOnly.of(false))]});}else createEditor();restoring=false;renderFiles();document.body.classList.remove('drawer');position();scheduleSave();if(workspaceMode==='tts')ttsDocumentChanged('switched');}
function nameDialog(path=null){if(worker)return;renamePath=path;$('nameTitle').textContent=path?'修改工作区路径':'新建文件';$('confirmName').textContent=path?'重命名':'创建';$('fileName').value=path||(workspaceMode==='notepad'?'笔记.txt':workspaceMode==='tts'?'English.txt':'new_file.py');const hint=$('nameHint');if(hint)hint.textContent=workspaceMode==='notepad'?'可带子文件夹；例如 日记/今天.txt。':workspaceMode==='tts'?'可带子文件夹；例如 Articles/chapter-one.txt。':'可带子文件夹；请写扩展名，例如 .py。';$('nameDialog').returnValue='cancel';$('nameDialog').showModal();setTimeout(()=>$('fileName').select(),50);}
$('nameDialog').addEventListener('close',()=>{if($('nameDialog').returnValue!=='default')return;const path=$('fileName').value.trim();if(!validPath(path)){notify('路径无效，请使用文件名或 folder/file.py。');return;}if(state.files.some(f=>f.path===path)&&path!==renamePath){notify('已有同名文件。');return;}if(renamePath){const f=state.files.find(f=>f.path===renamePath);f.path=path;state.opened=state.opened.map(p=>p===renamePath?path:p);if(state.active===renamePath)state.active=path;editorStates.delete(renamePath);}else{if(state.files.length>=160){notify('当前工作区最多 160 个文件。');return;}state.files.push(makeFile(path,''));}switchFile(path);changed();});
const themeQuery=window.matchMedia('(prefers-color-scheme: dark)');
function prefersDark(){try{return !!themeQuery.matches;}catch(e){return false;}}
function syncTheme(){
  const theme=sanitizeTheme(state.settings);
  state.settings.appearance=theme.appearance;
  state.settings.accent=theme.accent;
  const resolved=applyTheme(document.documentElement,theme,prefersDark());
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',themeColor(resolved));
  paintThemeChoices();
}
function paintThemeChoices(){
  const appearance=state.settings.appearance;
  const accent=state.settings.accent;
  document.querySelectorAll('#themeAppearance button').forEach(btn=>{
    const on=btn.dataset.value===appearance;
    btn.classList.toggle('selected',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
  document.querySelectorAll('#themeAccent button').forEach(btn=>{
    const on=btn.dataset.value===accent;
    btn.classList.toggle('selected',on);
    btn.setAttribute('aria-pressed',on?'true':'false');
  });
}
function adoptTheme(settings){
  let stored;
  try{stored=readStoredTheme(localStorage);}catch(e){stored=sanitizeTheme(null);}
  const theme=themeFromSettings(settings,stored);
  state.settings.appearance=theme.appearance;
  state.settings.accent=theme.accent;
  try{writeStoredTheme(localStorage,theme);}catch(e){}
  syncTheme();
}
function chooseTheme(partial){
  adoptTheme({...sanitizeTheme(state.settings),...partial});
  scheduleSave();
}
function bindThemeGroup(id,key){
  const root=$(id);
  if(!root)return;
  root.addEventListener('click',event=>{
    const btn=event.target.closest('button');
    if(!btn||!root.contains(btn)||!btn.dataset.value)return;
    chooseTheme({[key]:btn.dataset.value});
  });
}
try{themeQuery.addEventListener('change',()=>{if(state.settings.appearance==='system')syncTheme();});}catch(e){}
adoptTheme(null);
bindThemeGroup('themeAppearance','appearance');
bindThemeGroup('themeAccent','accent');
function applySettings(){$('fontSize').value=state.settings.fontSize;$('fontSizeValue').textContent=state.settings.fontSize;$('wordWrap').checked=!!state.settings.wrap;$('timeLimit').value=state.settings.timeLimit;syncTheme();if(view){view.dom.style.fontSize=state.settings.fontSize+'px';view.dispatch({effects:[wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[])]});}}
for(const id of ['fontSize','wordWrap','timeLimit'])$(id).oninput=()=>{state.settings.fontSize=+$('fontSize').value;state.settings.wrap=$('wordWrap').checked;state.settings.timeLimit=+$('timeLimit').value;applySettings();scheduleSave();};
/* 报错行渲染成可点击链接：splitLocations 标出带「文件:行:列」的行。 */
function append(text,error=false){
 const out=$('output');
 if(out.textContent.length>=70000)return;
 const str=String(text).slice(0,70000-out.textContent.length);
 const frag=document.createDocumentFragment();
 for(const part of splitLocations(str)){
  const span=document.createElement('span');
  if(error)span.className='error';
  if(error&&part.loc){span.classList.add('errlink');span.dataset.path=part.loc.path;span.dataset.line=String(part.loc.line);span.dataset.col=String(part.loc.column||1);span.title='跳到 '+part.loc.path+':'+part.loc.line;}
  span.textContent=part.text;
  frag.append(span);
 }
 out.append(frag);out.scrollTop=out.scrollHeight;
}
/* 点击报错行：切到对应文件并把光标移到出错行列。 */
function gotoError(loc){
 if(!loc||worker)return;
 const f=state.files.find(x=>x.path===loc.path);
 if(!f){notify('找不到 '+loc.path+'，可能已重命名或删除。');return;}
 switchFile(loc.path);
 outputTab(false);
 if(!view)return;
 const doc=view.state.doc;
 const line=doc.line(Math.min(Math.max(1,loc.line),doc.lines));
 const pos=Math.min(line.from+Math.max(0,(loc.column||1)-1),line.to);
 view.dispatch({selection:{anchor:pos},scrollIntoView:true});
 view.focus();
}
/* 把当前终端输出存成工作区 txt 文件并打开，方便留存运行结果。 */
function saveOutputToFile(){
 const text=$('output').textContent;
 if(!text.trim()){notify('终端还没有输出可保存。');return;}
 if(state.files.length>=160){notify('工作区已满 160 个文件，先删掉一些再存。');return;}
 const now=new Date(),p=n=>String(n).padStart(2,'0');
 const stamp=now.getFullYear()+p(now.getMonth()+1)+p(now.getDate())+'-'+p(now.getHours())+p(now.getMinutes())+p(now.getSeconds());
 let path='输出-'+stamp+'.txt',seq=2;
 while(state.files.some(f=>f.path===path))path='输出-'+stamp+'-'+(seq++)+'.txt';
 state.files.push(makeFile(path,text));
 if(!state.opened.includes(path))state.opened.push(path);
 changed();
 switchFile(path);
 notify('输出已存为 '+path);
}
function setConsole(open){$('consolePanel').classList.toggle('folded',!open);$('foldConsole').setAttribute('aria-expanded',String(open));}
function outputTab(input=false){$('output').hidden=input;$('stdin').hidden=!input;$('inputTab').classList.toggle('active',input);$('outputTab').classList.toggle('active',!input);setConsole(true);}
function setRunning(running){$('runButton').hidden=running;$('stopButton').hidden=!running;for(const id of ['newFile','openFile','openFolder','saveButton','exportButton','menuNew','menuOpen','menuFolder','menuSave','menuGame','menuMode','menuTemplates','menuQuiz']){const el=$(id);if(el)el.disabled=running;}if(view)view.dispatch({effects:editConfig.reconfigure(EditorState.readOnly.of(running))});}
/* kill=false 时保留 C++ 常驻线程（编译器留在内存，下次运行免加载）；
   停止按钮、超时、出错都走 kill=true，死循环程序必须能杀掉。 */
function stop(reason='已停止运行',kill=true){runToken++;if(worker){if(kill||worker!==cppWorker){worker.terminate();if(worker===cppWorker)cppWorker=null;}}worker=null;clearTimeout(timeout);setRunning(false);$('runState').textContent=reason;}
function applyRunFiles(files){let updated=0;for(const f of files||[]){if(!validPath(f.path)||typeof f.text!=='string'||f.text.length>MAX_FILE)continue;const existing=state.files.find(x=>x.path===f.path);if(existing){if(existing.text===f.text)continue;existing.text=f.text;editorStates.delete(f.path);}else if(state.files.length<160)state.files.push(makeFile(f.path,f.text));else continue;updated++;}if(updated){restoring=true;createEditor();restoring=false;changed();append(`\n[工作区] 已保留 ${updated} 个新增或修改的文件，写回手机文件需点击保存。\n`);}}
async function run(){
 if(worker)return;const f=active(),ext=extension(f.path);if(['html','htm'].includes(ext)){preview();return;}if(!['py','js','mjs','c','cc','cpp','cxx'].includes(ext)){notify(language(f.path)[0]+' 只能编辑，不能运行。可运行 .py、.js、.cpp/.c，或预览 .html。');return;}
 const isCpp=['c','cc','cpp','cxx'].includes(ext);
 flush();outputTab(false);$('output').replaceChildren();$('runState').textContent=ext==='py'?'准备 Python…':isCpp?(cppWorker?'编译 C/C++…':'准备 C/C++ 编译器…'):'运行 JavaScript…';runFiles=state.files.map(f=>({path:f.path,text:f.text}));const token=++runToken;
 /* C++ 线程常驻复用：编译器只加载一次；Python/JS 仍每次新建。 */
 worker=isCpp?(cppWorker||(cppWorker=new Worker('cpp-worker.js'))):new Worker(ext==='py'?'python-worker.js':'javascript-worker.js');
 setRunning(true);const started=performance.now();let hasStarted=false;
 /* C++ 首次要读 28 MB 本地工具链再编译，准备阶段给 120 秒；复用后编译很快。运行上限从 started 起算。 */
 timeout=setTimeout(()=>{if(token!==runToken)return;append('\n准备超时，已停止。'+(isCpp?'C++ 编译器首次加载较慢，请重试；多次失败请更新系统 WebView。':'可以在设置中调整运行上限。')+'\n',true);stop('准备超时');},isCpp&&!cppWorker?120000:isCpp?60000:45000);
 worker.onmessage=event=>{if(token!==runToken)return;const m=event.data||{};if(m.runId!==undefined&&m.runId!==token)return;if(m.type==='loading'){$('runState').textContent='读取本地 C++ 编译器…';}else if(m.type==='progress'){const pct=Math.round((m.value||0)*100);$('runState').textContent='读取编译器 '+pct+'%（仅首次较慢）';}else if(m.type==='started'&&!hasStarted){hasStarted=true;clearTimeout(timeout);$('runState').textContent='运行中 · 可停止';timeout=setTimeout(()=>{append('\n达到运行上限，已终止工作线程。\n',true);stop('运行超时');},state.settings.timeLimit*1000);}else if(m.type==='stdout'||m.type==='stderr')append(m.text,m.type==='stderr');else if(m.type==='done'){const elapsed=((performance.now()-started)/1000).toFixed(2);stop(m.ok?'执行完成 · '+elapsed+'s':'执行失败 · '+elapsed+'s',false);applyRunFiles(m.files);flush();}else if(m.type==='error'){append(m.text+'\n',true);stop('运行环境未能启动');}};
 worker.onerror=event=>{if(token!==runToken)return;append('运行环境错误：'+event.message+'\n请确认系统 WebView 支持 WebAssembly。\n',true);stop('运行环境错误');};
 worker.postMessage({runId:token,path:f.path,code:f.text,files:runFiles,stdin:$('stdin').value});
}
function preview(){flush();if(native){send('preview',{path:active().path,files:state.files.map(f=>({path:f.path,text:f.text}))});return;}const dlg=document.createElement('dialog');dlg.style.cssText='width:96vw;height:90vh;padding:8px;max-width:1100px';const close=document.createElement('button');close.textContent='关闭预览';close.onclick=()=>{dlg.close();dlg.remove();};const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.style.cssText='width:100%;height:90%;background:white;border:0';let content=active().text;content=content.replace(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/gi,(tag,path)=>{const f=state.files.find(f=>f.path===path);return f?'<style>'+f.text+'</style>':tag;}).replace(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,(tag,path)=>{const f=state.files.find(f=>f.path===path);return f?'<script>'+f.text+'</script>':tag;});frame.srcdoc=content;dlg.append(close,frame);document.body.append(dlg);dlg.showModal();}
function saveFile(as=false){flush();const f=active(),id=String(Date.now())+'-'+Math.random();if(native){pendingSaves.set(id,{path:f.path,text:f.text});send(as||!f.uri?'export':'save',{id,path:f.path,text:f.text,uri:f.uri,encoding:f.encoding});}else{const blob=new Blob([f.text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=f.path.split('/').pop();a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);f.savedText=f.text;changed();notify('已导出文件。');}}
function importFiles(files){if(worker){notify('请停止运行后再导入。');return null;}let first='',backups=0,accepted=0;for(const file of files){if(!validPath(file.path)||typeof file.text!=='string'||file.text.length>MAX_FILE)continue;let path=file.path;const existing=state.files.find(f=>f.path===path);if(existing&&existing.uri!==file.uri){if(state.files.length>=159){notify('文件过多，请先另存草稿后重试。');break;}const backup='_草稿备份/'+Date.now()+'_'+path.split('/').pop().slice(-140);existing.path=backup;existing.uri='';state.opened=state.opened.map(p=>p===path?backup:p);editorStates.delete(path);backups++;}else if(existing){if(existing.text!==existing.savedText){notify('文件存在未写回的编辑，已保留草稿。');continue;}Object.assign(existing,makeFile(path,file.text,file.uri,file.encoding));accepted++;if(!first)first=path;continue;}if(state.files.length>=160)break;state.files.push(makeFile(path,file.text,file.uri||'',file.encoding||'UTF-8'));accepted++;if(!first)first=path;}if(first)switchFile(first);changed();if(backups)notify('导入文件保留原名；同名旧稿已移到 _草稿备份。');return {accepted,backups};}
async function browserImport(event){const files=[];let skipped=0;for(const f of [...event.target.files].slice(0,160)){if(f.size>MAX_FILE){skipped++;continue;}try{const bytes=new Uint8Array(await f.arrayBuffer());if(bytes.includes(0))throw Error('binary');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);files.push({path:f.webkitRelativePath||f.name,text,uri:'browser:'+f.name});}catch(e){skipped++;}}const result=importFiles(files);notify(`已接收 ${result?.accepted||0} / ${files.length} 个文本文件${skipped?'，另跳过 '+skipped+' 个非文本或过大文件':''}`);event.target.value='';}
window.StudioNative={receive(m){
  if(!m)return;
  if(m.type==='aiToolResult'){const r=aiToolWaiters.get(m.id);if(r){aiToolWaiters.delete(m.id);r(m.data||(m.ok?'完成':'操作未完成'));}return;}
  /* 课堂模式的媒体回执（mediaPut / mediaGc）先交给 lecture 处理。 */
  if(lectureMediaMessage(m))return;
  /* 上课前预热麦克风权限的回执（见 EditorActivity.micPermission）。 */
  if(m.type==='micPermission'){const done=micWaiters.get(m.id);if(done){micWaiters.delete(m.id);done(!!m.granted);}return;}
  if(m.type==='restore'){restore(m.data);if(m.error)notify(m.error);}
  /* 草稿保存失败（体积超限、磁盘满、旧工作区只读）必须让用户看见，
     不能只在状态栏留一句“草稿保存失败”。 */
  else if(m.type==='snapshotSaved'){
    if(m.id>=latestSaved){
      latestSaved=m.id;
      if(m.id===revision){
        $('saveState').textContent=m.ok?'草稿已保存':'草稿保存失败';
        if(!m.ok&&m.message)notify(m.message);
      }
    }
  }
  else if(m.type==='imported'){const result=importFiles(m.files||[]);if(result&&result.accepted<(m.files||[]).length)notify('工作区接收 '+result.accepted+' / '+m.files.length+' 个文件，其余因容量或未保存草稿冲突未导入；原文件保留。');else notify((m.message||'导入完成')+(result?.backups?'；同名旧稿已备份':''));}
  else if(m.type==='saved'){const pending=pendingSaves.get(m.id);pendingSaves.delete(m.id);if(m.ok&&pending){if(pending.binary){notify('已导出到手机文件。');}else{const f=state.files.find(f=>f.path===pending.path);if(f){f.savedText=pending.text;f.uri=m.uri||f.uri;f.encoding=m.encoding||f.encoding;changed();}notify('已保存到手机文件。');}}else notify(m.message||'保存未完成，草稿仍保留。');}
  /* 一次性出题请求有独立的 quiz- id；先于聊天接收器，避免落进 AI 会话。 */
  else if(quizRequester.receive(m)){}
  else if(ttsReceive(m)){}
  else if(aiReceive(m)){}
  else if(m.type==='capabilities'){moduleCaps={...m,native:true};refreshAvailability();}
  else if(m.type==='moduleReturned')nativeReturned(m.id);
  else if(m.type==='notice')notify(m.message);
  else if(m.type==='gameState')$('gameSaveInfo').textContent=m.exists?'发现游戏存档 · 进入后点击“继续旅程”。':'尚无游戏存档 · 开始后会自动保存。';
}};
/* One activation path per control. pointerup used to fire before click and let the
   interface change underneath the finger (drawer opening, Run becoming Stop), which
   made 0.1.7 buttons feel broken on phones. */
const on=(id,fn)=>{const el=$(id);if(el)el.addEventListener('click',fn);};
const closeDrawer=()=>document.body.classList.remove('drawer');
const closeMenu=()=>{const m=$('menuDialog');if(m&&m.open)m.close();};
const menu=(id,fn)=>on(id,()=>{closeMenu();fn();});
/* The file drawer lives inside #workbench. Hiding that section also hides the drawer,
   so the game page only adds gameview and lets CSS collapse the editor. */
function showGame(){flush();closeDrawer();closeMenu();$('lounge').hidden=false;document.body.classList.add('gameview');$('activePath').textContent='游戏';$('dirtyFlag').textContent='伍子平 · 星火远征';const gameTab=$('gameTab');if(gameTab)gameTab.classList.add('selected');const backToFile=$('codeTab');if(backToFile){backToFile.classList.remove('selected');backToFile.textContent=workspaceMode==='game'?'← 回到首页':'← 返回刚才的文件';}send('gameState');}
function showCode(){closeMenu();$('workbench').hidden=false;$('lounge').hidden=true;document.body.classList.remove('gameview');const gameTab=$('gameTab');if(gameTab)gameTab.classList.remove('selected');const codeTab=$('codeTab');if(codeTab)codeTab.classList.add('selected');renderFiles();if(view)view.requestMeasure();}
function setWorkspaceMode(mode){
  workspaceMode=selectedMode=mode;
  const drawToggle=$('drawToggle');if(drawToggle)drawToggle.hidden=mode!=='notepad';
  const mdToggle=$('mdToggle');if(mdToggle)mdToggle.hidden=mode!=='notepad';
  if(mode!=='notepad')setMdPreview(false);
  if(mode!=='notepad')document.body.classList.remove('notepad');
  if(mode!=='lecture')document.body.classList.remove('lecture');
  if(mode!=='tts')document.body.classList.remove('tts');
  if(mode!=='ai')document.body.classList.remove('aiview');
  if(mode!=='game')document.body.classList.remove('gameview');
  if(mode!=='model')document.body.classList.remove('modelview');
  if(mode!=='focus')document.body.classList.remove('focusview');
  if(mode!=='pelican')document.body.classList.remove('pelicanview');
  if(mode!=='cards')document.body.classList.remove('cardsview');
  if(mode!=='mistakes')document.body.classList.remove('mistakesview');
  if(mode!=='habits')document.body.classList.remove('habitsview');
  if(mode!=='schedule')document.body.classList.remove('scheduleview');
  if(mode!=='novel')document.body.classList.remove('novelview');
  if(mode!=='medquiz')document.body.classList.remove('medquizview');
  for(const [id,m] of [['focusPanel','focus'],['pelicanPanel','pelican'],['cardsPanel','cards'],['mistakesPanel','mistakes'],['habitsPanel','habits'],['schedulePanel','schedule'],['novelPanel','novel'],['medquizPanel','medquiz'],['modelPanel','model'],['aiPanel','ai']]){
    const el=$(id);if(el&&mode!==m)el.hidden=true;
  }
}
on('filesToggle',()=>{closeMenu();document.body.classList.toggle('drawer');});on('backdrop',closeDrawer);on('closeExplorer',closeDrawer);on('newFile',()=>nameDialog());on('newTab',()=>nameDialog());menu('menuNew',()=>nameDialog());
menu('findButton',()=>{openSearchPanel(view);const searchInput=document.querySelector('.cm-search input');if(searchInput)searchInput.focus();else if(view)view.focus();});menu('settingsButton',()=>{applySettings();$('settingsDialog').showModal();});on('saveButton',()=>saveFile());menu('menuSave',()=>saveFile());menu('exportButton',()=>saveFile(true));on('runButton',run);on('stopButton',()=>{append('\n[已手动停止]\n');stop();});on('outputTab',()=>outputTab(false));on('inputTab',()=>outputTab(true));on('clearOutput',()=>$('output').replaceChildren());on('saveOutput',saveOutputToFile);$('output').addEventListener('click',event=>{const link=event.target.closest('.errlink');if(link)gotoError({path:link.dataset.path,line:+link.dataset.line,column:+link.dataset.col||1});});on('foldConsole',()=>setConsole($('consolePanel').classList.contains('folded')));on('openFile',()=>{flush();closeDrawer();native?send('open'):$('browserFiles').click();});on('openFolder',()=>{flush();closeDrawer();native?send('folder'):$('browserFolder').click();});menu('menuOpen',()=>{flush();native?send('open'):$('browserFiles').click();});menu('menuFolder',()=>{flush();native?send('folder'):$('browserFolder').click();});on('moreButton',()=>$('menuDialog').showModal());$('browserFiles').onchange=browserImport;$('browserFolder').onchange=browserImport;$('stdin').oninput=scheduleSave;
on('codeTab',()=>{if(workspaceMode==='game'){flush();openLanding(true);return;}showCode();});on('gameTab',showGame);menu('menuGame',showGame);menu('menuMode',()=>{flush();openLanding(true);});on('playGame',()=>{flush();if(native)send('play');else notify('此预览仅展示编辑器，安装 APK 后可直接进入原生游戏。');});on('exportGame',()=>native?send('exportGame'):notify('游戏存档备份在 Android APK 中使用。'));on('importGame',()=>native?send('importGame'):notify('安装 APK 后可导入游戏备份。'));on('drawToggle',()=>{if(workspaceMode!=='notepad')return;if(isDrawMode()){exitDrawMode();}else{enterDrawMode();}});
/* Markdown 预览：记事本里把当前笔记渲染成排版视图，纯展示不可编辑。 */
let mdOn=false;
function updateMdPreview(){
  const box=$('mdPreview');if(!box||!mdOn)return;
  box.innerHTML=renderMarkdown(view?view.state.doc.toString():'');
}
function setMdPreview(on){
  mdOn=!!on&&workspaceMode==='notepad';
  const box=$('mdPreview'),btn=$('mdToggle');
  if(box)box.hidden=!mdOn;
  if(btn)btn.setAttribute('aria-pressed',mdOn?'true':'false');
  if(mdOn)updateMdPreview();
}
on('mdToggle',()=>{if(workspaceMode!=='notepad')return;if(isDrawMode())exitDrawMode();setMdPreview(!mdOn);});
$('menuDialog').addEventListener('click',event=>{if(event.target===$('menuDialog'))$('menuDialog').close();});
/* 菜单关掉以后焦点别丢在 body 上：没有别的对话框接着开、也没有谁自己接过焦点，
   就还给齿轮按钮。老 WebView 的 focus(options) 可能不接受参数，兜一层。 */
$('menuDialog').addEventListener('close',()=>{
 if(document.querySelector('dialog[open]'))return;
 const current=document.activeElement;
 if(current&&current!==document.body)return;
 const more=$('moreButton');if(!more)return;
 try{more.focus({preventScroll:true});}catch(e){try{more.focus();}catch(ignored){}}
});
/* AI 输入区表单：内联 onsubmit="return false" 违反 CSP（script-src 不含 unsafe-inline），
   换成显式监听阻止提交时的页面导航。发送逻辑（Ctrl+Enter / 点击）在 ai.js，不受影响。 */
$('aiComposer').addEventListener('submit',event=>event.preventDefault());

/* ---------------- 笔记模板 ---------------- */
const quizRequester=createQuizRequester({send:(type,data)=>send(type,data),notify,native});
let quizCurrent=null,quizAnswers={},quizSelfGrades={},quizResult=null,quizNoteText='',quizRequestToken=0;

function currentAISettings(){
  const data=aiSerialize();
  return data&&data.settings?data.settings:{};
}
function templateDanger(){
  const lecture=workspaceMode==='lecture';
  return {lecture,recording:lecture&&lectureBusy(),hasStamps:lecture&&lectureStampCount()>0};
}
function renderTemplateChoices(){
  const list=$('templateList');if(!list)return;
  list.replaceChildren();
  const selected=(state.noteTemplates&&state.noteTemplates.last)||'blank';
  for(const template of NOTE_TEMPLATES){
    const card=document.createElement('button');
    card.type='button';card.className='template-card'+(template.id===selected?' selected':'');
    card.dataset.template=template.id;card.setAttribute('role','radio');
    card.setAttribute('aria-checked',template.id===selected?'true':'false');
    const title=document.createElement('strong');title.textContent=template.title;
    const copy=document.createElement('small');copy.textContent=template.description;
    card.append(title,copy);
    card.onclick=()=>{
      state.noteTemplates=sanitizeTemplateState({last:template.id});
      scheduleSave();renderTemplateChoices();updateTemplateHint();
    };
    list.append(card);
  }
}
function updateTemplateHint(){
  const template=templateById(state.noteTemplates&&state.noteTemplates.last)||NOTE_TEMPLATES[0];
  const danger=templateDanger();
  const hint=$('templateHint'),insert=$('templateInsert');
  if(!hint||!insert)return;
  if(danger.lecture){
    hint.textContent=danger.recording||danger.hasStamps
      ?'课堂笔记固定为「课堂笔记.md」，并靠时间戳定位。当前'+(danger.recording?'正在录音':'已有时间戳')+'，插入模板会打乱时间轴；请用「新建模板笔记」另存一篇。'
      :'课堂笔记固定为「课堂笔记.md」。当前没有时间戳，可以插入；录音开始后请改用新建。';
    insert.disabled=danger.recording||danger.hasStamps;
  }else{
    hint.textContent='「新建模板笔记」会创建 '+template.baseName+'.md，重名自动编号；「插入当前笔记」把模板放到光标处。';
    insert.disabled=!!worker;
  }
}
function openTemplateDialog(){
  if(worker){notify('请先停止运行，再使用笔记模板。');return;}
  closeMenu();renderTemplateChoices();updateTemplateHint();
  const dlg=$('templateDialog');if(dlg&&!dlg.open)dlg.showModal();
}
function createTemplateNote(){
  if(worker){notify('请先停止运行，再新建模板笔记。');return;}
  const template=templateById(state.noteTemplates&&state.noteTemplates.last)||NOTE_TEMPLATES[0];
  if(state.files.length>=160){
    const hint=$('templateHint');if(hint)hint.textContent='当前工作区最多 160 个文件，先整理或导出一些草稿。';
    notify('当前工作区最多 160 个文件。');return;
  }
  const action=noteTemplateAction({mode:workspaceMode,action:'create'});
  if(!action.ok){notify(action.message);return;}
  const path=templateFileName(template.id,state.files.map(file=>file.path));
  state.files.push(makeFile(path,template.content));
  if(!state.opened.includes(path))state.opened.push(path);
  changed();
  const dlg=$('templateDialog');if(dlg&&dlg.open)dlg.close();
  const open=action.open&&(workspaceMode==='notepad'||workspaceMode==='python');
  if(open){
    switchFile(path);
    notify('已新建模板笔记：'+path);
  }else{
    scheduleSave();
    notify('已新建模板笔记：'+path+'；当前课堂笔记和录音时间戳保持不变，可在文件列表打开。');
  }
}
function insertTemplateNote(){
  if(worker){notify('请先停止运行，再插入模板。');return;}
  const template=templateById(state.noteTemplates&&state.noteTemplates.last)||NOTE_TEMPLATES[0];
  if(!template.content.trim()){
    const hint=$('templateHint');if(hint)hint.textContent='空白模板没有正文；请用「新建模板笔记」创建空白文件。';
    notify('空白模板没有正文；请用「新建模板笔记」创建空白文件。');return;
  }
  const danger=templateDanger();
  const action=noteTemplateAction({mode:workspaceMode,action:'insert',recording:danger.recording,hasStamps:danger.hasStamps});
  if(!action.ok){notify(action.message);updateTemplateHint();return;}
  if(!view){notify('编辑器还没有准备好。');return;}
  const selection=view.state.selection.main;
  const result=insertTemplate(view.state.doc.toString(),template.content,{from:selection.from,to:selection.to});
  if(!result.insert){notify('没有可插入的内容。');return;}
  view.dispatch({changes:{from:result.from,to:result.to,insert:result.insert},selection:{anchor:result.cursor},scrollIntoView:true});
  changed();
  const dlg=$('templateDialog');if(dlg&&dlg.open)dlg.close();
  notify('已插入「'+template.title+'」模板。');
}
on('templateCancel',()=>{const dlg=$('templateDialog');if(dlg&&dlg.open)dlg.close();});
on('templateCreate',createTemplateNote);
on('templateInsert',insertTemplateNote);
$('templateDialog').addEventListener('click',event=>{if(event.target===$('templateDialog'))$('templateDialog').close();});
menu('menuTemplates',openTemplateDialog);

/* ---------------- 代码片段库 ---------------- */
function openSnippetDialog(){
  if(worker){notify('请先停止运行，再插入代码片段。');return;}
  closeMenu();
  const dlg=$('snippetDialog'),list=$('snippetList'),lead=$('snippetLead');
  if(!dlg||!list)return;
  const ext=extension(active()?active().path:'');
  const items=snippetsFor(ext);
  list.replaceChildren();
  if(!items.length){
    if(lead)lead.textContent='当前文件（.'+(ext||'无扩展名')+'）暂时没有配套片段。支持 Python、C/C++、JavaScript、HTML、CSS。';
    const p=document.createElement('p');p.className='hint';p.textContent='换个对应语言的代码文件再试试。';list.append(p);
  }else{
    if(lead)lead.textContent='当前语言：'+language(active().path)[0]+'，共 '+items.length+' 个片段。点一下插到光标处。';
    for(const s of items){
      const card=document.createElement('button');
      card.type='button';card.className='snippet-card';
      const title=document.createElement('strong');title.textContent=s.title;
      const desc=document.createElement('small');desc.textContent=s.desc;
      card.append(title,desc);
      card.onclick=()=>insertSnippet(s.id);
      list.append(card);
    }
  }
  dlg.showModal();
}
function insertSnippet(id){
  if(worker){notify('请先停止运行，再插入代码片段。');return;}
  const s=snippetById(id);
  if(!s||!view){notify('编辑器还没有准备好。');return;}
  const sel=view.state.selection.main;
  view.dispatch({changes:{from:sel.from,to:sel.to,insert:s.code},selection:{anchor:sel.from+s.code.length},scrollIntoView:true});
  changed();
  const dlg=$('snippetDialog');if(dlg&&dlg.open)dlg.close();
  notify('已插入「'+s.title+'」片段。');
}
on('snippetClose',()=>{const dlg=$('snippetDialog');if(dlg&&dlg.open)dlg.close();});
$('snippetDialog').addEventListener('click',event=>{if(event.target===$('snippetDialog'))$('snippetDialog').close();});
menu('menuSnippets',openSnippetDialog);

/* ---------------- 全项目搜索 ---------------- */
function runProjectSearch(){
  const input=$('searchInput'),list=$('searchResults'),meta=$('searchMeta');
  if(!input||!list)return;
  const q=input.value;
  const caseSensitive=$('searchCase')&&$('searchCase').checked;
  const {results,total,truncated}=searchProject(state.files,q,{caseSensitive,maxResults:200,maxPerFile:20});
  list.replaceChildren();
  if(!q.trim()){
    if(meta)meta.textContent='输入关键词，在所有工作区文件里查找。';
    return;
  }
  if(meta)meta.textContent=total?('找到 '+total+' 处'+(truncated?'（仅显示前 '+results.length+' 处）':'')):'没有匹配。';
  for(const r of results){
    const row=document.createElement('button');
    row.type='button';row.className='search-row';
    const loc=document.createElement('span');loc.className='search-loc';loc.textContent=r.path+':'+r.line;
    const txt=document.createElement('span');txt.className='search-text';txt.textContent=r.text.trim()||'（空行）';
    row.append(loc,txt);
    row.onclick=()=>{
      const dlg=$('searchDialog');if(dlg&&dlg.open)dlg.close();
      gotoError({path:r.path,line:r.line,column:r.column});
    };
    list.append(row);
  }
}
function openSearchDialog(){
  closeMenu();
  const dlg=$('searchDialog');if(!dlg)return;
  dlg.showModal();
  const input=$('searchInput');
  if(input){input.value='';setTimeout(()=>input.focus(),50);}
  runProjectSearch();
}
on('searchClose',()=>{const dlg=$('searchDialog');if(dlg&&dlg.open)dlg.close();});
$('searchDialog').addEventListener('click',event=>{if(event.target===$('searchDialog'))$('searchDialog').close();});
$('searchInput').addEventListener('input',runProjectSearch);
$('searchCase').addEventListener('change',runProjectSearch);
menu('menuSearch',openSearchDialog);

/* ---------------- 笔记生成试题 ---------------- */
function setQuizStage(stage){
  const dlg=$('quizDialog');if(!dlg)return;
  dlg.dataset.stage=stage;
  $('quizSetup').hidden=stage!=='setup';
  $('quizProgress').hidden=stage!=='generating';
  $('quizBody').hidden=stage!=='ready'&&stage!=='graded';
  $('quizSubmit').hidden=stage!=='ready';
  $('quizRegenerate').hidden=stage==='generating';
  $('quizCancel').hidden=stage!=='generating';
  if(stage==='ready'){const result=$('quizResult');if(result){result.hidden=true;result.replaceChildren();}}
}
function openQuizDialog(){
  if(worker){notify('请先停止运行，再使用笔记出题。');return;}
  closeMenu();
  const dlg=$('quizDialog');if(!dlg||dlg.open)return;
  quizRequestToken++;
  quizRequester.cancel({silent:true});
  quizCurrent=null;quizAnswers={};quizSelfGrades={};quizResult=null;
  quizNoteText=view?view.state.doc.toString():active().text;
  const path=active()?active().path:'当前笔记';
  const noteInfo=$('quizNoteInfo');
  if(noteInfo)noteInfo.textContent='当前笔记：'+path+' · '+quizNoteText.length+' 字';
  const availability=quizAIAvailability(currentAISettings(),{native});
  const ai=$('quizAi'),offline=$('quizOffline'),hint=$('quizHint'),privacy=$('quizPrivacy');
  const empty=!quizNoteText.trim();
  if(ai){ai.disabled=empty||!availability.ok;ai.textContent=availability.ok?'AI 生成（发送笔记）':'AI 生成不可用';ai.classList.toggle('primary',availability.ok);ai.hidden=false;}
  if(offline){offline.disabled=empty;offline.classList.toggle('primary',!availability.ok);}
  if(privacy)privacy.textContent='隐私：点「AI 生成」会把当前笔记正文（最多前 '+QUIZ_NOTE_LIMIT+' 字）发送到你配置的接口'+(availability.endpoint?'（'+availability.endpoint+'）':'')+'。只有点击按钮才会发送；取消或关闭对话框会中断这次请求。离线练习只在本机从笔记句子出题，不发送任何内容。';
  if(hint)hint.textContent=empty?'当前笔记是空的，先写几句。':(availability.ok?'AI 与离线练习都可以用。':'暂不能使用 AI：'+availability.message);
  setQuizStage('setup');
  dlg.showModal();
}
function quizAnswersFromForm(){
  const answers={};
  if(!quizCurrent)return answers;
  for(const question of quizCurrent.questions){
    if(question.type==='single'){
      const checked=document.querySelector('input[name="quiz-'+question.id+'"]:checked');
      answers[question.id]=checked?checked.value:'';
    }else{
      const input=document.querySelector('.quiz-input[data-qid="'+question.id+'"],.quiz-textarea[data-qid="'+question.id+'"]');
      answers[question.id]=input?input.value:'';
    }
  }
  return answers;
}
function renderQuiz(quiz){
  quizCurrent=quiz;quizAnswers={};quizSelfGrades={};quizResult=null;
  const title=$('quizMetaTitle'),source=$('quizSource'),hint=$('quizHint');
  if(title)title.textContent=quiz.title||'笔记练习';
  if(source){source.textContent=quiz.source==='ai'?'AI 生成':'离线基础练习';source.className='quiz-source '+(quiz.source==='ai'?'ai':'offline');}
  if(hint)hint.textContent=quiz.note||(quiz.source==='ai'?'题目由 AI 生成；解析和原文依据仅供参考。':'题目在本机从笔记句子和关键词生成；答案回指原文。');
  const box=$('quizQuestions');if(box)box.replaceChildren();
  quiz.questions.forEach((question,index)=>{
    const card=document.createElement('section');card.className='quiz-question';card.dataset.qid=question.id;
    const head=document.createElement('div');head.className='quiz-qhead';
    const number=document.createElement('span');number.className='quiz-number';number.textContent=String(index+1);
    const type=document.createElement('span');type.className='quiz-type';type.textContent=QUIZ_TYPE_LABELS[question.type]||question.type;
    head.append(number,type);
    const prompt=document.createElement('p');prompt.className='quiz-prompt';prompt.textContent=question.question;
    card.append(head,prompt);
    if(question.type==='single'){
      const options=document.createElement('div');options.className='quiz-options';
      question.options.forEach((option,optionIndex)=>{
        const label=document.createElement('label');label.className='quiz-option';
        const input=document.createElement('input');input.type='radio';input.name='quiz-'+question.id;input.value=option;
        const text=document.createElement('span');text.textContent=String.fromCharCode(65+optionIndex)+'. '+option;
        label.append(input,text);options.append(label);
      });
      card.append(options);
    }else if(question.type==='blank'){
      const input=document.createElement('input');input.type='text';input.className='quiz-input';input.dataset.qid=question.id;
      input.autocomplete='off';input.placeholder='填写答案';input.setAttribute('aria-label','第 '+(index+1)+' 题填空答案');
      card.append(input);
    }else{
      const area=document.createElement('textarea');area.className='quiz-textarea';area.dataset.qid=question.id;
      area.rows=3;area.placeholder='用自己的话回答；提交后可自评';area.setAttribute('aria-label','第 '+(index+1)+' 题简答');
      card.append(area);
    }
    const feedback=document.createElement('div');feedback.className='quiz-feedback';feedback.hidden=true;
    card.append(feedback);
    if(box)box.append(card);
  });
  const submit=$('quizSubmit');if(submit){submit.disabled=false;submit.hidden=false;}
  const save=$('quizSave');if(save){save.disabled=false;save.textContent='保存练习';save.hidden=true;}
  const retry=$('quizRetry');if(retry)retry.hidden=true;
  const result=$('quizResult');if(result){result.hidden=true;result.replaceChildren();}
}
function renderQuizFeedback(){
  if(!quizCurrent||!quizResult)return;
  const resultById=new Map(quizResult.items.map(item=>[item.id,item]));
  const box=$('quizQuestions');
  if(box)for(const card of box.querySelectorAll('.quiz-question')){
    const question=quizCurrent.questions.find(item=>item.id===card.dataset.qid);
    const item=resultById.get(card.dataset.qid);
    if(!question||!item)continue;
    card.classList.toggle('correct',item.status==='correct');
    card.classList.toggle('wrong',item.status==='wrong');
    card.classList.toggle('pending',item.status==='self');
    for(const input of card.querySelectorAll('input,textarea'))input.disabled=true;
    const feedback=card.querySelector('.quiz-feedback');if(!feedback)continue;
    feedback.hidden=false;feedback.replaceChildren();
    const status=document.createElement('strong');status.className='quiz-feedback-status';
    status.textContent=item.status==='correct'?(item.selfGraded?'✓ 自评：答对了':'✓ 回答正确'):item.status==='wrong'?(item.selfGraded?'✗ 自评：还需加强':'✗ 回答错误'):'… 简答题待自评';
    feedback.append(status);
    if(question.type==='short'&&item.status==='self'){
      const row=document.createElement('div');row.className='quiz-selfgrade';
      for(const [value,label] of [[true,'答对了'],[false,'还需加强']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.onclick=()=>{
          quizSelfGrades[question.id]=value;
          quizResult=gradeQuiz(quizCurrent,quizAnswers,quizSelfGrades);
          renderQuizFeedback();
        };
        row.append(button);
      }
      feedback.append(row);
    }
    if(item.response&&String(item.response).trim()){
      const mine=document.createElement('p');mine.className='quiz-mine';mine.textContent='我的作答：'+item.response;feedback.append(mine);
    }
    const answer=document.createElement('p');answer.className='quiz-correct-answer';
    answer.textContent='正确答案：'+(question.type==='single'&&question.answerIndex>=0?String.fromCharCode(65+question.answerIndex)+'. ':'')+question.answer;
    feedback.append(answer);
    if(question.explanation){const p=document.createElement('p');p.className='quiz-explanation';p.textContent='解析：'+question.explanation;feedback.append(p);}
    if(question.evidence){
      const p=document.createElement('p');p.className='quiz-evidence';
      p.textContent='原文依据'+(question.evidenceLine?'（第 '+question.evidenceLine+' 行）':'')+'：'+question.evidence;
      feedback.append(p);
    }
  }
  updateQuizSummary();
}
function updateQuizSummary(){
  if(!quizResult)return;
  const box=$('quizResult');if(!box)return;
  box.hidden=false;box.replaceChildren();
  const score=document.createElement('strong');score.className='quiz-score';
  score.textContent=quizResult.complete
    ?'得分 '+quizResult.correct+' / '+quizResult.total+' · '+quizResult.score+' 分'
    :'自动判分 '+quizResult.correct+' / '+quizResult.decided+' · '+quizResult.pending+' 道简答待自评';
  const note=document.createElement('p');
  note.textContent=quizResult.complete?'可以点「保存练习」把题目、答案和原文依据写入工作区。':'简答题自评后会重新计算得分。';
  box.append(score,note);
  const retry=$('quizRetry');if(retry)retry.hidden=!quizResult.items.some(item=>item.status==='wrong');
  const save=$('quizSave');if(save)save.hidden=false;
}
function startQuizGeneration(forceOffline){
  if(!quizNoteText.trim()){
    const hint=$('quizHint');if(hint)hint.textContent='当前笔记为空，先写几句再出题。';
    notify('当前笔记为空，先写几句再出题。');return;
  }
  const token=++quizRequestToken;
  let request;
  try{
    request=quizRequester.generate({
      noteText:quizNoteText,
      settings:currentAISettings(),
      count:normalizeQuizCount($('quizCount').value),
      forceOffline,
      nativeAllowed:native
    });
  }catch(error){
    setQuizStage('setup');
    const hint=$('quizHint');if(hint)hint.textContent='练习生成失败：'+(error&&error.message?error.message:error);
    notify('练习生成失败，请重试。');
    return;
  }
  setQuizStage('generating');
  const cancel=$('quizCancel');if(cancel)cancel.hidden=request.mode!=='ai';
  const progress=$('quizProgressText');
  if(progress)progress.textContent=forceOffline?'正在本机生成离线练习…':(request.mode==='ai'?'正在请求 AI 出题…（笔记正文会发送到你配置的接口）':'正在准备离线练习…');
  request.promise.then(result=>{
    if(token!==quizRequestToken||!$('quizDialog').open)return;
    if(result.cancelled){setQuizStage('setup');$('quizHint').textContent='已取消生成，没有继续发送请求。';return;}
    if(!result.ok){setQuizStage('setup');$('quizHint').textContent=result.error||'生成失败';notify(result.error||'生成失败');return;}
    if(result.fallback)notify('AI 出题未完成，已改用离线基础练习。');
    renderQuiz(result.quiz);
    setQuizStage('ready');
    const hint=$('quizHint');
    if(hint)hint.textContent=result.source==='ai'?'AI 已生成练习；解析和原文依据仅供参考。':'已在本机生成离线练习，没有发送笔记。';
  }).catch(error=>{
    if(token!==quizRequestToken||!$('quizDialog').open)return;
    setQuizStage('setup');
    const hint=$('quizHint');if(hint)hint.textContent='练习生成失败：'+(error&&error.message?error.message:error);
    notify('练习生成失败，请重试。');
  });
}
on('quizCancel',()=>{
  quizRequestToken++;
  quizRequester.cancel({silent:false});
  setQuizStage('setup');
  const hint=$('quizHint');if(hint)hint.textContent='已取消生成。';
});
on('quizSubmit',()=>{
  if(!quizCurrent)return;
  quizAnswers=quizAnswersFromForm();
  quizResult=gradeQuiz(quizCurrent,quizAnswers,quizSelfGrades);
  renderQuizFeedback();
  setQuizStage('graded');
  const save=$('quizSave');if(save)save.hidden=false;
});
on('quizRetry',()=>{
  if(!quizCurrent||!quizResult)return;
  const retry=retryWrongQuiz(quizCurrent,quizResult);
  if(!retry){
    const hint=$('quizHint');if(hint)hint.textContent='没有需要重做的错题。';
    notify('没有需要重做的错题。');return;
  }
  renderQuiz(retry);setQuizStage('ready');
  const hint=$('quizHint');if(hint)hint.textContent='已筛出 '+retry.questions.length+' 道错题，重新作答。';
});
on('quizSave',()=>{
  if(!quizCurrent)return;
  const now=new Date();
  if(state.files.length>=160){
    const hint=$('quizHint');if(hint)hint.textContent='当前工作区最多 160 个文件，先整理或导出一些草稿。';
    notify('当前工作区最多 160 个文件。');return;
  }
  const path=quizFileName(now,state.files.map(file=>file.path));
  const markdown=quizToMarkdown(quizCurrent,quizResult,{date:now});
  state.files.push(makeFile(path,markdown));
  if(!state.opened.includes(path))state.opened.push(path);
  changed();
  const save=$('quizSave');if(save){save.disabled=true;save.textContent='已保存';}
  const dlg=$('quizDialog');if(dlg&&dlg.open)dlg.close();
  const open=!worker&&(workspaceMode==='notepad'||workspaceMode==='python');
  if(open)switchFile(path);
  notify('练习已保存到 '+path+(open?'':'，可在文件列表打开')+'。');
});
on('quizRegenerate',()=>{
  quizRequestToken++;quizRequester.cancel({silent:true});
  quizCurrent=null;quizAnswers={};quizSelfGrades={};quizResult=null;
  setQuizStage('setup');
  const hint=$('quizHint');if(hint)hint.textContent='可以重新选择 AI 或离线练习。';
});
on('quizClose',()=>{const dlg=$('quizDialog');if(dlg&&dlg.open)dlg.close();});
$('quizDialog').addEventListener('close',()=>{
  quizRequestToken++;
  quizRequester.cancel({silent:true});
});
$('quizDialog').addEventListener('click',event=>{if(event.target===$('quizDialog'))$('quizDialog').close();});
on('quizAi',()=>startQuizGeneration(false));
on('quizOffline',()=>startQuizGeneration(true));
menu('menuQuiz',openQuizDialog);

for(const b of document.querySelectorAll('.quickkeys button')){
 let startX=0,startY=0,moved=false;
 b.addEventListener('pointerdown',event=>{startX=event.clientX;startY=event.clientY;moved=false;});
 b.addEventListener('pointermove',event=>{if(Math.hypot(event.clientX-startX,event.clientY-startY)>12)moved=true;});
 b.addEventListener('mousedown',event=>event.preventDefault());
 b.addEventListener('click',event=>{
  if(moved)return;moved=false;
  if(worker)return;
  const key=b.dataset.key;
  if(key==='tab')indentMore(view);
  else if(key==='undo')undo(view);
  else if(key==='redo')redo(view);
  else if(key==='left'||key==='right'){const pos=Math.max(0,Math.min(view.state.doc.length,view.state.selection.main.head+(key==='left'?-1:1)));view.dispatch({selection:{anchor:pos},scrollIntoView:true});}
  else{if(key==='newline'){const sel=view.state.selection.main;view.dispatch({changes:{from:sel.from,to:sel.to,insert:'\n'},selection:{anchor:sel.from+1}});}else{const text=b.dataset.insert||'',sel=view.state.selection.main;view.dispatch({changes:{from:sel.from,to:sel.to,insert:text+(b.dataset.pair||'')},selection:{anchor:sel.from+text.length}});}}
  view.focus();
 });
}
document.addEventListener('keydown',event=>{const mod=event.ctrlKey||event.metaKey;if(mod&&event.key.toLowerCase()==='s'){event.preventDefault();if(!worker)saveFile(event.shiftKey);}else if(event.key==='F5'||mod&&event.key==='Enter'){event.preventDefault();run();}else if(mod&&event.key.toLowerCase()==='o'){event.preventDefault();$('openFile').click();}else if(mod&&event.key.toLowerCase()==='n'){event.preventDefault();nameDialog();}});
window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();});
const onViewportChange=()=>{if((window.visualViewport?window.visualViewport.height:innerHeight)<520)setConsole(false);};
window.addEventListener('resize',onViewportChange);if(window.visualViewport)window.visualViewport.addEventListener('resize',onViewportChange);
/* Home is the root screen. A mode sits on top of it; back returns here. */
const landing=$('landing'),landingBack=$('landingBack'),landingStatus=$('landingStatus');
const homeCards=[...document.querySelectorAll('.home-card')];
const MODE_KEY='ember-studio-mode';
const KNOWN_MODES=HOME_ACTIONS.map(item=>item.id);
let landingOpen=true,landingTimer=0,selectedMode='',workspaceMode='python',lastCodePath='',lastTtsPath='',lastNotePath='',homeFromSession=false,lastOpened='';
/* 原生侧在 ready 之后发 capabilities；浏览器预览里修图页可以直接打开，扫描需要相机。 */
let moduleCaps={native,browserPhoto:!native,sdk:0};
try{const savedMode=localStorage.getItem(MODE_KEY);if(KNOWN_MODES.includes(savedMode))selectedMode=savedMode;}catch(e){}
function rememberedMode(){if(KNOWN_MODES.includes(lastOpened))return lastOpened;return homeFromSession&&KNOWN_MODES.includes(workspaceMode)?workspaceMode:selectedMode;}
function refreshResume(){
  const card=$('resumeCard'),title=$('resumeTitle'),detail=$('resumeDetail');
  if(!card)return;
  const mode=rememberedMode();
  const known=KNOWN_MODES.includes(mode);
  const info=resumeCard({mode:known?mode:'',activePath:state&&state.active,dirty:unsavedOriginals(state&&state.files).length,fromSession:homeFromSession});
  card.hidden=!info.visible;
  card.disabled=!ready;
  if(title)title.textContent=info.title;
  if(detail)detail.textContent=info.detail;
  const icon=$('resumeIcon'),meta=moduleById(info.mode);if(icon&&meta)icon.textContent=meta.icon;
  card.dataset.mode=info.mode||'';
}
function greet(){const h=new Date().getHours();return h<5?'夜深了，':h<11?'早上好，':h<13?'中午好，':h<18?'下午好，':'晚上好，';}
function refreshHomeTitle(){const t=$('homeTitle');if(t)t.textContent=greet()+'今天做点什么';}
function refreshAvailability(){for(const card of homeCards){const a=moduleAvailability(card.dataset.mode,moduleCaps);card.dataset.unavailable=a.ok?'0':'1';if(!a.ok)card.title=a.message;else card.removeAttribute('title');}}
function setHomeEnabled(on){for(const card of homeCards)card.disabled=!on;const resume=$('resumeCard');if(resume)resume.disabled=!on;}
function markLandingReady(){if(!landing)return;landing.dataset.ready='1';if(landingStatus)landingStatus.textContent='草稿已就绪';setHomeEnabled(true);refreshAvailability();refreshHomeTitle();refreshResume();
  /* 星穹在首页可见时启动；WebGL 不可用则保持卡片。 */
  /* 必须先让 #starStage 参与布局再 enter：否则量到 0 尺寸，
     WebGL 画布被建成 1×1 再拉伸满屏，整页糊成一片浅色。 */
  if(!starActive&&landingOpen&&!landing.hidden){document.body.classList.add('starhome');starActive=starApi.enter();if(starActive){setStarView(state.star&&state.star.view==='list');}else{document.body.classList.remove('starhome');}}
}
function hideLanding(){if(!landingOpen||!landing)return;if(starActive&&starApi)starApi.leave();if(workspaceMode==='ai')aiEnterPanel();if(workspaceMode==='tts')ttsShowBar();if(workspaceMode==='model'&&modelApi)modelApi.enter();if(workspaceMode==='pelican'&&pelicanApi)pelicanApi.enter();landingOpen=false;landing.classList.add('landing-out');landing.setAttribute('aria-hidden','true');clearTimeout(landingTimer);landingTimer=setTimeout(()=>{if(landingOpen)return;landing.hidden=true;landing.classList.remove('landing-out');if(view&&!['game','ai'].includes(workspaceMode))view.focus();},280);}
function openLanding(reopen=false){
  if(!landing)return;
  if(reopen&&workspaceMode==='tts')ttsHideBar();
  if(reopen&&workspaceMode==='ai'){setAISettings(false);aiHidePanel();}
  if(reopen&&workspaceMode==='model'&&modelApi)modelApi.leave();
  if(reopen&&workspaceMode==='pelican'&&pelicanApi)pelicanApi.leave();
  closeDrawer();closeMenu();
  if(view){try{closeSearchPanel(view);}catch(e){}}
  clearTimeout(landingTimer);
  landing.hidden=false;landing.classList.remove('landing-out');landing.removeAttribute('aria-hidden');
  landingOpen=true;homeFromSession=!!reopen;
  if(landingBack){landingBack.hidden=!reopen;const meta=moduleById(workspaceMode);landingBack.textContent='‹ 回到'+(meta?meta.title:'刚才的工作');}
  if(landingStatus)landingStatus.textContent=ready?'草稿已就绪':'正在读取草稿';
  try{renderTodayStrip(currentStatus(state.schedule,schedInfo()));}catch(e){}
  if(reopen&&KNOWN_MODES.includes(workspaceMode)){selectedMode=workspaceMode;lastOpened=workspaceMode;}
  refreshHomeTitle();refreshResume();
  if(starActive&&starApi)starApi.enter();
}
function setLectureTab(name){
  const tab=name==='timeline'||name==='slides'?name:'notes';
  document.body.dataset.lectureTab=tab;
  for(const button of document.querySelectorAll('.lecture-tab')){
    const on=button.dataset.tab===tab;
    button.classList.toggle('active',on);
    button.setAttribute('aria-selected',on?'true':'false');
  }
}
/* 模块自己的子层，栈顶在前。新功能要加子层时在这里登记，返回键就会先关它。 */
const MODULE_LAYERS=[
  {id:'aiSettings',mode:'ai',open:()=>!!$('aiPanel')&&$('aiPanel').classList.contains('settings-open'),close:()=>setAISettings(false)},
  {id:'modelPanel',mode:'model',open:()=>!!modelApi&&modelApi.panelOpen(),close:()=>{if(modelApi)modelApi.closePanel();}}
];
function moduleLayers(){return MODULE_LAYERS.filter(layer=>(!layer.mode||layer.mode===workspaceMode)&&layer.open()).map(layer=>layer.id);}
function closeModuleLayer(id){const layer=MODULE_LAYERS.find(item=>item.id===id);if(layer)layer.close();}
function setAISettings(open){const panel=$('aiPanel'),btn=$('aiSettingsToggle');if(!panel)return;panel.classList.toggle('settings-open',!!open);if(btn){btn.setAttribute('aria-expanded',open?'true':'false');btn.textContent=open?'收起设置':'设置';}}
function handleSystemBack(){
  const openDialog=document.querySelector('dialog[open]');
  try{
    const decision=resolveBack({
      dialogOpen:!!openDialog,
      drawerOpen:document.body.classList.contains('drawer'),
      drawing:isDrawMode()||document.body.classList.contains('drawing')||($('drawLayer')&&!$('drawLayer').hidden),
      searchOpen:!!(view&&view.dom&&view.dom.querySelector('.cm-search')),
      homeOpen:landingOpen,
      loungeOpen:!!$('lounge')&&!$('lounge').hidden,
      layers:moduleLayers(),
      mode:workspaceMode,
      lectureTab:document.body.dataset.lectureTab||'notes'    });
    switch(decision.action){
      case BACK.DIALOG:
        if(openDialog)openDialog.close('cancel');
        return true;
      case BACK.DRAWER:
        document.body.classList.remove('drawer');
        return true;
      case BACK.DRAW:
        exitDrawMode();
        setTimeout(()=>{if(view)view.focus();},0);
        return true;
      case BACK.SEARCH:
        closeSearchPanel(view);
        if(view)view.focus();
        return true;
      case BACK.LAYER:
        closeModuleLayer(decision.layer);
        return true;
      case BACK.LECTURE_TAB:
        setLectureTab('notes');
        return true;
      case BACK.EDITOR:
        showCode();
        return true;
      case BACK.HOME:
        flush();
        openLanding(true);
        return true;
      case BACK.EXIT:
        flush();
        return false;
      default:return false;
    }
  }catch(error){
    console.error('[Studio] back handling failed',error);
    return true;  }
}
/* 刷新后 active 可能是模板笔记；先恢复它，不能又跳回固定的 笔记.txt。 */
function ensureNote(){
  const target=notepadTarget({active:state.active,lastNote:lastNotePath,files:state.files});
  let note=state.files.find(f=>f.path===target.path);
  if(!note){note=makeFile(target.path,'');state.files.push(note);}
  lastNotePath=note.path;
  if(!state.opened.includes(note.path))state.opened.push(note.path);
  return note;
}
function ensureLectureNote(){let note=state.files.find(f=>f.path==='课堂笔记.md');if(!note){note=makeFile('课堂笔记.md','');state.files.push(note);changed();}if(!state.opened.includes(note.path))state.opened.push(note.path);return note;}
function ensureEnglishText(){let text=state.files.find(f=>f.path==='English.txt');if(!text){const activeFile=state.files.find(f=>f.path===state.active&&/\.(txt|md)$/i.test(f.path)&&/[A-Za-z]/.test(f.text||''));if(activeFile)text=activeFile;}if(!text){if(state.files.length>=160){notify('工作区已有 160 个文件，请先打开英文文本或腾出一个文件名额。');return null;}text=makeFile('English.txt','The old lighthouse stood at the edge of the bay, and every evening its light swept across the water. Mara liked to sit on the steps below it and read until the pages went grey.\n\nOne night a storm rolled in from the sea. The wind tore at her jacket, but the light kept turning, steady as a heartbeat. She closed her book and watched it work, and decided she would write about it in the morning.\n');state.files.push(text);changed();}if(!state.opened.includes(text.path))state.opened.push(text.path);lastTtsPath=text.path;return text;}
function applyMode(mode){
  const guard=canLeaveMode({recording:workspaceMode==='lecture'&&lectureBusy(),running:!!worker,to:mode});
  if(!guard.ok&&guard.reason==='recording'){notify('正在上课录音，请先点「⏹ 停止」结束录音，再切换模式。');selectedMode='lecture';return false;}
  if(!guard.ok){notify('Python 或 JavaScript 正在运行，请先停止运行，再切换模式。');return false;}
  const ttsTarget=mode==='tts'?((lastTtsPath&&state.files.find(x=>x.path===lastTtsPath))||state.files.find(x=>x.path==='English.txt')||ensureEnglishText()):null;
  if(mode==='tts'&&!ttsTarget)return false;
  if(workspaceMode==='tts'&&mode!=='tts')ttsModeLeave();
  if(workspaceMode==='model'&&mode!=='model'&&modelApi)modelApi.leave();
  if(workspaceMode==='pelican'&&mode!=='pelican'&&pelicanApi)pelicanApi.leave();
  const leavingAI=workspaceMode==='ai'&&mode!=='ai';
  setWorkspaceMode(mode);  const noteEmpty=$('noteEmpty');
  if(noteEmpty)noteEmpty.textContent=mode==='lecture'?'点上方「🎙 开始录音」，边听边记；每一行都会自动带上时间戳。':'从这里开始写点什么…';
  const drawToggle=$('drawToggle');
  if(leavingAI)aiModeLeave();
  const aiPanel=$('aiPanel');
  if(mode==='focus'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('focusview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=false;
    $('activePath').textContent='专注番茄';$('dirtyFlag').textContent='';
    renderFocus();
    return true;
  }
  if(mode==='cards'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('cardsview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=false;
    $('activePath').textContent='记忆卡片';$('dirtyFlag').textContent='';
    cardsResetReview();renderCards();
    return true;
  }
  if(mode==='mistakes'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('mistakesview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=false;
    $('activePath').textContent='错题本';$('dirtyFlag').textContent='';
    mistCloseForm();renderMistakes();
    return true;
  }
  if(mode==='habits'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('habitsview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=false;
    $('activePath').textContent='习惯打卡';$('dirtyFlag').textContent='';
    renderHabits();
    return true;
  }
  if(mode==='schedule'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('scheduleview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=false;
    $('activePath').textContent='课程表';$('dirtyFlag').textContent='';
    schedCloseForm();renderSchedule();
    return true;
  }
  if(mode==='novel'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('novelview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=false;
    $('activePath').textContent='小说阅读器';$('dirtyFlag').textContent='';
    novelShowShelf();renderNovelShelf();
    return true;
  }
  if(mode==='medquiz'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('medquizview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const cp=$('cardsPanel');if(cp)cp.hidden=true;
    const mip=$('mistakesPanel');if(mip)mip.hidden=true;
    const hp=$('habitsPanel');if(hp)hp.hidden=true;
    const sp=$('schedulePanel');if(sp)sp.hidden=true;
    const np=$('novelPanel');if(np)np.hidden=true;
    const qp=$('medquizPanel');if(qp)qp.hidden=false;
    $('activePath').textContent='医学生刷题';$('dirtyFlag').textContent='';
    mqShowSetup();renderMqSetup();
    return true;
  }
  if(mode==='pelican'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('pelicanview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const mp=$('modelPanel');if(mp)mp.hidden=true;
    const fp=$('focusPanel');if(fp)fp.hidden=true;
    const pp=$('pelicanPanel');if(pp)pp.hidden=false;
    $('activePath').textContent='鹈鹕骑车';$('dirtyFlag').textContent='';
    if(!pelicanApi.enter()){notify('鹈鹕骑车需要 WebGL 支持，当前设备暂不可用。');openLanding(true);}
    return true;
  }
  if(mode==='model'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('modelview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=true;
    const fp2=$('focusPanel');if(fp2)fp2.hidden=true;
    const pp2=$('pelicanPanel');if(pp2)pp2.hidden=true;
    const panel=$('modelPanel');if(panel)panel.hidden=false;
    $('activePath').textContent='3D 建模';$('dirtyFlag').textContent='场景自动保存';
    /* 3D 渲染层 enter 时才建 WebGL；不可用则提示降级。 */
    if(!modelApi.enter()){notify('3D 需要 WebGL 支持，当前设备暂不可用；其它功能不受影响。');openLanding(true);}
    return true;
  }
  if(mode==='ai'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('aiview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=false;
    $('activePath').textContent='AI 助手';$('dirtyFlag').textContent='';
    aiModeEnter();return true;
  }
  if(aiPanel)aiPanel.hidden=true;
  const modelPanelEl=$('modelPanel');if(modelPanelEl)modelPanelEl.hidden=true;
  const focusPanelEl=$('focusPanel');if(focusPanelEl)focusPanelEl.hidden=true;
  const pelicanPanelEl=$('pelicanPanel');if(pelicanPanelEl)pelicanPanelEl.hidden=true;
  document.body.classList.remove('aiview');$('workbench').hidden=false;
  if(mode==='game'){document.body.classList.remove('notepad');document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();showGame();return true;}
  showCode();
  /* 只有代码类文件进入 lastCodePath；模板/课堂笔记不能污染 Python 返回目标。 */
  if(mode==='notepad'){document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(shouldRememberCodePath(state.active))lastCodePath=state.active;document.body.classList.add('notepad');switchFile(ensureNote().path);if(drawToggle)drawToggle.hidden=false;}
  else if(mode==='lecture'){document.body.classList.remove('notepad');document.body.classList.remove('tts');document.body.classList.add('lecture');if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();const note=ensureLectureNote();switchFile(note.path);lectureModeEnter();}
  else if(mode==='tts'){document.body.classList.remove('notepad');document.body.classList.remove('lecture');lectureModeLeave();document.body.classList.add('tts');if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();switchFile(ttsTarget.path);ttsModeEnter();}
  else{document.body.classList.remove('notepad');document.body.classList.remove('lecture');document.body.classList.remove('tts');lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();const f=(lastCodePath&&state.files.find(x=>x.path===lastCodePath))||state.files.find(x=>x.path==='main.py')||state.files.find(x=>!x.path.endsWith('.txt'))||state.files[0];if(f)switchFile(f.path);}
  setTimeout(()=>{if(view)view.focus();},260);
  return true;
}
/* 原生模块（扫描相机、修图）是独立页面：首页留在下面，系统返回键关掉它就回到这里。 */
function openNativeModule(id){
  const meta=moduleById(id);
  const guard=canLeaveMode({recording:workspaceMode==='lecture'&&lectureBusy(),running:!!worker,to:id});
  if(!guard.ok){notify(guard.reason==='recording'?'正在上课录音，请先点「⏹ 停止」结束录音，再打开'+meta.title+'。':'代码正在运行，请先停止，再打开'+meta.title+'。');return false;}
  const a=moduleAvailability(id,moduleCaps);
  if(!a.ok){notify(a.message);return false;}
  flush();
  selectedMode=id;lastOpened=id;try{localStorage.setItem(MODE_KEY,id);}catch(e){}
  refreshResume();
  if(native)send('openModule',{id});
  else if(id==='photo')location.href='../photo/index.html?from=studio';
  return true;
}
function nativeReturned(id){
  if(!isNativeModule(id))return;
  if(!landingOpen)openLanding(homeFromSession);
  lastOpened=id;selectedMode=id;
  if(landingStatus)landingStatus.textContent='已从「'+moduleById(id).title+'」回到首页';
  refreshResume();
}
function enterHomeMode(mode){
  if(!ready||!landingOpen||!KNOWN_MODES.includes(mode))return;
  if(isNativeModule(mode)){openNativeModule(mode);return;}
  /* Re-opening the mode already on screen is a cancel, not another applyMode. */
  if(homeFromSession&&mode===workspaceMode){hideLanding();return;}
  if(!applyMode(mode))return;
  selectedMode=mode;lastOpened=mode;try{localStorage.setItem(MODE_KEY,mode);}catch(e){}hideLanding();
}
for(const card of homeCards)card.addEventListener('click',()=>enterHomeMode(card.dataset.mode));
const resume=$('resumeCard');if(resume)resume.addEventListener('click',()=>enterHomeMode(rememberedMode()));
if(landingBack)landingBack.addEventListener('click',()=>hideLanding());
on('homeButton',()=>{flush();openLanding(true);});
on('aiHome',()=>{flush();openLanding(true);});
on('aiSettingsToggle',()=>{const panel=$('aiPanel');setAISettings(!(panel&&panel.classList.contains('settings-open')));});
window.__studioLandingReady=true;
initLecture({
  notify,
  send:(type,payload)=>send(type,payload),
  native:()=>native,
  /* 上课模式的异常要在真机上留痕：写到 logcat 的同时在界面提示。 */
  reportError:text=>{if(native)send('jsError',{kind:'lecture',detail:String(text).slice(0,300)});},
  /* 安装包里 PPT 照片交给原生相册选择器（压缩后只用同源 URL 回传），
     浏览器预览没有桥时返回 false，退回 <input type="file">。 */
  pickSlides:()=>{if(!native)return false;send('pickSlides');return true;},
  /* 整个 PPT 文件交给原生文档选择器：复制进缓存后以同源 URL 回传给页面解析。 */
  pickPptx:()=>{if(!native)return false;send('pickPptx');return true;},
  scheduleSave,
  flush,
  /* 录音前先在原生层拿到 RECORD_AUDIO 运行时权限：WebView 的采集如果等到
     onPermissionRequest 里才弹系统权限框，授权回来时音频源往往已经初始化失败。 */
  requestMic,
  /* 开始新一节录音时把上一节课的笔记正文另存一份，
     时间戳会被清空，正文不能跟着丢。 */
  archiveNote:text=>{
    const value=String(text||'');
    if(!value.trim())return '';
    if(state.files.length>=160){notify('工作区文件已满，上节课笔记没有单独归档，正文仍保留在当前笔记里。');return '';}
    const now=new Date(),p=n=>String(n).padStart(2,'0');
    const stamp=now.getFullYear()+p(now.getMonth()+1)+p(now.getDate())+'-'+p(now.getHours())+p(now.getMinutes());
    let name='课堂笔记-'+stamp+'.md',seq=2;
    while(state.files.some(f=>f.path===name))name='课堂笔记-'+stamp+'-'+(seq++)+'.md';
    state.files.push(makeFile(name,value));
    changed();
    return name;
  },
  activePath:()=>state.active,
  view:()=>view,
  editorState:path=>editorStates.get(path)||null,
  ensureNote:ensureLectureNote,
  switchFile:path=>switchFile(path),
  workspaceMode:()=>workspaceMode,
  getState:()=>state
});
initTTS({
  native,
  send,
  notify,
  workspaceMode:()=>workspaceMode,
  getText:()=>view?view.state.doc.toString():active().text,
  getSettings:()=>state.tts,
  setSettings:value=>{state.tts=ttsSanitize(value);},
  saveSettings:scheduleSave,
  /* 当前句高亮用的编辑器钩子：可选，tts.js 每次现取，view 重建后自动跟随。 */
  view:()=>view,
  activePath:()=>state.active
});
function bytesToBase64(bytes){let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));return btoa(binary);}
/* 3D 与星穹渲染层静态初始化（IIFE 单文件打包，原生壳内联普通 script）。
 * 设备 WebView 为现代 Chrome，three 可正常解析；初始化不依赖 WebGL，
 * 仅 enter() 时才创建渲染器，WebGL 不可用则降级。 */
const modelApi=initModel({
  notify,native,
  send:(type,payload)=>send(type,payload),
  getState:()=>state.model,
  setState:value=>{state.model=modelSanitize(value);},
  scheduleSave,
  exportBinary:(name,bytes,mime)=>{
    const id='model-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
    if(native){pendingSaves.set(id,{path:name,text:'',binary:true});send('exportBinary',{id,path:name,data:bytesToBase64(bytes),mime});}
    else{const blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已导出 '+name);}
  }
});
const starApi=initStar({
  notify,
  modules:()=>MODULES,
  open:id=>enterHomeMode(id),
  getPrefs:()=>state.star||{starred:[],motion:true},
  setPrefs:p=>{state.star=starSanitize(p,MODULES.map(m=>m.id));scheduleSave();},
  showList:()=>setStarView(true)
});
const pelicanApi=initPelican({
  notify,
  getBest:()=>(state.pelican&&state.pelican.best)||0,
  setBest:b=>{state.pelican={best:b};scheduleSave();},
  onOver:(score,best)=>{notify('鹈鹕撞上了！得分 '+score+'，最佳 '+best+'。');}
});
/* 星穹首页：WebGL 可用时把功能做成恒星；不可用保留卡片列表。 */
let starActive=false;
function setStarView(list){
  document.body.classList.toggle('listview',!!list);
  const sky=$('homeSkyBtn');if(sky)sky.hidden=!starActive||!list;
  /* 记住用户选的视图，下次打开首页照旧。 */
  if(state.star){state.star.view=list?'list':'sky';scheduleSave();}
}
on('homeSkyBtn',()=>setStarView(false));

/* ---------------- 专注番茄 ---------------- */
function todayStr(){const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function renderFocus(){
  const s=state.focus||DEFAULT_FOCUS();
  const phase=$('focusPhase');if(phase)phase.textContent=s.phase==='work'?'专注':s.phase==='short'?'短休息':'长休息';
  const time=$('focusTime');if(time)time.textContent=fmtTime(s.remaining);
  const dots=$('focusDots');
  if(dots){dots.replaceChildren();for(let i=0;i<4;i++){const d=document.createElement('i');if(i<s.cycle)d.className='on';dots.append(d);}}
  const start=$('focusStart');if(start)start.textContent=s.running?'暂停':'开始';
  const wm=$('focusWorkMin'),sm=$('focusShortMin'),lm=$('focusLongMin');
  if(wm&&document.activeElement!==wm)wm.value=s.workMin;
  if(sm&&document.activeElement!==sm)sm.value=s.shortMin;
  if(lm&&document.activeElement!==lm)lm.value=s.longMin;
  const stats=$('focusStats');
  if(stats){const today=s.today&&s.today.date===todayStr()?s.today.count:0;stats.textContent='今日 '+today+' 个 · 累计 '+s.completed+' 个';}
  const chart=$('focusChart');
  if(chart){
    const days=lastNDays(s.history||{},7,todayStr());
    const max=Math.max(1,...days.map(d=>d.count));
    chart.replaceChildren();
    for(const d of days){
      const bar=document.createElement('span');bar.className='bar'+(d.count?'':' zero');
      const fill=document.createElement('i');fill.style.height=Math.round(d.count/max*52+3)+'px';
      const lab=document.createElement('b');lab.textContent=d.date.slice(8);
      bar.title=d.date+'：'+d.count+' 个';bar.append(fill,lab);chart.append(bar);
    }
  }
}
setInterval(()=>{
  if(!state.focus||!state.focus.running)return;
  const r=focusTick(state.focus,todayStr());
  state.focus=r.state;
  if(r.finished){notify(state.focus.phase==='work'?'休息结束，开始新一轮专注。':'一个专注段完成，休息一下。');scheduleSave();}
  if(workspaceMode==='focus')renderFocus();
},1000);
on('focusStart',()=>{state.focus=focusToggle(state.focus);renderFocus();scheduleSave();});
on('focusReset',()=>{state.focus=focusReset(state.focus);renderFocus();scheduleSave();});
on('focusSkip',()=>{state.focus=focusSkip(state.focus);renderFocus();scheduleSave();});
for(const [id,key] of [['focusWorkMin','workMin'],['focusShortMin','shortMin'],['focusLongMin','longMin']]){
  const el=$(id);if(el)el.onchange=()=>{state.focus=focusSetMinutes(state.focus,key,+el.value);renderFocus();scheduleSave();};
}

/* 记忆卡片：复习队列 + 翻面 + 四档评分 + 添加/列表。 */
let cardsQueue=[],cardsCurrent=null,cardsShown=false;
function cardsResetReview(){cardsQueue=[];cardsCurrent=null;cardsShown=false;}
function renderCards(){
  const deck=state.cards||deckSanitize(null);
  const st=deckStats(deck,Date.now());
  const stats=$('cardsStats');if(stats)stats.textContent='共 '+st.total+' 张 · 到期 '+st.due+' · 已学 '+st.learned;
  const face=$('cardsFaceText'),hint=$('cardsFaceHint'),rate=$('cardsRate');
  if(cardsCurrent){
    face.textContent=cardsShown?cardsCurrent.back:cardsCurrent.front;
    hint.textContent=cardsShown?'回忆一下，再给自己打分':'点卡片看背面';
    rate.hidden=!cardsShown;
  }else{
    face.textContent=cardsQueue.length?'共 '+cardsQueue.length+' 张待复习，点「开始复习」':'没有到期的卡片，去添加或稍后再来';
    hint.textContent='';rate.hidden=true;
  }
  const list=$('cardsList');
  if(list&&!list.hidden){
    list.replaceChildren();
    for(const c of deck.cards){
      const row=document.createElement('div');row.className='cards-row';
      const t=document.createElement('span');t.className='t';t.textContent=c.front;
      const d=document.createElement('span');d.className='d';d.textContent=c.due<=Date.now()?'到期':(c.interval?c.interval+'天':'新');
      const del=document.createElement('button');del.type='button';del.textContent='删';
      del.onclick=()=>{state.cards=removeCard(state.cards,c.id);cardsResetReview();renderCards();scheduleSave();};
      row.append(t,d,del);list.append(row);
    }
    if(!deck.cards.length){const e=document.createElement('p');e.className='cards-face-hint';e.textContent='还没有卡片，点「添加卡片」开始。';list.append(e);}
  }
}
on('cardsStart',()=>{cardsQueue=dueCards(state.cards,Date.now());cardsShown=false;cardsCurrent=cardsQueue.shift()||null;renderCards();});
on('cardsFace',()=>{if(!cardsCurrent)return;cardsShown=!cardsShown;renderCards();});
for(const b of document.querySelectorAll('#cardsRate button')){
  b.addEventListener('click',()=>{
    if(!cardsCurrent)return;
    const rated=reviewCard(cardsCurrent,+b.dataset.rate,Date.now());
    if(rated){state.cards={...deckSanitize(state.cards),cards:deckSanitize(state.cards).cards.map(c=>c.id===rated.id?rated:c)};}
    cardsShown=false;cardsCurrent=cardsQueue.shift()||null;
    renderCards();scheduleSave();
  });
}
on('cardsToggleAdd',()=>{const a=$('cardsAdd');a.hidden=!a.hidden;const l=$('cardsList');if(l)l.hidden=true;renderCards();});
on('cardsToggleList',()=>{const l=$('cardsList');l.hidden=!l.hidden;const a=$('cardsAdd');if(a)a.hidden=true;renderCards();});
on('cardsSave',()=>{
  const f=$('cardsFront').value,b=$('cardsBack').value;
  const r=addCard(state.cards,f,b,Date.now());
  if(!r.ok){notify('正面和背面都要填写。');return;}
  state.cards=r.deck;$('cardsFront').value='';$('cardsBack').value='';
  notify('已添加卡片');renderCards();scheduleSave();
});

/* 错题本：科目/掌握度筛选 + 记错题表单 + 列表(展开/掌握度/编辑/删除)。 */
let mistEditId=null,mistOpen=new Set();
function mistFillSubjects(){
  for(const id of ['mistSubject','mistFormSubject']){
    const sel=$(id);if(!sel||sel.options.length)continue;
    if(id==='mistSubject'){const o=document.createElement('option');o.value='全部';o.textContent='全部科目';sel.append(o);}
    for(const s of SUBJECTS){const o=document.createElement('option');o.value=s;o.textContent=s;sel.append(o);}
  }
}
function mistCloseForm(){mistEditId=null;const f=$('mistForm');if(f)f.hidden=true;}
function mistOpenForm(item){
  mistFillSubjects();
  mistEditId=item?item.id:null;
  $('mistTitle').value=item?item.title:'';
  $('mistFormSubject').value=item?item.subject:'数学';
  $('mistQuestion').value=item?item.question:'';
  $('mistAnswer').value=item?item.answer:'';
  $('mistReason').value=item?item.reason:'';
  $('mistForm').hidden=false;
  $('mistTitle').focus();
}
function renderMistakes(){
  mistFillSubjects();
  const book=state.mistakes||bookSanitize(null);
  const st=bookStats(book);
  const stats=$('mistStats');if(stats)stats.textContent='共 '+st.total+' 题 · 已掌握 '+st.mastered+' · 掌握率 '+st.rate+'%';
  const subject=$('mistSubject')?$('mistSubject').value:'全部';
  const mastery=$('mistMastery')?+$('mistMastery').value:-1;
  const list=$('mistList');if(!list)return;
  const items=filterMistakes(book,subject,mastery);
  list.replaceChildren();
  if(!items.length){const e=document.createElement('p');e.className='mist-empty';e.textContent=book.items.length?'这个筛选下没有错题。':'还没有错题，点「＋ 记错题」开始。';list.append(e);return;}
  for(const it of items){
    const card=document.createElement('div');card.className='mist-item';
    const head=document.createElement('div');head.className='mist-item-head';
    const t=document.createElement('span');t.className='t';t.textContent=it.title;
    const badge=document.createElement('span');badge.className='mist-badge';badge.textContent=it.subject;
    const mas=document.createElement('span');mas.className='mist-mastery m'+it.mastery;mas.textContent=MASTERY[it.mastery];
    head.append(t,badge,mas);
    head.onclick=()=>{if(mistOpen.has(it.id))mistOpen.delete(it.id);else mistOpen.add(it.id);renderMistakes();};
    card.append(head);
    if(mistOpen.has(it.id)){
      const body=document.createElement('div');body.className='mist-item-body';
      for(const [label,val] of [['题目',it.question],['正解',it.answer],['错因',it.reason]]){
        if(!val)continue;
        const f=document.createElement('div');f.className='mist-field';
        const b=document.createElement('b');b.textContent=label;
        const span=document.createElement('span');span.textContent=val;
        f.append(b,span);body.append(f);
      }
      card.append(body);
      const act=document.createElement('div');act.className='mist-item-actions';
      for(let m=0;m<3;m++){
        const b=document.createElement('button');b.type='button';b.textContent=MASTERY[m];if(it.mastery===m)b.className='on';
        b.onclick=e=>{e.stopPropagation();state.mistakes=setMastery(state.mistakes,it.id,m,Date.now()).book;renderMistakes();scheduleSave();};
        act.append(b);
      }
      const edit=document.createElement('button');edit.type='button';edit.textContent='编辑';
      edit.onclick=e=>{e.stopPropagation();mistOpenForm(it);};
      const del=document.createElement('button');del.type='button';del.className='del';del.textContent='删除';
      del.onclick=e=>{e.stopPropagation();state.mistakes=removeMistake(state.mistakes,it.id);mistOpen.delete(it.id);renderMistakes();scheduleSave();};
      act.append(edit,del);card.append(act);
    }
    list.append(card);
  }
}
on('mistAddBtn',()=>mistOpenForm(null));
on('mistCancel',()=>mistCloseForm());
{const ms=$('mistSubject');if(ms)ms.addEventListener('change',()=>renderMistakes());
 const mm=$('mistMastery');if(mm)mm.addEventListener('change',()=>renderMistakes());}
on('mistSave',()=>{
  const fields={title:$('mistTitle').value,subject:$('mistFormSubject').value,question:$('mistQuestion').value,answer:$('mistAnswer').value,reason:$('mistReason').value};
  if(!fields.title.trim()&&!fields.question.trim()){notify('至少填写标题或题目。');return;}
  const now=Date.now();
  if(mistEditId){const r=updateMistake(state.mistakes,mistEditId,fields,now);if(r.ok)state.mistakes=r.book;}
  else{const r=addMistake(state.mistakes,fields,now);if(r.ok)state.mistakes=r.book;}
  mistCloseForm();renderMistakes();scheduleSave();notify('已保存错题');
});

/* 习惯打卡：添加习惯 + 每日打卡 + 连续/最佳天数 + 最近7天点阵。 */
function renderHabits(){
  const book=state.habits||habitsSanitize(null);
  const today=todayStr();
  const st=habitsStats(book,today);
  const stats=$('habitStats');if(stats)stats.textContent='共 '+st.total+' 个 · 今日已打 '+st.doneToday+' · 累计 '+st.totalChecks+' 次';
  const list=$('habitList');if(!list)return;
  list.replaceChildren();
  if(!book.habits.length){const e=document.createElement('p');e.className='habit-empty';e.textContent='还没有习惯，输入名称点「添加」开始。';list.append(e);return;}
  for(const h of book.habits){
    const item=document.createElement('div');item.className='habit-item';
    const top=document.createElement('div');top.className='habit-item-top';
    const t=document.createElement('span');t.className='t';t.textContent=h.name;
    const streak=document.createElement('span');streak.className='habit-streak';streak.textContent='🔥 '+currentStreak(h,today)+' 天';
    const best=document.createElement('span');best.className='habit-best';best.textContent='最佳 '+bestStreak(h);
    const done=isChecked(h,today);
    const check=document.createElement('button');check.type='button';check.className='habit-check'+(done?' done':'');check.textContent=done?'已打卡':'打卡';
    check.onclick=()=>{state.habits=toggleCheck(state.habits,h.id,today);renderHabits();scheduleSave();};
    top.append(t,streak,best,check);item.append(top);
    const week=document.createElement('div');week.className='habit-week';
    for(const d of lastNDaysChecks(h,7,today)){
      const cell=document.createElement('span');cell.className='d'+(d.done?' on':'')+(d.date===today?' today':'');
      const fill=document.createElement('i');
      const lab=document.createElement('b');lab.textContent=d.date.slice(8);
      cell.title=d.date+(d.done?' 已打卡':' 未打卡');cell.append(fill,lab);week.append(cell);
    }
    item.append(week);
    const foot=document.createElement('div');foot.className='habit-item-foot';
    const del=document.createElement('button');del.type='button';del.textContent='删除';
    del.onclick=()=>{state.habits=removeHabit(state.habits,h.id);renderHabits();scheduleSave();};
    foot.append(del);item.append(foot);
    list.append(item);
  }
}
on('habitAddBtn',()=>{
  const el=$('habitName');const r=addHabit(state.habits,el.value,Date.now());
  if(!r.ok){notify(r.dup?'这个习惯已经有了。':'先输入习惯名称。');return;}
  state.habits=r.book;el.value='';renderHabits();scheduleSave();
});
{const hn=$('habitName');if(hn)hn.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('habitAddBtn').click();}});}

/* 课程表：周网格 + 正在上/下一节 + 冲突检测 + 单双周。 */
let schedEditId=null,schedColor=0;
function schedInfo(){return nowInfo(new Date(),(state.schedule&&state.schedule.termStart)||'');}
function schedCloseForm(){schedEditId=null;const f=$('schedForm');if(f)f.hidden=true;}
function schedFillSelects(){
  const day=$('schedDay');
  if(day&&!day.options.length)DAYS.forEach((d,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent=d;day.append(o);});
  const st=$('schedStart');
  if(st&&!st.options.length)PERIODS.forEach((p,i)=>{const o=document.createElement('option');o.value=i+1;o.textContent='第'+(i+1)+'节 '+fmtMin(p[0]);st.append(o);});
  const ln=$('schedLen');
  if(ln&&!ln.options.length)for(let i=1;i<=4;i++){const o=document.createElement('option');o.value=i;o.textContent='连上'+i+'节';ln.append(o);}
  const colors=$('schedColors');
  if(colors&&!colors.children.length){
    COURSE_COLORS.forEach((c,i)=>{
      const b=document.createElement('button');b.type='button';b.style.background=c;b.setAttribute('aria-label','颜色'+(i+1));
      b.onclick=()=>{schedColor=i;[...colors.children].forEach((x,j)=>x.classList.toggle('on',j===i));};
      colors.append(b);
    });
  }
}
function schedOpenForm(course){
  schedFillSelects();
  schedEditId=course?course.id:null;
  $('schedName').value=course?course.name:'';
  $('schedPlace').value=course?course.place:'';
  $('schedTeacher').value=course?course.teacher:'';
  $('schedDay').value=course?course.day:Math.min(7,schedInfo().day);
  $('schedStart').value=course?course.start:1;
  $('schedLen').value=course?course.len:2;
  $('schedWeeks').value=course&&course.weeks.length?course.weeks.join(','):'';
  schedColor=course?course.color:0;
  [...$('schedColors').children].forEach((x,j)=>x.classList.toggle('on',j===schedColor));
  $('schedDelete').hidden=!course;
  $('schedForm').hidden=false;
  $('schedName').focus();
}
function parseWeeks(text){
  const t=String(text||'').trim();
  if(!t)return [];
  const out=new Set();
  for(const part of t.split(/[,，、\s]+/)){
    const m=part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if(m){const a=+m[1],b=+m[2];for(let i=Math.min(a,b);i<=Math.max(a,b);i++)out.add(i);}
    else if(/^\d+$/.test(part))out.add(+part);
  }
  return [...out].filter(w=>w>=1&&w<=30).sort((a,b)=>a-b);
}
function renderSchedule(){
  schedFillSelects();
  const sched=state.schedule||scheduleSanitize(null);
  const info=schedInfo();
  const wk=$('schedWeek');if(wk)wk.textContent='第 '+info.week+' 周 · '+DAYS[info.day-1];
  const term=$('schedTermStart');if(term&&document.activeElement!==term)term.value=sched.termStart||'';
  /* 正在上 / 下一节 */
  const st=currentStatus(sched,info);
  const nowBox=$('schedNow');
  if(nowBox){
    if(st.now){
      const c=st.now;
      nowBox.innerHTML='';
      const b=document.createElement('b');b.textContent='正在上 · ';
      nowBox.append(b,document.createTextNode(c.name+(c.place?'（'+c.place+'）':'')));
    }else if(st.next){
      const c=st.next.course;
      const when=st.next.deltaMin!=null?(st.next.deltaMin+'分钟后'):DAYS[st.next.day-1];
      nowBox.innerHTML='';
      const b=document.createElement('b');b.textContent='下一节 · ';
      nowBox.append(b,document.createTextNode(when+' '+c.name+(c.place?'（'+c.place+'）':'')));
    }else{
      nowBox.textContent='这周还没排课，点「＋ 加课」开始。';
    }
  }
  renderTodayStrip(st);
  /* 周网格 */
  const grid=$('schedGrid');if(!grid)return;
  grid.replaceChildren();
  grid.append(Object.assign(document.createElement('span'),{className:'sched-corner',textContent:'节'}));
  for(let d=1;d<=7;d++){
    const h=document.createElement('span');h.className='sched-dayhead'+(d===info.day?' today':'');h.textContent=DAYS[d-1];
    h.style.gridColumn=String(d+1);h.style.gridRow='1';grid.append(h);
  }
  for(let p=1;p<=12;p++){
    const cell=document.createElement('span');cell.className='sched-period';cell.textContent=String(p);
    cell.style.gridColumn='1';cell.style.gridRow=String(p+1);grid.append(cell);
  }
  for(let d=1;d<=7;d++)for(let p=1;p<=12;p++){
    const c=document.createElement('span');c.className='sched-cell';
    c.style.gridColumn=String(d+1);c.style.gridRow=String(p+1);grid.append(c);
  }
  for(let d=1;d<=7;d++){
    for(const c of coursesOnDay(sched,d,info.week)){
      const b=document.createElement('button');b.type='button';b.className='sched-course';
      b.style.background=COURSE_COLORS[c.color];
      b.style.gridColumn=String(d+1);b.style.gridRow=(c.start+1)+' / span '+c.len;
      const name=document.createElement('b');name.textContent=c.name;
      const place=document.createElement('small');place.textContent=(c.place||'')+(c.teacher?' · '+c.teacher:'');
      b.append(name,place);
      b.onclick=()=>schedOpenForm(c);
      grid.append(b);
    }
  }
}
function renderTodayStrip(st){
  const strip=$('todayStrip');if(!strip)return;
  if(!st||(!st.now&&!st.next)){strip.hidden=true;return;}
  strip.hidden=false;
  const when=$('todayWhen'),name=$('todayName'),meta=$('todayMeta');
  if(st.now){
    when.textContent='正在上';name.textContent=st.now.name;
    meta.textContent=(st.now.place||'')+(st.now.teacher?' · '+st.now.teacher:'')+' · '+weeksText(st.now);
  }else{
    const c=st.next.course;
    when.textContent=st.next.deltaMin!=null?(st.next.deltaMin+'分钟后'):DAYS[st.next.day-1];
    name.textContent=c.name;
    meta.textContent=(c.place||'')+' · 第'+c.start+'节 · '+weeksText(c);
  }
}
on('schedAddBtn',()=>schedOpenForm(null));
on('schedCancel',()=>schedCloseForm());
on('schedSave',()=>{
  const fields={name:$('schedName').value,place:$('schedPlace').value,teacher:$('schedTeacher').value,
    day:+$('schedDay').value,start:+$('schedStart').value,len:+$('schedLen').value,
    color:schedColor,weeks:parseWeeks($('schedWeeks').value)};
  if(!fields.name.trim()){notify('先填课名。');return;}
  let r;
  if(schedEditId)r=updateCourse(state.schedule,schedEditId,fields);
  else r=addCourse(state.schedule,fields);
  if(!r.ok){notify(r.conflict?'和已有课撞时间了，换个节次或周次。':'没保存上，检查一下课名。');return;}
  state.schedule=r.sched;schedCloseForm();renderSchedule();scheduleSave();
});
on('schedDelete',()=>{
  if(schedEditId){state.schedule=removeCourse(state.schedule,schedEditId);schedCloseForm();renderSchedule();scheduleSave();}
});
{const ts=$('schedTermStart');if(ts)ts.addEventListener('change',()=>{state.schedule={...scheduleSanitize(state.schedule),termStart:ts.value};renderSchedule();scheduleSave();});}
{const strip=$('todayStrip');if(strip)strip.onclick=()=>applyMode('schedule');}
setInterval(()=>{if(workspaceMode==='schedule')renderSchedule();else if(document.body.classList.contains('starhome')||document.body.classList.contains('listview'))renderTodayStrip(currentStatus(state.schedule,schedInfo()));},30000);

/* 小说阅读器：书架 + 导入TXT + 分章 + 进度记忆 + 主题字号。正文存独立 localStorage 键。 */
let novelChapters=[],novelBookId=null;
const novelTextKey=id=>'ember-novel-text-'+id;
function novelShowShelf(){novelBookId=null;const r=$('novelReaderView');if(r)r.hidden=true;const s=$('novelShelfView');if(s)s.hidden=false;}
function renderNovelShelf(){
  const shelf=state.novel||shelfSanitize(null);
  const list=$('novelShelfList');if(!list)return;
  list.replaceChildren();
  if(!shelf.books.length){const e=document.createElement('p');e.className='novel-empty';e.textContent='书架还空着，点「＋ 导入 TXT」放一本书进来。';list.append(e);return;}
  for(const b of shelf.books){
    const row=document.createElement('div');row.className='novel-book';
    const cover=document.createElement('span');cover.className='cover';cover.textContent='📖';
    const info=document.createElement('span');info.className='info';
    const t=document.createElement('b');t.textContent=b.title;
    const meta=document.createElement('small');meta.textContent=(b.author?b.author+' · ':'')+progressText(b);
    info.append(t,meta);
    const open=document.createElement('button');open.type='button';open.className='del';open.style.color='var(--accent)';open.textContent='读';
    open.onclick=()=>novelOpen(b.id);
    const del=document.createElement('button');del.type='button';del.className='del';del.textContent='删';
    del.onclick=()=>{state.novel={...shelfSanitize(state.novel),books:shelfSanitize(state.novel).books.filter(x=>x.id!==b.id)};try{localStorage.removeItem(novelTextKey(b.id));}catch(e){}renderNovelShelf();scheduleSave();};
    row.append(cover,info,open,del);list.append(row);
  }
}
function novelOpen(id){
  const shelf=state.novel||shelfSanitize(null);
  const book=shelf.books.find(b=>b.id===id);if(!book)return;
  let text='';try{text=localStorage.getItem(novelTextKey(id))||'';}catch(e){}
  novelChapters=splitChapters(text);
  novelBookId=id;
  $('novelShelfView').hidden=true;$('novelReaderView').hidden=false;
  $('novelTitle').textContent=book.title;
  novelRenderChapter(Math.min(book.ch,Math.max(0,novelChapters.length-1)));
}
function novelRenderChapter(ch){
  const body=$('novelBody');if(!body)return;
  const c=novelChapters[ch];
  body.textContent=c?c.body:'（这一章是空的）';
  body.scrollTop=0;
  const shelf=shelfSanitize(state.novel);
  const book=shelf.books.find(b=>b.id===novelBookId);
  if(book){book.ch=ch;state.novel={...shelf,books:shelf.books.map(b=>b.id===novelBookId?book:b)};scheduleSave();}
  $('novelPos').textContent=(ch+1)+' / '+novelChapters.length;
  $('novelPrev').disabled=ch<=0;
  $('novelNext').disabled=ch>=novelChapters.length-1;
  const s=state.novel.settings;
  body.dataset.theme=s.theme;body.style.fontSize=s.fontSize+'px';body.style.lineHeight=String(s.line);
  for(const [id,th] of [['novelThemePaper','paper'],['novelThemeGreen','green'],['novelThemeNight','night']]){const b=$(id);if(b)b.classList.toggle('on',s.theme===th);}
}
function novelSetTheme(th){state.novel={...shelfSanitize(state.novel),settings:{...state.novel.settings,theme:th}};const body=$('novelBody');if(body)body.dataset.theme=th;for(const [id,t] of [['novelThemePaper','paper'],['novelThemeGreen','green'],['novelThemeNight','night']]){const b=$(id);if(b)b.classList.toggle('on',t===th);}scheduleSave();}
function novelFont(d){const s=novelSettingsSanitize({...state.novel.settings,fontSize:(state.novel.settings.fontSize||18)+d});state.novel={...shelfSanitize(state.novel),settings:s};const body=$('novelBody');if(body)body.style.fontSize=s.fontSize+'px';scheduleSave();}
on('novelImportBtn',()=>$('novelFile').click());
{const f=$('novelFile');if(f)f.addEventListener('change',async()=>{
  const file=f.files&&f.files[0];f.value='';if(!file)return;
  if(file.size>6*1024*1024){notify('文件太大（>6MB），换个小一点的 TXT。');return;}
  let text='';try{text=await file.text();}catch(e){notify('读不了这个文件。');return;}
  const chapters=splitChapters(text);
  if(!chapters.length){notify('文件是空的。');return;}
  const shelf=shelfSanitize(state.novel);
  if(shelf.books.length>=20){notify('书架满了（20 本），先删几本。');return;}
  const id=shelf.nextId;
  const title=(file.name||'未命名').replace(/\.txt$/i,'').slice(0,60);
  const book={id,title,author:'',addedAt:Date.now(),chapterCount:chapters.length,chars:text.length,ch:0};
  try{localStorage.setItem(novelTextKey(id),text);}catch(e){notify('本机存储放不下这本书，先删几本。');return;}
  state.novel={...shelf,nextId:id+1,current:id,books:[...shelf.books,book]};
  renderNovelShelf();scheduleSave();novelOpen(id);
});}
on('novelBackShelf',()=>{novelShowShelf();renderNovelShelf();});
on('novelPrev',()=>{const b=shelfSanitize(state.novel).books.find(x=>x.id===novelBookId);if(b&&b.ch>0)novelRenderChapter(b.ch-1);});
on('novelNext',()=>{const b=shelfSanitize(state.novel).books.find(x=>x.id===novelBookId);if(b&&b.ch<novelChapters.length-1)novelRenderChapter(b.ch+1);});
on('novelFontMinus',()=>novelFont(-1));
on('novelFontPlus',()=>novelFont(1));
on('novelThemePaper',()=>novelSetTheme('paper'));
on('novelThemeGreen',()=>novelSetTheme('green'));
on('novelThemeNight',()=>novelSetTheme('night'));
on('novelTocBtn',()=>{
  const toc=$('novelToc');if(!toc)return;
  if(!toc.hidden){toc.hidden=true;return;}
  toc.replaceChildren();
  const cur=shelfSanitize(state.novel).books.find(x=>x.id===novelBookId);
  novelChapters.forEach((c,i)=>{const b=document.createElement('button');b.type='button';b.textContent=c.title;if(cur&&cur.ch===i)b.className='on';b.onclick=()=>{toc.hidden=true;novelRenderChapter(i);};toc.append(b);});
  toc.hidden=false;
});

/* 医学生刷题：组卷 + 即时判分 + 解析 + 错题本。 */
let mqSession=null;
function mqShowSetup(){$('mqSetup').hidden=false;$('mqRun').hidden=true;$('mqResult').hidden=true;}
function renderMqSetup(){
  const sel=$('mqSubject');
  if(sel&&!sel.options.length){const all=document.createElement('option');all.value='全部';all.textContent='全部科目';sel.append(all);for(const s of QUIZ_SUBJECTS){const o=document.createElement('option');o.value=s;o.textContent=s;sel.append(o);}}
  if(sel)sel.value=state.medquiz.lastSubject||'全部';
  const md=$('mqMode');if(md)md.value=state.medquiz.lastMode||'order';
  const st=$('mqStats');if(st)st.textContent='已答 '+state.medquiz.answered+' · 正确率 '+mqAccuracy(state.medquiz)+'% · 错题 '+Object.keys(state.medquiz.wrong).length;
}
function mqRenderQuestion(){
  const s=mqSession;if(!s)return;
  const qid=s.ids[s.pos];const q=quizById(qid);
  $('mqProgress').textContent=(s.pos+1)+' / '+s.ids.length+' · '+q.subject;
  $('mqQuestion').textContent=q.q;
  const opts=$('mqOptions');opts.replaceChildren();
  const answered=s.answers[qid]!=null;
  q.options.forEach((opt,i)=>{
    const b=document.createElement('button');b.type='button';
    const k=document.createElement('span');k.className='k';k.textContent='ABCD'[i];
    const txt=document.createElement('span');txt.textContent=opt;
    b.append(k,txt);
    if(answered){b.disabled=true;if(i===q.answer)b.classList.add('right');else if(i===s.answers[qid])b.classList.add('wrong');}
    else b.onclick=()=>mqAnswer(i);
    opts.append(b);
  });
  const ex=$('mqExplain');
  if(answered){ex.hidden=false;ex.innerHTML='';const b=document.createElement('b');b.textContent=(s.answers[qid]===q.answer?'答对了 · ':'答错了 · ');ex.append(b,document.createTextNode(q.explain));}
  else ex.hidden=true;
  $('mqNext').hidden=!answered;
  $('mqNext').textContent=(s.pos+1>=s.ids.length)?'看结果':'下一题';
}
function mqAnswer(i){
  const s=mqSession;if(!s)return;
  const qid=s.ids[s.pos];
  mqSession=mqAnswerFn(s,qid,i);
  state.medquiz=mqGrade(state.medquiz,qid,i);
  scheduleSave();mqRenderQuestion();
}
on('mqStart',()=>{
  const subject=$('mqSubject').value,mode=$('mqMode').value;
  state.medquiz={...quizStatsSanitize(state.medquiz),lastSubject:subject,lastMode:mode};
  mqSession=mqBuild(state.medquiz,subject,mode);
  if(!mqSession.ids.length){notify(mode==='wrong'?'没有错题，先刷几道吧。':'这个科目暂时没有题。');return;}
  $('mqSetup').hidden=true;$('mqResult').hidden=true;$('mqRun').hidden=false;
  mqRenderQuestion();scheduleSave();
});
on('mqNext',()=>{
  mqSession=mqNextFn(mqSession);
  if(mqSession.finished){
    $('mqRun').hidden=true;$('mqResult').hidden=false;
    const sum=mqSummary(mqSession);
    const sc=$('mqScore');sc.innerHTML='';
    const b=document.createElement('b');b.textContent=sum.right+' / '+sum.total;
    sc.append(b,document.createTextNode('答对 '+sum.right+' 题，答错 '+sum.wrong+' 题。错题已收进错题本。'));
    $('mqRetryWrong').hidden=sum.wrong===0;
  }else mqRenderQuestion();
});
on('mqQuit',()=>{mqSession=null;mqShowSetup();renderMqSetup();});
on('mqBackSetup',()=>{mqSession=null;mqShowSetup();renderMqSetup();});
on('mqRetryWrong',()=>{
  mqSession=mqBuild(state.medquiz,'全部','wrong');
  if(!mqSession.ids.length){mqShowSetup();renderMqSetup();return;}
  $('mqResult').hidden=true;$('mqRun').hidden=false;mqRenderQuestion();
});
initDraw({
  scheduleSave:()=>{state.drawStrokes=getDrawStrokes();flush();},
  getDrawData:()=>state.drawStrokes||[],
  saveDrawData:(strokes)=>{state.drawStrokes=Array.isArray(strokes)?strokes:[];flush();},
  getDrawView:()=>state.drawView,
  saveDrawView:(v)=>{state.drawView=v;scheduleSave();}
});

/* AI 助手：网络请求走原生桥；设备工具卡由宿主执行并回传结果。 */
const aiToolWaiters=new Map();
function aiTool(tool,args){
 return new Promise(resolve=>{
  if(!native){resolve('此能力需要在天工 APK 中使用，并先授权目录。');return;}
  const id='at-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
  aiToolWaiters.set(id,resolve);send('aiTool',{id,tool,args});
  setTimeout(()=>{if(aiToolWaiters.delete(id))resolve('操作超时，请重试。');},25000);
 });
}
function aiRunSnippet(code,lang){
 return new Promise(resolve=>{
  const l=String(lang||'').toLowerCase();
  const js=/^(js|javascript|mjs)$/.test(l),cpp=/^(c|cc|cpp|cxx|c\+\+)$/.test(l);
  /* C++ 首次要加载本地工具链，准备阶段放宽到 90 秒。 */
  const w=new Worker(js?'javascript-worker.js':cpp?'cpp-worker.js':'python-worker.js');
  let out='';const timer=setTimeout(()=>{try{w.terminate();}catch(e){}resolve(out+'\n[达到运行上限]');},cpp?90000:15000);
  const done=value=>{clearTimeout(timer);try{w.terminate();}catch(e){}resolve(String(value||out||'(无输出)').slice(0,8000));};
  w.onmessage=e=>{const m=e.data||{};if(m.type==='stdout'||m.type==='stderr')out+=m.text;else if(m.type==='done')done();};
  w.onerror=e=>done('运行失败：'+(e.message||'未知错误'));
  try{w.postMessage({code,path:js?'ai_snippet.js':cpp?'ai_snippet.cpp':'ai_snippet.py',stdin:'',files:state.files.map(f=>({path:f.path,text:f.text}))});}catch(e){done('运行环境未能启动：'+e.message);}
 });
}
initAI({
 native,notify,send,scheduleSave,aiTool,
 getActiveText:()=>view?view.state.doc.toString():active().text,
 listFiles:()=>state.files.map(f=>f.path),
 readFile:path=>{const f=state.files.find(x=>x.path===String(path).slice(0,200));return f?f.text:'（文件不存在）';},
 writeFile:(path,text)=>{const p=String(path).slice(0,200);if(!validPath(p))return '路径无效';
   const f=state.files.find(x=>x.path===p);
   if(f){f.text=String(text).slice(0,20000);editorStates.delete(p);}else if(state.files.length<160)state.files.push(makeFile(p,String(text).slice(0,20000)));else return '工作区已满';
   restoring=true;if(state.active===p)createEditor();restoring=false;renderFiles();changed();scheduleSave();return '已写入草稿：'+p;},
 insertText:text=>{if(!view)return '编辑器未就绪';const at=view.state.selection.main.head,value=String(text).slice(0,20000);
   view.dispatch({changes:{from:at,to:at,insert:value},selection:{anchor:at+value.length}});changed();scheduleSave();return '已插入编辑器';},
 switchFile:path=>{const p=String(path).slice(0,200);if(!state.files.some(f=>f.path===p))return '文件不存在：'+p;switchFile(p);return '已打开：'+p;},
 runSnippet:aiRunSnippet
});
openLanding(false);
window.Studio={getState:()=>({...snapshot(),mode:workspaceMode,home:landingOpen,layers:moduleLayers(),resume:rememberedMode(),caps:moduleCaps}),get view(){return view;},run,stop,flush,importFiles,back:handleSystemBack,exitMessage:()=>exitCopy(state.files).message,lecture:lectureDebug,tts:ttsDebug,ai:aiDebug,model:()=>modelApi?modelApi.debug():{objects:0,selected:0,mode:'object',sheet:'',active:false}};
if(native)send('ready');else{let saved=null;try{saved=JSON.parse(localStorage.getItem('ember-studio-v1'));}catch(e){}restore(saved);}
