// 视频一期：播放+修剪+套用照片调子+导出MP4/WebM+封面
const el = id => document.getElementById(id);
const v = el('videoEl');
const outCanvas = document.createElement('canvas');
const octx = outCanvas.getContext('2d');
let exporting = false, cancelExp = false, vidName = '', seeking = false;

function vtip(t){ el('vidTip').textContent = t || ''; }
function fmtT(s){ s=Math.max(0,s||0); return s.toFixed(1)+'s'; }

// ---- 页签 ----
el('tabImg').onclick = () => switchTab('img');
el('tabVid').onclick = () => switchTab('vid');
function switchTab(which){
  const isImg = which === 'img';
  el('tabImg').classList.toggle('active', isImg);
  el('tabVid').classList.toggle('active', !isImg);
  el('imgView').classList.toggle('hidden', !isImg);
  el('vidView').classList.toggle('hidden', isImg);
  if(!isImg){ applyVidFilters(); updateVidInfo(); }
}

// ---- 滤镜联动：照片调子直接套视频（重型效果自动跳过） ----
function applyVidFilters(){
  if(!v.duration) return;
  const st = window.getPhotoState ? window.getPhotoState() : null;
  if(!st) return;
  const S = st.S;
  const exp = 100 + S.exposure * 0.8;
  v.style.filter = `brightness(${S.brightness}%) brightness(${exp}%) contrast(${S.contrast}%) saturate(${S.saturate}%)`;
  const tf = [];
  if(st.rotation) tf.push(`rotate(${st.rotation}deg)`);
  if(st.flipH) tf.push('scaleX(-1)');
  if(st.flipV) tf.push('scaleY(-1)');
  v.style.transform = tf.join(' ') || 'none';
  const w = el('vidWarm');
  if(S.warm !== 0){ w.style.background = S.warm > 0 ? '#ff9a3c' : '#3ca9ff'; w.style.opacity = Math.abs(S.warm) / 120; w.style.mixBlendMode = 'overlay'; }
  else w.style.opacity = 0;
  const vg = el('vidVig');
  vg.style.background = S.vignette > 0
    ? `radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,${S.vignette / 140}) 100%)`
    : 'none';
  const a = el('vidAspect').value;
  v.style.aspectRatio = a === 'orig' ? 'auto' : a.replace(':', '/');
  v.style.objectFit = 'cover';
  v.style.width = '100%';
}
el('vidAspect').onchange = applyVidFilters;

// ---- 载入 ----
el('vidFile').onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  loadVideoFile(f); el('vidFile').value = '';
};
function loadVideoFile(f){
  vidName = (f.name || '视频').replace(/\.[a-zA-Z0-9]+$/, '');
  v.src = URL.createObjectURL(f);
  v.volume = (+el('vidVol').value) / 100;
  vtip('载入中…');
}
v.addEventListener('loadedmetadata', () => {
  el('trimStart').value = 0;
  el('trimEnd').value = +v.duration.toFixed(1);
  el('vidSeek').max = v.duration;
  applyVidFilters(); updateVidInfo();
  vtip(`已载入，去图片页调好味道再回来导出。说“${Math.min(5, Math.floor(v.duration))}秒到${Math.floor(v.duration)}秒”可直接定段`);
});
function updateVidInfo(){
  if(!v.duration){ el('vidPhotoInfo').textContent = '先放视频进来'; el('vidInfo').textContent = '支持 mp4/mov/webm，本地解码不上传'; return; }
  el('vidInfo').textContent = `${vidName} ｜ ${v.videoWidth}×${v.videoHeight} ｜ ${fmtT(v.duration)}`;
  el('vidPhotoInfo').textContent = `${vidName} ｜ ${v.videoWidth}×${v.videoHeight} ｜ ${fmtT(v.duration)} ｜ 滤镜跟随图片调子`;
}

