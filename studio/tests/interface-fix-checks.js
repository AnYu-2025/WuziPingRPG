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
  await bridgePage.locator('.home-card[data-mode="'+mode+'"]').click();
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
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#lounge',{state:'hidden'});
    equal(await bridgePage.locator('#workbench').isVisible(),true,'workbench visibility');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('gameview')),false,'gameview class');
  }finally{await closePage(bridgePage);}
});

await run('back from a mode opens home and a second back asks to exit','home stays open, back is true then false',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'first back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'second back');
    equal(await bridgePage.locator('#landing').isVisible(),true,'home stays visible');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'repeated back still exits');
  }finally{await closePage(bridgePage);}
});

await run('home return button restores the same work','landing hidden and python file still active',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back home');
    await bridgePage.waitForSelector('#landingBack:not([hidden])');
    await bridgePage.locator('#landingBack').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    equal(await bridgePage.evaluate(()=>window.Studio.getState().active),'main.py','active file');
  }finally{await closePage(bridgePage);}
});

await run('draw mode back closes drawing layer','drawing false, drawLayer hidden, landing hidden',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'notepad');
    await bridgePage.locator('#drawToggle').click();
    await bridgePage.waitForFunction(()=>document.body.classList.contains('drawing'));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
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
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
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
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>nativeRequests.some(request=>request.type==='aiCancel')),false,'aiCancel request');
    equal(await bridgePage.evaluate(()=>window.Studio.ai().queue.length),before,'queue length while home is open');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),false,'second back asks to exit');
    equal(await bridgePage.locator('#landing').isVisible(),true,'home stays open');
    equal(await bridgePage.evaluate(()=>window.Studio.ai().queue.length),before,'queue survives the exit request');
  }finally{await closePage(bridgePage);}
});

await run('TTS is not stopped by picker','no ttsStop or ttsPause request',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'tts');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='ttsStatus'));
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>nativeRequests.some(request=>request.type==='ttsStop'||request.type==='ttsPause')),false,'TTS stop/pause request');
  }finally{await closePage(bridgePage);}
});

/* 播放中当前句轻微加深：.cm-tts-active 必须存在、颜色是 #0b3b34、内容正好是当前段。 */
await run('TTS highlights the sentence being read','body.tts playing shows .cm-tts-active in #0b3b34 with the current segment text',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'tts');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='ttsStatus'));
    await bridgePage.locator('#ttsPlay').click();
    await bridgePage.waitForSelector('.cm-tts-active');
    const highlight=await bridgePage.evaluate(()=>{
      const el=document.querySelector('.cm-tts-active');
      return {text:el.textContent,color:getComputedStyle(el).color,ttsMode:document.body.classList.contains('tts')};
    });
    equal(highlight.ttsMode,true,'tts mode class on body');
    equal(highlight.color,'rgb(11, 59, 52)','highlight colour #0b3b34');
    const expected=await bridgePage.evaluate(()=>window.Studio.tts.segments(window.Studio.view.state.doc.toString()).segments[0].text);
    equal(highlight.text,expected,'highlighted text is the current segment');
  }finally{await closePage(bridgePage);}
});

/* 停止朗读立即清掉当前句高亮。 */
await run('TTS highlight clears on stop','no .cm-tts-active after stop',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'tts');
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='ttsStatus'));
    await bridgePage.locator('#ttsPlay').click();
    await bridgePage.waitForSelector('.cm-tts-active');
    await bridgePage.locator('#ttsStop').click();
    await bridgePage.waitForTimeout(120);
    equal(await bridgePage.locator('.cm-tts-active').count(),0,'highlight count after stop');
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
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('.home-card[data-mode="notepad"]').click();
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('notepad')),false,'notepad class');
    await bridgePage.locator('.home-card[data-mode="lecture"]').click();
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('lecture')),false,'lecture class');
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
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'Studio.back result');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    const result=await bridgePage.evaluate(()=>({order:window.__backOrder,snapshots:nativeRequests.filter(request=>request.type==='snapshot')}));
    equal(result.order[0],'snapshot','request order');
    equal(result.order.includes('landing'),true,'landing observed');
    equal(result.snapshots.some(request=>request.data.files.some(file=>file.text.includes('saved-first'))),true,'snapshot draft');
  }finally{await closePage(bridgePage);}
});

