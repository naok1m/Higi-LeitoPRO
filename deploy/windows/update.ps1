# Atualiza o Higi Leito PRO para a versao mais recente do git.
# Uso (PowerShell como administrador, dentro da pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
# -SkipPull: nao baixa nada do git (use para reinstalar a versao atual, ex. depois de voltar versao).
param(
    [switch]$SkipPull
)

. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
Set-Location $Root

$previousCommit = (& git rev-parse HEAD).Trim()
Assert-ExitCode 'git rev-parse'

if (-not $SkipPull) {
    Write-Step '1/6 Baixando a versao nova (git pull)'
    & git pull --ff-only
    Assert-ExitCode 'git pull'
}
$currentCommit = (& git rev-parse HEAD).Trim()
if (-not $SkipPull -and $currentCommit -eq $previousCommit) {
    Write-Ok 'Nenhuma alteracao nova no git. Nada a fazer.'
    exit 0
}

Write-Step '2/6 Backup do banco antes de atualizar'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'backup.ps1')
Assert-ExitCode 'Backup'

Write-Step '3/6 Parando os servicos'
Stop-AppServices
Write-Ok 'Servicos parados (o sistema fica fora do ar por alguns instantes)'

$failed = $null
try {
    Write-Step '4/6 Dependencias e telas'
    & npm ci --no-audit --no-fund
    Assert-ExitCode 'npm ci'
    # Gera em dist-next e so troca se der certo: um build com erro nao derruba as telas atuais.
    $nextDist = Join-Path $Root 'dist-next'
    if (Test-Path $nextDist) { Remove-Item $nextDist -Recurse -Force }
    & npm run build -- --outDir dist-next --emptyOutDir
    Assert-ExitCode 'npm run build'
    $dist = Join-Path $Root 'dist'
    if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
    Rename-Item $nextDist 'dist'

    Write-Step '5/6 Atualizando o banco'
    & npm run db:migrate
    Assert-ExitCode 'npm run db:migrate'
} catch {
    $failed = $_
} finally {
    Write-Step '6/6 Iniciando os servicos'
    Start-AppServices
}

$healthy = Wait-AppHealth 60
if ($failed -or -not $healthy) {
    if ($failed) { Write-Warn "Falha na atualizacao: $failed" }
    if (-not $healthy) { Write-Warn 'A API nao respondeu ao teste de saude. Veja deploy\windows\status.ps1 e a pasta logs\.' }
    Write-Host ''
    Write-Host 'Para voltar para a versao anterior:' -ForegroundColor Yellow
    Write-Host "  git reset --hard $previousCommit" -ForegroundColor Yellow
    Write-Host '  powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1 -SkipPull' -ForegroundColor Yellow
    exit 1
}

Write-Ok "Atualizado de $($previousCommit.Substring(0, 7)) para $($currentCommit.Substring(0, 7))."
