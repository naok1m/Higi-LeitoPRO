# Gera um backup completo do banco (pg_dump, formato custom) e apaga os antigos.
# Roda sozinho todo dia as 02:00 (tarefa agendada criada pelo install.ps1).
# Manual: powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1
param(
    [string]$Destination = ''
)

. (Join-Path $PSScriptRoot 'common.ps1')

$envValues = Read-DotEnv
if (-not $Destination) { $Destination = $envValues['HIGI_BACKUP_DIR'] }
if (-not $Destination) { $Destination = Join-Path $Root 'backups' }
$keepDays = [int]$(if ($envValues['HIGI_BACKUP_KEEP_DAYS']) { $envValues['HIGI_BACKUP_KEEP_DAYS'] } else { 14 })
New-Item -ItemType Directory -Force $Destination | Out-Null
$logFile = Join-Path $Destination 'backup.log'

function Write-BackupLog([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

try {
    $db = Get-DatabaseConnection
    $pgBin = Get-PostgresBin
    $file = Join-Path $Destination ("higi_leito_{0:yyyyMMdd_HHmmss}.dump" -f (Get-Date))
    $env:PGPASSWORD = $db.Password
    & "$pgBin\pg_dump.exe" -h $db.Host -p $db.Port -U $db.User -d $db.Database -Fc -f $file
    Assert-ExitCode 'pg_dump'
    $sizeMb = [math]::Round((Get-Item $file).Length / 1MB, 2)
    Write-BackupLog "OK $file ($sizeMb MB)"

    Get-ChildItem $Destination -Filter 'higi_leito_*.dump' |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } |
        ForEach-Object {
            Remove-Item $_.FullName -Force
            Write-BackupLog "Removido backup antigo $($_.Name)"
        }
} catch {
    Write-BackupLog "ERRO $_"
    exit 1
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
