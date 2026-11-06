/* 天工 · AI 助手（原创实现）
 * 设计要点：联网默认关闭；凭据只留在工作区；所有写操作必须人工确认；
 * 网络请求交给原生桥（WebView 的 CSP 禁止外部 connect）；工具卡协议自定义。
 * 本模块不引用 dsh-Go 的任何代码，只借鉴「本机 / 远程 / 工具审批 / 插话」这类产品形态。
 */
export const AI_THEMES=['jade','ink','amber','rose','ocean','violet'];
export const AI_MODELS=['deepseek-chat','deepseek-reasoner','deepseek-coder'];
export const AI_TOOLS=[
  {name:'readFile',title:'读取工作区文件',args:['path'],write:false},
  {name:'listFiles',title:'列出工作区文件',args:[],write:false},
  {name:'runCode',title:'本机离线运行代码',args:['code','lang'],write:false},
  {name:'insertCode',title:'把代码插入编辑器',args:['code'],write:true},
  {name:'writeFile',title:'写入工作区文件',args:['path','code'],write:true},
  {name:'switchFile',title:'打开工作区文件',args:['path'],write:true},
  {name:'authorizeTree',title:'授权手机目录',args:[],write:false},
  {name:'scanFiles',title:'只读扫描残留文件',args:[],write:false},
  {name:'organizeFiles',title:'整理文件（重命名）',args:['moves'],write:true},
  {name:'deleteFiles',title:'清理残留文件',args:['documentIds','confirmed'],write:true,danger:true},
  {name:'writeWorkLog',title:'写入工作日志',args:['text'],write:true},
  {name:'scheduleTask',title:'创建定时任务',args:['at','action'],write:true},
  {name:'listTasks',title:'查看定时任务',args:[],write:false},
  {name:'cancelTask',title:'取消定时任务',args:['id'],write:true}
];
export const DEVICE_TOOLS=['authorizeTree','scanFiles','organizeFiles','deleteFiles','writeWorkLog','scheduleTask','listTasks','cancelTask'];
export const DEFAULT_AI={
  enabled:false,baseUrl:'https://api.deepseek.com/chat/completions',apiKey:'',model:'deepseek-chat',
  temperature:.7,system:'你是天工工作台里的编程助手。回答简洁，用中文。需要操作文件时输出 tool 代码块。',
  lang:'zh',theme:'jade',view:'chat',remote:false,remoteUrl:'',autoApprove:false
};
export const AI_LABELS={
  zh:{title:'AI 助手',off:'联网未开启',on:'已开启 · 请求仅发往你填写的服务',enable:'开启联网',send:'发送',stop:'停止',
      queue:'插话队列',flush:'立即发送',newSession:'新会话',export:'导出会话',import:'导入回放',share:'分享卡',
      settings:'连接与外观',base:'接口地址',key:'API Key',model:'模型',temp:'温度',remote:'连接电脑上的服务',
      remoteUrl:'电脑服务地址',auto:'自动批准只读工具',system:'系统提示',lang:'语言',theme:'主题',view:'视图',
      chat:'对话',web:'网页',thinking:'正在思考…',idle:'就绪',done:'已完成',waiting:'等待确认',
      approve:'允许',deny:'拒绝',tool:'工具过程',quick:'快捷指令',explain:'解释当前代码',generate:'生成代码',
      run:'运行当前文件',summarize:'总结会话',placeholder:'问点什么，或让我帮你改代码…',
      gate:'AI 助手默认不联网。开启后，请求只发往你填写的服务，密钥仅保存在本机工作区。',
      gateBtn:'我了解，开启联网',noKey:'请先填写 API Key 或服务地址。',
      browser:'浏览器预览不支持外部请求，请在天工 APK 中使用 AI 助手。',
      confirm:'把内容写进编辑器或文件前，需要你点「允许」。',tools:'工具卡',pet:'小助手',
      copy:'复制会话',load:'载入会话文本',shareTitle:'天工 · AI 助手对话',session:'会话回放',close:'关闭',
      attach:'添加图片',voice:'语音输入',voiceNo:'当前浏览器不支持语音识别',saved:'会话已保存'},
  en:{title:'AI Assistant',off:'Networking off',on:'On · requests go only to your endpoint',enable:'Enable networking',
      send:'Send',stop:'Stop',queue:'Queued',flush:'Send now',newSession:'New chat',export:'Export',import:'Replay',
      share:'Share card',settings:'Connection & appearance',base:'Endpoint',key:'API Key',model:'Model',temp:'Temperature',
      remote:'Connect to a computer',remoteUrl:'Remote endpoint',auto:'Auto-approve read-only tools',system:'System prompt',
      lang:'Language',theme:'Theme',view:'View',chat:'Chat',web:'Web',thinking:'Thinking…',idle:'Ready',done:'Done',
      waiting:'Awaiting approval',approve:'Allow',deny:'Deny',tool:'Tool steps',quick:'Shortcuts',
      explain:'Explain current code',generate:'Generate code',run:'Run current file',summarize:'Summarize chat',
      placeholder:'Ask anything, or let me write code…',
      gate:'AI Assistant never connects by default. Requests go only to the endpoint you enter and the key stays on this device.',
      gateBtn:'I understand, enable',noKey:'Enter an API Key or endpoint first.',
      browser:'Browser preview cannot reach external services. Use the APK for AI features.',
      confirm:'Writing to the editor or a file always needs your approval.',tools:'Tool cards',pet:'Companion',
      copy:'Copy chat',load:'Load chat text',shareTitle:'Ember Studio · AI Chat',session:'Chat replay',close:'Close',saved:'Chat saved'}
};
export const i18n=(key,lang)=>(AI_LABELS[lang==='en'?'en':'zh']||AI_LABELS.zh)[key]||key;

