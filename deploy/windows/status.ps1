# Mostra se o sistema esta funcionando: servicos, teste de saude e ultimas linhas dos logs.
# Uso: powershell -ExecutionPolicy Bypass -File deploy\windows\status.ps1
param(
    [int]$Lines = 20
)

. (Join-Path $PSScriptRoot 'common.ps1')

Write-Step 'Servicos'
$pgService = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
$all = @()
if ($pgService) { $all += $pgService }
foreach ($service in $Services) {
    $found = Get-Service -Name $service.Id -ErrorAction SilentlyContinue
    if ($found) { $all += $found } else { Write-Warn "$($service.Id) nao esta instalado" }
}
$proxy = Get-Service -Name $ProxyServiceId -ErrorAction SilentlyContinue
if ($proxy) { $all += $proxy }
$all | Format-Table Name, Status, StartType -AutoSize

Write-Step 'Teste de saude'
if (Wait-AppHealth 5) { Write-Ok "$(Get-AppUrl)/api/health respondeu" } else { Write-Warn "$(Get-AppUrl)/api/health NAO respondeu" }

foreach ($service in $Services) {
    foreach ($kind in @('out', 'err')) {
        $log = Join-Path $LogsDir "$($service.Id).$kind.log"
        if (Test-Path $log) {
            Write-Step "Ultimas linhas de logs\$($service.Id).$kind.log"
            Get-Content $log -Tail $Lines -Encoding UTF8
        }
    }
}
