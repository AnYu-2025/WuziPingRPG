/* 把 ../../photo（浮生图梦）打包成天工里的离线修图页。
 *
 * 页面逻辑原样复用桌面版 apps/desktop/src/renderer/app.ts；只换外壳：
 *   - apps/mobile/index.html  同一套元素 id，加了手机顶栏与分区面板
 *   - apps/mobile/mobile-shell.js  实现 window.photoShell（ShellBridge 契约）
 *   - apps/mobile/mobile.css  叠在桌面 styles.css 上的手机布局
 * 桌面版靠 import map 和 app:// 协议解析 @photo/core、@photo/io；这里在打包时直接指到源码。
 * Worker 打成 worker/render-worker.js，与 app.js 同目录相对路径（worker-port.ts 用 import.meta.url 定位）。
 */
import {build} from 'esbuild';
import {mkdir,copyFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const photo=path.resolve(here,'../../photo');
const desktop=path.join(photo,'apps/desktop');
const mobile=path.join(photo,'apps/mobile');
const out=path.resolve(here,'../src/main/assets/photo');
const targets={
  '@photo/core':path.join(photo,'packages/core/src/index.ts'),
  '@photo/io':path.join(photo,'packages/io/src/index.ts'),
  'app://core/index.js':path.join(photo,'packages/core/src/index.ts'),
  'app://io/index.js':path.join(photo,'packages/io/src/index.ts')
};
const photoPackages={
  name:'photo-packages',
  setup(b){
    b.onResolve({filter:/^(@photo\/(core|io)|app:\/\/(core|io)\/index\.js)$/},args=>({path:targets[args.path]}));
  }
};
const common={bundle:true,format:'esm',target:['chrome89'],minify:true,legalComments:'eof',plugins:[photoPackages],logLevel:'warning'};

await rm(out,{recursive:true,force:true});
await mkdir(path.join(out,'worker'),{recursive:true});
await build({...common,entryPoints:[path.join(desktop,'src/renderer/app.ts')],outfile:path.join(out,'app.js')});
await build({...common,entryPoints:[path.join(desktop,'src/worker/render-worker.ts')],outfile:path.join(out,'worker/render-worker.js')});
await copyFile(path.join(desktop,'styles.css'),path.join(out,'styles.css'));
for(const file of ['index.html','mobile.css','mobile-shell.js'])await copyFile(path.join(mobile,file),path.join(out,file));
console.log('Bundled 浮生图梦 mobile page to '+path.relative(here,out));
