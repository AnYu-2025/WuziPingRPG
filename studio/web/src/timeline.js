/* 上课模式 · 时间轴
   Canvas 渲染：RMS 波形包络 + 锚点标记（speech 青 / silence 灰 / manual 琥珀）+ 红色播放头。
   支持点击/拖动定位、锚点命中、围绕播放头的窗口缩放。 */

import {fmt} from './audio-engine.js';

const ZOOMS=[1,1.5,2,3,4,6,8,12,16,24,32];
const ANCHOR_COLORS={speech:'#0f766e',silence:'#9ca3af',manual:'#b45309'};

export class Timeline{
  constructor(canvas,handlers){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.handlers=handlers||{};
    this.duration=0;
    this.envelope=[];
    this.spacing=0.5;
    this.anchors=[];
    this.playhead=null;
    this.zoomIdx=0;
    this.win=[0,1];      // 可视窗口（占全程比例）
    this.raf=0;
    let sx=0,sy=0,st=0;
    canvas.addEventListener('pointerdown',e=>{sx=e.clientX;sy=e.clientY;st=this.timeAt(e.clientX);});
    canvas.addEventListener('pointerup',e=>{
      if(this.duration<=0)return;
      if(Math.abs(e.clientX-sx)>12||Math.abs(e.clientY-sy)>18)return;
      const anchor=this.anchorAt(e.clientX);
      if(anchor){if(this.handlers.onAnchor)this.handlers.onAnchor(anchor);}
      else if(this.handlers.onSeek)this.handlers.onSeek(Math.max(0,Math.min(this.duration,st)));
    });
    if(typeof ResizeObserver==='function')new ResizeObserver(()=>this.render()).observe(canvas);
    else window.addEventListener('resize',()=>this.render());
  }
  setData(duration,envelope,anchors,spacing){
    this.duration=Math.max(0,Number(duration)||0);
    this.envelope=envelope||[];
    this.anchors=anchors||[];
    if(spacing)this.spacing=spacing;
    this.clampWindow();
    this.schedule();
  }
  setPlayhead(t){
    this.playhead=(t==null)?null:Math.max(0,t);
    this.schedule();
  }
  zoom(dir){
    const next=Math.max(0,Math.min(ZOOMS.length-1,this.zoomIdx+dir));
    if(next===this.zoomIdx&&dir!==0){}
    this.zoomIdx=next;
    const span=1/ZOOMS[this.zoomIdx];
    const center=this.playhead!=null?this.playhead/this.duration:(this.win[0]+this.win[1])/2;
    this.win=[center-span/2,center+span/2];
    this.clampWindow();
    this.schedule();
  }
  clampWindow(){
    const span=1/ZOOMS[this.zoomIdx];
    let a=this.win[0],b=this.win[1];
    if(b-a>span){a=0;b=span;}
    if(b>1){a-=b-1;b=1;}
    if(a<0){b-=a;a=0;}
    this.win=[Math.max(0,a),Math.min(1,b)];
  }
  rangeLabel(){
    if(this.zoomIdx===0)return '全程';
    return fmt(this.win[0]*this.duration)+' – '+fmt(this.win[1]*this.duration);
  }
  timeAt(px){
    const rect=this.canvas.getBoundingClientRect();
    const w=rect.width||1;
    const rel=Math.max(0,Math.min(1,(px-rect.left)/w));
    const t=(this.win[0]+rel*(this.win[1]-this.win[0]))*this.duration;
    return Math.max(0,Math.min(this.duration,t));
  }
  anchorAt(px){
    const rect=this.canvas.getBoundingClientRect();
    const w=rect.width||1;
    let best=null,bestD=12;
    for(const a of this.anchors){
      const x=((a.time/this.duration)-this.win[0])/(this.win[1]-this.win[0])*w+rect.left;
      const d=Math.abs(x-px);
      if(d<=bestD){bestD=d;best=a;}
    }
    return best;
  }
  schedule(){
    if(this.raf)return;
    this.raf=requestAnimationFrame(()=>{this.raf=0;this.render();});
  }
  render(){
    const canvas=this.canvas,g=this.ctx;
    const w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    g.setTransform(dpr,0,0,dpr,0,0);
    g.clearRect(0,0,w,h);
    g.fillStyle='#fbfdfc';g.fillRect(0,0,w,h);
    if(this.duration<=0){
      g.fillStyle='#94a3b8';g.font='12px '+getComputedStyle(document.body).fontFamily;
      g.textAlign='center';
      g.fillText(this.envelope.length?'正在录音…':'开始录音后，这里会出现波形与锚点',w/2,h/2+4);
      return;
    }
    const [a,b]=this.win,span=Math.max(0.001,b-a);
    const t2x=t=>((t/this.duration)-a)/span*w;
    const bottom=h-16,mid=bottom*0.62,amp=Math.max(10,mid-12);
    /* 波形：每像素列取包络窗口内最大 RMS，随窗口缩放。 */
    let maxV=0.04;
    for(const v of this.envelope)if(v>maxV)maxV=v;
    const env=this.envelope,spacing=this.spacing;
    g.fillStyle='#2dd4bf';
    let cursor=Math.max(0,Math.floor(a*this.duration/spacing)-1);
    for(let x=0;x<w;x++){
      const t0=(a+(x/w)*span)*this.duration,t1=(a+((x+1)/w)*span)*this.duration;
      let i0=cursor,i1=Math.ceil(t1/spacing);
      cursor=Math.max(cursor,i0);
      let m=0;
      for(let i=Math.max(0,Math.floor(t0/spacing));i<Math.min(env.length,i1);i++){if(env[i]>m)m=env[i];if(i>cursor)cursor=i;}
      if(m<=0.0015)continue;
      const bh=Math.max(1.5,(m/maxV)*amp);
      g.fillRect(x,mid-bh,0.9,bh*2);
    }
    /* 时间刻度 */
    g.fillStyle='#94a3b8';g.font='10px ui-monospace,Menlo,Consolas,monospace';g.textAlign='left';
    const ticks=5;
    for(let i=0;i<=ticks;i++){
      const t=(a+i/ticks*span)*this.duration;
      const x=t2x(t);
      if(x<2||x>w-30)continue;
      g.fillRect(x,bottom+3,1,3);
      g.fillText(fmt(t),x+3,bottom+11);
    }
    /* 锚点：竖线 + 顶部圆点 */
    const sorted=this.anchors;
    const dense=sorted.length>48;
    for(const anchor of sorted){
      const x=t2x(anchor.time);
      if(x<-2||x>w+2)continue;
      const color=ANCHOR_COLORS[anchor.type]||ANCHOR_COLORS.manual;
      g.fillStyle=color;g.globalAlpha=0.32;
      g.fillRect(x-0.5,0,1,bottom);
      g.globalAlpha=1;
      g.beginPath();g.arc(x,7,3.4,0,Math.PI*2);g.fill();
      if(!dense&&anchor.label){
        g.fillStyle=color;g.font='10px ui-monospace,Menlo,Consolas,monospace';g.textAlign='left';
        const text=anchor.label.slice(0,10);
        const tw=g.measureText(text).width;
        if(x+tw+8<w)g.fillText(text,x+6,10);
      }
    }
    /* 播放头 */
    if(this.playhead!=null){
      const x=t2x(this.playhead);
      if(x>=-1&&x<=w+1){
        g.fillStyle='#dc2626';
        g.fillRect(x-0.5,0,1.4,bottom);
        g.beginPath();g.moveTo(x-4,0);g.lineTo(x+4,0);g.lineTo(x,6);g.closePath();g.fill();
      }
    }
  }
}
