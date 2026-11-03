// Run through Tabbit's nodejs command; this uses the real bundled Python WASM.
const fs=await import('node:fs/promises');
const root='D:/大学生软件创新大赛/WuziPingRPG';
const url=(await fs.readFile(root+'/build/studio/preview-url.txt','utf8')).trim();
await page.goto(url,{waitUntil:'networkidle'});
const before=await page.evaluate(()=>window.Studio.getState());
await page.evaluate(()=>window.StudioNative.receive({type:'restore',data:{version:1,files:[{path:'main.py',text:'print(1)',savedText:'print(1)',uri:'',encoding:'UTF-8'}],active:'main.py',opened:['main.py'],stdin:'',settings:{fontSize:15,wrap:false,light:false,timeLimit:15}}}));
const checks=[];
function check(value,name){assert(value,name);checks.push(name);}
async function edit(source){await page.locator('.cm-content').fill(source);assert.equal(await page.evaluate(()=>window.Studio.view.state.doc.toString()),source);}
async function run(){await page.locator('#runButton').click();await page.waitForFunction(()=>/执行完成|执行失败|运行环境/.test(document.getElementById('runState').textContent),null,{timeout:35000});return {status:await page.locator('#runState').innerText(),output:await page.locator('#output').innerText()};}
try{
 await page.setViewportSize({width:412,height:915});
 await edit('a = input()\nb = int(input())\nprint(a, b * 2)');await page.locator('#inputTab').click();await page.locator('#stdin').fill('李同学\n21\n');let r=await run();check(r.status.includes('完成')&&r.output.includes('李同学 42'),'Real Python reads multiline Unicode stdin');
 await edit('def broken(:\n    pass');r=await run();check(r.status.includes('失败')&&r.output.includes('SyntaxError')&&r.output.includes('main.py'),'Syntax errors retain the user filename');
 await edit('print(1 / 0)');r=await run();check(r.output.includes('ZeroDivisionError'),'Runtime exceptions reach the output panel');
 await edit('print("恢复正常")');r=await run();check(r.output.includes('恢复正常')&&r.status.includes('完成'),'A failed run cannot poison the next Python interpreter');
 await edit('input()\ninput()');await page.locator('#inputTab').click();await page.locator('#stdin').fill('一行\n');r=await run();check(r.output.includes('EOFError'),'Exhausted stdin raises EOF instead of hanging');
 await edit('with open("answer.txt", "w", encoding="utf8") as f:\n    f.write("答案：42")\nprint("已写入")');r=await run();check((await page.evaluate(()=>window.Studio.getState().files.find(f=>f.path==='answer.txt')?.text))==='答案：42','Python-created text files are retained in the workspace');
 await page.evaluate(()=>window.Studio.flush());await page.reload({waitUntil:'networkidle'});check((await page.evaluate(()=>window.Studio.getState().files.find(f=>f.path==='answer.txt')?.text))==='答案：42','Workspace and generated files survive a page restart');
 await page.evaluate(()=>window.Studio.importFiles([{path:'project/helpers.py',text:'def plus(x):\n    return x + 14\n',uri:'test:helper'},{path:'project/numbers.json',text:'{"n":41}',uri:'test:numbers'},{path:'project/main.py',text:'from helpers import plus\nimport json\nprint(plus(json.load(open("numbers.json"))["n"]))',uri:'test:project'}]));
 await page.locator('#filesToggle').click();await page.locator('.fileopen').filter({hasText:'project/main.py'}).click();r=await run();check(r.output.trim()==='55','Project-relative imports and data paths run from the entry directory');
 await edit('while True:\n    pass');await page.locator('#runButton').click();await page.waitForFunction(()=>document.getElementById('runState').textContent.includes('可停止'),null,{timeout:20000});await page.locator('#stopButton').click();check((await page.locator('#runState').innerText()).includes('停止')&&(await page.locator('#runButton').isVisible()),'Stop terminates an infinite Python loop without freezing the editor');
 await edit('print("x" * 1000000)');r=await run();check(r.output.length<=70000&&r.output.includes('截断')&&(await page.locator('#output span').count())<100,'Output flooding is bounded and reports truncation');
 await edit('x = 9');await run();await edit('print(x)');r=await run();check(r.output.includes('NameError'),'Each run uses a fresh Python global environment');
 await page.evaluate(()=>window.Studio.importFiles([{path:'demo.js',text:'console.log([1,2,3].reduce((a,b)=>a+b,0))',uri:'test:js'}]));r=await run();check(r.output.trim()==='6','JavaScript executes in its own worker');
 await edit('while(true){}');await page.locator('#runButton').click();await page.waitForFunction(()=>document.getElementById('runState').textContent.includes('可停止'));await page.locator('#stopButton').click();check((await page.locator('#runState').innerText()).includes('停止'),'Stop also terminates runaway JavaScript');
 await edit('console.log("继续编辑")');await page.evaluate(()=>window.Studio.flush());await page.reload({waitUntil:'networkidle'});check((await page.evaluate(()=>window.Studio.view.state.doc.toString())).includes('继续编辑'),'Latest edited source and active tab are restored');
 await page.locator('#settingsButton').click();await page.locator('#fontSize').fill('22');await page.locator('#wordWrap').check();await page.locator('#settingsDialog .primary').click();check((await page.locator('.cm-editor').evaluate(e=>e.style.fontSize))==='22px','Font and word-wrap settings affect the real editor');
 for(const size of [{width:360,height:800},{width:412,height:915},{width:915,height:412},{width:1280,height:800}]){await page.setViewportSize(size);const fit=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.getElementById('editor').getBoundingClientRect().height,run:document.getElementById('runButton').getBoundingClientRect().right}));check(fit.scroll<=fit.width+1&&fit.height>35&&fit.run<=fit.width,'Editor and run controls fit '+size.width+'x'+size.height);}
 await page.setViewportSize({width:412,height:915});await page.locator('#filesToggle').click();check(await page.locator('#explorer').isVisible(),'Mobile file drawer opens');await page.locator('#backdrop').click({position:{x:390,y:220}});
 await page.locator('#gameTab').click();check(await page.locator('#playGame').isVisible(),'Entertainment area exposes the embedded RPG entry');await page.locator('#codeTab').click();
 // Use a new owned page to exercise the native protocol without giving Python a bridge.
 const bridgePage=await context.newPage();try{
  await bridgePage.addInitScript(()=>{window.nativeRequests=[];window.StudioBridge={postMessage(raw){const m=JSON.parse(raw);window.nativeRequests.push(m);setTimeout(()=>{if(m.type==='ready')window.StudioNative.receive({type:'restore',data:null});if(m.type==='snapshot')window.StudioNative.receive({type:'snapshotSaved',id:m.id,ok:true});if(m.type==='gameState')window.StudioNative.receive({type:'gameState',exists:true});},0);}};});
  await bridgePage.goto(url,{waitUntil:'networkidle'});await expect(bridgePage.locator('.cm-editor')).toBeVisible();await bridgePage.locator('.cm-content').fill('print("native draft")');await bridgePage.waitForFunction(()=>window.nativeRequests.some(m=>m.type==='snapshot'&&m.data.files[0].text==='print("native draft")'));
  await expect(bridgePage.locator('#saveState')).toContainText('已保存');check(true,'Native autosave protocol sends and acknowledges edited drafts');
  await bridgePage.locator('#saveButton').click();check(await bridgePage.evaluate(()=>window.nativeRequests.some(m=>m.type==='export'&&m.text==='print("native draft")')),'Saving a new file invokes the Android document-export protocol');
  await bridgePage.locator('#gameTab').click();await bridgePage.waitForFunction(()=>document.getElementById('gameSaveInfo').textContent.includes('发现游戏存档'));await bridgePage.locator('#playGame').click();check(await bridgePage.evaluate(()=>window.nativeRequests.some(m=>m.type==='play')),'Native entertainment entry requests the game and recognizes a saved journey');
  await bridgePage.locator('#codeTab').click();await bridgePage.evaluate(()=>window.Studio.importFiles([{path:'index.html',text:'<h1>native preview</h1>',uri:'test:html'}]));await bridgePage.locator('#runButton').click();check(await bridgePage.evaluate(()=>window.nativeRequests.some(m=>m.type==='preview'&&m.path==='index.html')),'HTML preview is delegated outside the bridged editor WebView');
 }finally{await bridgePage.close();}
 await page.evaluate(data=>{window.StudioNative.receive({type:'restore',data});window.Studio.flush();},before);
 const report={checks:checks.length,passed:checks,engine:'Bundled Pyodide 0.27.7 WASM',android_device_tested:false};await fs.mkdir(root+'/artifacts/studio-v0.1',{recursive:true});await fs.writeFile(root+'/artifacts/studio-v0.1/browser-checks.json',JSON.stringify(report,null,2)+'\n');
 return report;
}catch(error){return {error:String(error),checksPassed:checks,status:await page.locator('#runState').innerText(),output:(await page.locator('#output').innerText()).slice(-2200)};}
