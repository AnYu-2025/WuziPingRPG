import {build} from 'esbuild';
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const out='../src/main/assets/studio';
await mkdir(out,{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,outfile:out+'/app.js',format:'iife',target:['chrome64'],minify:true,legalComments:'eof'});
for(const file of ['index.html','meteor-sky.webp','sky-ripple.js','boot.js','style.css','lecture.css','tts.css','ai.css','model.css','shell.css','python-worker.js','cpp-worker.js','javascript-worker.js','worker-output.js'])await copyFile('src/'+file,out+'/'+file);
/* C/C++ 离线编译工具链（Clang 22 WASM）：IIFE 入口 + 运行时资源。
   注意：AGP 的 mergeAssets 会把 .gz 资源自动解压并去掉 .gz 后缀，
   所以这里直接发布解压后的文件（加载器对非 gzip 内容原样放行，SHA-256 校验仍生效）。
   objective-c/ 不需要（只提供 C/C++），不复制。 */
await mkdir(out+'/clang/bin',{recursive:true});
await copyFile('node_modules/@live-codes/clang-wasm/dist/clang-wasm-toolchain.global.js',out+'/clang/clang-wasm-toolchain.global.js');
/* 资源发布为 .bin：一是躲开 AGP 对 .gz 的自动解压，二是躲开 noCompress 'wasm'
   规则让 88 MB 工具链参与 APK deflate 压缩。加载器按清单取 URL、按字节读取，
   扩展名不影响功能；SHA-256 校验仍对内容生效。 */
const manifest=JSON.parse(await readFile('node_modules/@live-codes/clang-wasm/assets/runtime-manifest.v1.json','utf8'));
for(const key of ['memfs','clang','lld','sysroot'])manifest.compiler[key].asset='bin/'+key+'.bin';
await writeFile(out+'/clang/runtime-manifest.v1.json',JSON.stringify(manifest,null,2));
for(const [src,name] of [['memfs.wasm','memfs.bin'],['clang.wasm','clang.bin'],['lld.wasm','lld.bin'],['sysroot.tar','sysroot.bin']]){
  const bytes=gunzipSync(await readFile('node_modules/@live-codes/clang-wasm/assets/bin/'+src+'.gz'));
  await writeFile(out+'/clang/bin/'+name,bytes);
}
await copyFile('node_modules/@live-codes/clang-wasm/THIRD-PARTY-NOTICES.md',out+'/clang/THIRD-PARTY-NOTICES.md');
await mkdir(out+'/licenses',{recursive:true});
const packages=[];
for(const name of await readdir('node_modules')){if(name.startsWith('@'))for(const child of await readdir('node_modules/'+name))packages.push(name+'/'+child);else if(!name.startsWith('.'))packages.push(name);}
for(const name of packages){try{const base='node_modules/'+name,pkg=JSON.parse(await readFile(base+'/package.json','utf8'));const files=(await readdir(base)).filter(f=>/^licen[sc]e(?:[.-]|$)/i.test(f));for(const file of files){const text=await readFile(base+'/'+file,'utf8');await writeFile(out+'/licenses/'+name.replace(/[^a-z0-9-]/gi,'_')+'-LICENSE.txt',`${pkg.name} ${pkg.version}\n\n${text}`);}}catch(e){/* Platform-specific optional build helpers need not be present. */}}
console.log('Bundled offline editor to '+out);
