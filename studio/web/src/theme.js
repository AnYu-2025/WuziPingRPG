/** 工作台外观：浅色 / 深色 / 跟随系统，再加一套主题色。只依赖纯数据，方便测试持久化。 */

export const THEME_STORAGE_KEY = 'ember-studio-theme-v1';
export const APPEARANCES = ['system', 'light', 'dark'];
export const ACCENTS = ['teal', 'amber', 'ink', 'rose'];

const THEME_COLORS = {
  light: {teal:'#f3f8f5', amber:'#fbf6ec', ink:'#f3f5f8', rose:'#fbf4f6'},
  dark: {teal:'#101614', amber:'#16130f', ink:'#101318', rose:'#161114'}
};

export function defaultTheme() {
  return {appearance:'system', accent:'teal'};
}

export function sanitizeTheme(raw) {
  const appearance = raw && APPEARANCES.includes(raw.appearance) ? raw.appearance : 'system';
  const accent = raw && ACCENTS.includes(raw.accent) ? raw.accent : 'teal';
  return {appearance, accent};
}

/** system 在这里落实成 light 或 dark，调用方传入当前是否偏好深色。 */
export function resolveTheme(theme, prefersDark) {
  const clean = sanitizeTheme(theme);
  const mode = clean.appearance === 'system' ? (prefersDark ? 'dark' : 'light') : clean.appearance;
  return {appearance:clean.appearance, accent:clean.accent, mode};
}

export function themeColor(resolved) {
  const mode = resolved && resolved.mode === 'dark' ? 'dark' : 'light';
  const accent = resolved && ACCENTS.includes(resolved.accent) ? resolved.accent : 'teal';
  return THEME_COLORS[mode][accent];
}

export function readStoredTheme(storage) {
  if (!storage || typeof storage.getItem !== 'function') return defaultTheme();
  try {
    const text = storage.getItem(THEME_STORAGE_KEY);
    if (!text) return defaultTheme();
    return sanitizeTheme(JSON.parse(text));
  } catch (e) {
    return defaultTheme();
  }
}

export function writeStoredTheme(storage, theme) {
  const clean = sanitizeTheme(theme);
  if (storage && typeof storage.setItem === 'function') {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(clean));
  }
  return clean;
}

/**
 * 工作区快照里有合法字段时以快照为准（换设备导入草稿也带着主题）；
 * 缺字段时用本机存储，避免旧草稿把用户刚选的主题盖回默认。
 */
export function themeFromSettings(settings, stored) {
  const saved = sanitizeTheme(stored);
  const hasAppearance = !!(settings && APPEARANCES.includes(settings.appearance));
  const hasAccent = !!(settings && ACCENTS.includes(settings.accent));
  if (!hasAppearance && !hasAccent) return saved;
  return sanitizeTheme({
    appearance: hasAppearance ? settings.appearance : saved.appearance,
    accent: hasAccent ? settings.accent : saved.accent
  });
}

export function applyTheme(root, theme, prefersDark) {
  const resolved = resolveTheme(theme, prefersDark);
  if (root) {
    root.dataset.theme = resolved.mode;
    root.dataset.appearance = resolved.appearance;
    root.dataset.accent = resolved.accent;
    if (root.style) root.style.colorScheme = resolved.mode;
  }
  return resolved;
}