// ---- 播放控制 ----
el('vidPlayBtn').onclick = () => {
  if(!v.duration){ vtip('先放视频进来'); return; }
  if(v.paused){ ensureInTrim(); v.play(); } else v.pause();
};
v.addEventListener('play', () => el('vidPlayBtn').textContent = '⏸ 暂停');
v.addEventListener('pause', () => el('vidPlayBtn').textContent = '▶ 播放');
v.addEventListener('timeupdate', () => {
  el('vidTime').textContent = `${fmtT(v.currentTime)} / ${fmtT(v.duration)}`;
  if(!seeking) el('vidSeek').value = v.currentTime;
  if(exporting) return;
  const { a, b } = trimRange();
  if(el('loopTrim').checked && v.duration && (v.currentTime >= b || v.currentTime < a - 0.2)) v.currentTime = a;
});
el('vidSeek').addEventListener('pointerdown', () => seeking = true);
window.addEventListener('pointerup', () => seeking = false);
el('vidSeek').addEventListener('input', e => { if(v.duration) v.currentTime = +e.target.value; });
el('vidVol').addEventListener('input', e => v.volume = (+e.target.value) / 100);

// ---- 修剪 ----
function trimRange(){
  const d = v.duration || 0;
  let a = Math.max(0, +el('trimStart').value || 0);
  let b = +el('trimEnd').value || d;
  b = Math.min(Math.max(b, 0), d);
  if(b <= a) b = Math.min(d, a + 1);
  return { a, b };
}
function ensureInTrim(){
  const { a, b } = trimRange();
  if(v.currentTime < a || v.currentTime >= b) v.currentTime = a;
}
el('markStartBtn').onclick = () => { el('trimStart').value = +v.currentTime.toFixed(1); vtip(`起点=${fmtT(v.currentTime)}`); };
el('markEndBtn').onclick = () => { el('trimEnd').value = +v.currentTime.toFixed(1); vtip(`终点=${fmtT(v.currentTime)}`); };

// ---- 快捷套氛围（复用图片预设，也进强度） ----
(function initVidPreset(){
  const sel = el('vidPreset');
  window.PRESETS.forEach(p => {
    const o = document.createElement('option'); o.value = p.key; o.textContent = p.name; sel.appendChild(o);
  });
  sel.onchange = () => { if(sel.value && window.applyPreset){ window.applyPreset(sel.value); sel.value = ''; } };
})();

