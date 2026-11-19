import {buildOverview} from './overview.js';
import {PYTHON_LABS, normalizeLabProgress} from './python-lab.js';

export function renderStudyDesk(container, {state, openMode, runStudyAction, labProgress, openLab}) {
  const summary = buildOverview(state, Date.now());
  const doc = container.ownerDocument;
  function element(tag, className, text) {
    const node = doc.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function row(title, detail, onClick) {
    const button = element('button', 'desk-row');
    button.type = 'button';
    const icon = element('span', 'desk-mark', '›');
    icon.setAttribute('aria-hidden', 'true');
    const copy = element('span', 'desk-row-copy');
    copy.append(element('strong', 'desk-row-title', title));
    if (detail) copy.append(element('small', 'desk-row-meta', detail));
    button.append(copy, icon);
    button.addEventListener('click', onClick);
    return button;
  }
  function section(title, rows) {
    const box = element('section', 'desk-section');
    const header = element('h3', 'desk-section-head', title);
    const list = element('div', 'desk-list');
    list.append(...rows);
    box.append(header, list);
    return box;
  }

  const [primary, ...upNext] = summary.plan;
  const feature = element('section', 'desk-feature');
  const title = primary?.id === 'seed' ? '今日练习' : (primary?.title || '今天没有待办');
  feature.append(element('h2', 'desk-title', title));
  if (primary && primary.id !== 'seed') feature.append(element('p', 'desk-detail', primary.reason));
  const start = element('button', 'desk-primary', primary ? primary.cta : '查看学习记录');
  start.type = 'button';
  start.addEventListener('click', () => primary ? runStudyAction(primary) : openMode('overview'));
  feature.append(start);

  const today = summary.todayStudy;
  const progress = [
    row('记忆卡片', summary.cards.total
      ? `${summary.cards.due} 张到期 · 今天已复习 ${today.cards} 张` : '0 张', () => openMode('cards')),
    row('错题本', summary.mistakes.total
      ? `${summary.tasks.mistakesOpen} 道待巩固 · 已掌握 ${summary.mistakes.mastered} 道` : '0 道', () => openMode('mistakes')),
    row('学习记录', `今天答了 ${today.quiz} 题 · 完成 ${today.focus} 段专注`, () => openMode('overview')),
  ];
  const modules = [
    row('课堂笔记', '录音、笔记和 PPT', () => openMode('lecture')),
    row('医学刷题', '基础医学 8 科', () => openMode('medquiz')),
    row('专注计时', '', () => openMode('focus')),
  ];
  const sections = [feature];
  if (openLab) {
    const labs = normalizeLabProgress(labProgress);
    const ran = Object.values(labs).filter(entry => entry.hasRun).length;
    const book = element('details', 'desk-section desk-lab-book');
    book.dataset.pythonLabs = '';
    const heading = element('summary', 'desk-section-head', 'Python 实验册');
    heading.append(element('span', 'desk-lab-count', `已运行 ${ran} / ${PYTHON_LABS.length}`));
    const list = element('div', 'desk-list');
    for (const lab of PYTHON_LABS) {
      const entry = labs[lab.id];
      const status = entry?.hasRun ? '已运行' : entry ? '进行中' : '未开始';
      const button = row(lab.title, status, () => openLab(lab.id));
      button.dataset.labId = lab.id;
      list.append(button);
    }
    book.append(heading, list);
    sections.push(book);
  }
  sections.push(section('学习进度', progress));
  if (upNext.length) {
    sections.push(section('接下来', upNext.map(action =>
      row(action.title, action.reason, () => runStudyAction(action)))));
  }
  sections.push(section('常用', modules));
  container.replaceChildren(...sections);
}
