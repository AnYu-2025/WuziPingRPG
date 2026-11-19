const assert = require('node:assert/strict');

module.exports = async function checkPythonLabs(page, reloadSavedWorkspace) {
  const {PYTHON_LABS} = await import('../../studio/web/src/python-lab.js');
  const [paper, rain, lights] = PYTHON_LABS;
  const collision = '实验-' + paper.id + '.py';
  const personalCode = 'print("自己的原文件")\n';

  // Deliver a pre-lab snapshot through the same public restore entry point as Android.
  await page.evaluate(({path, code}) => {
    const old = JSON.parse(sessionStorage.getItem('test-workspace'));
    delete old.pythonLabs;
    old.files.push({path, text:code, savedText:code, uri:'', encoding:'UTF-8'});
    window.StudioNative.receive({type:'restore', data:old});
  }, {path:collision, code:personalCode});

  const book = page.locator('details[data-python-labs]');
  const panel = page.locator('#pythonLabPanel');
  const editor = page.locator('#workbench .cm-content');
  const output = page.locator('#labOutput');
  const explanation = page.locator('#labExplanation');
  const progress = id => page.evaluate(key => window.Studio.getState().pythonLabs[key], id);
  async function open(lab) {
    if (!await book.evaluate(el => el.open)) await book.locator('summary').click();
    await book.locator('[data-lab-id="' + lab.id + '"]').click();
    await page.locator('#landing').waitFor({state:'hidden'});
    await panel.waitFor({state:'visible'});
    if (!await panel.locator('details').evaluate(el => el.open)) await page.locator('#labToggle').click();
  }
  async function edit(text) {
    await editor.locator('.cm-line').first().click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text);
  }
  async function run(ok) {
    await page.locator('#labRun').click();
    await page.waitForFunction(() => /执行完成|执行失败|超时|未能启动/.test(document.querySelector('#runState').textContent), null, {timeout:60000});
    assert.match(await page.locator('#runState').innerText(), ok ? /^执行完成/ : /^执行失败/);
  }
  async function home() {
    await page.locator('#homeButton').click();
    await book.waitFor({state:'visible'});
  }

  assert.deepEqual(await page.evaluate(() => window.Studio.getState().pythonLabs), {});
  await open(paper);
  const originalViewport = page.viewportSize();
  for (const viewport of [{width:320,height:568}, {width:760,height:390}, originalViewport]) {
    await page.setViewportSize(viewport);
    const bench = await page.locator('#workbench').boundingBox();
    for (const part of [panel, page.locator('#editor')]) {
      const bounds = await part.boundingBox();
      assert(bounds && Math.abs(bounds.x - bench.x) < 5 && bounds.width >= bench.width - 8,
        'closed mobile drawer must leave the workspace width available: ' + JSON.stringify({viewport, bench, bounds}));
    }
  }
  const paperPath = (await progress(paper.id)).path;
  assert.notEqual(paperPath, collision);
  assert.equal(await page.evaluate(path => window.Studio.getState().files.find(file => file.path === path).text, collision), personalCode);
  assert.equal(await page.locator('#labReveal').isVisible(), false);
  await edit('raise ValueError("还没有结果")');
  await run(false);
  assert.equal((await progress(paper.id)).hasRun, false);
  assert.equal(await page.locator('#labReveal').isVisible(), false);

  await edit(paper.starter);
  await run(true);
  assert.equal((await output.innerText()).trim(), paper.expectedOutput);
  await page.locator('#labReveal').click();
  assert(await explanation.isVisible());
  assert.equal(await page.locator('#labExpectedOutput').innerText(), paper.expectedOutput);

  const modified = paper.starter.replace('folds = 5', 'folds = 7');
  await edit(modified);
  await page.locator('#labPrediction').fill('128');
  await run(true);
  assert.equal((await output.innerText()).trim(), '128');
  await home();
  await reloadSavedWorkspace(page);
  await open(paper);
  const remembered = await progress(paper.id);
  assert.equal(remembered.path, paperPath);
  assert.equal(remembered.runSource, modified);
  assert.equal(await page.evaluate(() => window.Studio.view.state.doc.toString()), modified);
  assert.equal(await page.locator('#labPrediction').inputValue(), '128');
  assert.equal((await output.innerText()).trim(), '128');

  await edit('raise ValueError("保留上次成功结果")');
  await run(false);
  assert.equal((await output.innerText()).trim(), '128');
  assert.deepEqual(await progress(paper.id), remembered);
  await home();

  for (const lab of [rain, lights]) {
    await open(lab);
    await run(true);
    assert.equal((await output.innerText()).trim(), lab.expectedOutput);
    await home();
  }
  assert.match(await book.locator('summary').innerText(), /3\s*\/\s*3/);

  await page.locator('#deskCode').click();
  await page.locator('#codeBody').getByRole('button', {name:new RegExp(collision.replace('.', '\\.'))}).click();
  await page.locator('#landing').waitFor({state:'hidden'});
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.evaluate(() => window.Studio.view.state.doc.toString()), personalCode);
  const drawer = page.locator('#explorer');
  const shade = page.locator('#backdrop');
  await page.locator('#filesToggle').click();
  await shade.waitFor({state:'visible'});
  await drawer.getByRole('button', {name:'关闭文件列表'}).click();
  await shade.waitFor({state:'hidden'});
  await page.locator('#filesToggle').click();
  const shadeBox = await shade.boundingBox();
  await shade.click({position:{x:shadeBox.width-8, y:100}});
  await shade.waitFor({state:'hidden'});
  await page.locator('#filesToggle').click();
  await drawer.locator('.fileopen').filter({hasText:paperPath}).click();
  await shade.waitFor({state:'hidden'});
  const benchAfterDrawer = await page.locator('#workbench').boundingBox();
  assert((await editor.boundingBox()).width > benchAfterDrawer.width * 0.78, 'file drawer should release the editor width when a file is selected');
  await page.locator('#homeButton').click();
  await page.locator('#deskStudy').click();
  return {examples: PYTHON_LABS.map(lab => lab.expectedOutput), modifiedOutput: '128'};
};
