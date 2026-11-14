import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKUP_VERSION,buildBackup,parseBackup,backupSummary} from '../src/backup.js';

const snap=()=>({version:1,files:[{path:'a.py',text:'x'}],cards:{items:[{id:1}]},habits:{habits:[{id:1}]},exams:{exams:[]},schedule:{courses:[{id:1}]}});

test('buildBackup wraps snapshot and extras',()=>{
  const b=buildBackup(snap(),{novels:{'ember-novel-text-1':'body'},medquizCustom:[{q:'x',options:['a','b'],answer:0}]},123);
  assert.equal(b.app,'tiangong-studio');
  assert.equal(b.version,BACKUP_VERSION);
  assert.equal(b.exportedAt,123);
  assert.equal(b.novels['ember-novel-text-1'],'body');
});

test('parseBackup accepts valid string and object',()=>{
  const b=buildBackup(snap(),{novels:{},medquizCustom:[]},1);
  const p1=parseBackup(JSON.stringify(b));
  const p2=parseBackup(b);
  assert.ok(p1&&p2);
  assert.equal(p1.snapshot.files.length,1);
});

test('parseBackup rejects wrong app/version/snapshot',()=>{
  assert.equal(parseBackup('not json'),null);
  assert.equal(parseBackup({app:'other',version:1,snapshot:snap()}),null);
  assert.equal(parseBackup({app:'tiangong-studio',version:99,snapshot:snap()}),null);
  assert.equal(parseBackup({app:'tiangong-studio',version:1,snapshot:{version:1,files:[]}}),null);
  assert.equal(parseBackup(null),null);
});

test('parseBackup filters invalid custom questions and novels',()=>{
  const b=buildBackup(snap(),{novels:{ok:'text',bad:123},medquizCustom:[{q:'good',options:['a','b'],answer:0},{q:'noopts'},{notq:1}]},1);
  const p=parseBackup(b);
  assert.equal(Object.keys(p.novels).length,1);
  assert.equal(p.medquizCustom.length,1);
});

test('backupSummary counts records',()=>{
  const p=parseBackup(buildBackup(snap(),{novels:{a:'x',b:'y'},medquizCustom:[{q:'q',options:['a','b'],answer:0}]},1));
  const s=backupSummary(p);
  assert.equal(s.files,1);
  assert.equal(s.cards,1);
  assert.equal(s.habits,1);
  assert.equal(s.courses,1);
  assert.equal(s.novels,2);
  assert.equal(s.customQuiz,1);
  assert.equal(backupSummary(null),null);
});