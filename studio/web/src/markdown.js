/* 天工 · Markdown 预览渲染（纯函数，不依赖 DOM，方便单元测试）
 * 安全策略：先整体 HTML 转义，再只做白名单内的 Markdown 变换，
 * 因此用户内容里的 <script>、onerror 等一律变成文本，不会执行。
 * 支持：标题 #~######、无序/有序列表、粗体、斜体、行内代码、围栏代码块、
 *       引用 >、分隔线 ---、链接 [text](http/https)、段落与换行。 */

const ESC={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>ESC[c]);
}

/* 只允许 http/https/mailto 链接，挡掉 javascript: 等。 */
function safeUrl(u){
  const t=String(u||'').trim();
  if(/^(https?:\/\/|mailto:)/i.test(t))return t;
  return '';
}

/* 行内变换：先转义，再替换代码/粗体/斜体/链接。输入应为原始文本。 */
function inline(raw){
  let s=escapeHtml(raw);
  /* 行内代码 `code`：内容已转义，包 <code> */
  s=s.replace(/`([^`]+)`/g,(m,c)=>'<code>'+c+'</code>');
  /* 链接 [text](url)：text 已转义；url 需解码回原始再校验 */
  s=s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g,(m,text,url)=>{
    const real=safeUrl(url.replace(/&amp;/g,'&'));
    if(!real)return text;
    return '<a href="'+escapeHtml(real)+'" rel="noopener noreferrer">'+text+'</a>';
  });
  /* 粗体 **x** 先于斜体 *x* */
  s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>');
  return s;
}

export function renderMarkdown(src){
  const text=String(src==null?'':src);
  const lines=text.split(/\r?\n/);
  const out=[];
  let i=0;
  let listType=null; /* 'ul' | 'ol' | null */
  const closeList=()=>{if(listType){out.push('</'+listType+'>');listType=null;}};
  while(i<lines.length){
    const line=lines[i];
    /* 围栏代码块 ``` */
    const fence=/^```(.*)$/.exec(line);
    if(fence){
      closeList();
      const buf=[];i++;
      while(i<lines.length&&!/^```/.test(lines[i])){buf.push(lines[i]);i++;}
      i++; /* 跳过结束 ``` */
      out.push('<pre><code>'+escapeHtml(buf.join('\n'))+'</code></pre>');
      continue;
    }
    /* 空行 */
    if(!line.trim()){closeList();i++;continue;}
    /* 标题 */
    const h=/^(#{1,6})\s+(.*)$/.exec(line);
    if(h){closeList();out.push('<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>');i++;continue;}
    /* 分隔线 */
    if(/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)){closeList();out.push('<hr>');i++;continue;}
    /* 引用 */
    if(/^>\s?/.test(line)){
      closeList();
      const buf=[];
      while(i<lines.length&&/^>\s?/.test(lines[i])){buf.push(lines[i].replace(/^>\s?/,''));i++;}
      out.push('<blockquote>'+renderMarkdown(buf.join('\n'))+'</blockquote>');
      continue;
    }
    /* 无序列表 */
    const ul=/^[-*+]\s+(.*)$/.exec(line);
    if(ul){
      if(listType!=='ul'){closeList();out.push('<ul>');listType='ul';}
      out.push('<li>'+inline(ul[1])+'</li>');i++;continue;
    }
    /* 有序列表 */
    const ol=/^\d+[.)]\s+(.*)$/.exec(line);
    if(ol){
      if(listType!=='ol'){closeList();out.push('<ol>');listType='ol';}
      out.push('<li>'+inline(ol[1])+'</li>');i++;continue;
    }
    /* 普通段落：合并连续非空行 */
    closeList();
    const buf=[line];i++;
    while(i<lines.length&&lines[i].trim()&&!/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])){buf.push(lines[i]);i++;}
    out.push('<p>'+buf.map(inline).join('<br>')+'</p>');
  }
  closeList();
  return out.join('\n');
}