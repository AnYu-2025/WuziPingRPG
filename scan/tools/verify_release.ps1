$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectDirectory
try {
    New-Item -ItemType Directory -Path verification -Force | Out-Null
    & .\gradlew.bat --offline --no-daemon regressionCheck assembleDebug assembleRelease lintDebug lintRelease 2>&1 |
        Tee-Object -FilePath verification/build-2.4.0.log
    if ($LASTEXITCODE -ne 0) { throw '构建或检查失败，未复制正式包。' }
    $metadata = Get-Content -LiteralPath app/build/outputs/apk/release/output-metadata.json -Raw | ConvertFrom-Json
    if ($metadata.applicationId -ne 'com.scan.camera' -or $metadata.elements[0].versionName -ne '2.4.0' -or $metadata.elements[0].versionCode -ne 29) {
        throw '正式包版本或包名不符合 2.4.0。'
    }
    Copy-Item -LiteralPath app/build/outputs/apk/release/app-release.apk -Destination 扫描相机-v2.4.0.apk
    Get-FileHash -LiteralPath 扫描相机-v2.4.0.apk -Algorithm SHA256 |
        Format-List | Out-File -LiteralPath verification/apk-2.4.0-sha256.txt -Encoding utf8
    Get-Content -LiteralPath verification/apk-2.4.0-sha256.txt
} finally {
    Pop-Location
}
