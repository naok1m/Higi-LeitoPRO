# Coloca o Caddy na porta 8000 para dividi-la entre o Higi Leito PRO (/higi) e a API FastAPI.
#
# ANTES de rodar (veja docs\DEPLOY.md, secao "Porta compartilhada"):
#   1. O Higi ja instalado com deploy\windows\install.ps1.
#   2. Saber o comando que inicia a FastAPI: no meio do script ele pausa e pede para voce
#      reinicia-la so na porta interna, por exemplo:
#        uvicorn main:app --host 127.0.0.1 --port 8001 --proxy-headers --forwarded-allow-ips 127.0.0.1
#
# Uso (PowerShell como administrador, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\proxy\install-proxy.ps1
# Para desfazer: deploy\windows\proxy\remove-proxy.ps1
param(
    [int]$PublicPort = 8000,
    [int]$FastApiPort = 8001,
    [string]$BasePath = '/higi'
)

. (Join-Path $PSScriptRoot '..\common.ps1')
Assert-Administrator
Set-Location $Root
$BasePath = '/' + $BasePath.Trim('/')
$CaddyDir = Join-Path $ToolsDir 'caddy'
$CaddyExe = Join-Path $CaddyDir 'caddy.exe'
$CaddyFile = Join-Path $ToolsDir 'Caddyfile'
$ProxyService = @{ Id = $ProxyServiceId; Name = "Proxy porta $PublicPort (Higi + FastAPI)"; Description = "Divide a porta ${PublicPort}: $BasePath vai para o Higi Leito PRO e o resto para a API FastAPI (porta $FastApiPort)." }

Write-Step '1/6 Conferindo o Higi'
foreach ($service in $Services) {
    if (-not (Get-Service -Name $service.Id -ErrorAction SilentlyContinue)) {
        throw "O servico $($service.Id) nao existe. Rode primeiro deploy\windows\install.ps1."
    }
}
$envValues = Read-DotEnv
$higiPort = $(if ($envValues['PORT']) { [int]$envValues['PORT'] } else { 3000 })
if ($higiPort -eq $PublicPort -or $higiPort -eq $FastApiPort) { throw "O Higi (PORT=$higiPort no .env) precisa usar uma porta diferente de $PublicPort e $FastApiPort." }
Write-Ok "Higi instalado (porta interna $higiPort)"

Write-Step '2/6 Baixando e conferindo o Caddy'
New-Item -ItemType Directory -Force $CaddyDir, $LogsDir | Out-Null
if (-not (Test-Path $CaddyExe)) {
    $zip = Join-Path $ToolsDir 'caddy.zip'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $CaddyUrl -OutFile $zip -UseBasicParsing
    $hash = (Get-FileHash $zip -Algorithm SHA256).Hash
    if ($hash -ne $CaddySha256) {
        Remove-Item $zip -Force
        throw "O Caddy baixado nao confere com o hash esperado ($hash). Download corrompido ou adulterado."
    }
    Expand-Archive -Path $zip -DestinationPath $CaddyDir -Force
    Remove-Item $zip -Force
}
$template = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Caddyfile.template'), $Utf8NoBom)
$config = $template.Replace('{{PUBLIC_PORT}}', "$PublicPort").Replace('{{BASE_PATH}}', $BasePath)
$config = $config.Replace('{{HIGI_PORT}}', "$higiPort").Replace('{{FASTAPI_PORT}}', "$FastApiPort")
$config = $config.Replace('{{LOGS_DIR}}', ($LogsDir -replace '\\', '/'))
[System.IO.File]::WriteAllText($CaddyFile, $config, $Utf8NoBom)
$validation = Invoke-Native { & $CaddyExe validate --config $CaddyFile --adapter caddyfile }
if ($LASTEXITCODE -ne 0) {
    $validation | Select-Object -Last 5 | ForEach-Object { Write-Host "    $_" }
    throw 'O Caddyfile gerado e invalido (veja as mensagens acima).'
}
Write-Ok "Caddy pronto ($CaddyFile)"

Write-Step "3/6 Publicando o Higi em $BasePath (so acessivel pelo proxy)"
Set-DotEnvValue 'HIGI_BASE_PATH' $BasePath
Set-DotEnvValue 'HOST' '127.0.0.1'
& npm run build
Assert-ExitCode 'npm run build'
Stop-AppServices
Start-AppServices
$oldRule = "Higi Leito PRO (TCP $higiPort)"
if (Get-NetFirewallRule -DisplayName $oldRule -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -DisplayName $oldRule }
if (-not (Wait-AppHealth 60)) { throw 'O Higi nao voltou a responder. Veja deploy\windows\status.ps1.' }
Write-Ok 'Higi reiniciado'

