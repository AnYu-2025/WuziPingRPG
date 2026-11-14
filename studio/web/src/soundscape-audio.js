/* 天工 · 潮声白噪音景 · WebAudio 程序合成引擎
 * 全部声音由噪声缓冲 + 滤波 + LFO + 随机事件实时合成，不加载任何音频文件。
 * 仅在用户手势后创建 AudioContext；不可用时返回 false 由主逻辑降级。 */

export function createSoundscapeAudio(){
  let ctx=null,master=null,fade=null,started=false;
  const nodes={};      // id -> {gain, srcs:[], lfos:[], stop()}
  const sched={};      // id -> nextEventTime
  let tickTimer=0;
  let masterVol=.8,fadeVol=1;

  function ensure(){
    if(ctx)return true;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC)return false;
    try{ctx=new AC();}catch(e){return false;}
    master=ctx.createGain();master.gain.value=masterVol*fadeVol;
    fade=ctx.createGain();fade.gain.value=1;
    master.connect(fade);fade.connect(ctx.destination);
    return true;
  }
  function resume(){if(ctx&&ctx.state==='suspended')ctx.resume();}

  function noiseBuffer(type){
    const len=ctx.sampleRate*3;
    const buf=ctx.createBuffer(1,len,ctx.sampleRate);
    const d=buf.getChannelData(0);
    let last=0;
    for(let i=0;i<len;i++){
      const w=Math.random()*2-1;
      if(type==='brown'){last=(last+0.02*w)/1.02;d[i]=last*3.5;}
      else if(type==='pink'){last=(last+0.05*w)/1.05;d[i]=(last*2+w*0.3)*0.6;}
      else d[i]=w;
    }
    return buf;
  }
  const buffers={};
  function buf(type){if(!buffers[type])buffers[type]=noiseBuffer(type);return buffers[type];}

  function loopSource(type){
    const s=ctx.createBufferSource();s.buffer=buf(type);s.loop=true;s.start();
    return s;
  }
  function layerGain(id,vol){
    const g=ctx.createGain();g.gain.value=vol;g.connect(master);
    return g;
  }

  /* 各层合成图。返回 {gain,srcs,lfos,extra}。 */
  function build(id,vol){
    const g=layerGain(id,vol);
    const srcs=[],lfos=[];
    const add=(n)=>{srcs.push(n);return n;};
    if(id==='white'){
      add(loopSource('white')).connect(g);
    }else if(id==='brown'){
      const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=400;
      add(loopSource('brown')).connect(lp);lp.connect(g);
    }else if(id==='rain'){
      const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=900;
      const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=7000;
      add(loopSource('white')).connect(hp);hp.connect(lp);lp.connect(g);
    }else if(id==='wind'){
      const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=420;bp.Q.value=1.1;
      add(loopSource('brown')).connect(bp);bp.connect(g);
      const lfo=ctx.createOscillator();lfo.frequency.value=0.07;
      const lg=ctx.createGain();lg.gain.value=220;
      lfo.connect(lg);lg.connect(bp.frequency);lfo.start();lfos.push(lfo);
    }else if(id==='waves'){
      const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=600;
      const swell=ctx.createGain();swell.gain.value=vol*0.5;
      add(loopSource('brown')).connect(lp);lp.connect(swell);swell.connect(g);
      const lfo=ctx.createOscillator();lfo.frequency.value=0.09;
      const lg=ctx.createGain();lg.gain.value=vol*0.45;
      lfo.connect(lg);lg.connect(swell.gain);lfo.start();lfos.push(lfo);
      g.gain.value=1; // swell 已含音量
    }else if(id==='fire'){
      const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=900;
      const base=ctx.createGain();base.gain.value=0.5;
      add(loopSource('brown')).connect(lp);lp.connect(base);base.connect(g);
    }else if(id==='night'){
      g.gain.value=vol; // 事件型，gain 作总线
    }else if(id==='cafe'){
      const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=520;bp.Q.value=0.8;
      const am=ctx.createGain();am.gain.value=0.7;
      add(loopSource('pink')).connect(bp);bp.connect(am);am.connect(g);
      const lfo=ctx.createOscillator();lfo.frequency.value=0.31;
      const lg=ctx.createGain();lg.gain.value=0.25;
      lfo.connect(lg);lg.connect(am.gain);lfo.start();lfos.push(lfo);
    }else if(id==='thunder'){
      g.gain.value=vol; // 事件型
    }
    return {gain:g,srcs,lfos};
  }

  /* 随机事件：fire 噼啪 / night 虫鸣 / thunder 远雷。 */
  function scheduleEvents(now){
    for(const id of ['fire','night','thunder']){
      const n=nodes[id];if(!n)continue;
      if(sched[id]==null)sched[id]=now+Math.random()*0.5;
      while(sched[id]<now+0.3){
        const t=sched[id];
        if(id==='fire')crackle(t,n.gain);
        else if(id==='night')chirp(t,n.gain);
        else thunder(t,n.gain);
        sched[id]=t+(id==='fire'?0.05+Math.random()*0.35:id==='night'?0.4+Math.random()*1.6:8+Math.random()*14);
      }
    }
  }
  function crackle(t,dest){
    const s=ctx.createBufferSource();s.buffer=buf('white');
    const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=1500+Math.random()*2500;bp.Q.value=2;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.5+Math.random()*0.5,t+0.005);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.03+Math.random()*0.06);
    s.connect(bp);bp.connect(g);g.connect(dest);
    s.start(t);s.stop(t+0.15);
  }
  function chirp(t,dest){
    const f=3800+Math.random()*900;
    const pulses=3+Math.floor(Math.random()*4);
    for(let i=0;i<pulses;i++){
      const o=ctx.createOscillator();o.type='sine';o.frequency.value=f;
      const g=ctx.createGain();
      const st=t+i*0.07;
      g.gain.setValueAtTime(0.0001,st);
      g.gain.exponentialRampToValueAtTime(0.25,st+0.01);
      g.gain.exponentialRampToValueAtTime(0.0001,st+0.045);
      o.connect(g);g.connect(dest);
      o.start(st);o.stop(st+0.06);
    }
  }
  function thunder(t,dest){
    const s=ctx.createBufferSource();s.buffer=buf('brown');s.loop=true;
    const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=140;
    const g=ctx.createGain();
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(0.9,t+0.06);
    g.gain.exponentialRampToValueAtTime(0.0001,t+2.5+Math.random()*2);
    s.connect(lp);lp.connect(g);g.connect(dest);
    s.start(t);s.stop(t+5);
  }

  function tick(){
    if(!ctx)return;
    scheduleEvents(ctx.currentTime);
  }

  return {
    ensure,
    resume,
    isRunning(){return started;},
    startLayer(id,vol){
      if(!ensure())return false;
      resume();
      if(nodes[id])this.setLayerVol(id,vol);
      else{nodes[id]=build(id,vol);sched[id]=null;}
      if(!started){started=true;tickTimer=setInterval(tick,200);}
      return true;
    },
    stopLayer(id){
      const n=nodes[id];if(!n)return;
      try{n.srcs.forEach(s=>s.stop());n.lfos.forEach(l=>l.stop());}catch(e){}
      try{n.gain.disconnect();}catch(e){}
      delete nodes[id];delete sched[id];
      if(started&&Object.keys(nodes).length===0){started=false;clearInterval(tickTimer);}
    },
    setLayerVol(id,v){
      const n=nodes[id];if(!n)return;
      if(id==='waves')return; // swell 自带
      n.gain.gain.setTargetAtTime(v,ctx.currentTime,0.05);
    },
    setMaster(v){masterVol=v;if(master)master.gain.setTargetAtTime(masterVol*fadeVol,ctx.currentTime,0.05);},
    setFade(f){fadeVol=f;if(master)master.gain.setTargetAtTime(masterVol*fadeVol,ctx.currentTime,0.1);},
    stopAll(){
      for(const id of Object.keys(nodes))this.stopLayer(id);
      started=false;clearInterval(tickTimer);
    },
    dispose(){this.stopAll();if(ctx){try{ctx.close();}catch(e){}ctx=null;}}
  };
}