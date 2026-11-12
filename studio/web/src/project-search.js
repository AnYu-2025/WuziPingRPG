/* 天工 · 全项目搜索（纯函数，不依赖 DOM，方便单元测试）
 * 在工作区所有文本文件里找关键词，返回命中行，供点击跳转。
 * 输入 files=[{path,text}]，query 字符串，options={caseSensitive,maxResults,maxPerFile}。 */

export function searchProject(files,query,options={}){
  const q=String(query==null?'':query);
  if(!q.trim())return {results:[],total:0,truncated:false};
  const caseSensitive=!!options.caseSensitive;
  const maxResults=Math.max(1,options.maxResults||200);
  const maxPerFile=Math.max(1,options.maxPerFile||20);
  const needle=caseSensitive?q:q.toLowerCase();
  const results=[];
  let total=0,truncated=false;
  const list=Array.isArray(files)?files:[];
  for(const f of list){
    if(!f||typeof f.path!=='string'||typeof f.text!=='string')continue;
    const lines=f.text.split('\n');
    let inFile=0;
    for(let i=0;i<lines.length;i++){
      const hay=caseSensitive?lines[i]:lines[i].toLowerCase();
      const col=hay.indexOf(needle);
      if(col<0)continue;
      total++;
      if(results.length>=maxResults){truncated=true;continue;}
      if(inFile>=maxPerFile){truncated=true;continue;}
      inFile++;
      /* 命中行太长时截一段上下文，避免结果列表撑爆。 */
      let snippet=lines[i];
      if(snippet.length>160){
        const start=Math.max(0,col-40);
        snippet=(start>0?'…':'')+snippet.slice(start,start+150)+(start+150<lines[i].length?'…':'');
      }
      results.push({path:f.path,line:i+1,column:col+1,text:snippet});
    }
  }
  return {results,total,truncated};
}