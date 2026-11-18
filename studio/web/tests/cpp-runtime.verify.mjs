/* 手动验证脚本（不进 npm test）：真实编译运行 C++ 与多文件项目。
   与 cpp-worker.js 相同：走 createToolchain + runtime.compileArtifact，
   高层 createCompiler 不透传 workspaceFiles，多文件项目必须用底层接口。
   运行：node tests/cpp-runtime.verify.mjs */
import {createCompiler} from '@live-codes/clang-wasm';
import {createToolchain} from '@live-codes/clang-wasm/toolchain';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createDeskDraft,cppRunScope} from '../src/desk-code.js';

const compiler=await createCompiler('cpp');

/* 1. 中文输出 + stdin + 循环 */
const code=`#include <iostream>
#include <string>
int main(){
    std::string name;
    std::getline(std::cin,name);
    std::cout << "你好，" << name << "！\\n";
    int sum=0;
    for(int i=1;i<=100;++i) sum+=i;
    std::cout << "sum=" << sum << std::endl;
    return 0;
}`;
const r=await compiler.run(code,'伍子平\n');
assert.deepEqual(r.errors,[]);
assert.equal(r.exitCode,0);
assert.ok(r.output.includes('你好，伍子平！'),r.output);
assert.ok(r.output.includes('sum=5050'),r.output);
console.log('✓ 单文件编译运行 + stdin + 中文输出');

/* 2. 编译错误要有诊断 */
const bad=await compiler.run('int main(){ undefined_symbol(); }');
assert.equal(bad.exitCode,null);
assert.ok(bad.errors.some(l=>l.includes('use of undeclared identifier')));
console.log('✓ 编译错误诊断');

/* 3. 多文件项目：头文件 + 两个翻译单元（cpp-worker 同款底层调用） */
const chain=await createToolchain({});
const mainCode='#include "geometry.h"\n#include <iostream>\nint main(){ std::cout << area(3,4) << std::endl; }';
const workspaceFiles=[
  {path:'main.cpp',content:mainCode},
  {path:'geometry.h',content:'#pragma once\nint area(int w,int h);'},
  {path:'geometry.cpp',content:'#include "geometry.h"\nint area(int w,int h){return w*h;}'}
];
const built=await chain.lock(()=>chain.captureCompilerOutput(()=>chain.runtime.compileArtifact(mainCode,{
  language:'CPP',fileName:'main.cpp',activePath:'main.cpp',workspaceFiles,
  compileArgs:['-fgnuc-version=4.2.1','-std=gnu++23','-O2','-ferror-limit','20']
})));
assert.equal(built.error,null,built.raw);
const multi=await chain.execute(built.result,{args:[],stdin:()=>null,stdout:()=>{},stderr:()=>{},files:workspaceFiles.map(f=>({path:f.path,contents:f.content}))});
assert.equal(multi.exitCode,0);
assert.ok(multi.stdout.includes('12'),multi.stdout);
console.log('✓ 多文件项目（头文件 + 多翻译单元链接）');

/* 4. C 语言 */
const cCompiler=await createCompiler('c');
const c=await cCompiler.run('#include <stdio.h>\nint main(){printf("c-ok %d\\n",42);return 0;}');
assert.deepEqual(c.errors,[]);
assert.ok(c.output.includes('c-ok 42'));
console.log('✓ C 语言编译运行');

/* 5. 程序写文件（工作区回写的数据来源） */
const fw=await compiler.run('#include <cstdio>\nint main(){FILE*f=fopen("out.txt","w");fputs("written",f);fclose(f);return 0;}');
assert.deepEqual(fw.errors,[]);
assert.equal(fw.exitCode,0);
console.log('✓ 程序写文件');

/* Exercise the actual browser worker handler; reuse the local WASM compiler for its importScripts transport. */
const messages=[];
const context=vm.createContext({
  self:{location:{href:'https://localhost/studio/cpp-worker.js'},clangWasmToolchain:{createToolchain:async()=>chain}},
  URL,performance,TextDecoder,Uint8Array,Map,setTimeout,clearTimeout,
  postMessage:message=>messages.push(message),
  importScripts(name){
    if(name==='worker-output.js') vm.runInContext(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),context);
    else assert.equal(name,'clang/clang-wasm-toolchain.global.js');
  }
});
vm.runInContext(readFileSync(new URL('../src/cpp-worker.js',import.meta.url),'utf8'),context);
const flat=workspaceFiles.map(f=>({path:f.path,text:f.content}));
const entry=createDeskDraft(flat,'cpp');
entry.text='#include "helper.h"\n#include <cstdio>\nint main(){int n=0;FILE* f=fopen("input.txt","r");if(!f)return 1;fscanf(f,"%d",&n);fclose(f);printf("%d",twice(n));f=fopen("result.txt","w");if(!f)return 2;fputs("ready",f);fclose(f);}';
const second=createDeskDraft([...flat,entry],'cpp');
const all=[...flat,entry,second,{path:entry.deskProject+'/input.txt',text:'8'},
  {path:entry.deskProject+'/helper.cpp',text:'int twice(int n){return 2*n;}'},
  {path:entry.deskProject+'/helper.h',text:'int twice(int);'}];
for(const [file,expected] of [[flat[0],'12'],[entry,'16'],[second,'你好，C++！']]){
  messages.length=0;
  const scope=cppRunScope(all,file.path);
  await context.self.onmessage({data:{path:file.path,code:file.text,projectRoot:scope.root,files:scope.files}});
  const output=messages.filter(m=>m.type==='stdout'||m.type==='stderr').map(m=>m.text).join('');
  const done=messages.find(m=>m.type==='done');
  assert.ok(done?.ok,output);
  assert.ok(output.includes(expected),output);
  if(file===entry)assert.ok(done.files.some(f=>f.path===entry.deskProject+'/result.txt'&&f.text==='ready'));
}
console.log('✓ 两个新建 C++ 项目与旧多文件项目独立运行，项目内相对读写正常');

compiler.dispose();cCompiler.dispose();chain.dispose();
console.log('全部通过');
