/* C/C++ 运行线程：与 python-worker 同一套消息协议，共用工作区与终端。
   每次运行新建 worker，「停止」直接 terminate，和 Python 的行为一致。
   编译器是 Clang 22 的 WebAssembly 版（@live-codes/clang-wasm），资源全部本地加载：
   首次运行读取约 28 MB 的本地工具链，之后同一页面内多次运行走内存缓存。
   多文件项目：工作区里的 .c/.cc/.cpp/.cxx 会一起编译链接，头文件随处可 include。 */
importScripts('worker-output.js');
const valid=p=>typeof p==='string'&&p.length<=200&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!/[\x00-\x1f\\:*?"<>|]/.test(p);
const SOURCE=/\.(c|cc|cpp|cxx)$/i;
let toolchain=null,toolchainLoading=null;

async function ensureToolchain(){
  if(toolchain)return toolchain;
  if(!toolchainLoading){
    toolchainLoading=(async()=>{
      importScripts('clang/clang-wasm-toolchain.global.js');
      const made=await self.clangWasmToolchain.createToolchain({
        baseUrl:new URL('clang/',self.location.href).href,
        onProgress:value=>postMessage({type:'progress',value:Math.max(0,Math.min(1,Number(value)||0))})
      });
      toolchain=made;return made;
    })().catch(error=>{toolchainLoading=null;throw error;});
  }
  return toolchainLoading;
}

/* clang 的原始输出混着 ANSI 颜色与运行时日志，只留诊断行给用户。 */
function diagnostics(raw){
  const strip=String(raw||'').replace(/\u001b\[[0-9;]*[A-Za-z]/g,'');
  return strip.split(/\r?\n/).map(line=>line.replace(/\s+$/,'')).filter(line=>line&&!/^\s*>|^\s*done\.?\s*$/.test(line));
}

self.onmessage=async({data})=>{
  try{
    const files=(data.files||[]).filter(f=>valid(f.path)&&typeof f.text==='string');
    const isC=/\.c$/i.test(data.path);
    const language=isC?'C':'CPP';
    const std=isC?'gnu23':'gnu++23';
    postMessage({type:'loading'});
    const chain=await ensureToolchain();
    const workspaceFiles=files.map(f=>({path:f.path,content:f.text}));
    const compileStarted=performance.now();
    const built=await chain.lock(()=>chain.captureCompilerOutput(()=>chain.runtime.compileArtifact(data.code,{
      language,
      fileName:data.path,
      activePath:data.path,
      workspaceFiles,
      compileArgs:['-fgnuc-version=4.2.1','-std='+std,'-O2','-ferror-limit','20']
    })));
    const compileMs=Math.round(performance.now()-compileStarted);
    if(built.error){
      const lines=diagnostics(built.raw);
      emit('stderr',(lines.length?lines.join('\n'):String(built.error&&built.error.message||built.error))+'\n');
      flushOutput();postMessage({type:'done',ok:false,compileMs});return;
    }
    emit('stdout','[编译完成 '+(compileMs/1000).toFixed(2)+'s · Clang 22 · '+std+']\n');
    postMessage({type:'started',compileMs});
    const stdinLines=String(data.stdin||'').split('\n');
    if(stdinLines[stdinLines.length-1]==='')stdinLines.pop();
    let inputIndex=0;
    const runStarted=performance.now();
    let host=null;
    const result=await chain.execute(built.result,{
      args:[],
      programName:data.path,
      stdin:()=>inputIndex<stdinLines.length?stdinLines[inputIndex++]+'\n':null,
      stdout:chunk=>emit('stdout',chunk),
      stderr:chunk=>emit('stderr',chunk),
      files:files.map(f=>({path:f.path,contents:f.text})),
      /* execute 不直接返回文件系统；extraImports 是文档化的扩展点，
         在这里拿到 host 引用，运行结束后读程序写出的文件。 */
      extraImports:context=>{host=context.host;return {};}
    });
    const runMs=Math.round(performance.now()-runStarted);
    flushOutput();
    if(result.exitCode!==0)emit('stderr','[程序退出码 '+result.exitCode+']\n');
    /* 程序写出的文本文件回写工作区，和 Python 的 applyRunFiles 一致。 */
    const outFiles=[];let total=0;
    if(host&&host.rootDirectory){
      const walk=(dir,prefix,depth)=>{
        if(depth>12||outFiles.length>=160)return;
        for(const [name,node] of dir.contents||[]){
          if(name==='.'||name==='..'||name==='tmp')continue;
          const path=prefix?prefix+'/'+name:name;
          if(node&&node.contents instanceof Map)walk(node,path,depth+1);
          else if(node&&node.data){
            const bytes=node.data instanceof Uint8Array?node.data:new Uint8Array(node.data);
            if(bytes.length>2*1024*1024||total+bytes.length>12*1024*1024||bytes.includes(0))continue;
            try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(valid(path)&&!files.some(f=>f.path===path&&f.text===text)){outFiles.push({path,text});total+=bytes.length;}}catch(e){}
          }
        }
      };
      walk(host.rootDirectory,'',0);
    }
    flushOutput();
    postMessage({type:'done',ok:result.exitCode===0,files:outFiles,compileMs,runMs,exitCode:result.exitCode});
  }catch(error){
    emit('stderr',String(error&&error.message||error)+'\n');
    flushOutput();postMessage({type:'done',ok:false});
  }
};