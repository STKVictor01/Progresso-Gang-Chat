$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$musicPython = Join-Path $projectRoot '.tools\music-venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $musicPython)) {
    python -m venv (Join-Path $projectRoot '.tools\music-venv')
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente de música.' }
}
& $musicPython -m pip install -r (Join-Path $projectRoot 'server\music-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências de música.' }
Write-Host 'Música preparada. Abra novamente o atalho do chat.'
