// 专业调色：RGB曲线 + HSL八色分调（预览/导出同一套像素管线）
const HSL_COLORS = [
  { key: 'red',     name: '红', c: 0,   css: '#e5484d' },
  { key: 'orange',  name: '橙', c: 30,  css: '#f76b15' },
  { key: 'yellow',  name: '黄', c: 60,  css: '#ffd60a' },
  { key: 'green',   name: '绿', c: 120, css: '#46a758' },
  { key: 'cyan',    name: '青', c: 180, css: '#12a594' },
  { key: 'blue',    name: '蓝', c: 240, css: '#3e63dd' },
  { key: 'purple',  name: '紫', c: 270, css: '#8e4ec6' },
  { key: 'magenta', name: '品', c: 300, css: '#d6409f' },
];
function defaultGrade(){
  const id = () => [[0, 0], [255, 255]];
  const hsl = {};
  HSL_COLORS.forEach(o => hsl[o.key] = { h: 0, s: 0, l: 0 });
  return { curves: { rgb: id(), r: id(), g: id(), b: id() }, chan: 'rgb', sel: 'red', hsl };
}
let GRADE = defaultGrade();

function gradeSnapshot(){ return JSON.parse(JSON.stringify({ curves: GRADE.curves, sel: GRADE.sel, hsl: GRADE.hsl })); }
function restoreGrade(g){
  if(!g) return;
  GRADE.curves = g.curves; GRADE.hsl = g.hsl; GRADE.sel = g.sel || 'red';
  syncGradeUI();
}
function resetGrade(){ GRADE = defaultGrade(); syncGradeUI(); }
function curvesDirty(){
  return ['rgb', 'r', 'g', 'b'].some(k => {
    const p = GRADE.curves[k];
    return p.length !== 2 || p[0][0] !== 0 || p[0][1] !== 0 || p[1][0] !== 255 || p[1][1] !== 255;
  });
}
function hslDirty(){ return Object.values(GRADE.hsl).some(o => o.h !== 0 || o.s !== 0 || o.l !== 0); }
function gradeDirty(){ return curvesDirty() || hslDirty(); }

