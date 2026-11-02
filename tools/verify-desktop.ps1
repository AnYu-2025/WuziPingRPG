param([string]$JdkRoot = $env:JAVA_HOME)
$ErrorActionPreference = 'Stop'
if (-not $JdkRoot) { $JdkRoot = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$classes = Join-Path $projectRoot 'build\desktop'
$dist = Join-Path $projectRoot 'dist'
$screens = Join-Path $projectRoot 'artifacts\screenshots-v0.7'
New-Item -ItemType Directory -Force -Path $classes,$dist,$screens | Out-Null
$sources = @((Get-ChildItem -LiteralPath (Join-Path $projectRoot 'core\src\main\java') -Filter '*.java' -Recurse).FullName) + @((Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tools\desktop') -Filter '*.java' -Recurse).FullName) + @((Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tools\tests') -Filter '*.java' -Recurse).FullName)
& (Join-Path $JdkRoot 'bin\javac.exe') -encoding UTF-8 --release 8 -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }
Push-Location $projectRoot
try {
    & (Join-Path $JdkRoot 'bin\java.exe') -cp $classes cn.wuziping.ember.tests.GameTests
    if ($LASTEXITCODE -ne 0) { throw 'Simulation checks failed' }
    & (Join-Path $JdkRoot 'bin\java.exe') -cp $classes cn.wuziping.ember.tests.StoryTests
    if ($LASTEXITCODE -ne 0) { throw 'Story checks failed' }
    & (Join-Path $JdkRoot 'bin\java.exe') -cp $classes cn.wuziping.ember.tests.BodyTests
    if ($LASTEXITCODE -ne 0) { throw 'Body campaign checks failed' }
    & (Join-Path $JdkRoot 'bin\java.exe') -cp $classes cn.wuziping.ember.tests.GuestTests
    if ($LASTEXITCODE -ne 0) { throw 'Hidden guest checks failed' }
    & (Join-Path $JdkRoot 'bin\java.exe') -cp $classes cn.wuziping.ember.tests.ExpansionTests
    if ($LASTEXITCODE -ne 0) { throw 'Expansion checks failed' }
    & (Join-Path $JdkRoot 'bin\java.exe') -cp $classes cn.wuziping.ember.tests.MathTests
    if ($LASTEXITCODE -ne 0) { throw 'Mathematics checks failed' }
    & (Join-Path $JdkRoot 'bin\java.exe') '-Djava.awt.headless=true' -cp $classes cn.wuziping.ember.desktop.Desktop --screenshots $screens
    if ($LASTEXITCODE -ne 0) { throw 'Screenshot rendering failed' }
    & (Join-Path $JdkRoot 'bin\jar.exe') cfe (Join-Path $dist 'WuziPing-desktop-preview.jar') cn.wuziping.ember.desktop.Desktop -C $classes . -C (Join-Path $projectRoot 'app\src\main\assets') .
    if ($LASTEXITCODE -ne 0) { throw 'Desktop preview packaging failed' }
} finally { Pop-Location }
