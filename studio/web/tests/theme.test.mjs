import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY, APPEARANCES, ACCENTS, defaultTheme, sanitizeTheme, resolveTheme,
  readStoredTheme, writeStoredTheme, themeFromSettings, applyTheme, themeColor
} from '../src/theme.js';

function memoryStorage(initial) {
  const data = {...initial};
  return {
    getItem: key => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    dump: () => ({...data})
  };
}

test('unknown theme values fall back to system teal', () => {
  assert.deepEqual(sanitizeTheme(null), defaultTheme());
  assert.deepEqual(sanitizeTheme({appearance:'neon', accent:'nope'}), {appearance:'system', accent:'teal'});
  assert.deepEqual(sanitizeTheme({appearance:'dark', accent:'rose'}), {appearance:'dark', accent:'rose'});
  assert.deepEqual(APPEARANCES, ['system', 'light', 'dark']);
  assert.deepEqual(ACCENTS, ['teal', 'amber', 'ink', 'rose']);
});

test('system appearance follows the host preference', () => {
  assert.equal(resolveTheme({appearance:'system', accent:'ink'}, false).mode, 'light');
  assert.equal(resolveTheme({appearance:'system', accent:'ink'}, true).mode, 'dark');
  assert.equal(resolveTheme({appearance:'light', accent:'amber'}, true).mode, 'light');
  assert.equal(resolveTheme({appearance:'dark', accent:'teal'}, false).mode, 'dark');
  assert.equal(themeColor(resolveTheme({appearance:'dark', accent:'rose'}, true)), '#161114');
  assert.equal(themeColor(resolveTheme({appearance:'light', accent:'amber'}, false)), '#fbf6ec');
});

test('theme survives a restart when storage is written and read back', () => {
  const first = memoryStorage();
  const saved = writeStoredTheme(first, {appearance:'dark', accent:'amber', extra:'ignore'});
  assert.deepEqual(saved, {appearance:'dark', accent:'amber'});
  const raw = first.dump()[THEME_STORAGE_KEY];
  const restarted = memoryStorage({[THEME_STORAGE_KEY]: raw});
  assert.deepEqual(readStoredTheme(restarted), {appearance:'dark', accent:'amber'});
  assert.deepEqual(readStoredTheme(memoryStorage()), defaultTheme());
  assert.deepEqual(readStoredTheme(memoryStorage({[THEME_STORAGE_KEY]: '{'})), defaultTheme());
});

test('workspace snapshot wins, and a legacy snapshot keeps the device theme', () => {
  const stored = {appearance:'dark', accent:'ink'};
  assert.deepEqual(themeFromSettings({fontSize:15, wrap:true, timeLimit:15}, stored), stored);
  assert.deepEqual(themeFromSettings({appearance:'light'}, stored), {appearance:'light', accent:'ink'});
  assert.deepEqual(themeFromSettings({accent:'rose', appearance:'nope'}, stored), {appearance:'dark', accent:'rose'});
  assert.deepEqual(themeFromSettings({appearance:'system', accent:'teal'}, stored), {appearance:'system', accent:'teal'});
  assert.deepEqual(themeFromSettings(null, null), defaultTheme());
});

test('applyTheme writes the resolved mode onto the document root', () => {
  const root = {dataset:{}, style:{}};
  const resolved = applyTheme(root, {appearance:'system', accent:'rose'}, true);
  assert.equal(resolved.mode, 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.dataset.appearance, 'system');
  assert.equal(root.dataset.accent, 'rose');
  assert.equal(root.style.colorScheme, 'dark');
  applyTheme(root, {appearance:'light', accent:'amber'}, true);
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.dataset.accent, 'amber');
});
