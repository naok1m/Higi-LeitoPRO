# Desfaz o install-proxy.ps1: remove o Caddy e devolve ao Higi uma porta propria.
# Use quando a seguranca liberar uma porta so para o Higi (ex.: 3000).
#
# Uso (PowerShell como administrador, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\proxy\remove-proxy.ps1 -HigiPort 3000
#
# DEPOIS: volte a FastAPI para a porta original, por exemplo:
#   uvicorn main:app --host 10.85.250.25 --port 8000
param(
    [Parameter(Mandatory = $true)][int]$HigiPort,
    [int]$PublicPort = 8000
)

. (Join-Path $PSScriptRoot '..\common.ps1')
Assert-Administrator
Set-Location $Root

Write-Step '1/3 Removendo o proxy'
$wrapper = Get-ServiceWrapperPath $ProxyServiceId
if (Get-Service -Name $ProxyServiceId -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ProxyServiceId -Force -ErrorAction SilentlyContinue
    & $wrapper uninstall | Out-Null
    Write-Ok 'Servico do proxy removido'
} else {
    Write-Ok 'Proxy nao estava instalado'
}
$proxyRule = "Proxy Higi + FastAPI (TCP $PublicPort)"
if (Get-NetFirewallRule -DisplayName $proxyRule -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $proxyRule }

Write-Step "2/3 Publicando o Higi na raiz da porta $HigiPort"
Set-DotEnvValue 'HIGI_BASE_PATH' ''
Set-DotEnvValue 'HOST' '0.0.0.0'
Set-DotEnvValue 'PORT' "$HigiPort"
& npm run build
Assert-ExitCode 'npm run build'
$rule = "Higi Leito PRO (TCP $HigiPort)"
if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $HigiPort -Action Allow -Profile Domain, Private | Out-Null
}
Stop-AppServices
Start-AppServices

Write-Step '3/3 Testando'
if (Wait-AppHealth 60) { Write-Ok "Higi no ar em $(Get-AppUrl ([System.Net.Dns]::GetHostName()))" } else { Write-Warn 'O Higi nao respondeu. Veja deploy\windows\status.ps1.' }
Write-Host ''
Write-Host "Agora volte a FastAPI para a porta $PublicPort (feche o cmd e inicie com --host 10.85.250.25 --port $PublicPort)." -ForegroundColor Yellow
