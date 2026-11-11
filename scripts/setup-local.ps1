$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$toolsDir = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
$runtime = Join-Path $toolsDir 'node-v22-local'
if (!(Test-Path -LiteralPath (Join-Path $runtime 'node.exe'))) {
    $baseUrl = 'https://nodejs.org/dist/latest-v22.x'
    $checksums = (Invoke-WebRequest -UseBasicParsing "$baseUrl/SHASUMS256.txt").Content
    $entry = ($checksums -split "`n" | Where-Object { $_ -match '\snode-v22\.[\d.]+-win-x64\.zip\s*$' } | Select-Object -First 1)
    if (!$entry) { throw 'Node.js 22 Windows x64 archive was not found.' }
    $parts = $entry.Trim() -split '\s+'
    $archive = Join-Path $toolsDir $parts[1]
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$($parts[1])" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $parts[0]) { throw 'Node.js checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $toolsDir -Force
    Move-Item -LiteralPath (Join-Path $toolsDir ($parts[1] -replace '\.zip$', '')) -Destination $runtime
}
$env:PATH = "$runtime;$env:PATH"
& (Join-Path $runtime 'node.exe') --version
& (Join-Path $runtime 'npm.cmd') ci --cache (Join-Path $toolsDir 'npm-cache')
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
Write-Host 'Ready. Run start-local.cmd to open the local development server.'