await run('new AI session cancels the in-flight request','aiCancel is sent and the session is no longer busy',async()=>{
  const bridgePage=await openBridge(true);
  try{
    await enterMode(bridgePage,'ai');
    await bridgePage.locator('#aiInput').fill('please keep working');
    await bridgePage.locator('#aiSend').click();
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiRequest'));
    await bridgePage.locator('#aiNewSession').click();
    await bridgePage.waitForFunction(()=>nativeRequests.some(request=>request.type==='aiCancel'));
    const state=await bridgePage.evaluate(()=>({busy:window.Studio.ai().busy,messages:window.Studio.ai().messages.length,cancels:nativeRequests.filter(request=>request.type==='aiCancel').length}));
    equal(state.busy,false,'busy');
    equal(state.messages,0,'messages');
    equal(state.cancels>0,true,'cancel count');
  }finally{await closePage(bridgePage);}
});

await run('reselecting the current card does not leave the file','notepad path stays after a second entry',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'notepad');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back home');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    await bridgePage.locator('.home-card[data-mode="notepad"]').click();
    await bridgePage.waitForSelector('#landing',{state:'hidden'});
    equal(await bridgePage.evaluate(()=>window.Studio.getState().active),'笔记.txt','active file');
    equal(await bridgePage.evaluate(()=>document.body.classList.contains('notepad')),true,'notepad class');
  }finally{await closePage(bridgePage);}
});

await run('lecture subview back returns to notes before home','timeline click then back stays in lecture on notes',async()=>{
  const bridgePage=await openBridge();
  try{
    await bridgePage.setViewportSize({width:390,height:844});
    await enterMode(bridgePage,'lecture');
    await bridgePage.locator('.lecture-tab[data-tab="timeline"]').click();
    equal(await bridgePage.evaluate(()=>document.body.dataset.lectureTab),'timeline','tab before back');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back');
    equal(await bridgePage.evaluate(()=>document.body.dataset.lectureTab||'notes'),'notes','tab after back');
    equal(await bridgePage.locator('#landing').isHidden(),true,'still in lecture');
  }finally{await closePage(bridgePage);}
});

await run('game opened from home returns home','mode stays game and the homepage is visible',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'game');
    equal(await bridgePage.evaluate(()=>window.Studio.back()),true,'back');
    await bridgePage.waitForSelector('#landing:not([hidden])');
    equal(await bridgePage.evaluate(()=>window.Studio.getState().mode),'game','mode');
  }finally{await closePage(bridgePage);}
});

