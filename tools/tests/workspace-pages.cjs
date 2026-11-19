const assert = require('node:assert/strict');

module.exports = async function checkWorkspacePages(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({width:360, height:600});
  await page.locator('#deskStudy').click();
  const pages = page.locator('#workspacePages');
  const study = page.locator('#studyDesk');
  const scrollTop = () => study.evaluate(el => el.scrollTop);
  const waitForPage = index => page.waitForFunction(i => {
    const viewport = document.getElementById('workspacePages');
    const tabs = document.querySelectorAll('#workspaceTabs [role="tab"]');
    return tabs[i].getAttribute('aria-selected') === 'true' &&
      Math.abs(viewport.scrollLeft - viewport.clientWidth * i) <= 2;
  }, index);
  await waitForPage(0);

  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:1});
  async function swipe(from, to) {
    const send = (type, touchPoints) => touch.send('Input.dispatchTouchEvent', {type, touchPoints});
    await send('touchStart', [from]);
    for (let i = 1; i <= 6; i++) {
      await send('touchMove', [{x:from.x + (to.x - from.x) * i / 6, y:from.y + (to.y - from.y) * i / 6}]);
    }
    await send('touchEnd', []);
  }
  try {
    const {x, y, width, height} = await pages.boundingBox();
    const left = {x:x + 28, y:y + height/2};
    const right = {x:x + width - 28, y:left.y};
    await swipe({x:x + width/2, y:y + height - 40}, {x:x + width/2, y:y + 40});
    await page.waitForFunction(() => document.getElementById('studyDesk').scrollTop > 35);
    await waitForPage(0);
    await swipe(right, left);
    await waitForPage(1);
    const savedStudyScroll = await scrollTop();
    await swipe(right, left);
    await waitForPage(2);
    assert.equal(await page.locator('#studyDesk').getAttribute('inert'), '');
    await swipe(left, right);
    await waitForPage(1);
    await swipe(left, right);
    await waitForPage(0);
    assert.equal(await scrollTop(), savedStudyScroll, 'page changes should preserve the vertical list position');
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', {enabled:false});
    await touch.detach();
    await page.setViewportSize(viewport);
  }
  await waitForPage(0);
  await page.locator('#deskSettings').click();
  assert.match(await page.locator('#studioVersion').innerText(), /^0[.]5[.][0-9]+$/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settingsDialog').isVisible(), false);
  return {horizontalSwipe: true, verticalScroll: true, settingsVersion: true};
};
