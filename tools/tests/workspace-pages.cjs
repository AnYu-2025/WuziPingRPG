const assert = require('node:assert/strict');

module.exports = async function checkWorkspacePages(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({width:360, height:600});
  await page.locator('#deskStudy').click();
  const pages = page.locator('#workspacePages');
  const study = page.locator('#studyDesk');
  const scrollTop = () => study.evaluate(el => el.scrollTop);
  async function waitForPage(index) {
    try {
      await page.waitForFunction(i => {
        const viewport = document.getElementById('workspacePages');
        const tabs = document.querySelectorAll('#workspaceTabs [role="tab"]');
        return tabs[i].getAttribute('aria-selected') === 'true' &&
          Math.abs(viewport.scrollLeft - viewport.clientWidth * i) <= 2;
      }, index, {timeout: 8000});
    } catch (cause) {
      const actual = await pages.evaluate(el => ({
        tab: document.querySelector('#workspaceTabs [aria-selected="true"]')?.id,
        left: el.scrollLeft,
        width: el.clientWidth
      }));
      throw new Error('Workspace page ' + index + ' did not settle: ' + JSON.stringify(actual), {cause});
    }
  }
  await waitForPage(0);
  await study.evaluate(el => { el.scrollTop = 0; });

  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', {enabled:true, maxTouchPoints:1});
  async function swipe(from, to) {
    const send = (type, touchPoints) => touch.send('Input.dispatchTouchEvent', {type, touchPoints});
    await send('touchStart', [from]);
    for (let i = 1; i <= 6; i++) {
      // Give Chromium a frame per point so CDP doesn't coalesce a swipe into one move.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
      await send('touchMove', [{x:from.x + (to.x - from.x) * i / 6, y:from.y + (to.y - from.y) * i / 6}]);
    }
    await send('touchEnd', []);
  }
  try {
    const {x, y, width, height} = await pages.boundingBox();
    const left = {x:x + 44, y:y + height/2};
    const right = {x:x + width - 44, y:left.y};
    await study.evaluate(el => {
      window.__lastStudyScroll = performance.now();
      el.addEventListener('scroll', () => { window.__lastStudyScroll = performance.now(); });
    });
    await swipe({x:x + width/2, y:y + height - 40}, {x:x + width/2, y:y + 40});
    // Start the horizontal gesture after the vertical momentum has settled.
    await page.waitForFunction(() => document.getElementById('studyDesk').scrollTop > 35 &&
      performance.now() - window.__lastStudyScroll > 180, null, {timeout: 8000});
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