const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const str=(v,max)=>typeof v==='string'?v.slice(0,max):'';
export function aiSanitize(raw){
  const r=raw&&typeof raw==='object'?raw:{};
  return {
    enabled:r.enabled===true,
    baseUrl:str(r.baseUrl,300)||DEFAULT_AI.baseUrl,
    apiKey:str(r.apiKey,300),
    model:str(r.model,80)||DEFAULT_AI.model,
    temperature:clamp(Number(r.temperature)||.7,0,2),
    system:str(r.system,2000)||DEFAULT_AI.system,
    lang:r.lang==='en'?'en':'zh',
    theme:AI_THEMES.includes(r.theme)?r.theme:'jade',
    view:r.view==='web'?'web':'chat',
    remote:r.remote===true,
    remoteUrl:str(r.remoteUrl,300),
    autoApprove:r.autoApprove===true
  };
}
export function trimMessages(list){
  const src=Array.isArray(list)?list:[];const out=[];let total=0;
  for(const m of src.slice(-200)){
    if(!m||typeof m!=='object')continue;
    const role=['user','assistant','tool','system'].includes(m.role)?m.role:'user';
    const content=str(m.content,20000),ts=Number(m.ts)||Date.now();
    if(total+content.length>200000)break;
    total+=content.length;out.push({role,content,ts,kind:str(m.kind,20),name:str(m.name,40)});
  }
  return out;
}
/** Self-defined tool-card protocol: fenced ```tool blocks containing {tool,args}. */
export function parseToolCalls(text){
  const out=[];if(typeof text!=='string')return out;
  const re=/```tool\s*([\s\S]*?)```/g;let match;
  while((match=re.exec(text))!==null){
    try{
      const call=JSON.parse(match[1].trim());
      if(call&&typeof call.tool==='string'&&AI_TOOLS.some(t=>t.name===call.tool))
        out.push({tool:call.tool,args:call.args&&typeof call.args==='object'?call.args:{}});
    }catch(e){/* malformed card is shown as plain text */}
  }
  return out;
}
export function shareCardData(messages,title,limit=6){
  const lines=trimMessages(messages).filter(m=>m.role==='user'||m.role==='assistant').slice(-limit)
    .map(m=>({who:m.role==='user'?'我':'AI',text:str(m.content,120).replace(/\s+/g,' ').trim()}));
  return {title:str(title,60)||'天工 · AI 助手',lines};
}
export function endpointOf(settings){
  const s=aiSanitize(settings);
  return s.enabled&&s.remote&&s.remoteUrl?s.remoteUrl:s.baseUrl;
}
export function requestBody(settings,messages){
  const s=aiSanitize(settings);
  return {model:s.model,temperature:s.temperature,stream:true,
    messages:[{role:'system',content:s.system},...trimMessages(messages).map(m=>({role:m.role==='tool'?'user':m.role,content:m.content}))]};
}
export function aiLeavePlan({busy=false,queueLength=0}={}){
  const queued=Math.max(0,Math.floor(Number(queueLength)||0));
  if(queued>0)return {cancel:busy,dropQueue:true,notice:queued};
  return {cancel:busy,dropQueue:false,notice:0};
}

