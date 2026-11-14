import test from 'node:test';
import assert from 'node:assert/strict';
import {detectDelimiter,parseDelimited,parseCards,importCards,parseMistakes,importMistakes,csvCell,toCSV,exportCards,exportMistakes,updateCard,importSummary,CARD_HEADERS,MISTAKE_HEADERS} from '../src/transfer.js';
import {deckSanitize,addCard,reviewCard} from '../src/cards.js';
import {bookSanitize,addMistake} from '../src/mistakes.js';

const NOW=1700000000000;

test('detectDelimiter picks tab/comma/semicolon/pipe',()=>{
  assert.equal(detectDelimiter('a,b\n1,2'),',');
  assert.equal(detectDelimiter('a\tb\n1\t2'),'\t');
  assert.equal(detectDelimiter('a;b\n1;2'),';');
  assert.equal(detectDelimiter('a|b\n1|2'),'|');
  assert.equal(detectDelimiter('single'),',');
});

test('parseDelimited handles quotes, escaped quotes, embedded newline and BOM',()=>{
  const rows=parseDelimited('\uFEFFfront,back\r\n"a,1","say ""hi"""\r\n"line1\nline2",x\r\n');
  assert.equal(rows.length,3);
  assert.deepEqual(rows[1],['a,1','say "hi"']);
  assert.deepEqual(rows[2],['line1\nline2','x']);
});

test('parseDelimited drops blank rows',()=>{
  const rows=parseDelimited('a,b\n\n1,2\n   \n');
  assert.equal(rows.length,2);
});

test('parseCards recognizes Chinese headers and plain rows',()=>{
  const zh=parseCards('正面,背面\n苹果,apple\n香蕉,banana');
  assert.equal(zh.hasHeader,true);
  assert.equal(zh.items.length,2);
  assert.equal(zh.items[0].front,'苹果');
  const plain=parseCards('苹果,apple\n香蕉,banana');
  assert.equal(plain.hasHeader,false);
  assert.equal(plain.items.length,2);
});

test('parseCards reports rows missing front or back',()=>{
  const r=parseCards('front,back\nok,yes\nonlyfront,\n,onlyback');
  assert.equal(r.items.length,1);
  assert.equal(r.errors.length,2);
});

test('parseCards keeps progress columns when present',()=>{
  const r=parseCards('front,back,ease,interval,reps,due,lapses\nq,a,2.2,10,4,123,1');
  assert.equal(r.items[0].ease,2.2);
  assert.equal(r.items[0].interval,10);
  assert.equal(r.items[0].reps,4);
  assert.equal(r.items[0].due,123);
  assert.equal(r.items[0].lapses,1);
});

test('importCards dedupes by front and preserves existing progress',()=>{
  let deck=addCard(deckSanitize(null),'苹果','apple',NOW).deck;
  deck={...deck,cards:deck.cards.map(c=>reviewCard(c,2,NOW))};
  const before=deck.cards[0];
  const res=importCards(deck,'正面,背面\n苹果,APPLE\n香蕉,banana\n苹果,again',NOW+1000);
  assert.equal(res.added,1);
  assert.equal(res.skipped,2);
  assert.equal(res.deck.cards.length,2);
  const kept=res.deck.cards.find(c=>c.front==='苹果');
  assert.equal(kept.back,before.back);
  assert.equal(kept.reps,before.reps);
  assert.equal(kept.interval,before.interval);
});

test('importCards assigns unique increasing ids',()=>{
  const res=importCards(deckSanitize(null),'a,1\nb,2\nc,3',NOW);
  const ids=res.deck.cards.map(c=>c.id);
  assert.equal(new Set(ids).size,3);
  assert.ok(res.deck.nextId>Math.max(...ids));
});

test('parseMistakes maps Chinese headers and mastery text',()=>{
  const r=parseMistakes('科目,标题,题目,答案,错因,掌握度\n数学,求根,x^2-5x+6=0,x=2或3,符号弄反,已掌握\n黑客,题2,q2,a2,r2,模糊');
  assert.equal(r.items.length,2);
  assert.equal(r.items[0].subject,'数学');
  assert.equal(r.items[0].mastery,2);
  assert.equal(r.items[1].subject,'其他');
  assert.equal(r.items[1].mastery,1);
});

test('parseMistakes accepts numeric mastery and defaults subject',()=>{
  const r=parseMistakes('subject,title,question,mastery\n,标题,q,2');
  assert.equal(r.items[0].subject,'其他');
  assert.equal(r.items[0].mastery,2);
});

