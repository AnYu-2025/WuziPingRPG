const assert = require('node:assert/strict');

module.exports = async function checkMistakeReview(page, reloadSavedWorkspace) {
  const {QUIZ_BANK} = await import('../../studio/web/src/quiz-data.js');
  const desk = page.locator('#deskBody');
  // Start from the recommendation so the direct action is covered as well.
  await desk.locator('.desk-primary').click();
  const stem = page.locator('#mqQuestion');
  await stem.waitFor({state:'visible'});
  const text = await stem.innerText();
  const current = QUIZ_BANK.find(item => item.q === text);
  assert.ok(current, 'first practice question must come from the built-in bank');
  const wrongOption = current.options.find((_, i) => i !== current.answer);
  await page.locator('#mqOptions').getByText(wrongOption, {exact:true}).click();
  await page.locator('#mqExplain').waitFor({state:'visible'});

  await page.locator('#homeButton').click();
  await desk.getByRole('button', {name:/错题本/}).click();
  const item = page.locator('#mistList .mist-item').first();
  await item.locator('.mist-item-head').click();
  assert.equal(await item.locator('.mist-badge').innerText(), current.subject);
  assert.ok((await item.locator('.mist-item-body').innerText()).includes(current.options[current.answer]));
  await item.getByRole('button', {name:'制成复习卡'}).click();
  assert.equal(await item.getByRole('button', {name:'已制卡'}).isDisabled(), true);

  await page.locator('#homeButton').click();
  const due = desk.locator('.desk-feature');
  assert.match(await due.innerText(), /1 张到期卡片/);
  await due.locator('.desk-primary').click();
  const face = page.locator('#cardsFaceText');
  await page.waitForFunction(q => document.getElementById('cardsFaceText')?.textContent?.includes(q), current.q);
  await page.locator('#cardsFace').click();
  assert.ok((await face.innerText()).includes(current.options[current.answer]));
  await page.locator('#cardsRate button[data-rate="2"]').click();
  await page.locator('#homeButton').click();
  const cards = desk.getByRole('button', {name:/记忆卡片/});
  const completed = /0 张到期 · 今天已复习 1 张/;
  assert.match(await cards.innerText(), completed, 'study desk should reflect the completed review');
  await reloadSavedWorkspace(page);
  assert.match(await cards.innerText(), completed, 'completed review should survive a saved workspace reload');
  return true;
};
