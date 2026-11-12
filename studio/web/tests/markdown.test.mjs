import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown,escapeHtml} from '../src/markdown.js';

test('escapeHtml neutralizes tags and quotes',()=>{
  assert.equal(escapeHtml('<script>alert(1)</script>'),'&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('"\'&'), '&quot;&#39;&amp;');
});

test('script tags in markdown become inert text',()=>{
  const html=renderMarkdown('hello <script>alert(1)</script> world');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('img onerror injection is escaped',()=>{
  const html=renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('javascript: links are stripped to plain text',()=>{
  const html=renderMarkdown('[click](javascript:alert(1))');
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('<a'));
});

test('http links render with rel noopener',()=>{
  const html=renderMarkdown('[site](https://example.com)');
  assert.ok(html.includes('<a href="https://example.com"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('headings h1..h6',()=>{
  assert.ok(renderMarkdown('# T').includes('<h1>T</h1>'));
  assert.ok(renderMarkdown('###### T').includes('<h6>T</h6>'));
});

test('bold and italic',()=>{
  const html=renderMarkdown('**b** and *i*');
  assert.ok(html.includes('<strong>b</strong>'));
  assert.ok(html.includes('<em>i</em>'));
});

test('inline code escapes content',()=>{
  const html=renderMarkdown('use `<b>` here');
  assert.ok(html.includes('<code>&lt;b&gt;</code>'));
});

test('fenced code block escapes and preserves newlines',()=>{
  const html=renderMarkdown('```\n<b>\nline2\n```');
  assert.ok(html.includes('<pre><code>&lt;b&gt;\nline2</code></pre>'));
});

test('unordered and ordered lists',()=>{
  const ul=renderMarkdown('- a\n- b');
  assert.ok(ul.includes('<ul>')&&ul.includes('<li>a</li>')&&ul.includes('<li>b</li>'));
  const ol=renderMarkdown('1. a\n2. b');
  assert.ok(ol.includes('<ol>')&&ol.includes('<li>a</li>'));
});

test('blockquote and hr',()=>{
  assert.ok(renderMarkdown('> quote').includes('<blockquote>'));
  assert.ok(renderMarkdown('---').includes('<hr>'));
});

test('paragraph joins consecutive lines with br',()=>{
  const html=renderMarkdown('line1\nline2');
  assert.ok(html.includes('<p>line1<br>line2</p>'));
});

test('empty input yields empty string',()=>{
  assert.equal(renderMarkdown(''),'');
  assert.equal(renderMarkdown(null),'');
});