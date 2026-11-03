/* ES5 prelude: runs before app.js so a WebView that cannot parse the modern
   bundle still reports why, instead of showing a silently dead screen. */
(function () {
  var errors = [];
  window.__studioBootOk = true;
  window.__studioErrors = errors;
  function report(kind, detail) {
    detail = String(detail || '').slice(0, 400);
    errors.push(kind + ': ' + detail);
    if (errors.length > 8) errors.shift();
    try {
      if (window.StudioBridge && window.StudioBridge.postMessage) {
        window.StudioBridge.postMessage(JSON.stringify({type: 'jsError', kind: kind, detail: detail}));
      }
    } catch (ignored) {}
  }
  window.__studioBootReport = report;
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (target && target !== window && target.tagName) {
      var tag = String(target.tagName).toUpperCase();
      if (tag !== 'SCRIPT' && tag !== 'LINK') return;
      report('resource', tag + ' ' + (target.src || target.href || ''));
      return;
    }
    report('script', (event && event.message || '脚本错误') +
      (event && event.filename ? ' @' + event.filename + ':' + event.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    report('promise', reason && (reason.stack || reason.message) || reason || '');
  });
  setTimeout(function () {
    if (window.Studio && (window.Studio.view || window.__studioLandingReady)) return;
    var host = document.getElementById('editor');
    if (!host || host.getAttribute('data-boot-failed') === '1') return;
    host.setAttribute('data-boot-failed', '1');
    var box = document.createElement('div');
    box.style.cssText = 'padding:18px 20px;font:14px/1.6 sans-serif;color:#1f2937;background:#fff';
    var title = document.createElement('p');
    title.style.cssText = 'margin:0 0 6px;font-weight:600';
    title.textContent = '编辑器脚本没有完成加载。';
    box.appendChild(title);
    var hint = document.createElement('p');
    hint.style.cssText = 'margin:0;color:#64748b';
    hint.textContent = '请更新 Android System WebView 或 Chrome 后重新打开天工。';
    box.appendChild(hint);
    if (errors.length) {
      var detail = document.createElement('p');
      detail.style.cssText = 'margin:10px 0 0;font:12px/1.5 monospace;color:#64748b;word-break:break-all;white-space:pre-wrap';
      detail.textContent = errors.join('\n');
      box.appendChild(detail);
    }
    var landing = document.getElementById('landing');
    if (landing) {
      box.style.cssText += ';position:fixed;left:14px;right:14px;bottom:14px;z-index:9999;border-radius:14px;box-shadow:0 12px 30px rgba(15,23,42,.22)';
      document.body.appendChild(box);
    } else {
      host.appendChild(box);
    }
  }, 3000);
})();
