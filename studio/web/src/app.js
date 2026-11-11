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
import {BACK,resolveBack,canLeaveMode,resumeCard,exitCopy,unsavedOriginals,HOME_ACTIONS,moduleById,isNativeModule,moduleAvailability} from './back.js';
import {NOTE_TEMPLATES,templateById,templateFileName,sanitizeTemplateState,insertTemplate,noteTemplateAction,notepadTarget,isNotepadNotePath,shouldRememberCodePath} from './note-templates.js';
import {createQuizRequester,quizAIAvailability,normalizeQuizCount,gradeQuiz,retryWrongQuiz,quizToMarkdown,quizFileName,QUIZ_TYPE_LABELS,QUIZ_NOTE_LIMIT} from './quiz.js';

const $=id=>document.getElementById(id),native=!!window.StudioBridge,MAX_FILE=2*1024*1024;
/* 原生工作区快照的硬上限（EditorActivity 里是同一个数）。
   以前超限是静默丢弃整份草稿，现在先在页面里算清楚再明确报错。 */
const WORKSPACE_LIMIT=30*1024*1024;

/* Light editor surface: calm paper background, quiet gutters, GitHub-like syntax colours. */
const codeTheme=EditorView.theme({
  '&':{backgroundColor:'#ffffff',color:'#1f2937',height:'100%'},
  '.cm-content':{caretColor:'#111827'},
  '.cm-cursor,.cm-dropCursor':{borderLeftColor:'#111827'},
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,.cm-content ::selection':{backgroundColor:'#dbeafe'},
  '.cm-gutters':{backgroundColor:'#ffffff',color:'#a7b3c2',border:'none'},
  '.cm-activeLine':{backgroundColor:'#f7f9fc'},
  '.cm-activeLineGutter':{backgroundColor:'#f7f9fc',color:'#5b6b80'},
  '.cm-panels':{backgroundColor:'#f7f9fc',color:'#1f2937'},
  '.cm-searchMatch':{backgroundColor:'#fde68a'},
  '.cm-searchMatch.cm-searchMatch-selected':{backgroundColor:'#fca5a5'},
  '.cm-tooltip':{backgroundColor:'#ffffff',border:'1px solid #e3e8ef',color:'#1f2937'},
  '.cm-tooltip-autocomplete>ul>li[aria-selected]':{backgroundColor:'#eef4ff',color:'#1d4ed8'}
},{dark:false});
const codeHighlight=HighlightStyle.define([
  {tag:tags.comment,color:'#6b7280',fontStyle:'italic'},
  {tag:[tags.keyword,tags.operatorKeyword,tags.modifier,tags.controlKeyword],color:'#cf222e'},
  {tag:[tags.string,tags.special(tags.string),tags.regexp],color:'#0a3069'},
  {tag:[tags.number,tags.bool,tags.null],color:'#0550ae'},
  {tag:[tags.function(tags.variableName),tags.definition(tags.function(tags.variableName))],color:'#8250df'},
  {tag:[tags.className,tags.typeName,tags.namespace],color:'#953800'},
  {tag:[tags.propertyName,tags.attributeName],color:'#116329'},
  {tag:[tags.tagName],color:'#116329'},
  {tag:tags.heading,color:'#0550ae',fontWeight:'600'},
  {tag:[tags.link,tags.url],color:'#0969da',textDecoration:'underline'},
  {tag:tags.invalid,color:'#b91c1c'}
]);
const langs={py:['Python',python],js:['JavaScript',javascript],mjs:['JavaScript',javascript],ts:['TypeScript',()=>javascript({typescript:true})],html:['HTML',html],htm:['HTML',html],css:['CSS',css],json:['JSON',json],c:['C',cpp],h:['C/C++',cpp],cpp:['C++',cpp],cc:['C++',cpp],java:['Java',java],md:['Markdown',markdown]};
const extension=path=>(path.split('.').pop()||'').toLowerCase();
const validPath=path=>typeof path==='string'&&path.length>0&&path.length<=200&&!path.startsWith('/')&&!path.split('/').some(v=>!v||v==='.'||v==='..')&&!/[\x00-\x1f\\:*?"<>|]/.test(path);
const makeFile=(path,text,uri='',encoding='UTF-8')=>({path,text,uri,encoding,savedText:text});
const defaults=()=>({version:1,files:[makeFile('main.py','# 天工 · 离线 Python\n# 标准输入在下方面板填写，每行一项\nfrom geometry import rectangle_area\nimport json\n\nname = input("你的名字：")\nprint(f"你好，{name}！")\n\nwith open("data.json", encoding="utf-8") as f:\n    shape = json.load(f)\n\narea = rectangle_area(shape["width"], shape["height"])\nprint(f"长方形面积：{area}")\nfor i in range(1, 4):\n    print("让想法运行起来", "✦" * i)\n'),makeFile('geometry.py','def rectangle_area(width, height):\n    """计算长方形面积。"""\n    return width * height\n'),makeFile('data.json','{\n  "width": 8,\n  "height": 5\n}\n'),makeFile('index.html','<!doctype html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<style>body{background:#142330;color:#b2ebda;font:18px system-ui;padding:30px}button{padding:12px;border-radius:8px}</style>\n<h1>你好，天工！</h1>\n<p>这是手机上写出的第一个页面。</p>\n<button onclick="this.textContent=\'想法变成了现实 ✦\'">试着点一下</button>\n</html>\n')],active:'main.py',opened:['main.py','geometry.py'],stdin:'伍子平\n',settings:{fontSize:15,wrap:true,timeLimit:15},drawStrokes:[],drawView:null,tts:{voice:'',locale:'en-US',rate:1},noteTemplates:sanitizeTemplateState(),ai:aiSerialize()});
let state=defaults(),view,restoring=false,worker=null,runToken=0,timeout=null,saveTimer=null,revision=0,latestSaved=0,renamePath=null,ready=false,toastTimer,pendingSaves=new Map(),runFiles=[];
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
function snapshot(){return {version:1,files:state.files,active:state.active,opened:state.opened,stdin:$('stdin').value,settings:state.settings,noteTemplates:sanitizeTemplateState(state.noteTemplates),lecture:lectureSerialize(),tts:ttsSerialize(),drawStrokes:state.drawStrokes||[],drawView:getDrawView(),ai:aiSerialize()};}
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
  state.settings.fontSize=Math.max(12,Math.min(24,Number(state.settings.fontSize)||15));state.settings.timeLimit=[15,30,60].includes(+state.settings.timeLimit)?+state.settings.timeLimit:15;if(window.innerWidth<700)state.settings.wrap=true;
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
     if(update.docChanged&&!restoring){const f=active();f.text=update.state.doc.toString();scheduleSave();refreshBadges();ttsDocumentChanged('edited');}
     if(update.selectionSet||update.docChanged)position();
   })
 ]};
 view=new EditorView({state:EditorState.create(config),parent:$('editor')});view.dom.style.fontSize=state.settings.fontSize+'px';editorStates.set(active().path,view.state);position();lectureViewCreated();
}
function position(){if(!view)return;const pos=view.state.selection.main.head,line=view.state.doc.lineAt(pos);$('position').textContent=`第 ${line.number} 行，第 ${pos-line.from+1} 列`;const note=$('noteCount');if(note&&document.body.classList.contains('notepad'))note.textContent=view.state.doc.length+' 字 · '+view.state.doc.lines+' 行';else if(note&&document.body.classList.contains('lecture'))note.textContent=lectureStatusText();else if(note&&document.body.classList.contains('tts'))note.textContent=ttsStatusText();else if(note&&document.body.classList.contains('aiview'))note.textContent=aiStatusText();const empty=$('noteEmpty');if(empty){const blank=document.body.classList.contains('notepad')||document.body.classList.contains('lecture');empty.classList.toggle('show',blank&&view.state.doc.length===0);}}
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
function applySettings(){$('fontSize').value=state.settings.fontSize;$('fontSizeValue').textContent=state.settings.fontSize;$('wordWrap').checked=!!state.settings.wrap;$('timeLimit').value=state.settings.timeLimit;if(view){view.dom.style.fontSize=state.settings.fontSize+'px';view.dispatch({effects:[wrapConfig.reconfigure(state.settings.wrap?EditorView.lineWrapping:[])]});}}
for(const id of ['fontSize','wordWrap','timeLimit'])$(id).oninput=()=>{state.settings={fontSize:+$('fontSize').value,wrap:$('wordWrap').checked,timeLimit:+$('timeLimit').value};applySettings();scheduleSave();};
function append(text,error=false){if($('output').textContent.length>=70000)return;const span=document.createElement('span');if(error)span.className='error';span.textContent=String(text).slice(0,70000-$('output').textContent.length);$('output').append(span);$('output').scrollTop=$('output').scrollHeight;}
function setConsole(open){$('consolePanel').classList.toggle('folded',!open);$('foldConsole').setAttribute('aria-expanded',String(open));}
function outputTab(input=false){$('output').hidden=input;$('stdin').hidden=!input;$('inputTab').classList.toggle('active',input);$('outputTab').classList.toggle('active',!input);setConsole(true);}
function setRunning(running){$('runButton').hidden=running;$('stopButton').hidden=!running;for(const id of ['newFile','openFile','openFolder','saveButton','exportButton','menuNew','menuOpen','menuFolder','menuSave','menuGame','menuMode','menuTemplates','menuQuiz']){const el=$(id);if(el)el.disabled=running;}if(view)view.dispatch({effects:editConfig.reconfigure(EditorState.readOnly.of(running))});}
function stop(reason='已停止运行'){runToken++;if(worker)worker.terminate();worker=null;clearTimeout(timeout);setRunning(false);$('runState').textContent=reason;}
function applyRunFiles(files){let updated=0;for(const f of files||[]){if(!validPath(f.path)||typeof f.text!=='string'||f.text.length>MAX_FILE)continue;const existing=state.files.find(x=>x.path===f.path);if(existing){if(existing.text===f.text)continue;existing.text=f.text;editorStates.delete(f.path);}else if(state.files.length<160)state.files.push(makeFile(f.path,f.text));else continue;updated++;}if(updated){restoring=true;createEditor();restoring=false;changed();append(`\n[工作区] 已保留 ${updated} 个新增或修改的文件，写回手机文件需点击保存。\n`);}}
async function run(){
 if(worker)return;const f=active(),ext=extension(f.path);if(['html','htm'].includes(ext)){preview();return;}if(!['py','js','mjs'].includes(ext)){notify(language(f.path)[0]+' 暂仅支持编辑；请运行 .py、.js 或预览 .html。');return;}
 flush();outputTab(false);$('output').replaceChildren();$('runState').textContent=ext==='py'?'准备 Python…':'运行 JavaScript…';runFiles=state.files.map(f=>({path:f.path,text:f.text}));const token=++runToken;worker=new Worker(ext==='py'?'python-worker.js':'javascript-worker.js');setRunning(true);const started=performance.now();let hasStarted=false;
 timeout=setTimeout(()=>{if(token!==runToken)return;append('\n运行超时，已停止。可以在设置中调整运行上限。\n',true);stop('运行超时');},45000);
 worker.onmessage=event=>{if(token!==runToken)return;const m=event.data||{};if(m.type==='started'&&!hasStarted){hasStarted=true;clearTimeout(timeout);$('runState').textContent='运行中 · 可停止';timeout=setTimeout(()=>{append('\n达到运行上限，已终止工作线程。\n',true);stop('运行超时');},state.settings.timeLimit*1000);}else if(m.type==='stdout'||m.type==='stderr')append(m.text,m.type==='stderr');else if(m.type==='done'){const elapsed=((performance.now()-started)/1000).toFixed(2);stop(m.ok?'执行完成 · '+elapsed+'s':'执行失败 · '+elapsed+'s');applyRunFiles(m.files);flush();}else if(m.type==='error'){append(m.text+'\n',true);stop('运行环境未能启动');}};
 worker.onerror=event=>{if(token!==runToken)return;append('运行环境错误：'+event.message+'\n请确认系统 WebView 支持 WebAssembly。\n',true);stop('运行环境错误');};
 worker.postMessage({path:f.path,code:f.text,files:runFiles,stdin:$('stdin').value});
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
  else if(m.type==='saved'){const pending=pendingSaves.get(m.id);pendingSaves.delete(m.id);if(m.ok&&pending){const f=state.files.find(f=>f.path===pending.path);if(f){f.savedText=pending.text;f.uri=m.uri||f.uri;f.encoding=m.encoding||f.encoding;changed();}notify('已保存到手机文件。');}else notify(m.message||'保存未完成，草稿仍保留。');}
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
  if(mode!=='notepad')document.body.classList.remove('notepad');
  if(mode!=='lecture')document.body.classList.remove('lecture');
  if(mode!=='tts')document.body.classList.remove('tts');
  if(mode!=='ai')document.body.classList.remove('aiview');
  if(mode!=='game')document.body.classList.remove('gameview');
}
on('filesToggle',()=>{closeMenu();document.body.classList.toggle('drawer');});on('backdrop',closeDrawer);on('closeExplorer',closeDrawer);on('newFile',()=>nameDialog());on('newTab',()=>nameDialog());menu('menuNew',()=>nameDialog());
menu('findButton',()=>{openSearchPanel(view);const searchInput=document.querySelector('.cm-search input');if(searchInput)searchInput.focus();else if(view)view.focus();});menu('settingsButton',()=>$('settingsDialog').showModal());on('saveButton',()=>saveFile());menu('menuSave',()=>saveFile());menu('exportButton',()=>saveFile(true));on('runButton',run);on('stopButton',()=>{append('\n[已手动停止]\n');stop();});on('outputTab',()=>outputTab(false));on('inputTab',()=>outputTab(true));on('clearOutput',()=>$('output').replaceChildren());on('foldConsole',()=>setConsole($('consolePanel').classList.contains('folded')));on('openFile',()=>{flush();closeDrawer();native?send('open'):$('browserFiles').click();});on('openFolder',()=>{flush();closeDrawer();native?send('folder'):$('browserFolder').click();});menu('menuOpen',()=>{flush();native?send('open'):$('browserFiles').click();});menu('menuFolder',()=>{flush();native?send('folder'):$('browserFolder').click();});on('moreButton',()=>$('menuDialog').showModal());$('browserFiles').onchange=browserImport;$('browserFolder').onchange=browserImport;$('stdin').oninput=scheduleSave;
on('codeTab',()=>{if(workspaceMode==='game'){flush();openLanding(true);return;}showCode();});on('gameTab',showGame);menu('menuGame',showGame);menu('menuMode',()=>{flush();openLanding(true);});on('playGame',()=>{flush();if(native)send('play');else notify('此预览仅展示编辑器，安装 APK 后可直接进入原生游戏。');});on('exportGame',()=>native?send('exportGame'):notify('游戏存档备份在 Android APK 中使用。'));on('importGame',()=>native?send('importGame'):notify('安装 APK 后可导入游戏备份。'));on('drawToggle',()=>{if(workspaceMode!=='notepad')return;if(isDrawMode()){exitDrawMode();}else{enterDrawMode();}});
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
function markLandingReady(){if(!landing)return;landing.dataset.ready='1';if(landingStatus)landingStatus.textContent='草稿已就绪';setHomeEnabled(true);refreshAvailability();refreshHomeTitle();refreshResume();}
function hideLanding(){if(!landingOpen||!landing)return;if(workspaceMode==='ai')aiEnterPanel();if(workspaceMode==='tts')ttsShowBar();landingOpen=false;landing.classList.add('landing-out');landing.setAttribute('aria-hidden','true');clearTimeout(landingTimer);landingTimer=setTimeout(()=>{if(landingOpen)return;landing.hidden=true;landing.classList.remove('landing-out');if(view&&!['game','ai'].includes(workspaceMode))view.focus();},280);}
function openLanding(reopen=false){
  if(!landing)return;
  if(reopen&&workspaceMode==='tts')ttsHideBar();
  if(reopen&&workspaceMode==='ai'){setAISettings(false);aiHidePanel();}
  closeDrawer();closeMenu();
  if(view){try{closeSearchPanel(view);}catch(e){}}
  clearTimeout(landingTimer);
  landing.hidden=false;landing.classList.remove('landing-out');landing.removeAttribute('aria-hidden');
  landingOpen=true;homeFromSession=!!reopen;
  if(landingBack){landingBack.hidden=!reopen;const meta=moduleById(workspaceMode);landingBack.textContent='‹ 回到'+(meta?meta.title:'刚才的工作');}
  if(landingStatus)landingStatus.textContent=ready?'草稿已就绪':'正在读取草稿';
  if(reopen&&KNOWN_MODES.includes(workspaceMode)){selectedMode=workspaceMode;lastOpened=workspaceMode;}
  refreshHomeTitle();refreshResume();
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
  {id:'aiSettings',mode:'ai',open:()=>!!$('aiPanel')&&$('aiPanel').classList.contains('settings-open'),close:()=>setAISettings(false)}
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
function ensureEnglishText(){let text=state.files.find(f=>f.path==='English.txt');if(!text){const activeFile=state.files.find(f=>f.path===state.active&&/\.(txt|md)$/i.test(f.path)&&/[A-Za-z]/.test(f.text||''));if(activeFile)text=activeFile;}if(!text){if(state.files.length>=160){notify('工作区已有 160 个文件，请先打开英文文本或腾出一个文件名额。');return null;}text=makeFile('English.txt','Welcome to English Reading.\n\nType or open an English text here. The reader divides long paragraphs at natural sentence boundaries, so you can follow an entire article without losing your place.\n\nChoose an installed English voice, adjust the speaking rate, and use the same controls to pause, continue, or stop at any time.\n');state.files.push(text);changed();}if(!state.opened.includes(text.path))state.opened.push(text.path);lastTtsPath=text.path;return text;}
function applyMode(mode){
  const guard=canLeaveMode({recording:workspaceMode==='lecture'&&lectureBusy(),running:!!worker,to:mode});
  if(!guard.ok&&guard.reason==='recording'){notify('正在上课录音，请先点「⏹ 停止」结束录音，再切换模式。');selectedMode='lecture';return false;}
  if(!guard.ok){notify('Python 或 JavaScript 正在运行，请先停止运行，再切换模式。');return false;}
  const ttsTarget=mode==='tts'?((lastTtsPath&&state.files.find(x=>x.path===lastTtsPath))||state.files.find(x=>x.path==='English.txt')||ensureEnglishText()):null;
  if(mode==='tts'&&!ttsTarget)return false;
  if(workspaceMode==='tts'&&mode!=='tts')ttsModeLeave();
  const leavingAI=workspaceMode==='ai'&&mode!=='ai';
  setWorkspaceMode(mode);  const noteEmpty=$('noteEmpty');
  if(noteEmpty)noteEmpty.textContent=mode==='lecture'?'点上方「🎙 开始录音」，边听边记；每一行都会自动带上时间戳。':'从这里开始写点什么…';
  const drawToggle=$('drawToggle');
  if(leavingAI)aiModeLeave();
  const aiPanel=$('aiPanel');
  if(mode==='ai'){
    document.body.classList.remove('notepad','lecture','tts');document.body.classList.add('aiview');
    lectureModeLeave();if(drawToggle)drawToggle.hidden=true;if(isDrawMode())exitDrawMode();
    $('workbench').hidden=true;$('lounge').hidden=true;
    if(aiPanel)aiPanel.hidden=false;
    $('activePath').textContent='AI 助手';$('dirtyFlag').textContent='';
    aiModeEnter();return true;
  }
  if(aiPanel)aiPanel.hidden=true;
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
  const js=/^(js|javascript|mjs)$/i.test(lang||''),w=new Worker(js?'javascript-worker.js':'python-worker.js');
  let out='';const timer=setTimeout(()=>{try{w.terminate();}catch(e){}resolve(out+'\n[达到 15 秒运行上限]');},15000);
  const done=value=>{clearTimeout(timer);try{w.terminate();}catch(e){}resolve(String(value||out||'(无输出)').slice(0,8000));};
  w.onmessage=e=>{const m=e.data||{};if(m.type==='stdout'||m.type==='stderr')out+=m.text;else if(m.type==='done')done();};
  w.onerror=e=>done('运行失败：'+(e.message||'未知错误'));
  try{w.postMessage({code,path:js?'ai_snippet.js':'ai_snippet.py',stdin:'',files:state.files.map(f=>({path:f.path,text:f.text}))});}catch(e){done('运行环境未能启动：'+e.message);}
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
window.Studio={getState:()=>({...snapshot(),mode:workspaceMode,home:landingOpen,layers:moduleLayers(),resume:rememberedMode(),caps:moduleCaps}),get view(){return view;},run,stop,flush,importFiles,back:handleSystemBack,exitMessage:()=>exitCopy(state.files).message,lecture:lectureDebug,tts:ttsDebug,ai:aiDebug};
if(native)send('ready');else{let saved=null;try{saved=JSON.parse(localStorage.getItem('ember-studio-v1'));}catch(e){}restore(saved);}
