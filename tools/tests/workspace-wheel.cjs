const assert = require('node:assert/strict');

module.exports = async function checkWorkspaceWheel(page, reloadSavedWorkspace) {
  const trigger = page.locator('#deskWheel');
  const dialog = page.locator('#workspaceWheel');
  const wheel = dialog.locator('#wheelStage');
  const enter = dialog.locator('#wheelEnter');
  const option = id => dialog.locator('[data-destination="' + id + '"].wheel-option');
  const back = () => page.evaluate(() => window.Studio.back());
  const focusedId = () => page.evaluate(() => document.activeElement.id);
  const snapshotFiles = () => page.evaluate(() => window.Studio.getState().files);
  const before = await snapshotFiles();
  const viewport = page.viewportSize();

  await trigger.click();
  assert.equal(await focusedId(), 'wheelEnter');
  for (const size of [{width:320,height:568}, {width:760,height:360}, viewport]) {
    await page.setViewportSize(size);
    const bounds = await dialog.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 &&
      bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height,
      'wheel dialog should fit the screen: ' + JSON.stringify({size, bounds}));
    const panel = await wheel.boundingBox();
    const close = await dialog.locator('#wheelClose').boundingBox();
    assert(panel.width >= 218 &&
      panel.y + panel.height <= bounds.y + bounds.height &&
      close.x + close.width <= bounds.x + bounds.width,
      'dial and dismiss must fit inside the overlay');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await focusedId(), 'deskWheel');
  await trigger.click();
  assert.equal(await back(), true);
  await dialog.waitFor({state:'hidden'});
  assert.equal(await focusedId(), 'deskWheel');
  await trigger.click();
  await dialog.locator('#wheelClose').click();
  await dialog.waitFor({state:'hidden'});

  await trigger.click();
  await option('code').click();
  assert.equal(await page.locator('#deskCode').getAttribute('aria-selected'), 'true');
  await reloadSavedWorkspace(page);
  assert.equal(await page.locator('#deskCode').getAttribute('aria-selected'), 'true');

  await trigger.click();
  assert.equal(await option('code').getAttribute('aria-current'), 'true');
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:1});
  try {
    const {x, y, width, height} = await option('tools').boundingBox();
    const point = {x:x + width / 2, y:y + height / 2};
    const dispatch = (type, touchPoints) => touch.send('Input.dispatchTouchEvent', {type, touchPoints});
    await dispatch('touchStart', [point]);
    for (const distance of [18, 52, 96]) {
      await dispatch('touchMove', [{x:point.x - distance,y:point.y}]);
    }
    await dispatch('touchEnd', []);
    assert(await dialog.isVisible(), 'a completed swipe should leave the selected destination open for confirmation');
    assert.equal(await option('tools').getAttribute('aria-current'), 'true');
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', {enabled:false});
    await touch.detach();
  }
  await enter.click();
  await page.locator('#catalogHome').waitFor({state:'visible'});
  await page.locator('#catalogHome').click();
  assert.equal(await focusedId(), 'deskWheel');
  await trigger.click();
  await option('game').click();
  await page.locator('#landing').waitFor({state:'hidden'});
  await page.locator('#lounge').waitFor({state:'visible'});
  assert.equal(await page.evaluate(() => window.Studio.getState().mode), 'game');
  await page.locator('#playGame').click();
  assert(await page.evaluate(() => window.nativeCalls.some(call => call.type === 'play')),
    'game lobby should use the existing Android launch message');
  assert.equal(await back(), true);
  await trigger.waitFor({state:'visible'});
  assert.equal(await page.locator('#deskCode').getAttribute('aria-selected'), 'true');

  await trigger.click();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await option('study').getAttribute('aria-current'), 'true');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#deskStudy').getAttribute('aria-selected'), 'true');
  assert.deepEqual(await snapshotFiles(), before, 'navigation must preserve all local drafts');
  return {routes: ['study','code','tools','game'], touchSwipe: true, androidGameLaunchMessage: true};
};
