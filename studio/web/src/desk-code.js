const languages = new Map(Object.entries({
  py: 'Python', js: 'JavaScript', mjs: 'JavaScript', ts: 'TypeScript',
  c: 'C', h: 'C/C++', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++',
  java: 'Java', html: 'HTML', htm: 'HTML', css: 'CSS', json: 'JSON'
}));

const starterText = {
  py: 'print("你好，Python！")\n',
  js: 'console.log("你好，JavaScript！");\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "你好，C++！" << std::endl;\n    return 0;\n}\n'
};

export function createDeskDraft(files, ext) {
  if (!Object.prototype.hasOwnProperty.call(starterText, ext)) throw new Error('不支持此文件类型');
  const occupied = new Set(files.map(file => file.path.split('/')[0]));
  let number = 1;
  while (occupied.has('project-' + number)) number++;
  const deskProject = 'project-' + number;
  return {path: deskProject + '/main.' + ext, text: starterText[ext], deskProject};
}

export function cppRunScope(files, activePath) {
  // Only a persisted marker on a file inside the generated folder creates a boundary.
  // Existing multi-file projects (including folders with the same naming pattern) remain one workspace.
  const roots = new Set();
  for (const {path, deskProject} of files) {
    if (typeof deskProject === 'string' && /^project-[1-9]\d*$/.test(deskProject)
        && path.startsWith(deskProject + '/')) roots.add(deskProject);
  }
  const projectOf = path => {
    const slash = path.indexOf('/');
    const root = slash > 0 ? path.slice(0, slash) : '';
    return roots.has(root) ? root : '';
  };
  const activeProject = projectOf(activePath);
  return {root: activeProject, files: files.filter(file => projectOf(file.path) === activeProject)};
}

export function codeDeskFiles(state, exampleFiles = [], lastCodePath = '') {
  const originals = new Map(exampleFiles.map(file => [file.path, file.text]));
  const personal = [], examples = [];
  for (const file of state.files || []) {
    if (!file || typeof file.path !== 'string' || typeof file.text !== 'string') continue;
    const extension = /\.([^.\/]+)$/.exec(file.path)?.[1].toLowerCase();
    const language = languages.get(extension);
    if (!language) continue;
    const isExample = !file.uri && originals.get(file.path) === file.text &&
      (typeof file.savedText !== 'string' || file.savedText === file.text);
    (isExample ? examples : personal).push({file, language});
  }
  const byPath = new Map(personal.map(entry => [entry.file.path, entry]));
  const recent = byPath.get(state.active) || byPath.get(lastCodePath) ||
    examples.find(entry => entry.file.path === lastCodePath);
  return {personal, examples, recent};
}

export function codeFileStatus(file) {
  const dirty = typeof file.savedText === 'string' && file.text !== file.savedText;
  if (typeof file.uri === 'string' && file.uri.startsWith('content:')) {
    return dirty ? '已关联原文件 · 待写回' : '已关联原文件';
  }
  if (typeof file.uri === 'string' && file.uri.startsWith('browser:')) {
    return dirty ? '导入副本 · 有修改' : '导入副本';
  }
  return '本地草稿';
}

export function renderCodeDesk(container, {
  state, openCodeFile, newCodeFile, importCodeFile, openCode, exampleFiles = [], lastCodePath = ''
}) {
  const doc = container.ownerDocument;
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (className, label, action) => {
    const el = make('button', className, label);
    el.type = 'button';
    el.addEventListener('click', action);
    return el;
  };
  const {personal, examples, recent} = codeDeskFiles(state, exampleFiles, lastCodePath);
  const candidate = recent || personal[0];
  const feature = make('section', 'desk-feature');
  if (candidate) {
    const {file, language} = candidate;
    feature.append(make('span', 'desk-kicker', recent ? '继续编程' : '工作区文件'),
      make('h2', 'desk-title', file.path),
      make('p', 'desk-detail', language + ' · ' + (examples.includes(candidate) ? '内置示例' : codeFileStatus(file))),
      button('desk-primary', '打开文件', () => openCodeFile(file.path)));
  } else {
    feature.append(make('span', 'desk-kicker', '编程工作区'), make('h2', 'desk-title', '写一个 Python 程序'),
      make('p', 'desk-detail', '新文件保存在本机，可在编辑器中直接运行。'),
      button('desk-primary', '新建 Python', () => newCodeFile('py')));
  }

  const actions = make('section', 'desk-section');
  actions.append(make('h3', 'desk-section-head', '文件操作'));
  const choices = make('div', 'desk-list');
  for (const extension of ['py', 'js', 'cpp']) {
    if (!candidate && extension === 'py') continue;
    const name = languages.get(extension);
    choices.append(button('desk-row', '新建 ' + name, () => newCodeFile(extension)));
  }
  choices.append(button('desk-row', '从设备导入文件', importCodeFile),
    button('desk-row', '打开编辑器', openCode));
  actions.append(choices);

  const rows = (entries, sample) => {
    const list = make('div', 'desk-list');
    for (const {file, language} of entries) {
      const row = button('desk-row', '', () => openCodeFile(file.path));
      const copy = make('span', 'desk-row-copy');
      copy.append(make('span', 'desk-row-title', file.path),
        make('span', 'desk-row-meta', language + ' · ' + (sample ? '内置示例' : codeFileStatus(file))));
      const mark = make('span', 'desk-mark', '›');
      mark.setAttribute('aria-hidden', 'true');
      row.append(copy, mark);
      list.append(row);
    }
    return list;
  };
  const files = make('section', 'desk-section');
  files.append(make('h3', 'desk-section-head', '我的代码文件'));
  files.append(personal.length ? rows(personal, false) : make('p', 'desk-detail', '在这里查看新建和导入的代码文件。'));

  const content = doc.createDocumentFragment();
  content.append(feature, actions, files);
  if (examples.length) {
    const samples = make('details', 'desk-section');
    samples.append(make('summary', 'desk-section-head', '内置示例 · ' + examples.length), rows(examples, true));
    content.append(samples);
  }
  container.replaceChildren(content);
}
