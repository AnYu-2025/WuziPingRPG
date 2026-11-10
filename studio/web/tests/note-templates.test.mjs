import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_TEMPLATES, NOTE_TEMPLATE_IDS, templateById, sanitizeTemplateState,
  templateFileName, insertTemplate, noteTemplateAction,
  notepadTarget, isNotepadNotePath, isNoteDocumentPath, shouldRememberCodePath, NOTEPAD_FALLBACK
} from '../src/note-templates.js';

test('four note templates are available and blank stays empty', () => {
  assert.deepEqual(NOTE_TEMPLATE_IDS, ['blank', 'cornell', 'outline', 'wrong']);
  assert.deepEqual(NOTE_TEMPLATES.map(item => item.title), ['空白', '康奈尔', '大纲', '错题整理']);
  assert.equal(templateById('blank').content, '');
  for (const id of ['cornell', 'outline', 'wrong']) {
    const template = templateById(id);
    assert.ok(template.content.length > 40, id);
    assert.match(template.content, /^# /, id);
    assert.ok(template.baseName.endsWith('笔记') || template.baseName === '错题整理', id);
  }
  assert.match(templateById('cornell').content, /线索/);
  assert.match(templateById('cornell').content, /总结/);
  assert.match(templateById('wrong').content, /错因/);
  assert.match(templateById('wrong').content, /同类练习/);
  assert.equal(templateById('nope'), null);
});

test('template settings keep only a known last choice', () => {
  assert.deepEqual(sanitizeTemplateState(null), { last: 'blank' });
  assert.deepEqual(sanitizeTemplateState({ last: 'cornell' }), { last: 'cornell' });
  assert.deepEqual(sanitizeTemplateState({ last: 'unknown' }), { last: 'blank' });
  assert.deepEqual(sanitizeTemplateState('cornell'), { last: 'blank' });
});

test('template file names auto-number on collision', () => {
  assert.equal(templateFileName('cornell', []), '康奈尔笔记.md');
  assert.equal(templateFileName('cornell', ['康奈尔笔记.md']), '康奈尔笔记-2.md');
  assert.equal(templateFileName('cornell', ['康奈尔笔记.md', '康奈尔笔记-2.md']), '康奈尔笔记-3.md');
  assert.equal(templateFileName('wrong', ['错题整理.md']), '错题整理-2.md');
  assert.equal(templateFileName('missing', []), '模板笔记.md');
});

test('template insertion replaces the selection and pads paragraphs', () => {
  const template = templateById('cornell');
  const empty = insertTemplate('', template, { from: 0, to: 0 });
  assert.equal(empty.text, template.content.trimEnd());
  assert.equal(empty.cursor, empty.text.length);

  const middle = insertTemplate('开头\n结尾', template, { from: 3, to: 3 });
  assert.match(middle.insert, /^\n# 康奈尔笔记/);
  assert.match(middle.insert, /\n\n$/);
  assert.ok(middle.text.startsWith('开头\n\n# 康奈尔笔记'));
  assert.ok(middle.text.endsWith('\n\n结尾'));

  const selected = insertTemplate('保留 替换 保留', '新内容', { from: 3, to: 5 });
  assert.equal(selected.text, '保留 \n\n新内容\n\n 保留');
  assert.equal(selected.insert, '\n\n新内容\n\n');

  const blank = insertTemplate('abc', templateById('blank'), { from: 1, to: 1 });
  assert.equal(blank.insert, '');
  assert.equal(blank.text, 'abc');
  assert.equal(blank.cursor, 1);
});

test('notepad reopens the active note or the last note before falling back', () => {
  const files = [
    { path: 'main.py' },
    { path: '康奈尔笔记.md' },
    { path: '大纲笔记.md' },
    { path: '笔记.txt' },
    { path: 'English.txt' },
    { path: '课堂笔记.md' }
  ];
  assert.deepEqual(
    notepadTarget({ active: '康奈尔笔记.md', files }),
    { path: '康奈尔笔记.md', exists: true },
    'a refreshed resume card must reopen the active template note'
  );
  assert.deepEqual(
    notepadTarget({ active: 'main.py', lastNote: '康奈尔笔记.md', files }),
    { path: '康奈尔笔记.md', exists: true },
    'the last note is restored after leaving Python'
  );
  assert.deepEqual(
    notepadTarget({ active: 'English.txt', files }),
    { path: 'English.txt', exists: true },
    'ordinary .txt notes are valid targets'
  );
  assert.deepEqual(
    notepadTarget({ active: 'main.py', files }),
    { path: '笔记.txt', exists: true },
    'fallback is 笔记.txt when no note was remembered'
  );
  assert.deepEqual(
    notepadTarget({ active: 'missing.md', lastNote: '大纲笔记.md', files }),
    { path: '大纲笔记.md', exists: true },
    'stale active paths fall through to the last note'
  );
  assert.deepEqual(
    notepadTarget({ active: 'main.py', files: [] }),
    { path: '笔记.txt', exists: false },
    'the caller creates 笔记.txt when nothing exists'
  );
});

test('课堂笔记.md never becomes an ordinary notepad target', () => {
  const files = [
    { path: 'main.py' },
    { path: '康奈尔笔记.md' },
    { path: '笔记.txt' },
    { path: '课堂笔记.md' }
  ];
  assert.deepEqual(
    notepadTarget({ active: '课堂笔记.md', files }),
    { path: '笔记.txt', exists: true }
  );
  assert.deepEqual(
    notepadTarget({ active: '课堂笔记.md', lastNote: '康奈尔笔记.md', files }),
    { path: '康奈尔笔记.md', exists: true },
    'a real note still wins over the lecture note'
  );
  assert.deepEqual(
    notepadTarget({ active: 'main.py', lastNote: '课堂笔记.md', files }),
    { path: '笔记.txt', exists: true },
    'the lecture note is skipped even as lastNote'
  );
  assert.equal(NOTEPAD_FALLBACK, '笔记.txt');
});

test('note path predicates keep template notes out of lastCodePath', () => {
  assert.equal(isNoteDocumentPath('康奈尔笔记.md'), true);
  assert.equal(isNoteDocumentPath('课堂笔记.md'), true);
  assert.equal(isNoteDocumentPath('English.txt'), true);
  assert.equal(isNoteDocumentPath('main.py'), false);
  assert.equal(isNoteDocumentPath('data.json'), false);
  assert.equal(isNotepadNotePath('康奈尔笔记.md'), true);
  assert.equal(isNotepadNotePath('English.txt'), true);
  assert.equal(isNotepadNotePath('课堂笔记.md'), false);
  assert.equal(shouldRememberCodePath('main.py'), true);
  assert.equal(shouldRememberCodePath('data.json'), true);
  assert.equal(shouldRememberCodePath('康奈尔笔记.md'), false);
  assert.equal(shouldRememberCodePath('课堂笔记.md'), false);
  assert.equal(shouldRememberCodePath('English.txt'), false);
  assert.equal(shouldRememberCodePath(''), false);
});

test('lecture note templates never damage timestamps', () => {
  assert.deepEqual(
    noteTemplateAction({ mode: 'notepad', action: 'insert' }),
    { ok: true, action: 'insert', open: true, reason: '' }
  );
  const recording = noteTemplateAction({ mode: 'lecture', action: 'insert', recording: true, hasStamps: false });
  assert.equal(recording.ok, false);
  assert.equal(recording.reason, 'recording');
  assert.match(recording.message, /新建模板笔记/);

  const stamped = noteTemplateAction({ mode: 'lecture', action: 'insert', recording: false, hasStamps: true });
  assert.equal(stamped.ok, false);
  assert.equal(stamped.reason, 'timestamps');
  assert.match(stamped.message, /时间戳/);

  const createDuringLecture = noteTemplateAction({ mode: 'lecture', action: 'create', recording: true, hasStamps: true });
  assert.equal(createDuringLecture.ok, true);
  assert.equal(createDuringLecture.open, false, 'a lecture template note is created without switching away from the note');

  const createInNotepad = noteTemplateAction({ mode: 'notepad', action: 'create' });
  assert.equal(createInNotepad.ok, true);
  assert.equal(createInNotepad.open, true);
});
