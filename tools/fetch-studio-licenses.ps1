$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$out=Join-Path $root 'studio/src/main/assets/studio/licenses'
New-Item -ItemType Directory -Force -Path $out | Out-Null
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/pyodide/pyodide/0.27.7/LICENSE' -OutFile (Join-Path $out 'Pyodide-0.27.7-LICENSE.txt')
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/python/cpython/v3.12.7/LICENSE' -OutFile (Join-Path $out 'CPython-3.12.7-LICENSE.txt')
[IO.File]::WriteAllText((Join-Path $out 'SOURCES.txt'),"Pyodide 0.27.7: https://github.com/pyodide/pyodide/tree/0.27.7`nCPython 3.12.7: https://github.com/python/cpython/tree/v3.12.7`nThe bundled runtime files are unmodified upstream release artifacts.`nCodeMirror and its JavaScript dependencies: exact versions and source URLs are in studio/web/package-lock.json. License texts are copied by build.mjs.`n",[Text.UTF8Encoding]::new($false))