// ---- 导出 ----
function seekTo(t){
  return new Promise(res => {
    const h = () => { v.removeEventListener('seeked', h); res(); };
    v.addEventListener('seeked', h);
    v.currentTime = Math.max(0, Math.min(t, (v.duration || 1) - 0.15));
  });
}
function pickMime(){
  if(typeof MediaRecorder === 'undefined') return '';
  const list = ['video/mp4;codecs="avc1.42E01E"', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return list.find(m => { try{ return MediaRecorder.isTypeSupported(m); }catch(e){ return false; } }) || '';
}
function drawVFrame(geo){
  const st = window.getPhotoState();
  const S = st.S;
  octx.filter = window.effFilter();
  octx.save();
  octx.translate(outCanvas.width / 2, outCanvas.height / 2);
  octx.rotate(st.rotation * Math.PI / 180);
  octx.scale(st.flipH ? -1 : 1, st.flipV ? -1 : 1);
  const odd = Math.round(st.rotation) % 180 !== 0;
  const bw = odd ? geo.th : geo.tw, bh = odd ? geo.tw : geo.th;
  const s = Math.min(bw / geo.sw, bh / geo.sh);
  octx.drawImage(v, geo.sx, geo.sy, geo.sw, geo.sh, -geo.sw * s / 2, -geo.sh * s / 2, geo.sw * s, geo.sh * s);
  octx.restore();
  if(S.warm !== 0){
    octx.save(); octx.globalAlpha = Math.abs(S.warm) / 120;
    octx.fillStyle = S.warm > 0 ? '#ff9a3c' : '#3ca9ff';
    octx.globalCompositeOperation = 'overlay';
    octx.fillRect(0, 0, outCanvas.width, outCanvas.height); octx.restore();
  }
  if(S.vignette > 0){
    const w = outCanvas.width, h = outCanvas.height;
    const g = octx.createRadialGradient(w/2,h/2,Math.min(w,h)*0.3,w/2,h/2,Math.max(w,h)*0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${S.vignette/140})`);
    octx.fillStyle = g; octx.fillRect(0, 0, w, h);
  }
  window.paintWMText(octx, outCanvas.width, outCanvas.height);
  window.paintSticker(octx, outCanvas.width, outCanvas.height);
}
function calcGeo(){
  const vw = v.videoWidth, vh = v.videoHeight;
  const asp = el('vidAspect').value;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if(asp !== 'orig'){
    const [aw, ah] = asp.split(':').map(Number), tr = aw / ah, sr = vw / vh;
    if(sr > tr){ sh = vh; sw = Math.round(vh * tr); sx = Math.round((vw - sw) / 2); }
    else { sw = vw; sh = Math.round(vw / tr); sy = Math.round((vh - sh) / 2); }
  }
  let tw = sw, th = sh;
  const cap = +el('vidSize').value;
  if(cap > 0){ const s = Math.min(1, cap / Math.max(tw, th)); tw = Math.round(tw * s); th = Math.round(th * s); }
  return { sx, sy, sw, sh, tw, th };
}
el('vidExportBtn').onclick = exportVideo;
el('vidCancelBtn').onclick = () => { cancelExp = true; };
async function exportVideo(){
  if(!v.duration){ vtip('先放视频进来'); return; }
  if(exporting) return;
  const { a, b } = trimRange();
  if(b - a < 0.3){ vtip('片段太短，把终点拉开一点'); return; }
  const mime = pickMime();
  if(!mime){ vtip('当前环境不支持视频编码导出'); return; }
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const geo = calcGeo();
  const st = window.getPhotoState();
  const odd = Math.round(st.rotation) % 180 !== 0;
  outCanvas.width = odd ? geo.th : geo.tw;
  outCanvas.height = odd ? geo.tw : geo.th;
  exporting = true; cancelExp = false;
  el('vidCancelBtn').classList.remove('hidden');
  try{
    await seekTo(a);
    await v.play();
    const stream = outCanvas.captureStream(30);
    try{
      const vsrc = v.captureStream ? v.captureStream() : null;
      if(vsrc) vsrc.getAudioTracks().forEach(t => stream.addTrack(t));
    }catch(e){}
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.max(800000, Math.round(geo.tw * geo.th * 24 * 0.12)) });
    const chunks = [];
    rec.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => rec.onstop = r);
    rec.start(500);
    const result = await new Promise(res => {
      const loop = () => {
        if(cancelExp || !exporting){ res('cancel'); return; }
        if(v.currentTime >= b - 0.05 || v.ended){ res('ok'); return; }
        try{ drawVFrame(geo); }catch(e){}
        vtip(`导出中 ${Math.round((v.currentTime - a) / (b - a) * 100)}%（${fmtT(v.currentTime - a)}/${fmtT(b - a)}）`);
        requestAnimationFrame(loop);
      };
      loop();
    });
    rec.stop(); v.pause(); await stopped;
    if(result === 'ok'){
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      await window.saveBlob(blob, `${vidName || '视频'}_加工_${outCanvas.width}x${outCanvas.height}.${ext}`);
      vtip(`导出完成 ${outCanvas.width}×${outCanvas.height} ${window.fmtKB ? window.fmtKB(blob.size) : ''}，请查收`);
    } else vtip('已取消导出');
  }catch(e){ vtip('导出失败：' + e.message); }
  exporting = false;
  el('vidCancelBtn').classList.add('hidden');
}

// 调试入口：?view=vid 直接进视频页
if(/view=vid/.test(location.search)) switchTab('vid');

// ---- 封面：当前帧存图片（走图片导出设置+存对话框） ----
el('vidCoverBtn').onclick = async () => {
  if(!v.duration){ vtip('先放视频进来'); return; }
  const geo = calcGeo();
  const st = window.getPhotoState();
  const odd = Math.round(st.rotation) % 180 !== 0;
  outCanvas.width = odd ? geo.th : geo.tw;
  outCanvas.height = odd ? geo.tw : geo.th;
  drawVFrame(geo);
  const bytes = await window.downloadCanvas(outCanvas, `${vidName || '视频'}_封面_${outCanvas.width}x${outCanvas.height}.${window.extOf ? window.extOf(window.getExportSettings().format) : 'jpg'}`);
  vtip(`封面已导出 ${outCanvas.width}×${outCanvas.height}${bytes ? ' ' + window.fmtKB(bytes) : ''}`);
};
