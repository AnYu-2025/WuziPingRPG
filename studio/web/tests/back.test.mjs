import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {BACK,resolveBack} from '../src/back.js';

const base={
  dialogOpen:false,
  drawerOpen:false,
  drawing:false,
  searchOpen:false,
  homeOpen:false,
  loungeOpen:false
};

test('dialog has priority over every other layer',()=>{
  assert.equal(resolveBack({...base,dialogOpen:true,drawerOpen:true,drawing:true,searchOpen:true,homeOpen:true,loungeOpen:true}).action,BACK.DIALOG);
});

test('drawer has priority over draw, search and home',()=>{
  assert.equal(resolveBack({...base,drawerOpen:true,drawing:true,searchOpen:true,homeOpen:true}).action,BACK.DRAWER);
});

test('drawing has priority over search and home',()=>{
  assert.equal(resolveBack({...base,drawing:true,searchOpen:true,homeOpen:true}).action,BACK.DRAW);
});

test('search has priority over home',()=>{
  assert.equal(resolveBack({...base,searchOpen:true,homeOpen:true}).action,BACK.SEARCH);
});

test('home screen asks for exit instead of being collapsed',()=>{
  assert.equal(resolveBack({...base,homeOpen:true}).action,BACK.HOME);
});

test('game lobby returns to the editor before the home screen',()=>{
  assert.equal(resolveBack({...base,loungeOpen:true}).action,BACK.LOUNGE);
});

test('editor opens the home screen',()=>{
  assert.equal(resolveBack({...base}).action,BACK.OPEN);
});

test('missing or undefined context fields do not throw',()=>{
  assert.doesNotThrow(()=>resolveBack());
  assert.doesNotThrow(()=>resolveBack({dialogOpen:undefined,drawerOpen:null,drawing:undefined,searchOpen:null,homeOpen:undefined,loungeOpen:null}));
  assert.equal(resolveBack().action,BACK.OPEN);
});

/* 回归防线：宿主只能有一个返回键入口。
   0.1.21 之前 EditorActivity.onBackPressed 里内联了一串 evaluateJavascript
   自己判断弹窗/抽屉/游戏大厅，页面这套 window.Studio.back() 只有测试在调，
   结果真机上画板收尾、搜索关闭、逐层返回全失效而测试全绿。 */
test('native back delegates to window.Studio.back',()=>{
  const file=new URL('../../src/main/java/cn/wuziping/studio/EditorActivity.java',import.meta.url);
  if(!fs.existsSync(file))return;      // 只跑 Web 子包时跳过
  const source=fs.readFileSync(file,'utf8');
  const start=source.indexOf('public void onBackPressed');
  assert.ok(start>0,'onBackPressed must exist');
  const body=source.slice(start,source.indexOf('private void confirmRecordingExit',start));
  assert.match(body,/window\.Studio\.back/, 'back must be handled by the page');
  assert.doesNotMatch(body,/dialog\[open\]/,'host must not re-implement dialog handling');
  assert.doesNotMatch(body,/classList\.contains\('drawer'\)/,'host must not re-implement drawer handling');
});
