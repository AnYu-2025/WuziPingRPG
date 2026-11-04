importScripts('worker-output.js');
function format(value){try{return typeof value==='string'?value:(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v)??String(value));}catch(e){return String(value);}}
function log(type,args){emit(type,args.map(format).join(' ')+'\n');}
self.console={log:(...args)=>log('stdout',args),info:(...args)=>log('stdout',args),warn:(...args)=>log('stderr',args),error:(...args)=>log('stderr',args)};
self.onmessage=async({data})=>{postMessage({type:'started'});try{const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;await new AsyncFunction(data.code+'\n//# sourceURL='+encodeURI(data.path))();flushOutput();postMessage({type:'done',ok:true});}catch(e){log('stderr',[String(e.stack||e)]);flushOutput();postMessage({type:'done',ok:false});}};
