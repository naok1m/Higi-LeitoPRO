# Remove os servicos do Windows e a tarefa de backup. NAO apaga o banco nem os backups.
# Uso: powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall.ps1
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator

foreach ($service in $Services) {
    $wrapper = Get-ServiceWrapperPath $service.Id
    if (Get-Service -Name $service.Id -ErrorAction SilentlyContinue) {
        Stop-Service -Name $service.Id -Force -ErrorAction SilentlyContinue
        & $wrapper uninstall
        Write-Ok "$($service.Id) removido"
    }
}
Unregister-ScheduledTask -TaskName "$ServicePrefix-Backup" -Confirm:$false -ErrorAction SilentlyContinue
Write-Ok 'Tarefa de backup removida. O banco de dados e os backups foram mantidos.'
