/* 天工 · 报错定位解析（纯函数，不依赖 DOM，方便单元测试）
 * 把编译器/解释器输出里的「文件:行:列」抽出来，供终端点击跳转。
 * 覆盖三种常见格式：
 *   C/C++ (clang)：  main.cpp:12:5: error: ...
 *   Python：         File "main.py", line 12
 *                    File "/workspace/sub/x.py", line 3, in <module>
 *   Node/JS：        at /workspace/app.js:12:5   或   app.js:12
 */

/* 只认工作区内的普通源码路径，挡掉 URL、系统头文件、伪文件名。 */
function cleanPath(raw){
  if(typeof raw!=='string')return null;
  let p=raw.trim();
  if(!p)return null;
  p=p.replace(/^\/workspace\//,'').replace(/^\.\//,'');
  if(p.startsWith('/'))return null;             // 绝对路径（系统头文件等）不跳
  if(/^[a-zA-Z]:[\\/]/.test(p))return null;     // Windows 盘符
  if(p.includes('://'))return null;             // URL
  if(p.includes('<'))return null;               // <stdin> / <string> 等伪文件名
  if(p.length>200)return null;
  if(!/\.(c|cc|cpp|cxx|h|hpp|py|js|mjs|ts)$/i.test(p))return null;
  if(/[\\:*?"<>|\x00-\x1f]/.test(p))return null;
  return p;
}

/* 从一行文本里解析出 {path,line,column}；没有则 null。 */
export function parseErrorLocation(line){
  if(typeof line!=='string'||!line)return null;
  let m;
  /* clang：file:line:col: error/warning/note */
  m=/([^\s:]+\.(?:c|cc|cpp|cxx|h|hpp)):(\d+):(\d+):/i.exec(line);
  if(m){
    const path=cleanPath(m[1]);
    if(path)return {path,line:Math.max(1,+m[2]),column:Math.max(1,+m[3])};
  }
  /* Python：File "path", line N */
  m=/File "([^"]+)", line (\d+)/.exec(line);
  if(m){
    const path=cleanPath(m[1]);
    if(path)return {path,line:Math.max(1,+m[2]),column:1};
  }
  /* Node：at .../file.js:line:col  或裸 file.js:line:col */
  m=/(?:at\s+)?(?:.*[\\/])?([^\s\\/]+\.(?:js|mjs|ts)):(\d+)(?::(\d+))?/.exec(line);
  if(m){
    const path=cleanPath(m[1]);
    if(path)return {path,line:Math.max(1,+m[2]),column:m[3]?Math.max(1,+m[3]):1};
  }
  return null;
}

/* 从整段输出里挑第一个 error 行定位（没有 error 就取第一个可定位行）。 */
export function firstErrorLocation(text){
  if(typeof text!=='string'||!text)return null;
  const lines=text.split(/\r?\n/);
  let fallback=null;
  for(const line of lines){
    const loc=parseErrorLocation(line);
    if(!loc)continue;
    if(/\berror\b|Error|错误/i.test(line))return loc;
    if(!fallback)fallback=loc;
  }
  return fallback;
}

/* 把一段文本按行切开，标注每行是否可跳转，供终端渲染成可点击 span。
 * 返回 [{text,loc|null}]，保留换行；loc 非空的片段点击跳转到对应文件行。 */
export function splitLocations(text){
  if(typeof text!=='string'||!text)return [];
  const lines=String(text).split('\n');
  const out=[];
  lines.forEach((line,i)=>{
    const tail=i<lines.length-1?'\n':'';
    const loc=parseErrorLocation(line);
    out.push({text:line+tail,loc});
  });
  return out;
}