Write-Step '4/6 Hora de mover a FastAPI (ela fica fora do ar so ate o passo 5 terminar)'
Write-Host ''
Write-Host '    1. Feche o cmd em que a FastAPI esta rodando.' -ForegroundColor Yellow
Write-Host '    2. Inicie de novo trocando o host e a porta, por exemplo:' -ForegroundColor Yellow
Write-Host "         uvicorn main:app --host 127.0.0.1 --port $FastApiPort --proxy-headers --forwarded-allow-ips 127.0.0.1" -ForegroundColor Yellow
Write-Host '    3. Volte aqui e pressione Enter (ou digite S e Enter para sair sem instalar o proxy).' -ForegroundColor Yellow
while ($true) {
    $answer = Read-Host '    Pronto?'
    if ($answer -match '^[sS]') { Write-Warn 'Cancelado. O Higi ficou em modo proxy; rode este script de novo ou o remove-proxy.ps1.'; exit 1 }
    $listener = Get-NetTCPConnection -LocalPort $PublicPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $owner = $(if ($listener) { Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue } else { $null })
    $publicFree = (-not $listener) -or ($owner -and $owner.ProcessName -eq 'caddy')
    $fastApiUp = Test-TcpPort '127.0.0.1' $FastApiPort
    if ($publicFree -and $fastApiUp) { break }
    if (-not $publicFree) { Write-Warn "A porta $PublicPort ainda esta em uso por '$($owner.ProcessName)' (PID $($listener.OwningProcess)). Feche o cmd antigo." }
    if (-not $fastApiUp) { Write-Warn "A FastAPI ainda nao responde em 127.0.0.1:$FastApiPort." }
}
Write-Ok "FastAPI na porta interna $FastApiPort e porta $PublicPort livre"

Write-Step "5/6 Instalando o servico do proxy na porta $PublicPort"
$wrapper = Get-ServiceWrapperPath $ProxyServiceId
if (Get-Service -Name $ProxyServiceId -ErrorAction SilentlyContinue) {
    Stop-Service -Name $ProxyServiceId -Force -ErrorAction SilentlyContinue
    & $wrapper uninstall | Out-Null
}
Copy-Item (Install-WinSw) $wrapper -Force
Write-ServiceConfig $ProxyService $CaddyExe "run --config `"$CaddyFile`" --adapter caddyfile" ''
& $wrapper install
Assert-ExitCode 'Instalar o servico do proxy'
# Regra por porta (e nao por programa): vale para o Caddy no lugar do python.exe.
$proxyRule = "Proxy Higi + FastAPI (TCP $PublicPort)"
if (-not (Get-NetFirewallRule -DisplayName $proxyRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $proxyRule -Direction Inbound -Protocol TCP -LocalPort $PublicPort -Action Allow -Profile Domain, Private | Out-Null
}
Start-Service -Name $ProxyServiceId

Write-Step '6/6 Testando pelo proxy'
Start-Sleep -Seconds 3
$ok = $true
try {
    $higi = Invoke-WebRequest -Uri "http://127.0.0.1:$PublicPort$BasePath/api/health" -UseBasicParsing -TimeoutSec 10
    Write-Ok "Higi em http://127.0.0.1:$PublicPort$BasePath respondeu ($($higi.StatusCode))"
} catch {
    Write-Warn "Higi pelo proxy nao respondeu: $_"
    $ok = $false
}
if (Test-TcpPort '127.0.0.1' $PublicPort) {
    Write-Ok "Porta $PublicPort atendendo (FastAPI continua em http://<ip>:$PublicPort/)"
} else {
    Write-Warn "Nada respondendo na porta $PublicPort"
    $ok = $false
}
if (-not $ok) {
    Write-Host ''
    Write-Host 'Veja logs\HigiLeitoPro-Proxy.err.log. Para desfazer: deploy\windows\proxy\remove-proxy.ps1' -ForegroundColor Yellow
    exit 1
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "Higi Leito PRO: http://${ip}:$PublicPort$BasePath" -ForegroundColor Green
Write-Host "FastAPI (como antes): http://${ip}:$PublicPort/" -ForegroundColor Green
Write-Host 'Lembrete: a FastAPI agora precisa estar sempre rodando na porta interna.' -ForegroundColor Yellow
