/* 天工 · 代码片段库（纯数据 + 过滤函数，不依赖 DOM，方便单元测试）
 * 按当前文件语言列出常用模板，点一下插到光标处。
 * 每条：{id, title, desc, langs:[...], code}。langs 用扩展名小写。 */

export const SNIPPETS=[
  /* ---- Python ---- */
  {id:'py-main',title:'主入口',desc:'if __name__ 守卫 + main()',langs:['py'],
   code:'def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n'},
  {id:'py-read',title:'读文件',desc:'with open 逐行读取',langs:['py'],
   code:'with open("data.txt", encoding="utf-8") as f:\n    for line in f:\n        print(line.rstrip())\n'},
  {id:'py-write',title:'写文件',desc:'with open 写入文本',langs:['py'],
   code:'with open("out.txt", "w", encoding="utf-8") as f:\n    f.write("hello\\n")\n'},
  {id:'py-json',title:'JSON 读写',desc:'json.load / dump',langs:['py'],
   code:'import json\n\nwith open("data.json", encoding="utf-8") as f:\n    data = json.load(f)\n\nwith open("out.json", "w", encoding="utf-8") as f:\n    json.dump(data, f, ensure_ascii=False, indent=2)\n'},
  {id:'py-input',title:'读输入',desc:'input + 整数解析',langs:['py'],
   code:'name = input("你的名字：")\nn = int(input("一个整数："))\nprint(f"你好 {name}，n={n}")\n'},
  {id:'py-list',title:'列表推导',desc:'过滤 + 变换',langs:['py'],
   code:'nums = [1, 2, 3, 4, 5, 6]\nevens = [x * x for x in nums if x % 2 == 0]\nprint(evens)\n'},
  {id:'py-class',title:'类',desc:'__init__ + 方法',langs:['py'],
   code:'class Counter:\n    def __init__(self):\n        self.n = 0\n\n    def add(self, k=1):\n        self.n += k\n        return self.n\n'},
  {id:'py-try',title:'异常处理',desc:'try / except / finally',langs:['py'],
   code:'try:\n    result = 10 / 0\nexcept ZeroDivisionError as e:\n    print("出错了：", e)\nfinally:\n    print("收尾")\n'},

  /* ---- C / C++ ---- */
  {id:'cpp-main',title:'主函数',desc:'iostream + main',langs:['c','cc','cpp','cxx'],
   code:'#include <iostream>\n\nint main() {\n    std::cout << "hello\\n";\n    return 0;\n}\n'},
  {id:'cpp-vector',title:'vector 遍历',desc:'范围 for',langs:['cc','cpp','cxx'],
   code:'#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<int> v = {1, 2, 3};\n    for (int x : v) std::cout << x << "\\n";\n    return 0;\n}\n'},
  {id:'cpp-string',title:'读一行',desc:'getline + string',langs:['cc','cpp','cxx'],
   code:'#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    std::getline(std::cin, name);\n    std::cout << "你好，" << name << "\\n";\n    return 0;\n}\n'},
  {id:'cpp-map',title:'map 计数',desc:'unordered_map 统计',langs:['cc','cpp','cxx'],
   code:'#include <iostream>\n#include <unordered_map>\n#include <string>\n\nint main() {\n    std::unordered_map<std::string, int> cnt;\n    cnt["a"]++;\n    cnt["a"]++;\n    std::cout << cnt["a"] << "\\n";\n    return 0;\n}\n'},
  {id:'cpp-sort',title:'排序',desc:'algorithm sort',langs:['cc','cpp','cxx'],
   code:'#include <iostream>\n#include <vector>\n#include <algorithm>\n\nint main() {\n    std::vector<int> v = {3, 1, 2};\n    std::sort(v.begin(), v.end());\n    for (int x : v) std::cout << x << " ";\n    return 0;\n}\n'},
  {id:'c-main',title:'C 主函数',desc:'stdio + main',langs:['c'],
   code:'#include <stdio.h>\n\nint main(void) {\n    printf("hello\\n");\n    return 0;\n}\n'},
  {id:'c-struct',title:'结构体',desc:'struct + 初始化',langs:['c','cc','cpp','cxx'],
   code:'typedef struct {\n    int x;\n    int y;\n} Point;\n\nPoint p = {1, 2};\n'},

  /* ---- JavaScript ---- */
  {id:'js-fn',title:'函数',desc:'箭头函数 + 返回',langs:['js','mjs','ts'],
   code:'const add = (a, b) => a + b;\nconsole.log(add(2, 3));\n'},
  {id:'js-fetch',title:'数组遍历',desc:'map / filter / reduce',langs:['js','mjs','ts'],
   code:'const nums = [1, 2, 3, 4];\nconst sum = nums.filter(x => x % 2 === 0).reduce((a, b) => a + b, 0);\nconsole.log(sum);\n'},
  {id:'js-async',title:'异步',desc:'async / await + try',langs:['js','mjs','ts'],
   code:'async function run() {\n  try {\n    const result = await Promise.resolve(42);\n    console.log(result);\n  } catch (e) {\n    console.error(e);\n  }\n}\nrun();\n'},
  {id:'js-class',title:'类',desc:'class + 方法',langs:['js','mjs','ts'],
   code:'class Counter {\n  constructor() { this.n = 0; }\n  add(k = 1) { this.n += k; return this.n; }\n}\nconst c = new Counter();\nconsole.log(c.add());\n'},
  {id:'js-dom',title:'DOM 操作',desc:'querySelector + 事件',langs:['js','mjs'],
   code:'const btn = document.querySelector("#btn");\nbtn?.addEventListener("click", () => {\n  console.log("clicked");\n});\n'},

  /* ---- HTML / CSS ---- */
  {id:'html-page',title:'页面骨架',desc:'doctype + meta + 容器',langs:['html','htm'],
   code:'<!doctype html>\n<html lang="zh-CN">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>页面</title>\n</head>\n<body>\n  <h1>你好</h1>\n</body>\n</html>\n'},
  {id:'css-flex',title:'Flex 居中',desc:'水平垂直居中',langs:['css'],
   code:'.center {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n'},
];

/* 按扩展名过滤片段；未知扩展返回空数组。 */
export function snippetsFor(ext){
  const e=String(ext||'').toLowerCase();
  if(!e)return [];
  return SNIPPETS.filter(s=>s.langs.includes(e));
}

export function snippetById(id){
  return SNIPPETS.find(s=>s.id===id)||null;
}