// Run through the Playwright harness with `page`, `context`, `assert`, and `expect` injected.
// Set STUDIO_ROOT and optionally STUDIO_URL; otherwise the URL is read from build/studio/preview-url.txt.
const fs=await import('node:fs/promises');
const root=(process.env.STUDIO_ROOT||'').trim();
if(!root)throw new Error('STUDIO_ROOT is required');
const url=(process.env.STUDIO_URL||await fs.readFile(root+'/build/studio/preview-url.txt','utf8')).trim();
const passed=[];
const failed=[];
const run=async(name,expected,fn)=>{
  try{
    await fn();
    passed.push(name);
  }catch(error){
    failed.push({name,expected,actual:error&&error.message?error.message:String(error)});
  }
};
const equal=(actual,expected,label)=>assert.deepEqual(actual,expected,label+'\nexpected: '+JSON.stringify(expected)+'\nactual: '+JSON.stringify(actual));
const fixture=(aiEnabled=false)=>({
  version:1,
  files:[
    {path:'main.py',text:'print(1)',savedText:'print(1)',uri:'',encoding:'UTF-8'},
    {path:'English.txt',text:'A long English paragraph for browser speech testing. '.repeat(80),savedText:'A long English paragraph for browser speech testing. '.repeat(80),uri:'',encoding:'UTF-8'}
  ],
  active:'main.py',
  opened:['main.py','English.txt'],
  stdin:'',
  settings:{fontSize:15,wrap:false,timeLimit:15},
  lecture:null,
  tts:{voice:'',locale:'en-US',rate:1,resumeOffset:0,fingerprint:''},
  drawStrokes:[],
  ai:{settings:{enabled:aiEnabled,baseUrl:'https://example.com/chat/completions',apiKey:aiEnabled?'test-key':'',model:'deepseek-chat',temperature:.7,system:'test',lang:'zh',theme:'jade',view:'chat',remote:false,remoteUrl:'',autoApprove:false},messages:[]}
});
const openBridge=async(aiEnabled=false)=>{
  const bridgePage=await context.newPage();
  await bridgePage.setViewportSize({width:412,height:915});
  await bridgePage.addInitScript(initial=>{
    try{localStorage.setItem('ember-studio-mode','python');}catch(ignored){}
    window.nativeRequests=[];
    window.StudioBridge={postMessage(raw){
      const message=JSON.parse(raw);
      window.nativeRequests.push(message);
      setTimeout(()=>{
        if(message.type==='ready')window.StudioNative.receive({type:'restore',data:initial});
        else if(message.type==='snapshot')window.StudioNative.receive({type:'snapshotSaved',id:message.id,ok:true});
        else if(message.type==='gameState')window.StudioNative.receive({type:'gameState',exists:false});
        else if(message.type==='ttsStatus')window.StudioNative.receive({type:'ttsStatus',ready:true,engine:'Mock TTS',voices:[{name:'English Voice',locale:'en-US'}]});
      },0);
    }};
  },fixture(aiEnabled));
  await bridgePage.goto(url,{waitUntil:'networkidle'});
  await bridgePage.waitForSelector('#landing[data-ready="1"]');
  return bridgePage;
};
const enterMode=async(bridgePage,mode)=>{
  await bridgePage.locator('.wheel-item[data-mode="'+mode+'"]').click({force:true});
  await bridgePage.evaluate(()=>document.getElementById('enterMode').click());
  await bridgePage.waitForSelector('#landing',{state:'hidden'});
  await bridgePage.waitForTimeout(450);
};
const closePage=async bridgePage=>{if(bridgePage&&!bridgePage.isClosed())await bridgePage.close();};

await run('game lobby back returns to editor','workbench visible, lounge hidden, no gameview class',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('#moreButton').click();
    await bridgePage.locator('#menuGame').click();
    await bridgePage.waitForSelector('#lounge:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    await bridgePage.waitForSelector('#lounge',{state:'hidden'});
    equal(await bridgePage.locator('#workbench').isVisible(),true,'workbench visibility');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('gameview')),false,'gameview class');
  }finally{await closePage(bridgePage);}
});

await run('back opens the home screen first','handled, landing visible',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
  }finally{await closePage(bridgePage);}
});

/* 双击退出：编辑器里按两下返回 —— 第一下回首页，第二下请求宿主退出。
   这条以前从页面这边永远走不到（宿主自己判断），真机上按返回只能退出，
   逐层返回等于没有。 */
await run('second back on the home screen asks to exit','handled then exit, landing stays visible',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'exit','second back');
    equal(await bridgePage.locator('#landing').isVisible(),true,'landing still visible');
  }finally{await closePage(bridgePage);}
});