/* ---- runtime state (DOM access is confined to initAI and its handlers) ---- */
let env=null,settings=aiSanitize(null),messages=[],busy=false,currentId='',queue=[],streamBuffer='',dom=null,handledTs=0;
export function aiSerialize(){return {settings:aiSanitize(settings),messages:trimMessages(messages)};}
export function aiRestore(data){settings=aiSanitize(data&&data.settings);messages=trimMessages(data&&data.messages);if(dom)renderAll();}
export function aiDebug(){return {settings:aiSanitize(settings),messages:trimMessages(messages),busy,queue:queue.slice(),currentId};}
export function aiStatusText(){return busy?i18n('thinking',settings.lang):settings.enabled?i18n('idle',settings.lang):i18n('off',settings.lang);}
const notify=text=>{if(env&&env.notify)env.notify(text);};
const save=()=>{if(env&&env.scheduleSave)env.scheduleSave();};
const el=id=>dom?dom[id]:null;
const L=key=>i18n(key,settings.lang);

function applyAppearance(){
  if(!dom)return;
  document.documentElement.dataset.aiTheme=settings.theme;
  const panel=el('aiPanel');if(panel)panel.classList.toggle('ai-web',settings.view==='web');
  const status=el('aiStatus');if(status)status.textContent=aiStatusText();
  const pet=el('aiPet');if(pet)pet.dataset.state=busy?'thinking':settings.enabled?'idle':'off';
  const gate=el('aiGate');if(gate)gate.hidden=settings.enabled;
  const lang=el('aiLang'),theme=el('aiTheme'),view=el('aiView');
  if(lang)lang.value=settings.lang;if(theme)theme.value=settings.theme;if(view)view.value=settings.view;
  if(dom&&dom.panel)dom.panel.setAttribute('lang',settings.lang==='en'?'en':'zh-CN');
}
function refreshLabels(){
  if(!dom)return;
  const map={aiTitle:'title',aiSend:'send',aiStop:'stop',aiNewSession:'newSession',aiExport:'export',
    aiImport:'import',aiShare:'share',aiGateBtn:'gateBtn',aiGateText:'gate',aiStatusHint:'confirm',
    aiSettingsTitle:'settings',aiQuickTitle:'quick',aiToolsTitle:'tools',aiShareTitle:'shareTitle',
    aiSessionTitle:'session',aiCopy:'copy',aiLoad:'load',aiCloseShare:'close',aiCloseSession:'close'};
  for(const [id,key] of Object.entries(map)){const node=el(id);if(node)node.textContent=L(key);}
  const input=el('aiInput');if(input)input.placeholder=L('placeholder');
  const flush=el('aiFlushQueue');if(flush)flush.textContent=L('flush');
  const quick=el('aiQuick');if(quick)for(const b of quick.querySelectorAll('button[data-quick]'))b.textContent=L(b.dataset.quick);
}
function renderMessages(){
  const box=el('aiMessages');if(!box)return;box.replaceChildren();
  for(const m of messages){
    const row=document.createElement('article');row.className='ai-msg ai-'+m.role;
    const who=document.createElement('span');who.className='ai-who';
    who.textContent=m.role==='user'?L('pet')==='Companion'?'You':'我':m.role==='tool'||m.kind==='tool'?L('tool'):'AI';
    const body=document.createElement('div');body.className='ai-body';
    if(m.kind==='tool'||m.role==='tool'){
      const details=document.createElement('details');const summary=document.createElement('summary');
      summary.textContent=L('tool')+' · '+(m.name||'result');const pre=document.createElement('pre');pre.textContent=m.content;
      details.append(summary,pre);body.append(details);
    }else{
      for(const line of String(m.content).split('\n')){const p=document.createElement('p');p.textContent=line;body.append(p);}
    }
    row.append(who,body);
    if(m.role==='assistant'&&!busy){
      const tools=parseToolCalls(m.content);
      if(tools.length){const area=document.createElement('div');area.className='ai-tools';
        for(const call of tools)area.append(toolCard(call,m));body.append(area);}
      const insert=document.createElement('button');insert.className='ai-insert';insert.textContent='↳ '+L('approve');
      insert.onclick=()=>{if(env&&env.insertText)env.insertText(m.content,{confirm:true});};body.append(insert);
    }
    box.append(row);
  }
  box.scrollTop=box.scrollHeight;
}
/* Android has no recycle bin: list every path and require a second, explicit confirm. */
function confirmDelete(args,onYes){
  const ids=Array.isArray(args&&args.documentIds)?args.documentIds.slice(0,10):[];
  const dlg=document.createElement('dialog');dlg.className='ai-dialog';
  const title=document.createElement('h2');title.textContent='⚠️ 永久删除确认';
  const warn=document.createElement('p');warn.textContent='以下条目将被永久删除，不可恢复。请逐条核对，确认后再继续：';
  const list=document.createElement('pre');list.textContent=ids.length?ids.map((v,i)=>(i+1)+'. '+v).join('\n'):'（没有待删条目）';
  const row=document.createElement('div');row.className='ai-dialog-actions';
  const no=document.createElement('button');no.type='button';no.textContent='取消';
  const yes=document.createElement('button');yes.type='button';yes.textContent='确认永久删除';
  yes.style.cssText='background:#b0576a;color:#fff;border-color:transparent';
  no.onclick=()=>dlg.close();yes.onclick=()=>{dlg.close();onYes();};
  row.append(no,yes);dlg.append(title,warn,list,row);document.body.append(dlg);
  dlg.addEventListener('close',()=>dlg.remove());dlg.showModal();
}
function toolCard(call,message){
  const def=AI_TOOLS.find(t=>t.name===call.tool)||{title:call.tool,write:false};
  const card=document.createElement('div');card.className='ai-card'+(def.write?' ai-card-write':'');
  const head=document.createElement('strong');head.textContent=(def.write?'✎ ':'◇ ')+def.title+' · '+call.tool;
  const pre=document.createElement('pre');pre.textContent=JSON.stringify(call.args,null,2).slice(0,800);
  const row=document.createElement('div');row.className='ai-card-actions';
  const yes=document.createElement('button');yes.textContent=L('approve');
  const no=document.createElement('button');no.textContent=L('deny');
  yes.onclick=()=>{card.remove();
    if(call.tool==='deleteFiles')confirmDelete(call.args,()=>{call.args.confirmed=true;runTool(call);});
    else runTool(call);
  };
  no.onclick=()=>{card.remove();};
  row.append(yes,no);card.append(head,pre,row);
  return card;
}
async function runTool(call){
  if(!env)return;
  const args=call.args||{};let result='';
  try{
    if(DEVICE_TOOLS.includes(call.tool))result=env.aiTool?await env.aiTool(call.tool,args):'此能力需要天工 APK';
    else if(call.tool==='readFile')result=await env.readFile(str(args.path,200));
    else if(call.tool==='listFiles')result=(env.listFiles()||[]).join('\n');
    else if(call.tool==='runCode')result=await env.runSnippet(str(args.code,20000),str(args.lang,10)||'py');
    else if(call.tool==='insertCode')result=await env.insertText(str(args.code,20000),{confirm:true});
    else if(call.tool==='writeFile')result=await env.writeFile(str(args.path,200),str(args.code,20000),{confirm:true});
    else if(call.tool==='switchFile')result=await env.switchFile(str(args.path,200));
    else result='unknown tool';
  }catch(e){result='工具执行失败：'+(e&&e.message?e.message:e);}
  messages.push({role:'tool',content:String(result).slice(0,8000),ts:Date.now(),kind:'tool',name:call.tool});
  renderMessages();save();
}
function renderQueue(){
  const box=el('aiQueue'),list=el('aiQueueList');if(!box||!list)return;
  box.hidden=!queue.length;list.replaceChildren();
  for(const q of queue){const li=document.createElement('li');li.textContent=q;list.append(li);}
}
function renderAll(){applyAppearance();refreshLabels();renderMessages();renderQueue();syncSettings();}
function syncSettings(){
  if(!dom)return;
  const map={aiEnabled:'enabled',aiBaseUrl:'baseUrl',aiApiKey:'apiKey',aiModel:'model',aiTemperature:'temperature',
    aiRemote:'remote',aiRemoteUrl:'remoteUrl',aiAutoApprove:'autoApprove',aiSystem:'system'};
  for(const [id,key] of Object.entries(map)){
    const node=el(id);if(!node)continue;
    if(node.type==='checkbox')node.checked=!!settings[key];else node.value=settings[key];
  }
  applyAppearance();
}
function setSetting(key,value){settings=aiSanitize({...settings,[key]:value});syncSettings();renderAll();save();}

