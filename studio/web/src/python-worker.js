/* A fresh worker for each run prevents stale modules and makes Stop unconditional. */
importScripts('worker-output.js');
const valid=p=>typeof p==='string'&&p.length<=200&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!/[\x00-\x1f\\:*?"<>|]/.test(p);
self.onmessage=async({data})=>{
 try{
  importScripts('runtime/pyodide.js');
  const runtime=await loadPyodide({indexURL:new URL('runtime/',self.location.href).href});
  const stdin=(data.stdin||'').split('\n');if(stdin[stdin.length-1]==='')stdin.pop();let inputIndex=0;
  runtime.setStdin({stdin:()=>inputIndex<stdin.length?stdin[inputIndex++]:null});
  const stdout=new TextDecoder(),stderr=new TextDecoder();
  runtime.setStdout({write(buffer){emit('stdout',stdout.decode(buffer,{stream:true}));return buffer.length;}});
  runtime.setStderr({write(buffer){emit('stderr',stderr.decode(buffer,{stream:true}));return buffer.length;}});
  runtime.FS.mkdirTree('/workspace');
  for(const file of data.files||[])if(valid(file.path)&&typeof file.text==='string'){const path='/workspace/'+file.path;runtime.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));runtime.FS.writeFile(path,file.text,{encoding:'utf8'});}
  runtime.globals.set('_studio_path','/workspace/'+data.path);runtime.globals.set('_studio_source',data.code);
  postMessage({type:'started'});
  await runtime.runPythonAsync(`import sys, os, traceback, linecache
os.chdir(os.path.dirname(_studio_path))
sys.path.insert(0, '/workspace')
sys.path.insert(0, os.path.dirname(_studio_path))
sys.argv = [_studio_path]
linecache.cache[_studio_path] = (len(_studio_source), None, _studio_source.splitlines(True), _studio_path)
_studio_ok = True
try:
    exec(compile(_studio_source, _studio_path, 'exec'), {'__name__': '__main__', '__file__': _studio_path})
except SystemExit as error:
    _studio_ok = error.code is None or error.code == 0
    if not _studio_ok: print('SystemExit:', error.code, file=sys.stderr)
except BaseException as error:
    _studio_ok = False
    traceback.print_exception(type(error), error, error.__traceback__.tb_next)
`);
  const files=[];let total=0;
  function scan(dir,depth=0){if(depth>12)return;for(const name of runtime.FS.readdir(dir)){if(name==='.'||name==='..'||name==='__pycache__')continue;const path=dir+'/'+name,stat=runtime.FS.stat(path);if(runtime.FS.isDir(stat.mode))scan(path,depth+1);else if(files.length<160&&stat.size<=2*1024*1024&&total+stat.size<12*1024*1024){const bytes=runtime.FS.readFile(path);if(bytes.includes(0))continue;try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),relative=path.slice(11);if(valid(relative)){files.push({path:relative,text});total+=stat.size;}}catch(e){}}}}
  scan('/workspace');emit('stdout',stdout.decode());emit('stderr',stderr.decode());flushOutput();postMessage({type:'done',ok:!!runtime.globals.get('_studio_ok'),files});
 }catch(error){emit('stderr',String(error));flushOutput();postMessage({type:'done',ok:false});}
};