await run('draw mode back closes drawing layer','drawing false, drawLayer hidden, landing hidden',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'notepad');
    await bridgePage.locator('#drawToggle').click();
    await bridgePage.waitForFunction(()=>document.body.classList.contains('drawing'));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('drawing')),false,'drawing class');
    await bridgePage.waitForSelector('#drawLayer',{state:'hidden'});
    equal(await bridgePage.locator('#landing').isHidden(),true,'landing visibility');
  }finally{await closePage(bridgePage);}
});

await run('search back closes search panel','.cm-search removed while landing stays hidden',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('#moreButton').click();
    await bridgePage.locator('#findButton').click();
    await bridgePage.waitForSelector('.cm-search');
    console.log('search DOM:',await bridgePage.evaluate(()=>document.querySelector('.cm-search').outerHTML.slice(0,240)));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    equal(await bridgePage.locator('.cm-search').count(),0,'search panel count');
    equal(await bridgePage.locator('#landing').isHidden(),true,'landing visibility');
  }finally{await closePage(bridgePage);}
});

await run('AI queue survives picker','no aiCancel, same queue length, AI panel restored',async()=>{
  const bridgePage=await openBridge(true);
  try{
    await enterMode(bridgePage,'ai');
    await bridgePage.locator('#aiInput').fill('first');
    await bridgePage.locator('#aiSend').click();
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiRequest'));
    await bridgePage.locator('#aiInput').fill('second');
    await bridgePage.locator('#aiSend').click();
    const before=await bridgePage.evaluate(()=>window.Studio.ai().queue.length);
    equal(before,1,'queue length before back');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>nativeRequests.some(request=>request.type==='aiCancel')),false,'aiCancel request');
    equal(await bridgePage.evaluate(()=>window.Studio.ai().queue.length),before,'queue length while picker open');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'exit','second back requests exit');
    await bridgePage.locator('#landingBack').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    equal(await bridgePage.locator('#aiPanel').isVisible(),true,'AI panel visibility');
  }finally{await closePage(bridgePage);}
});

await run('TTS is not stopped by picker','no ttsStop or ttsPause request',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'tts');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='ttsStatus'));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>nativeRequests.some(request=>request.type==='ttsStop'||request.type==='ttsPause')),false,'TTS stop/pause request');
  }finally{await closePage(bridgePage);}
});

await run('running code blocks notepad switch','notepad class absent, file count unchanged, stop available',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.locator('.cm-content').fill('while True:\n    pass');
    await bridgePage.locator('#runButton').click();
    await bridgePage.waitForFunction(()=>document.getElementById('runState').textContent.includes('可停止'),null,{timeout:30000});
    const before=await bridgePage.evaluate(()=>window.Studio.getState().files.length);
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('.wheel-item[data-mode="notepad"]').click({force:true});
    await bridgePage.locator('.wheel-item[data-mode="notepad"]').click({force:true});
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('notepad')),false,'notepad class');
    equal(await bridgePage.evaluate(()=>window.Studio.getState().files.length),before,'file count');
    await bridgePage.locator('#landingBack').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    await bridgePage.locator('#stopButton').click();
    await bridgePage.waitForFunction(()=>!document.getElementById('stopButton').offsetParent);
  }finally{await closePage(bridgePage);}
});

await run('Ctrl+Enter sends AI only','aiRequest present, no run effects, runState ready',async()=>{
  const bridgePage=await openBridge(true);
  try{
    await enterMode(bridgePage,'ai');
    await bridgePage.locator('#aiInput').fill('hello');
    await bridgePage.locator('#aiInput').press('Control+Enter');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiRequest'));
    const requests=await bridgePage.evaluate(()=>nativeRequests.map(request=>request.type));
    equal(requests.filter(type=>['aiRequest','play','preview'].includes(type)),['aiRequest'],'native request sequence');
    equal(await bridgePage.locator('#runState').innerText(),'就绪','run state');
  }finally{await closePage(bridgePage);}
});

await run('flush happens before landing','snapshot request precedes visible landing and contains draft',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    await bridgePage.evaluate(()=>{
      window.__backOrder=[];
      const original=window.StudioBridge.postMessage.bind(window.StudioBridge);
      window.StudioBridge.postMessage=raw=>{const message=JSON.parse(raw);if(message.type==='snapshot')window.__backOrder.push('snapshot');original(raw);};
      const landing=document.getElementById('landing');
      let seen=false;
      new MutationObserver(()=>{if(!landing.hidden&&!seen){seen=true;window.__backOrder.push('landing');}}).observe(landing,{attributes:true,attributeFilter:['hidden']});
    });
    const draft='# flushed before landing\nprint("saved-first")\n';
    await bridgePage.locator('.cm-content').fill(draft);
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    const result=await bridgePage.evaluate(()=>({order:window.__backOrder,snapshots:nativeRequests.filter(request=>request.type==='snapshot')}));
    equal(result.order[0],'snapshot','request order');
    equal(result.order.includes('landing'),true,'landing observed');
    equal(result.snapshots.some(request=>request.data.files.some(file=>file.text.includes('saved-first'))),true,'snapshot draft');
  }finally{await closePage(bridgePage);}
});

