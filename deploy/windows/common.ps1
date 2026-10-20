# Funcoes compartilhadas pelos scripts de implantacao (carregado com ". .\common.ps1").
# Mensagens sem acento de proposito: o PowerShell 5.1 do Windows Server le scripts como ANSI.

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$EnvFile = Join-Path $Root '.env'
$ToolsDir = Join-Path $PSScriptRoot 'tools'
$LogsDir = Join-Path $Root 'logs'
$ServicePrefix = 'HigiLeitoPro'
$Services = @(
    @{ Id = "$ServicePrefix-API"; Name = 'Higi Leito PRO - API'; Script = 'server\api.js'; Description = 'API e telas do Higi Leito PRO.' },
    @{ Id = "$ServicePrefix-Worker"; Name = 'Higi Leito PRO - Worker'; Script = 'server\worker.js'; Description = 'Sincronizacao com o Oracle (MV), webhooks e limpezas do Higi Leito PRO.' }
)
$WinSwUrl = 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe'
$WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) { Write-Host "    OK: $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "    ATENCAO: $Message" -ForegroundColor Yellow }

function Assert-Administrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Abra o PowerShell com "Executar como administrador" e rode o script de novo.'
    }
}

function Assert-ExitCode([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What falhou (codigo $LASTEXITCODE). Veja as mensagens acima." }
}

function Read-DotEnv {
    $values = @{}
    if (-not (Test-Path $EnvFile)) { return $values }
    foreach ($line in [System.IO.File]::ReadAllLines($EnvFile, $Utf8NoBom)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            $values[$Matches[1]] = $value
        }
    }
    return $values
}

function Set-DotEnvValue([string]$Key, [string]$Value) {
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path $EnvFile) { $lines.AddRange([System.IO.File]::ReadAllLines($EnvFile, $Utf8NoBom)) }
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "^\s*$Key\s*=") {
            $lines[$i] = "$Key=$Value"
            $found = $true
        }
    }
    if (-not $found) { $lines.Add("$Key=$Value") }
    [System.IO.File]::WriteAllLines($EnvFile, $lines, $Utf8NoBom)
}

function New-RandomSecret([int]$Length = 32) {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'.ToCharArray()
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Get-PostgresBin {
    $candidates = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
        Sort-Object { [int]($_.Directory.Parent.Name -replace '[^\d].*$', '') } -Descending
    if (-not $candidates) {
        throw 'PostgreSQL nao encontrado em C:\Program Files\PostgreSQL. Instale o PostgreSQL 17 (veja docs\DEPLOY.md, passo 2).'
    }
    return $candidates[0].Directory.FullName
}

function Get-PostgresServiceName {
    $service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $service) { throw 'O servico do PostgreSQL nao foi encontrado. Confira a instalacao do PostgreSQL.' }
    return $service.Name
}

function Get-DatabaseConnection {
    $envValues = Read-DotEnv
    if (-not $envValues['DATABASE_URL']) { throw "DATABASE_URL nao esta configurada em $EnvFile." }
    $uri = [Uri]$envValues['DATABASE_URL']
    $userInfo = $uri.UserInfo.Split(':', 2)
    return @{
        Host = $uri.Host
        Port = $(if ($uri.Port -gt 0) { $uri.Port } else { 5432 })
        User = [Uri]::UnescapeDataString($userInfo[0])
        Password = $(if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { '' })
        Database = $uri.AbsolutePath.TrimStart('/')
    }
}

function Get-AppUrl([string]$HostName = 'localhost') {
    $envValues = Read-DotEnv
    $port = $(if ($envValues['PORT']) { $envValues['PORT'] } else { '3000' })
    $protocol = $(if ($envValues['HIGI_TLS_PFX_PATH']) { 'https' } else { 'http' })
    return "${protocol}://${HostName}:$port"
}

function Wait-AppHealth([int]$TimeoutSeconds = 60) {
    $url = "$(Get-AppUrl)/api/health"
    # Certificado interno costuma nao valer para "localhost"; so este teste local ignora a validacao.
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return $true }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $false
}

function Get-ServiceWrapperPath([string]$ServiceId) { return Join-Path $ToolsDir "$ServiceId.exe" }

function Install-WinSw {
    New-Item -ItemType Directory -Force $ToolsDir | Out-Null
    $template = Join-Path $ToolsDir 'WinSW-x64.exe'
    if (-not (Test-Path $template)) {
        Write-Host '    Baixando WinSW (gerenciador de servicos)...'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $WinSwUrl -OutFile $template -UseBasicParsing
    }
    $hash = (Get-FileHash $template -Algorithm SHA256).Hash
    if ($hash -ne $WinSwSha256) {
        Remove-Item $template -Force
        throw "O WinSW baixado nao confere com o hash esperado ($hash). Download corrompido ou adulterado."
    }
    return $template
}

function Write-ServiceConfig($Service, [string]$NodePath, [string]$PostgresService) {
    $xml = @"
<service>
  <id>$($Service.Id)</id>
  <name>$($Service.Name)</name>
  <description>$($Service.Description)</description>
  <executable>$NodePath</executable>
  <arguments>$($Service.Script)</arguments>
  <workingdirectory>$Root</workingdirectory>
  <depend>$PostgresService</depend>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="5 sec" />
  <onfailure action="restart" delay="15 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>20 sec</stoptimeout>
  <env name="NODE_ENV" value="production" />
  <logpath>$LogsDir</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>10</keepFiles>
  </log>
</service>
"@
    [System.IO.File]::WriteAllText((Join-Path $ToolsDir "$($Service.Id).xml"), $xml, $Utf8NoBom)
}

function Stop-AppServices {
    foreach ($service in $Services) {
        if (Get-Service -Name $service.Id -ErrorAction SilentlyContinue) {
            Stop-Service -Name $service.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Start-AppServices {
    foreach ($service in $Services) { Start-Service -Name $service.Id }
}
