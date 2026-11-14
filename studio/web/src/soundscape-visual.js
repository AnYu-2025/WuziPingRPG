/* 天工 · 潮声白噪音景 · 粒子画布
 * 随当前混音层叠加绘制雨丝/浪线/火星/星点/咖啡光斑/风痕，纯 Canvas2D，轻量。 */

export function createSoundscapeVisual(canvas){
  const ctx=canvas.getContext('2d');
  let raf=0,W=0,H=0,parts=[],active=new Set(),running=false;
  const rnd=(a,b)=>a+Math.random()*(b-a);

  function resize(){
    const r=canvas.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    W=Math.max(1,r.width);H=Math.max(1,r.height);
    canvas.width=W*dpr;canvas.height=H*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function seed(){
    parts=[];
    const push=(kind,n,make)=>{for(let i=0;i<n;i++)parts.push(Object.assign({kind},make()));};
    if(active.has('rain'))push('rain',60,()=>({x:rnd(0,W),y:rnd(0,H),l:rnd(8,18),v:rnd(300,520)}));
    if(active.has('waves'))push('wave',3,(_,i)=>({y:H*(0.55+0.14*(i||0)),ph:rnd(0,6),amp:rnd(6,14)}));
    if(active.has('fire'))push('ember',26,()=>({x:rnd(W*0.3,W*0.7),y:H+10,v:rnd(30,80),r:rnd(1,3),hue:rnd(15,40)}));
    if(active.has('night'))push('star',40,()=>({x:rnd(0,W),y:rnd(0,H*0.8),r:rnd(0.5,1.6),ph:rnd(0,6)}));
    if(active.has('cafe'))push('bokeh',14,()=>({x:rnd(0,W),y:rnd(0,H),r:rnd(10,34),ph:rnd(0,6)}));
    if(active.has('wind'))push('streak',16,()=>({x:rnd(0,W),y:rnd(0,H),l:rnd(40,120),v:rnd(120,260)}));
    if(active.has('white')||active.has('brown'))push('grain',30,()=>({x:rnd(0,W),y:rnd(0,H),r:rnd(0.5,1.5),ph:rnd(0,6)}));
  }
  let last=0;
  function frame(t){
    if(!running)return;
    raf=requestAnimationFrame(frame);
    const dt=last?Math.min(0.05,(t-last)/1000):0.016;last=t;
    ctx.clearRect(0,0,W,H);
    const time=t/1000;
    for(const p of parts){
      if(p.kind==='rain'){
        p.y+=p.v*dt;p.x-=p.v*dt*0.12;
        if(p.y>H){p.y=-20;p.x=rnd(0,W+40);}
        ctx.strokeStyle='rgba(150,190,255,.35)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+p.l*0.12,p.y+p.l);ctx.stroke();
      }else if(p.kind==='wave'){
        ctx.strokeStyle='rgba(90,200,220,.3)';ctx.lineWidth=1.5;
        ctx.beginPath();
        for(let x=0;x<=W;x+=6){
          const y=p.y+Math.sin(x*0.02+time*1.2+p.ph)*p.amp;
          x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.stroke();
      }else if(p.kind==='ember'){
        p.y-=p.v*dt;p.x+=Math.sin(time*2+p.y*0.02)*20*dt;
        if(p.y<-10){p.y=H+10;p.x=rnd(W*0.3,W*0.7);}
        const a=Math.max(0,Math.min(1,p.y/H));
        ctx.fillStyle=`hsla(${p.hue},95%,60%,${0.5*a+0.1})`;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();
      }else if(p.kind==='star'){
        const tw=0.4+0.6*Math.abs(Math.sin(time*1.5+p.ph));
        ctx.fillStyle=`rgba(220,235,255,${0.5*tw})`;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();
      }else if(p.kind==='bokeh'){
        const a=0.06+0.05*Math.sin(time*0.7+p.ph);
        ctx.fillStyle=`rgba(255,200,120,${a})`;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();
      }else if(p.kind==='streak'){
        p.x+=p.v*dt;if(p.x>W+p.l)p.x=-p.l;
        ctx.strokeStyle='rgba(180,220,200,.15)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+p.l,p.y+Math.sin(p.x*0.01)*4);ctx.stroke();
      }else if(p.kind==='grain'){
        const a=0.1+0.1*Math.sin(time*3+p.ph);
        ctx.fillStyle=`rgba(200,200,210,${a})`;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,7);ctx.fill();
      }
    }
  }
  return {
    setActive(ids){
      const next=new Set(ids);
      const changed=next.size!==active.size||[...next].some(x=>!active.has(x));
      active=next;
      if(changed){resize();seed();}
    },
    start(){if(running)return;running=true;resize();seed();last=0;raf=requestAnimationFrame(frame);},
    stop(){running=false;cancelAnimationFrame(raf);ctx.clearRect(0,0,W,H);},
    resize
  };
}