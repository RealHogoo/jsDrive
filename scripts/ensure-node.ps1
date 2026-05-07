$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeVersion = if ($env:NODE_VERSION) { $env:NODE_VERSION } else { "v22.13.1" }
$RuntimeDir = Join-Path $RootDir ".runtime"
$NodeHome = Join-Path $RuntimeDir "node-$NodeVersion"
$NodeExe = Join-Path $NodeHome "node.exe"

if (!(Test-Path $NodeExe)) {
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $archive = "node-$NodeVersion-win-$arch.zip"
    $url = "https://nodejs.org/dist/$NodeVersion/$archive"
    $zipPath = Join-Path $RuntimeDir $archive

    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    Write-Host "Downloading Node.js $NodeVersion (win-$arch)..."
    Invoke-WebRequest -Uri $url -OutFile $zipPath

    if (Test-Path $NodeHome) {
        Remove-Item -Recurse -Force $NodeHome
    }
    Expand-Archive -Path $zipPath -DestinationPath $RuntimeDir -Force
    Move-Item -Path (Join-Path $RuntimeDir "node-$NodeVersion-win-$arch") -Destination $NodeHome
    Remove-Item -Force $zipPath
}

Write-Output $NodeHome
