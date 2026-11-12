/* 首页夜空：整片天空 + 流星都画在这一张画布上。
   之前流星用 CSS 动画（100%→0% 位置瞬移回起点），叠加在涟漪画布之上，
   循环接缝会露馅；而涟漪按条带位移又会把上层文字糊出鬼影。
   现在：流星由画布按周期计算，每颗在不可见区间完成复位 —— 位移与透明度
   在周期首尾严格相等，接缝在数学上不存在；涟漪只作用于天空自身。 */
(function () {
  var canvas = document.getElementById('skyRipple');
  var landing = document.getElementById('landing');
  if (!canvas || !landing) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  var img = new Image(), loaded = false, raf = 0, last = 0, running = false;
  /* 负延迟让首屏就有流星在天上，而不是等几秒才出现。 */
  var meteors = [
    { x:.30, color:'#ffcf7a', period:4.5, offset:2.2 },
    { x:.80, color:'#f4a5ff', period:5.5, offset:1.0 },
    { x:1.20, color:'#8fc0ff', period:4.2, offset:3.1 },
    { x:1.60, color:'#ffadb9', period:6.0, offset:4.3 },
    { x:.65, color:'#f9edff', period:5.0, offset:4.0 },
    { x:1.40, color:'#dbb1ff', period:4.8, offset:2.7 },
    { x:1.05, color:'#ffd58f', period:5.7, offset:0.5 },
    { x:1.80, color:'#9bbaff', period:6.3, offset:1.7 }
  ];
  var ANG = -37 * Math.PI / 180, COS = Math.cos(ANG), SIN = Math.sin(ANG);
  var FADE_IN = .05, MOVE_END = .80;
  /* 星尘：确定性伪随机，避免每次刷新布局跳变。 */
  var dust = (function () {
    var out = [], seed = 20261112;
    var rnd = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    var tints = ['#ffffff', '#cfe0ff', '#ffe6c4', '#e3d4ff'];
    for (var i = 0; i < 90; i++) {
      out.push({ x: rnd(), y: rnd() * .92, r: .5 + rnd() * 1.1, base: .18 + rnd() * .5,
                 speed: .5 + rnd() * 1.8, phase: rnd() * Math.PI * 2, color: tints[(rnd() * tints.length) | 0] });
    }
    return out;
  }());

  img.onload = function () { loaded = true; canvas.classList.add('ready'); start(); };
  img.onerror = function () { canvas.classList.remove('ready'); stop(); };
  img.src = 'meteor-sky.webp';

  function visible() {
    return !document.hidden && !landing.hidden && !landing.classList.contains('landing-out');
  }
  function start() { if (running || !loaded) return; running = true; last = 0; raf = requestAnimationFrame(draw); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  function meteorState(m, t) {
    var p = ((t + m.offset) % m.period) / m.period;   /* 0..1 */
    var move = Math.min(p, MOVE_END) / MOVE_END;      /* 位移在 80% 走完，之后静止 */
    var alpha;
    if (p < FADE_IN) alpha = p / FADE_IN * .9;
    else if (p < .70) alpha = .9 - (p - FADE_IN) / (.70 - FADE_IN) * .1;
    else if (p < MOVE_END) alpha = .8 * (1 - (p - .70) / (MOVE_END - .70));
    else alpha = 0;                                   /* 80%~100% 全透明，复位不可见 */
    return { move: move, alpha: alpha };
  }

  function draw(now) {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    if (!visible()) return;
    if (now - last < 33) return;                      /* ~30fps，省电且足够顺滑 */
    last = now;
    var box = landing.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    /* 按设备像素比渲染：素材本身 941×1672，之前压到 390 宽再被 2x 屏放大，
       等于二次降采样，星点全糊。现在 1:1 用足素材分辨率（上限 2x 控制开销）。 */
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var scale = dpr;
    var t = now / 1000;

    /* 缓慢呼吸：正弦周期运动，首尾天然连续，不会像 alternate 那样有折返感。 */
    var breathe = reduce ? 0 : Math.sin(t * (2 * Math.PI / 32));
    var zoom = 1.06 + breathe * .022;
    var panX = breathe * w * .006, panY = Math.cos(t * (2 * Math.PI / 32)) * h * .004;
    var cover = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
    var iw = w / cover, ih = h / cover;
    var ix = (img.naturalWidth - iw) / 2 + panX / cover, iy = (img.naturalHeight - ih) / 2 + panY / cover;

    var states = meteors.map(function (m) { return meteorState(m, t); });
    /* 整图一次绘制：不再按条带位移重采样（那会把星点抹成横纹）。
       动感交给缓慢的缩放/平移呼吸 + 流星 + 星尘闪烁，画面始终锐利。 */
    ctx.drawImage(img, ix, iy, iw, ih, 0, 0, w, h);

    /* 夜色氛围：multiply 压暗保留银河细节，再叠冷紫渐变与暗角。
       全部烘进画布，CSS 侧不再叠半透明层，避免二次发灰。 */
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    var night = ctx.createLinearGradient(0, 0, w * .3, h);
    night.addColorStop(0, '#4a4a86');
    night.addColorStop(.5, '#3a3a6e');
    night.addColorStop(1, '#2a2c58');
    ctx.fillStyle = night;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    var tint = ctx.createLinearGradient(0, 0, w, h);
    tint.addColorStop(0, 'rgba(28,20,72,.42)');
    tint.addColorStop(.55, 'rgba(14,14,44,.30)');
    tint.addColorStop(1, 'rgba(6,8,26,.52)');
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    var vign = ctx.createRadialGradient(w * .5, h * .34, Math.min(w, h) * .22, w * .5, h * .5, Math.max(w, h) * .8);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, 'rgba(2,3,14,.62)');
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, w, h);

    if (reduce) return;
    /* 星尘闪烁：在天空上撒一层细碎呼吸光点，让静止的星野也有生命感。 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var s2 = 0; s2 < dust.length; s2++) {
      var d2 = dust[s2];
      var tw = .35 + .65 * (.5 + .5 * Math.sin(t * d2.speed + d2.phase));
      ctx.globalAlpha = d2.base * tw;
      ctx.fillStyle = d2.color;
      ctx.beginPath();
      ctx.arc(d2.x * w, d2.y * h, d2.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    /* 流星：亮头 + 渐隐尾，加色混合让它们真正发光。 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < meteors.length; i++) {
      var m = meteors[i], s = states[i];
      if (s.alpha <= .01) continue;
      var hx = m.x * w + s.move * (-1.30 * w);
      var hy = (-.05 * h) + s.move * (1.05 * h);
      var len = Math.min(260, Math.max(120, w * .36)) * scale;
      var tx = hx - COS * len, ty = hy - SIN * len;
      var grad = ctx.createLinearGradient(hx, hy, tx, ty);
      grad.addColorStop(0, m.color);
      grad.addColorStop(.35, m.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = s.alpha;
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.6, 3 * scale);
      ctx.lineCap = 'round';
      ctx.shadowColor = m.color;
      ctx.shadowBlur = 10 * scale;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.2, 1.9 * scale), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  document.addEventListener('visibilitychange', function () { visible() ? start() : stop(); });
  window.addEventListener('resize', function () { last = 0; });
  if (window.MutationObserver) {
    new MutationObserver(function () { visible() ? start() : stop(); })
      .observe(landing, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }
  start();
}());
