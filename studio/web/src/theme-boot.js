/* 在首屏绘制前套上已保存的主题。逻辑与 theme.js 的白名单保持一致，且必须是 ES5。 */
(function () {
  var appearances = {system:1, light:1, dark:1};
  var accents = {teal:1, amber:1, ink:1, rose:1};
  var theme = {appearance:'system', accent:'teal'};
  try {
    var raw = JSON.parse(localStorage.getItem('ember-studio-theme-v1') || 'null');
    if (raw && appearances[raw.appearance]) theme.appearance = raw.appearance;
    if (raw && accents[raw.accent]) theme.accent = raw.accent;
  } catch (ignored) {}
  var dark = false;
  try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (ignored) {}
  var mode = theme.appearance === 'system' ? (dark ? 'dark' : 'light') : theme.appearance;
  var root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.setAttribute('data-appearance', theme.appearance);
  root.setAttribute('data-accent', theme.accent);
  root.style.colorScheme = mode;
})();
