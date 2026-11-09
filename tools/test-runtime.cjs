// Exercise the exact bundled Python runtime independently of a device WebView.
const path=require('node:path'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../studio/src/main/assets/studio/runtime');
const {loadPyodide}=require(path.join(base,'pyodide.js'));
(async()=>{const py=await loadPyodide({indexURL:base+path.sep});const output=[];py.setStdout({batched:s=>output.push(s)});py.FS.mkdirTree('/workspace/project');py.FS.writeFile('/workspace/project/helper.py','def area(w,h):\n    return w*h\n');py.FS.writeFile('/workspace/project/data.json','{"w":8,"h":5}');
  await py.runPythonAsync("import os, sys, json\nos.chdir('/workspace/project')\nsys.path.insert(0, os.getcwd())\nfrom helper import area\nwith open('data.json', encoding='utf8') as f: d=json.load(f)\nprint('长方形面积：', area(d['w'],d['h']), sep='')");
  assert.equal(output.join('\n'),'长方形面积：40');console.log('PASS bundled Python: Chinese output, import, JSON and relative paths');
})().catch(e=>{console.error(e);process.exitCode=1;});