/* 600–899px 曾是空白断点：三栏的固定宽度把笔记区挤成一条缝，底部 Tab 点了布局不动。
   现在 <900px 一律上下分屏（面板全宽），≥900px 才是 300px 侧栏。
   前置断言目标元素真实可见且有宽度：面板被藏掉时 0 vs 0 也会「差 <2」假绿。 */
await run('lecture panels stack below 900px and split above','tabs visible + full-width timeline at 800px, tabs hidden + 300px timeline at 1000px',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    await bridgePage.setViewportSize({width:800,height:1000});
    /* 默认停在「笔记」Tab，时间轴面板是收起的；先切到时间轴才量得到它的宽度。 */
    await bridgePage.locator('.lecture-tab[data-tab="timeline"]').click();
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.locator('#lectureTabs').isVisible(),true,'tabs visible at 800px');
    const stacked=await bridgePage.evaluate(()=>{
      const panel=document.getElementById('lectureTimeline');
      return {
        panel:panel.getBoundingClientRect().width,
        visible:panel.offsetParent!==null,
        workbench:document.getElementById('workbench').clientWidth
      };
    });
    equal(stacked.visible&&stacked.panel>0,true,'timeline panel is visible with real width at 800px');
    equal(Math.abs(stacked.panel-stacked.workbench)<2,true,'timeline spans the workbench width');
    await bridgePage.setViewportSize({width:1000,height:800});
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.locator('#lectureTabs').isVisible(),false,'tabs hidden at 1000px');
    const wide=await bridgePage.evaluate(()=>({
      width:document.getElementById('lectureTimeline').getBoundingClientRect().width,
      visible:document.getElementById('lectureTimeline').offsetParent!==null
    }));
    equal(wide.visible&&wide.width>0,true,'timeline column is visible with real width at 1000px');
    equal(wide.width>=295&&wide.width<=305,true,'timeline is a 300px column');
  }finally{await closePage(bridgePage);}
});

/* 窄屏播放态：播放 / 新录音 / 停止 / 计时 / 翻译 / 📌 一行放不下，条必须能换行且不横向溢出。
   参数化 360/412/431/440/481 五档：431–441 与 481–511 都是 QA 抓到过溢出的缺陷窗口。
   前置断言条本身可见、宽度 >300：元素被藏掉时 scrollWidth 0 <= clientWidth 0 会假绿。 */
await run('lecture bar fits narrow widths while playing','no overflow at 360/412/431/440/481px and anchor button inside the bar',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    for(const width of [360,412,431,440,481]){
      await bridgePage.setViewportSize({width,height:740});
      await bridgePage.waitForTimeout(80);
      /* 录音需要麦克风，测试里直接摆出播放态的可见集合（setBar('playing') 的效果），
         并且同一次 evaluate 里立刻量尺寸：中间不留任务，避免被别的刷新改回去。 */
      const fit=await bridgePage.evaluate(()=>{
        const bar=document.getElementById('lectureBar');
        bar.dataset.state='playing';
        document.getElementById('recordBtn').dataset.role='play';
        document.getElementById('recordLabel').textContent='⏸ 暂停';
        document.getElementById('pauseBtn').hidden=true;
        document.getElementById('newRecBtn').hidden=false;
        document.getElementById('stopBtn').hidden=false;
        document.getElementById('anchorBtn').hidden=false;
        const anchor=document.getElementById('anchorBtn').getBoundingClientRect();
        const own=bar.getBoundingClientRect();
        return {scroll:bar.scrollWidth,client:bar.clientWidth,width:own.width,visible:bar.offsetParent!==null,anchorRight:anchor.right,barRight:own.right};
      });
      equal(fit.visible&&fit.width>0,true,'lecture bar visible with real width at '+width+'px');
      equal(fit.width>300,true,'lecture bar wider than 300px at '+width+'px');
      equal(fit.scroll<=fit.client+1,true,'no horizontal scroll in the lecture bar at '+width+'px');
      equal(fit.anchorRight<=fit.barRight,true,'anchor button stays inside the bar at '+width+'px');
    }
  }finally{await closePage(bridgePage);}
});

