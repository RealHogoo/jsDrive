$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeHome = & (Join-Path $PSScriptRoot "ensure-node.ps1")
$env:PATH = "$NodeHome;$env:PATH"

Set-Location $RootDir

if (!(Test-Path "node_modules") -or ((Get-Item "package.json").LastWriteTime -gt (Get-Item "node_modules").LastWriteTime)) {
    npm install
}

if ($env:SKIP_BUILD -ne "true") {
    npm run build
}

node dist/main.js
