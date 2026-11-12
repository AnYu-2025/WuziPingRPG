/* 手动验证脚本（不进 npm test）：真实编译运行 C++ 与多文件项目。
   与 cpp-worker.js 相同：走 createToolchain + runtime.compileArtifact，
   高层 createCompiler 不透传 workspaceFiles，多文件项目必须用底层接口。
   运行：node tests/cpp-runtime.verify.mjs */
import {createCompiler} from '@live-codes/clang-wasm';
import {createToolchain} from '@live-codes/clang-wasm/toolchain';
import assert from 'node:assert/strict';

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

compiler.dispose();cCompiler.dispose();chain.dispose();
console.log('全部通过');