// ---- 曲线 LUT（Fritsch-Carlson 单调三次 Hermite：共线保线性、单调、顺滑） ----
function buildCurveLUT(pts){
  const lut = new Uint8ClampedArray(256);
  let p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  p = p.filter((pt, i) => i === 0 || pt[0] !== p[i - 1][0]); // 同x去重
  const n = p.length;
  if(n === 1){ lut.fill(p[0][1]); return lut; }
  const h = [], m = [], mm = new Array(n);
  for(let i = 0; i < n - 1; i++){ h[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]); m[i] = (p[i + 1][1] - p[i][1]) / h[i]; }
  mm[0] = m[0]; mm[n - 1] = m[n - 2];
  for(let i = 1; i < n - 1; i++){
    if(m[i - 1] * m[i] <= 0) mm[i] = 0;
    else{
      const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
      mm[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  let seg = 0;
  for(let x = 0; x < 256; x++){
    if(x <= p[0][0]){ lut[x] = p[0][1]; continue; }
    if(x >= p[n - 1][0]){ lut[x] = p[n - 1][1]; continue; }
    while(seg < n - 2 && x > p[seg + 1][0]) seg++;
    const t = (x - p[seg][0]) / h[seg];
    const t2 = t * t, t3 = t2 * t;
    lut[x] = (2*t3 - 3*t2 + 1) * p[seg][1] + (t3 - 2*t2 + t) * h[seg] * mm[seg]
           + (-2*t3 + 3*t2) * p[seg + 1][1] + (t3 - t2) * h[seg] * mm[seg + 1];
  }
  return lut;
}
function buildGradeLUTs(){
  const m = buildCurveLUT(GRADE.curves.rgb);
  const R = buildCurveLUT(GRADE.curves.r), G = buildCurveLUT(GRADE.curves.g), B = buildCurveLUT(GRADE.curves.b);
  const r = new Uint8ClampedArray(256), g = new Uint8ClampedArray(256), b = new Uint8ClampedArray(256);
  for(let x = 0; x < 256; x++){ r[x] = m[R[x]]; g[x] = m[G[x]]; b[x] = m[B[x]]; }
  return { r, g, b };
}

// ---- HSV 快速互转 ----
function rgb2hsv(r, g, b){
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if(d > 0.0001){
    if(mx === r) h = ((g - b) / d) % 6;
    else if(mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if(h < 0) h += 360;
  }
  return [h, mx < 1e-6 ? 0 : d / mx, mx];
}
function hsv2rgb(h, s, v){
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r, g, b;
  if(h < 60){ r = c; g = x; b = 0; } else if(h < 120){ r = x; g = c; b = 0; }
  else if(h < 180){ r = 0; g = c; b = x; } else if(h < 240){ r = 0; g = x; b = c; }
  else if(h < 300){ r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ---- 统一调色：曲线 → HSL（一遍像素循环） ----
function applyGrade(tcanvas){
  if(!gradeDirty()) return;
  const c = tcanvas.getContext('2d');
  const w = tcanvas.width, h = tcanvas.height;
  if(w * h > 30000000) return;
  const L = curvesDirty() ? buildGradeLUTs() : null;
  const useHSL = hslDirty();
  const Hp = useHSL ? HSL_COLORS.map(o => ({ c: o.c, ...GRADE.hsl[o.key] })) : null;
  const img = c.getImageData(0, 0, w, h), d = img.data;
  for(let i = 0; i < d.length; i += 4){
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if(L){ r = L.r[r]; g = L.g[g]; b = L.b[b]; }
    if(useHSL){
      let [hh, ss, vv] = rgb2hsv(r, g, b);
      if(ss > 0.02){
        let dh = 0, ds = 0, dl = 0;
        for(let k = 0; k < Hp.length; k++){
          const p = Hp[k];
          if(!p.h && !p.s && !p.l) continue;
          let dist = Math.abs(hh - p.c); if(dist > 180) dist = 360 - dist;
          if(dist >= 60) continue;
          const wt = (Math.cos(dist / 60 * Math.PI) + 1) / 2;
          dh += p.h * wt; ds += p.s * wt; dl += p.l * wt;
        }
        if(dh || ds || dl){
          const out = hsv2rgb(hh + dh, Math.min(1, Math.max(0, ss * (1 + ds / 100))), Math.min(1, Math.max(0, vv * (1 + dl / 100))));
          r = out[0]; g = out[1]; b = out[2];
        }
      }
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  c.putImageData(img, 0, 0);
}

// ---- 曲线编辑器 UI ----
let curveDrag = -1;
function curveCanvas(){ return document.getElementById('curveCanvas'); }
function drawCurveEd(){
  const cv = curveCanvas(); if(!cv) return;
  const c = cv.getContext('2d'), W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H); c.fillStyle = '#10131a'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,255,255,.09)'; c.lineWidth = 1;
  for(let i = 1; i < 4; i++){
    c.beginPath(); c.moveTo(W * i / 4, 0); c.lineTo(W * i / 4, H); c.stroke();
    c.beginPath(); c.moveTo(0, H * i / 4); c.lineTo(W, H * i / 4); c.stroke();
  }
  c.strokeStyle = 'rgba(255,255,255,.18)';
  c.beginPath(); c.moveTo(0, H); c.lineTo(W, 0); c.stroke();
  const pts = GRADE.curves[GRADE.chan];
  const X = x => x / 255 * W, Y = y => H - y / 255 * H;
  const lut = buildCurveLUT(pts);
  const col = { rgb: '#e8eaf0', r: '#ff6b6b', g: '#69db7c', b: '#74c0fc' }[GRADE.chan];
  c.strokeStyle = col; c.lineWidth = 1.8; c.beginPath();
  for(let x = 0; x < 256; x += 2){ const px = X(x), py = Y(lut[x]); x === 0 ? c.moveTo(px, py) : c.lineTo(px, py); }
  c.stroke();
  pts.forEach((p, i) => {
    c.fillStyle = i === curveDrag ? '#fff' : col;
    c.beginPath(); c.arc(X(p[0]), Y(p[1]), i === curveDrag ? 5.5 : 4, 0, 7); c.fill();
    c.fillStyle = '#10131a'; c.beginPath(); c.arc(X(p[0]), Y(p[1]), 1.8, 0, 7); c.fill();
  });
}
function curveEvtPos(e){
  const r = curveCanvas().getBoundingClientRect();
  return [
    Math.round(Math.min(255, Math.max(0, (e.clientX - r.left) / r.width * 255))),
    Math.round(Math.min(255, Math.max(0, (1 - (e.clientY - r.top) / r.height)) * 255))
  ];
}
function initCurveEd(){
  const cv = curveCanvas(); if(!cv) return;
  cv.addEventListener('mousedown', e => {
    const [x, y] = curveEvtPos(e);
    const pts = GRADE.curves[GRADE.chan];
    let best = -1, bd = 14 * 14 * (255 / cv.getBoundingClientRect().width) ** 2;
    pts.forEach((p, i) => { const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if(dd < bd){ bd = dd; best = i; } });
    if(best >= 0){ curveDrag = best; }
    else if(pts.length < 12){
      if(typeof window.snap === 'function') window.snap();
      pts.push([x, y]); pts.sort((a, b) => a[0] - b[0]);
      curveDrag = pts.findIndex(p => p[0] === x && p[1] === y);
      drawCurveEd(); requestGradeRender();
    }
  });
  window.addEventListener('mousemove', e => {
    if(curveDrag < 0 || !curveCanvas()) return;
    const [x, y] = curveEvtPos(e);
    const pts = GRADE.curves[GRADE.chan];
    pts[curveDrag] = [x, y]; pts.sort((a, b) => a[0] - b[0]);
    curveDrag = pts.findIndex(p => p[0] === x && p[1] === y);
    drawCurveEd(); requestGradeRender();
  });
  window.addEventListener('mouseup', () => { curveDrag = -1; });
  cv.addEventListener('dblclick', e => {
    const [x, y] = curveEvtPos(e);
    const pts = GRADE.curves[GRADE.chan];
    if(pts.length <= 2) return;
    let best = -1, bd = 1e9;
    pts.forEach((p, i) => { const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2; if(dd < bd){ bd = dd; best = i; } });
    if(best >= 0){ if(typeof window.snap === 'function') window.snap(); pts.splice(best, 1); drawCurveEd(); requestGradeRender(); }
  });
  document.querySelectorAll('[data-chan]').forEach(b => b.onclick = () => {
    GRADE.chan = b.dataset.chan;
    document.querySelectorAll('[data-chan]').forEach(x => x.classList.toggle('on', x === b));
    drawCurveEd();
  });
  const rst = document.getElementById('curveResetBtn');
  if(rst) rst.onclick = () => {
    if(typeof window.snap === 'function') window.snap();
    const id = () => [[0, 0], [255, 255]];
    GRADE.curves = { rgb: id(), r: id(), g: id(), b: id() };
    drawCurveEd(); requestGradeRender();
  };
  drawCurveEd();
}
function requestGradeRender(){
  if(typeof window.requestRender === 'function') window.requestRender();
  else if(typeof render === 'function') render();
}

// ---- HSL UI ----
function initHslUI(){
  const box = document.getElementById('hslSwatches'); if(!box) return;
  box.innerHTML = '';
  HSL_COLORS.forEach(o => {
    const b = document.createElement('button');
    b.className = 'sw' + (GRADE.sel === o.key ? ' on' : '');
    b.style.setProperty('--c', o.css); b.title = o.name; b.dataset.k = o.key;
    b.onclick = () => {
      GRADE.sel = o.key;
      box.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b));
      syncHslSliders();
    };
    box.appendChild(b);
  });
  [['hslH', 'h'], ['hslS', 's'], ['hslL', 'l']].forEach(([id, k]) => {
    const sl = document.getElementById(id);
    sl.oninput = () => {
      GRADE.hsl[GRADE.sel][k] = +sl.value;
      sl.nextElementSibling.textContent = sl.value;
      requestGradeRender();
    };
    sl.onchange = () => { if(typeof window.snap === 'function') window.snap(); };
  });
  syncHslSliders();
}
function syncHslSliders(){
  const o = GRADE.hsl[GRADE.sel] || { h: 0, s: 0, l: 0 };
  [['hslH', 'h'], ['hslS', 's'], ['hslL', 'l']].forEach(([id, k]) => {
    const sl = document.getElementById(id); if(!sl) return;
    sl.value = o[k]; sl.nextElementSibling.textContent = o[k];
  });
  if(typeof paintRanges === 'function') paintRanges();
}
function syncGradeUI(){
  drawCurveEd(); syncHslSliders();
  document.querySelectorAll('[data-chan]').forEach(x => x.classList.toggle('on', x.dataset.chan === GRADE.chan));
  const box = document.getElementById('hslSwatches');
  if(box) box.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x.dataset.k === GRADE.sel));
}

// 口语微调入口（renderer口语层调用）
function applyHslAdjust(k, d){
  if(typeof window.snap === 'function') window.snap();
  const o = GRADE.hsl[k]; if(!o) return;
  for(const key in d){
    const r = key === 'h' ? [-30, 30] : [-100, 100];
    o[key] = Math.max(r[0], Math.min(r[1], o[key] + d[key]));
  }
  syncHslSliders(); requestGradeRender();
}

// 初始化（脚本在body末尾，DOM已就绪；renderer先跑完，这里补恢复调色快照）
initCurveEd(); initHslUI();
try{
  const _o = JSON.parse(localStorage.getItem('zhaopian_v1') || 'null');
  if(_o && _o.grade) restoreGrade(_o.grade);
}catch(e){}
