import {buildOverview} from './overview.js';

export function renderStudyDesk(container, {state, openMode, runStudyAction}) {
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
    copy.append(element('strong', 'desk-row-title', title), element('small', 'desk-row-meta', detail));
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
  feature.append(element('p', 'desk-kicker', '今日学习'));
  let title = '今天没有待办';
  let detail = '可以查看学习记录，或从下方选择要继续的内容。';
  if (primary) {
    title = primary.title;
    detail = primary.reason;
    if (primary.id === 'seed') {
      title = '开始一轮练习';
      detail = '打开题库，答完可以查看解析并重练错题。';
    }
  }
  feature.append(element('h2', 'desk-title', title), element('p', 'desk-detail', detail));
  const start = element('button', 'desk-primary', primary ? primary.cta : '查看学习记录');
  start.type = 'button';
  start.addEventListener('click', () => primary ? runStudyAction(primary) : openMode('overview'));
  feature.append(start);

  const today = summary.todayStudy;
  const progress = [
    row('记忆卡片', summary.cards.total
      ? `${summary.cards.due} 张到期 · 今天已复习 ${today.cards} 张` : '添加第一张卡片', () => openMode('cards')),
    row('错题本', summary.mistakes.total
      ? `${summary.tasks.mistakesOpen} 道待巩固 · 已掌握 ${summary.mistakes.mastered} 道` : '记下第一道错题', () => openMode('mistakes')),
    row('学习记录', `今天答了 ${today.quiz} 题 · 完成 ${today.focus} 段专注`, () => openMode('overview')),
  ];
  const modules = [
    row('课堂笔记', '记录课程与讲义', () => openMode('lecture')),
    row('医学刷题', '按学科练习或重做错题', () => openMode('medquiz')),
    row('专注计时', '安排一段学习时间', () => openMode('focus')),
  ];
  const sections = [feature, section('我的学习进度', progress)];
  if (upNext.length) {
    sections.push(section('接下来', upNext.map(action =>
      row(action.title, action.reason, () => runStudyAction(action)))));
  }
  sections.push(section('常用学习工具', modules));
  container.replaceChildren(...sections);
}
