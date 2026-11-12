/* Batch output so print/console floods cannot flood the UI event queue. */
let outputSize=0,pendingOutput='',pendingError=false,lastOutput=Date.now(),truncated=false;
/* 常驻线程（C++）用 runId 标记输出归属；一次性线程不带，保持兼容。 */
var outputRunId;
function flushOutput(){if(!pendingOutput)return;const m={type:pendingError?'stderr':'stdout',text:pendingOutput};if(outputRunId!==undefined)m.runId=outputRunId;postMessage(m);pendingOutput='';pendingError=false;lastOutput=Date.now();}
function emit(type,value){if(outputSize>=65536)return;const text=String(value);if(!text)return;const piece=text.slice(0,65536-outputSize);outputSize+=piece.length;pendingOutput+=piece;pendingError=pendingError||type==='stderr';if(outputSize>=65536&&!truncated){pendingOutput+='\n[输出达到 64K 字符，后续内容已截断；可随时停止]\n';truncated=true;}if(pendingOutput.length>=2048||Date.now()-lastOutput>=40)flushOutput();}
