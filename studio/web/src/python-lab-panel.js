const panels = new WeakMap();

function updateText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function outputText(value) {
  // Ignore the final newline added by print; keep meaningful spaces and blank lines.
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

function comparePrediction(view) {
  const prediction = view.prediction.value;
  let message = '';
  if (view.progress.hasRun && prediction.trim()) {
    message = outputText(prediction) === outputText(view.progress.output)
      ? '当前预测文本与上次输出一致。' : '当前预测文本与上次输出有差异。';
  }
  view.comparison.hidden = !message;
  updateText(view.comparison, message);
}

function toggleExplanation(view, visible) {
  view.explanation.hidden = !visible;
  view.reveal.setAttribute('aria-expanded', String(visible));
  updateText(view.reveal, visible ? '收起原始示例解析' : '查看原始示例解析');
}

function createPanel(container, id) {
  const doc = container.ownerDocument;
  function el(tag, elementId, text) {
    const node = doc.createElement(tag);
    if (elementId) node.id = elementId;
    if (text) node.textContent = text;
    return node;
  }
  const details = el('details');
  details.open = true;
  const toggle = el('summary', 'labToggle');
  const title = el('strong', 'labTitle');
  const status = el('span', 'labStatus');
  status.setAttribute('role', 'status');
  toggle.append(title, status);

  const body = el('div', 'labBody');
  const prompt = el('p', 'labPrompt');
  const label = el('label', null, '你预计会输出什么？');
  label.htmlFor = 'labPrediction';
  const prediction = el('textarea', 'labPrediction');
  prediction.rows = 2;
  prediction.maxLength = 500;
  prediction.placeholder = '可以写出结果，也可以说说自己的推理';
  const run = el('button', 'labRun', '运行代码');
  run.type = 'button';

  const result = el('section', 'labResult');
  const resultLabel = el('h3', null, '上次运行输出');
  const context = el('p', 'labRunContext');
  const output = el('pre', 'labOutput');
  const comparison = el('p', 'labComparison');
  const reveal = el('button', 'labReveal');
  reveal.type = 'button';
  reveal.setAttribute('aria-controls', 'labExplanation');
  const explanation = el('div', 'labExplanation');
  const expected = el('pre', 'labExpectedOutput');
  const reason = el('p', 'labReason');
  const challenge = el('p', 'labChallenge');
  explanation.append(el('h3', null, '原始代码的预期输出'), expected, reason,
    el('h3', null, '改一改，再运行'), challenge);
  result.append(resultLabel, context, output, comparison, reveal, explanation);
  body.append(prompt, label, prediction, run, result);
  details.append(toggle, body);
  container.replaceChildren(details);
  const view = {id, title, status, prompt, prediction, run, result, context, output, comparison,
    reveal, explanation, expected, reason, challenge, progress: {}};
  toggleExplanation(view, false);
  prediction.addEventListener('input', () => {
    view.onPredict(prediction.value);
    comparePrediction(view);
  });
  run.addEventListener('click', () => view.onRun());
  reveal.addEventListener('click', () => {
    const show = explanation.hidden;
    toggleExplanation(view, show);
    if (show && view.onReveal) view.onReveal();
  });
  return view;
}

export function renderPythonLabPanel(container, {lab, progress = {}, modified, onPredict, onReveal, onRun}) {
  if (!lab) {
    container.hidden = true;
    if (panels.delete(container)) container.replaceChildren();
    return;
  }
  let view = panels.get(container);
  if (!view || view.id !== lab.id) {
    view = createPanel(container, lab.id);
    panels.set(container, view);
  }
  container.hidden = false;
  Object.assign(view, {progress, onPredict, onReveal, onRun});
  updateText(view.title, lab.title);
  updateText(view.prompt, lab.prompt);
  // Reuse the textarea so saving and rendering during IME input preserve the caret.
  const saved = progress.prediction ?? '';
  if (view.prediction.value !== saved && container.ownerDocument.activeElement !== view.prediction) {
    view.prediction.value = saved;
  }
  view.run.disabled = !!progress.running;
  updateText(view.run, progress.running ? '运行中…' : '运行代码');
  view.result.hidden = !progress.hasRun;
  const changed = modified ?? progress.modified;
  let status = '先预测';
  if (progress.hasRun) status = changed ? '代码已修改' : '已运行';
  updateText(view.status, progress.running ? '运行中' : status);
  if (!progress.hasRun) {
    toggleExplanation(view, false);
    return;
  }
  const ranOriginal = typeof progress.runSource === 'string'
    && progress.runSource.replace(/\r\n?/g, '\n') === lab.starter.replace(/\r\n?/g, '\n');
  let context = ranOriginal ? '这次运行使用了原始示例。' : '这次输出来自上次运行的代码，可与原始示例的解析对照。';
  if (changed) context = '你已修改代码。下方是修改前的输出，重新运行即可更新。';
  updateText(view.context, context);
  updateText(view.output, progress.output || '（没有输出）');
  updateText(view.expected, lab.expectedOutput || '（没有输出）');
  updateText(view.reason, lab.explanation);
  updateText(view.challenge, lab.challenge);
  comparePrediction(view);
}