await run('home layout stays reachable on short and landscape screens','logo, title and cards do not overlap and the last card can scroll into view',async()=>{
  const bridgePage=await openBridge();
  try{
    const css=await bridgePage.evaluate(()=>[...document.styleSheets].flatMap(sheet=>{try{return [...sheet.cssRules].map(rule=>rule.cssText);}catch(e){return [];}}).join('\n'));
    equal(css.includes('env(safe-area-inset-top)'),true,'top safe area');
    equal(css.includes('env(safe-area-inset-left)'),true,'left safe area');
    equal(css.includes('env(safe-area-inset-right)'),true,'right safe area');
    const sizes=[[320,568],[360,640],[390,844],[640,360]];
    for(const [width,height] of sizes){
      await bridgePage.setViewportSize({width,height});
      const measure=await bridgePage.evaluate(insets=>{
        const landing=document.getElementById('landing');
        landing.style.paddingTop=(8+insets.top)+'px';
        landing.style.paddingRight=(8+insets.right)+'px';
        landing.style.paddingBottom=(8+insets.bottom)+'px';
        landing.style.paddingLeft=(8+insets.left)+'px';
        const back=document.getElementById('landingBack');
        back.hidden=false;
        const scroller=document.getElementById('homeScroll');
        scroller.scrollTop=0;
        const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
        const box=landing.getBoundingClientRect();
        const brand=document.getElementById('homeBrand').getBoundingClientRect();
        const title=document.getElementById('homeTitle').getBoundingClientRect();
        const status=document.querySelector('.home-status').getBoundingClientRect();
        const first=document.querySelector('.home-card[data-mode="python"]').getBoundingClientRect();
        const last=document.querySelector('.home-card[data-mode="game"]');
        last.scrollIntoView({block:'end'});
        const reached=last.getBoundingClientRect();
        const view=landing.getBoundingClientRect();
        return {
          brandTitle:overlap(brand,title),
          brandStatus:overlap(brand,status),
          titleStatus:overlap(title,status),
          brandBack:overlap(brand,back.getBoundingClientRect()),
          brandInside:brand.left>=box.left-1&&brand.right<=box.right+1&&brand.top>=box.top-1,
          firstWidth:first.width,
          lastVisible:reached.top<view.bottom-2&&reached.bottom>view.top+2&&reached.left>=view.left-1&&reached.right<=view.right+1,
          scrollWidth:document.documentElement.scrollWidth,
          innerWidth:window.innerWidth
        };
      },{top:47,right:34,bottom:21,left:34});
      equal(measure.brandTitle,false,width+'x'+height+' brand/title');
      equal(measure.brandStatus,false,width+'x'+height+' brand/status');
      equal(measure.titleStatus,false,width+'x'+height+' title/status');
      equal(measure.brandBack,false,width+'x'+height+' brand/back');
      equal(measure.brandInside,true,width+'x'+height+' brand inside');
      equal(measure.firstWidth>40,true,width+'x'+height+' card width');
      equal(measure.lastVisible,true,width+'x'+height+' last card');
      equal(measure.scrollWidth<=measure.innerWidth+1,true,width+'x'+height+' overflow');
    }
  }finally{await closePage(bridgePage);}
});


await run('lecture panels stack below 900px and split above','tabs visible and full-width timeline at 800px; 300px column at 1000px',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    await bridgePage.setViewportSize({width:800,height:1000});
    await bridgePage.locator('.lecture-tab[data-tab="timeline"]').click();
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.locator('#lectureTabs').isVisible(),true,'tabs visible at 800px');
    const stacked=await bridgePage.evaluate(()=>{
      const panel=document.getElementById('lectureTimeline');
      return {panel:panel.getBoundingClientRect().width,visible:panel.offsetParent!==null,workbench:document.getElementById('workbench').clientWidth};
    });
    equal(stacked.visible&&stacked.panel>0,true,'timeline visible at 800px');
    equal(Math.abs(stacked.panel-stacked.workbench)<2,true,'timeline spans the workbench');
    await bridgePage.setViewportSize({width:1000,height:800});
    await bridgePage.waitForTimeout(150);
    equal(await bridgePage.locator('#lectureTabs').isVisible(),false,'tabs hidden at 1000px');
    const wide=await bridgePage.evaluate(()=>({width:document.getElementById('lectureTimeline').getBoundingClientRect().width,visible:document.getElementById('lectureTimeline').offsetParent!==null}));
    equal(wide.visible&&wide.width>0,true,'timeline column visible at 1000px');
    equal(wide.width>=295&&wide.width<=305,true,'timeline is a 300px column');
  }finally{await closePage(bridgePage);}
});

await run('lecture bar fits narrow widths while playing','no overflow at 360/412/431/440/481 and the anchor stays inside',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    for(const width of [360,412,431,440,481]){
      await bridgePage.setViewportSize({width,height:740});
      await bridgePage.waitForTimeout(80);
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
      equal(fit.visible&&fit.width>300,true,'lecture bar visible at '+width);
      equal(fit.scroll<=fit.client+1,true,'no horizontal scroll at '+width);
      equal(fit.anchorRight<=fit.barRight+1,true,'anchor inside the bar at '+width);
    }
  }finally{await closePage(bridgePage);}
});

