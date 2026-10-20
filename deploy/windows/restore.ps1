# Restaura um backup gerado pelo backup.ps1. APAGA os dados atuais do banco!
# Uso: powershell -ExecutionPolicy Bypass -File deploy\windows\restore.ps1 -BackupFile "C:\...\higi_leito_20261020_020000.dump"
param(
    [Parameter(Mandatory = $true)][string]$BackupFile
)

. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator

if (-not (Test-Path $BackupFile)) { throw "Arquivo nao encontrado: $BackupFile" }
Write-Host ''
Write-Host 'ATENCAO: todos os dados atuais do Higi Leito PRO serao substituidos pelo backup:' -ForegroundColor Red
Write-Host "  $BackupFile" -ForegroundColor Red
$confirm = Read-Host 'Digite RESTAURAR para continuar'
if ($confirm -ne 'RESTAURAR') {
    Write-Host 'Cancelado.'
    exit 0
}

$db = Get-DatabaseConnection
$pgBin = Get-PostgresBin

Write-Step 'Backup de seguranca do estado atual'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'backup.ps1')
Assert-ExitCode 'Backup de seguranca'

Write-Step 'Parando os servicos'
Stop-AppServices

try {
    Write-Step 'Restaurando'
    $env:PGPASSWORD = $db.Password
    & "$pgBin\pg_restore.exe" -h $db.Host -p $db.Port -U $db.User -d $db.Database --clean --if-exists --no-owner --single-transaction $BackupFile
    Assert-ExitCode 'pg_restore'
    Write-Ok 'Backup restaurado.'
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Write-Step 'Iniciando os servicos'
    Start-AppServices
}

if (Wait-AppHealth 60) { Write-Ok 'Sistema no ar.' } else { Write-Warn 'A API nao respondeu. Veja deploy\windows\status.ps1.' }
