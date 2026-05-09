param(
    [string]$Port,
    [string]$PublicBaseUrl,
    [string]$AdminServiceBaseUrl,
    [string]$AdminServicePublicBaseUrl,
    [string]$StorageRoot,
    [string]$DbHost,
    [string]$DbPort,
    [string]$DbDatabase,
    [string]$DbUsername,
    [string]$DbPassword
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$NodeHome = & (Join-Path $PSScriptRoot "ensure-node.ps1")
$env:PATH = "$NodeHome;$env:PATH"

if ($Port) { $env:PORT = $Port }
if ($PublicBaseUrl) { $env:PUBLIC_BASE_URL = $PublicBaseUrl }
if ($AdminServiceBaseUrl) { $env:ADMIN_SERVICE_BASE_URL = $AdminServiceBaseUrl }
if ($AdminServicePublicBaseUrl) { $env:ADMIN_SERVICE_PUBLIC_BASE_URL = $AdminServicePublicBaseUrl }
if ($StorageRoot) { $env:WEBHARD_STORAGE_ROOT = $StorageRoot }
if ($DbHost) { $env:WEBHARD_DB_HOST = $DbHost }
if ($DbPort) { $env:WEBHARD_DB_PORT = $DbPort }
if ($DbDatabase) { $env:WEBHARD_DB_DATABASE = $DbDatabase }
if ($DbUsername) { $env:WEBHARD_DB_USERNAME = $DbUsername }
if ($DbPassword) { $env:WEBHARD_DB_PASSWORD = $DbPassword }

Set-Location $RootDir

if (!(Test-Path "node_modules") -or ((Get-Item "package.json").LastWriteTime -gt (Get-Item "node_modules").LastWriteTime)) {
    npm install
}

if ($env:SKIP_BUILD -ne "true") {
    npm run build
}

node dist/main.js