function push(role,content,kind,name){messages.push({role,content:str(content,20000),ts:Date.now(),kind:kind||'',name:name||''});messages=trimMessages(messages);renderMessages();save();}
function emit(type,data){if(env&&env.send)env.send(type,data);}
function startRequest(text){
  if(!settings.enabled){notify(L('gate'));return;}
  const url=endpointOf(settings);
  if(!/^https?:\/\//i.test(url)||!settings.apiKey&&!settings.remote){notify(L('noKey'));return;}
  if(env&&!env.native){notify(L('browser'));return;}
  if(busy)return;
  if(text)push('user',text);
  busy=true;streamBuffer='';currentId='ai-'+Date.now()+'-'+Math.floor(Math.random()*1e6);
  push('assistant','');
  emit('aiRequest',{id:currentId,url,key:settings.apiKey,body:requestBody(settings,messages.slice(0,-1))});
  applyAppearance();
}
function markInterrupted(){
  const last=messages[messages.length-1];
  if(last&&last.role==='assistant'){
    if(!last.content.includes('（已中断）'))
      last.content=last.content?last.content+'\n\n（已中断）':'（已中断）';
    handledTs=last.ts;
  }else{
    messages.push({role:'tool',content:'（已中断）',ts:Date.now(),kind:'status',name:'interrupted'});
  }
  messages=trimMessages(messages);
  renderMessages();
  save();
}
function finish(status,notifyCancelled=true){
  const wasBusy=busy;
  busy=false;currentId='';applyAppearance();
  const last=messages[messages.length-1];
  if(status==='done'&&last&&last.role==='assistant'&&last.ts!==handledTs){
    handledTs=last.ts;
    for(const call of parseToolCalls(last.content)){
      const def=AI_TOOLS.find(t=>t.name===call.tool);
      if(def&&!def.write&&settings.autoApprove)runTool(call);
    }
  }
  if(status==='cancelled'&&wasBusy){
    markInterrupted();
    if(notifyCancelled)notify('回答已中断。');
  }
  if(status==='error')notify('请求未完成，请检查地址与密钥。');
  if(queue.length){const next=queue.shift();renderQueue();startRequest(next);}
}
function cancel(dropQueue=false,notifyCancelled=true){
  if(dropQueue)queue=[];
  if(currentId)emit('aiCancel',{id:currentId});
  finish('cancelled',notifyCancelled);
}

export function aiReceive(m){
  if(!m||typeof m!=='object')return false;
  if(m.type==='aiChunk'){
    if(!busy||m.id!==currentId)return true;
    streamBuffer+=str(m.text,4000);
    if(messages.length&&messages[messages.length-1].role==='assistant')messages[messages.length-1].content=streamBuffer;
    renderMessages();return true;
  }
  if(m.type==='aiDone'){if(busy&&m.id===currentId)finish('done');return true;}
  if(m.type==='aiError'){if(busy&&m.id===currentId)finish('error');return true;}
  return false;
}
export function aiModeEnter(){if(dom&&dom.panel){dom.panel.hidden=false;}renderAll();}
export function aiHidePanel(){if(dom&&dom.panel)dom.panel.hidden=true;}
export function aiEnterPanel(){if(dom&&dom.panel)dom.panel.hidden=false;renderAll();}
export function aiModeLeave(){
  if(dom&&dom.panel)dom.panel.hidden=true;
  const plan=aiLeavePlan({busy,queueLength:queue.length});
  if(plan.cancel)cancel(plan.dropQueue,false);
  else if(plan.dropQueue){queue=[];renderQueue();}
  if(plan.notice)notify((plan.cancel?'回答已中断，':'')+'已丢弃 '+plan.notice+' 条未发送的消息。');
  else if(plan.cancel)notify('回答已中断。');
}

export function initAI(config){
  env=config;
  const $=id=>document.getElementById(id);
  dom={panel:$('aiPanel'),aiMessages:$('aiMessages'),aiInput:$('aiInput'),aiSend:$('aiSend'),aiStop:$('aiStop'),
    aiQueue:$('aiQueue'),aiQueueList:$('aiQueueList'),aiFlushQueue:$('aiFlushQueue'),aiNewSession:$('aiNewSession'),
    aiExport:$('aiExport'),aiImport:$('aiImport'),aiShare:$('aiShare'),aiStatus:$('aiStatus'),aiPet:$('aiPet'),
    aiGate:$('aiGate'),aiGateBtn:$('aiGateBtn'),aiGateText:$('aiGateText'),aiQuick:$('aiQuick'),aiTools:$('aiTools'),
    aiEnabled:$('aiEnabled'),aiBaseUrl:$('aiBaseUrl'),aiApiKey:$('aiApiKey'),aiModel:$('aiModel'),
    aiTemperature:$('aiTemperature'),aiRemote:$('aiRemote'),aiRemoteUrl:$('aiRemoteUrl'),
    aiAutoApprove:$('aiAutoApprove'),aiSystem:$('aiSystem'),aiLang:$('aiLang'),aiTheme:$('aiTheme'),aiView:$('aiView'),
    aiShareDialog:$('aiShareDialog'),aiShareCanvas:$('aiShareCanvas'),aiShareTitle:$('aiShareTitle'),
    aiCloseShare:$('aiCloseShare'),aiSessionDialog:$('aiSessionDialog'),aiSessionText:$('aiSessionText'),
    aiSessionTitle:$('aiSessionTitle'),aiCopy:$('aiCopy'),aiLoad:$('aiLoad'),aiCloseSession:$('aiCloseSession')};
  if(!dom.panel)return;
  const bind=(id,key,kind)=>{const node=el(id);if(!node)return;node.addEventListener(kind==='change'?'change':'input',()=>{
    let v=kind==='check'?node.checked:kind==='number'?Number(node.value):node.value;
    setSetting(key,v);
  });};
  bind('aiEnabled','enabled','check');bind('aiBaseUrl','baseUrl');bind('aiApiKey','apiKey');bind('aiModel','model');
  bind('aiTemperature','temperature','number');bind('aiRemote','remote','check');bind('aiRemoteUrl','remoteUrl');
  bind('aiAutoApprove','autoApprove','check');bind('aiSystem','system');
  for(const [id,key] of [['aiLang','lang'],['aiTheme','theme'],['aiView','view']]){
    const node=el(id);if(node)node.onchange=()=>setSetting(key,node.value);
  }
  if(el('aiGateBtn'))el('aiGateBtn').onclick=()=>setSetting('enabled',true);
  const send=()=>{
    const input=el('aiInput');if(!input)return;const text=input.value.trim();if(!text)return;input.value='';
    if(busy){queue.push(text);renderQueue();notify(L('queue'));return;}
    startRequest(text);
  };
  if(el('aiSend'))el('aiSend').onclick=e=>{e.preventDefault();send();};
  if(dom.aiInput)dom.aiInput.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.stopPropagation();send();}};
  if(el('aiStop'))el('aiStop').onclick=()=>cancel();
  if(el('aiFlushQueue'))el('aiFlushQueue').onclick=()=>{if(!queue.length)return;const next=queue.shift();renderQueue();if(busy)cancel();startRequest(next);};
  if(el('aiNewSession'))el('aiNewSession').onclick=()=>{messages=[];renderMessages();save();};
  if(el('aiExport'))el('aiExport').onclick=()=>{const dlg=el('aiSessionDialog');const area=el('aiSessionText');if(area)area.value=JSON.stringify(aiSerialize(),null,2);if(dlg&&dlg.showModal)dlg.showModal();};
  if(el('aiImport'))el('aiImport').onclick=()=>{const dlg=el('aiSessionDialog');const area=el('aiSessionText');if(area)area.value='';if(dlg&&dlg.showModal)dlg.showModal();};
  if(el('aiCopy'))el('aiCopy').onclick=()=>{const area=el('aiSessionText');if(area&&navigator.clipboard)navigator.clipboard.writeText(area.value).then(()=>notify(L('saved')));};
  if(el('aiLoad'))el('aiLoad').onclick=()=>{const area=el('aiSessionText');if(!area)return;try{aiRestore(JSON.parse(area.value));notify(L('saved'));}catch(e){notify('会话文本无法解析。');}};
  if(el('aiCloseSession'))el('aiCloseSession').onclick=()=>{const dlg=el('aiSessionDialog');if(dlg&&dlg.close)dlg.close();};
  if(el('aiShare'))el('aiShare').onclick=()=>{
    const canvas=el('aiShareCanvas');if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    const data=shareCardData(messages,L('shareTitle'));
    ctx.fillStyle='#f6f2e8';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#2b3440';ctx.font='bold 30px sans-serif';ctx.fillText(data.title,36,58);
    let y=104;ctx.font='20px sans-serif';
    for(const line of data.lines){ctx.fillStyle=line.who==='我'?'#8a5a44':'#4f7168';ctx.fillText(line.who,36,y);
      ctx.fillStyle='#3c4a55';ctx.fillText(line.text.slice(0,42),90,y);y+=54;if(y>canvas.height-40)break;}
    const dlg=el('aiShareDialog');if(dlg&&dlg.showModal)dlg.showModal();
  };
  if(el('aiCloseShare'))el('aiCloseShare').onclick=()=>{const dlg=el('aiShareDialog');if(dlg&&dlg.close)dlg.close();};
  const quick=el('aiQuick');
  if(quick)quick.onclick=e=>{
    const b=e.target.closest('button[data-quick]');if(!b)return;
    const key=b.dataset.quick,text=el('aiInput');if(!text)return;
    const current=env.getActiveText?env.getActiveText():'';
    const prompts={explain:'请解释当前文件的代码，指出关键点：\n',generate:'请写一段可以直接运行的 Python 代码，要求：\n',
      run:'请给出一个本机可运行的小例子，并说明预期输出：\n',summarize:'请用三句话总结我们目前的对话。'};
    text.value=(prompts[key]||'')+(key==='summarize'?'':current.slice(0,3000));text.focus();
  };
  const attach=el('aiAttach');
  if(attach)attach.onclick=()=>{const f=el('aiAttachInput');if(f)f.click();};
  const file=el('aiAttachInput');
  if(file)file.onchange=()=>{const f=file.files&&file.files[0];if(!f)return;const reader=new FileReader();
    reader.onload=()=>{const input=el('aiInput');if(input)input.value+='\n[图片：'+f.name+' · '+(typeof reader.result==='string'?reader.result.slice(0,40):'')+'…]\n';notify('图片已附注；多模态需模型支持。');};
    reader.readAsDataURL(f);};
  const voice=el('aiVoice');
  if(voice){
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR)voice.hidden=true;else voice.onclick=()=>{
      const r=new SR();r.lang=settings.lang==='en'?'en-US':'zh-CN';
      r.onresult=e=>{const input=el('aiInput');if(input)input.value+=(e.results[0][0].transcript||'');};
      r.onerror=()=>notify(L('voiceNo'));try{r.start();}catch(e){notify(L('voiceNo'));}
    };
  }
  const authorize=el('aiAuthorize');
  if(authorize)authorize.onclick=()=>emit('aiTree');
  renderAll();
  return {send,startRequest,cancel};
}