await run('lecture empty note points at the record button','hint visible on a blank note and hidden after typing',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    await bridgePage.evaluate(()=>{const v=window.Studio.view;v.dispatch({changes:{from:0,to:v.state.doc.length,insert:''}});});
    await bridgePage.waitForTimeout(60);
    const empty=await bridgePage.evaluate(()=>{
      const el=document.getElementById('noteEmpty');
      return {visible:el.offsetParent!==null&&getComputedStyle(el).display!=='none',text:el.textContent};
    });
    equal(empty.visible,true,'noteEmpty visible');
    equal(empty.text.includes('开始录音'),true,'hint mentions recording');
    await bridgePage.evaluate(()=>{const v=window.Studio.view;v.dispatch({changes:{from:0,insert:'a'}});});
    await bridgePage.waitForTimeout(60);
    equal(await bridgePage.evaluate(()=>document.getElementById('noteEmpty').offsetParent!==null),false,'noteEmpty hidden after typing');
  }finally{await closePage(bridgePage);}
});

await run('lecture tabs expose one selected tab','aria-selected matches the active tab',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'lecture');
    await bridgePage.locator('.lecture-tab[data-tab="timeline"]').click();
    await bridgePage.waitForTimeout(80);
    const tabs=await bridgePage.evaluate(()=>[...document.querySelectorAll('.lecture-tab')].map(t=>({tab:t.dataset.tab,selected:t.getAttribute('aria-selected'),active:t.classList.contains('active')})));
    equal(tabs.length,3,'three lecture tabs');
    equal(tabs.filter(t=>t.selected==='true').length,1,'one selected tab');
    equal(tabs.find(t=>t.selected==='true').tab,'timeline','timeline selected');
    equal(tabs.find(t=>t.active).tab,'timeline','active class matches');
  }finally{await closePage(bridgePage);}
});

await run('editor actions stay reachable with safe-area padding','home, save, run and more do not overlap at 320, 360 and landscape',async()=>{
  const bridgePage=await openBridge();
  try{
    await enterMode(bridgePage,'python');
    for(const [width,height] of [[320,568],[360,640],[640,360]]){
      await bridgePage.setViewportSize({width,height});
      const fit=await bridgePage.evaluate(insets=>{
        const bar=document.querySelector('.appbar');
        bar.style.paddingTop='0px';
        bar.style.paddingLeft=(4+insets.left)+'px';
        bar.style.paddingRight=(4+insets.right)+'px';
        bar.style.marginTop=insets.top+'px';
        const ids=['filesToggle','saveButton','homeButton','runButton','moreButton'];
        const boxes=ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
        const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
        const hits=[];
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlap(boxes[i],boxes[j]))hits.push(boxes[i].id+'/'+boxes[j].id);
        const outside=boxes.filter(b=>b.width<24||b.height<24||b.left<-1||b.top<-1||b.right>innerWidth+1||b.bottom>innerHeight+1).map(b=>b.id+':'+Math.round(b.width)+'x'+Math.round(b.height));
        return {hits,outside,scroll:document.documentElement.scrollWidth,inner:innerWidth};
      },{top:47,right:34,bottom:21,left:34});
      equal(fit.hits, [], width+'x'+height+' overlaps');
      equal(fit.outside, [], width+'x'+height+' clipped '+JSON.stringify(fit.outside));
      equal(fit.scroll<=fit.inner+1, true, width+'x'+height+' overflow');
    }
  }finally{await closePage(bridgePage);}
});

const report={checks:passed.length+failed.length,passed,failed,env:{viewport:'412x915 plus home, lecture and chrome sizes',mode:'browser'}};
await fs.mkdir(root+'/artifacts/studio-v0.1',{recursive:true});
if(failed.length===0){
  await fs.writeFile(root+'/artifacts/studio-v0.1/interface-fix-checks.json',JSON.stringify(report,null,2)+'\n');
}else{
  console.log(JSON.stringify(report,null,2));
}
for(const item of failed)console.log('FAILED '+item.name+'\n  expected: '+item.expected+'\n  actual: '+item.actual);
globalThis.__studioInterfaceFixReport=report;
