/* Offline sky distortion follows the actual CSS meteor positions. */
(function () {
  var canvas = document.getElementById('skyRipple');
  var landing = document.getElementById('landing');
  if (!canvas || !landing || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  var img = new Image(), last = 0, loaded = false, raf = 0;
  var meteors = [].slice.call(document.querySelectorAll('.meteor-field i'));
  img.onload = function () { loaded = true; canvas.classList.add('ready'); };
  img.src = 'meteor-sky.webp';
  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (!loaded || document.hidden || landing.hidden || landing.classList.contains('landing-out') || now - last < 50) return;
    last = now;
    var box = landing.getBoundingClientRect(), scale = Math.min(1, 640 / Math.max(box.width, 1));
    var w = Math.max(1, Math.round(box.width * scale)), h = Math.max(1, Math.round(box.height * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    var cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    var iw = w / cover, ih = h / cover, ix = (img.naturalWidth - iw) / 2, iy = (img.naturalHeight - ih) / 2;
    var heads = meteors.map(function (el) { var r = el.getBoundingClientRect(); return {y:(r.top+r.height/2-box.top)*scale, visible:parseFloat(getComputedStyle(el).opacity)>0.15}; });
    var strips = Math.max(32, Math.round(h / 14)), step = h / strips;
    for (var n = 0; n < strips; n++) {
      var y = n * step, shift = 0;
      heads.forEach(function (p) { if (!p.visible) return; var d = (y-p.y)/Math.max(h*.12,30); shift += Math.sin(d*4-now*.006)*Math.exp(-d*d)*3.5*scale; });
      var sy = iy + y / h * ih, sh = Math.min(ih / strips + 2, img.naturalHeight - sy);
      ctx.drawImage(img, ix, sy, iw, sh, shift-2, y-1, w+4, step+2);
    }
  }
  img.onerror = function () { canvas.classList.remove('ready'); if (raf) cancelAnimationFrame(raf); };
  raf = requestAnimationFrame(draw);
}());
