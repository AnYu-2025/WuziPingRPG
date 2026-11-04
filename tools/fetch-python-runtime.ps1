param([string]$Version='0.27.7')
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination=Join-Path $root 'studio/src/main/assets/studio/runtime'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$files=@('pyodide.js','pyodide.mjs','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json')
foreach($name in $files){
    $target=Join-Path $destination $name
    if(-not (Test-Path -LiteralPath $target)){Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/pyodide/v$Version/full/$name" -OutFile $target}
    Write-Output "$name $((Get-Item -LiteralPath $target).Length) bytes"
}
$entries=@($files | ForEach-Object {"$((Get-FileHash -LiteralPath (Join-Path $destination $_) -Algorithm SHA256).Hash.ToLowerInvariant())  $_"})
[IO.File]::WriteAllText((Join-Path $destination 'SHA256SUMS.txt'),(($entries -join "`n")+"`n"),[Text.UTF8Encoding]::new($false))
