$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtime = Join-Path $projectRoot '.tools/node-v22-local'
if (!(Test-Path -LiteralPath (Join-Path $runtime 'node.exe')) -or !(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/vite'))) {
    & (Join-Path $PSScriptRoot 'setup-local.ps1')
}
$env:PATH = "$runtime;$env:PATH"
& (Join-Path $runtime 'npm.cmd') run dev -- --host 127.0.0.1 --port 5173 --strictPort
exit $LASTEXITCODE