test('importMistakes dedupes by title+question',()=>{
  let book=addMistake(bookSanitize(null),{subject:'数学',title:'t',question:'q'},NOW).book;
  const res=importMistakes(book,'科目,标题,题目\n数学,t,q\n数学,t,q2',NOW+10);
  assert.equal(res.added,1);
  assert.equal(res.skipped,1);
  assert.equal(res.book.items.length,2);
  const ids=res.book.items.map(i=>i.id);
  assert.equal(new Set(ids).size,2);
});

test('csvCell escapes quotes commas and newlines',()=>{
  assert.equal(csvCell('plain'),'plain');
  assert.equal(csvCell('a,b'),'"a,b"');
  assert.equal(csvCell('say "hi"'),'"say ""hi"""');
  assert.equal(csvCell('l1\nl2'),'"l1\nl2"');
  assert.equal(csvCell(null),'');
});

test('cards export round-trips through import',()=>{
  let deck=deckSanitize(null);
  deck=addCard(deck,'带,逗号','带"引号"',NOW).deck;
  deck=addCard(deck,'换行\n正面','换行\n背面',NOW).deck;
  const csv=exportCards(deck);
  const back=importCards(deckSanitize(null),csv,NOW);
  assert.equal(back.added,2);
  assert.equal(back.deck.cards[0].front,'带,逗号');
  assert.equal(back.deck.cards[0].back,'带"引号"');
  assert.equal(back.deck.cards[1].back,'换行\n背面');
});

test('cards export preserves scheduling fields on reimport',()=>{
  let deck=addCard(deckSanitize(null),'q','a',NOW).deck;
  deck={...deck,cards:deck.cards.map(c=>reviewCard(c,3,NOW))};
  const csv=exportCards(deck);
  const res=importCards(deckSanitize(null),csv,NOW);
  const src=deck.cards[0],got=res.deck.cards[0];
  assert.equal(got.ease,src.ease);
  assert.equal(got.interval,src.interval);
  assert.equal(got.reps,src.reps);
  assert.equal(got.due,src.due);
});

test('mistakes export round-trips with mastery text',()=>{
  let book=bookSanitize(null);
  book=addMistake(book,{subject:'英语',title:'t,1',question:'q"1',answer:'a\n1',reason:'r',mastery:2},NOW).book;
  const csv=exportMistakes(book);
  const res=importMistakes(bookSanitize(null),csv,NOW);
  assert.equal(res.added,1);
  const it=res.book.items[0];
  assert.equal(it.title,'t,1');
  assert.equal(it.question,'q"1');
  assert.equal(it.answer,'a\n1');
  assert.equal(it.mastery,2);
  assert.equal(it.subject,'英语');
});

test('toCSV writes header row and CRLF',()=>{
  const csv=toCSV(['a','b'],[{a:1,b:2}]);
  assert.equal(csv,'a,b\r\n1,2\r\n');
});

test('updateCard edits text and keeps progress',()=>{
  let deck=addCard(deckSanitize(null),'old','oldback',NOW).deck;
  deck={...deck,cards:deck.cards.map(c=>reviewCard(c,2,NOW))};
  const before=deck.cards[0];
  const res=updateCard(deck,before.id,'new','newback');
  assert.equal(res.ok,true);
  const c=res.deck.cards[0];
  assert.equal(c.front,'new');
  assert.equal(c.back,'newback');
  assert.equal(c.reps,before.reps);
  assert.equal(c.interval,before.interval);
  assert.equal(c.due,before.due);
  assert.equal(updateCard(deck,before.id,'','x').ok,false);
  assert.equal(updateCard(deck,999,'x','y').ok,false);
});

test('importSummary describes result',()=>{
  const s=importSummary({added:3,skipped:2,errors:['x']});
  assert.ok(s.includes('新增 3'));
  assert.ok(s.includes('跳过 2'));
  assert.ok(s.includes('1 行有问题'));
  assert.equal(importSummary(null),'');
});

test('empty and garbage input does not throw',()=>{
  assert.equal(parseCards('').items.length,0);
  assert.equal(parseMistakes(',,,').items.length,0);
  const r=importCards(deckSanitize(null),'',NOW);
  assert.equal(r.added,0);
  assert.equal(r.deck.cards.length,0);
});

test('headers constants stay stable',()=>{
  assert.deepEqual(CARD_HEADERS,['front','back','ease','interval','reps','due','lapses']);
  assert.deepEqual(MISTAKE_HEADERS,['subject','title','question','answer','reason','mastery']);
});