/* 空笔记的起点提示：上课时文案必须说「开始录音」，写下一个字就消失。 */
await run('lecture 空笔记有起点','noteEmpty visible with 开始录音 hint on blank note, hidden after typing',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    /* 课堂笔记是新文件，本就为空；显式清空一遍，保证断言不依赖初始内容。 */
    await bridgePage.evaluate(()=>{const v=window.Studio.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:''}});});
    await bridgePage.waitForTimeout(60);
    const empty=await bridgePage.evaluate(()=>{
      const el=document.getElementById('noteEmpty');
      return {visible:el.offsetParent!==null&&getComputedStyle(el).display!=='none',text:el.textContent};
    });
    equal(empty.visible,true,'noteEmpty visible on blank lecture note');
    equal(empty.text.includes('开始录音'),true,'hint mentions 开始录音');
    await bridgePage.evaluate(()=>{const v=window.Studio.view;v.dispatch({changes:{from:0,insert:'a'}});});
    await bridgePage.waitForTimeout(60);
    equal(await bridgePage.evaluate(()=>document.getElementById('noteEmpty').offsetParent!==null),false,'noteEmpty hidden after typing');
  }finally{await closePage(bridgePage);}
});

/* Tab 切换要同步 aria-selected：恰好一个 true，且与 .active 是同一个按钮。 */
await run('lecture Tab 同步 aria-selected','exactly one aria-selected=true matching .active after switching tabs',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    await bridgePage.locator('.lecture-tab[data-tab="timeline"]').click();
    await bridgePage.waitForTimeout(80);
    const tabs=await bridgePage.evaluate(()=>[...document.querySelectorAll('.lecture-tab')].map(t=>({tab:t.dataset.tab,selected:t.getAttribute('aria-selected'),active:t.classList.contains('active')})));
    equal(tabs.length,3,'three lecture tabs');
    equal(tabs.filter(t=>t.selected==='true').length,1,'exactly one aria-selected=true');
    equal(tabs.find(t=>t.selected==='true').tab,tabs.find(t=>t.active).tab,'aria-selected matches .active');
    equal(tabs.find(t=>t.selected==='true').tab,'timeline','timeline tab selected');
  }finally{await closePage(bridgePage);}
});

/* Toast 的停靠位置跟着模式走：python 压状态栏上方、上课抬到控制条上方、朗读贴控制条下沿，
   AI 页改从顶部出现（底部是输入框，不能压）。 */
await run('toast 不悬空不压输入框','bottom 92px python / 84px lecture / 36px tts; aiview top 64px bottom auto',async()=>{
  const bridgePage=await openBridge();
  try{
    const readToast=()=>bridgePage.evaluate(()=>{const style=getComputedStyle(document.getElementById('toast'));return {top:style.top,bottom:style.bottom};});
    for(const [mode,bottom] of [['python','92px'],['lecture','84px'],['tts','36px']]){
      await enterMode(bridgePage,mode);
      equal((await readToast()).bottom,bottom,'toast bottom offset in '+mode);
      equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','back from '+mode);
      await bridgePage.waitForSelector('#landing:not([hidden])');
    }
    await enterMode(bridgePage,'ai');
    const aiToast=await readToast();
    equal(aiToast.top,'64px','toast top offset in ai mode');
    equal(aiToast.bottom,'auto','toast bottom is auto in ai mode');
  }finally{await closePage(bridgePage);}
});

/* 齿轮颜色跟随主题变量：上课是胭脂色系，Python 是青绿墨色。 */
await run('齿轮跟随主题','gear color rgb(159, 18, 57) in lecture, rgb(16, 33, 27) in python',async()=>{
  const bridgePage=await openBridge();
  try{
    const gearColor=()=>bridgePage.evaluate(()=>getComputedStyle(document.getElementById('moreButton')).color);
    await enterMode(bridgePage,'lecture');
    equal(await gearColor(),'rgb(159, 18, 57)','gear color in lecture');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),'handled','back from lecture');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await enterMode(bridgePage,'python');
    equal(await gearColor(),'rgb(16, 33, 27)','gear color in python');
  }finally{await closePage(bridgePage);}
});

const report={checks:passed.length+failed.length,passed,failed,env:{viewport:'412x915',mode:'browser'}};
await fs.mkdir(root+'/artifacts/studio-v0.1',{recursive:true});
if(failed.length===0){
  await fs.writeFile(root+'/artifacts/studio-v0.1/interface-fix-checks.json',JSON.stringify(report,null,2)+'\n');
}else{
  console.log(JSON.stringify(report,null,2));
}
for(const item of failed)console.log('FAILED '+item.name+'\n  expected: '+item.expected+'\n  actual: '+item.actual);
globalThis.__studioInterfaceFixReport=report;
