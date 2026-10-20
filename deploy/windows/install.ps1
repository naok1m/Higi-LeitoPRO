# Primeira instalacao do Higi Leito PRO no Windows Server.
# Uso (PowerShell como administrador, dentro da pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
# Opcional: -ImportJson "C:\caminho\users.json" para trazer os dados do sistema antigo.
# Pode ser rodado de novo com seguranca: o que ja existe e mantido.
param(
    [string]$ImportJson = ''
)

. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
Set-Location $Root

Write-Step '1/9 Conferindo o Node.js'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js nao encontrado. Instale o Node.js 22 LTS ou mais novo (veja docs\DEPLOY.md, passo 1).' }
$nodeVersion = [Version]((& node -v).TrimStart('v'))
if ($nodeVersion -lt [Version]'22.12.0') { throw "Node.js $nodeVersion e antigo demais. Instale o Node.js 22 LTS ou mais novo." }
$nodePath = $nodeCommand.Source
Write-Ok "Node.js $nodeVersion em $nodePath"

Write-Step '2/9 Conferindo o PostgreSQL'
$pgBin = Get-PostgresBin
$pgService = Get-PostgresServiceName
Write-Ok "PostgreSQL em $pgBin (servico $pgService)"

Write-Step '3/9 Arquivo de configuracao (.env)'
if (Test-Path $EnvFile) {
    Write-Ok '.env ja existe; mantido como esta.'
} else {
    Copy-Item (Join-Path $Root '.env.example') $EnvFile
    $adminEmail = (Read-Host 'E-mail do administrador de TI (usado para criar o primeiro acesso)').Trim().ToLower()
    $superPassword = Read-Host 'Senha do usuario "postgres" (definida ao instalar o PostgreSQL)' -AsSecureString
    $superPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($superPassword))
    $appPassword = New-RandomSecret 32

    Write-Host '    Criando usuario "higi_app" e banco "higi_leito" no PostgreSQL...'
    $env:PGPASSWORD = $superPlain
    try {
        $roleSql = "DO `$`$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'higi_app') THEN CREATE ROLE higi_app LOGIN PASSWORD '$appPassword'; ELSE ALTER ROLE higi_app WITH LOGIN PASSWORD '$appPassword'; END IF; END `$`$;"
        & "$pgBin\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c $roleSql
        Assert-ExitCode 'Criar o usuario do banco'
        $exists = & "$pgBin\psql.exe" -h 127.0.0.1 -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'higi_leito'"
        Assert-ExitCode 'Consultar os bancos existentes'
        if (-not $exists) {
            & "$pgBin\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE higi_leito OWNER higi_app ENCODING 'UTF8' TEMPLATE template0"
            Assert-ExitCode 'Criar o banco higi_leito'
        }
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }

    Set-DotEnvValue 'DATABASE_URL' "postgres://higi_app:$appPassword@127.0.0.1:5432/higi_leito"
    Set-DotEnvValue 'HIGI_ADMIN_EMAIL' $adminEmail
    Write-Ok 'Banco criado e .env gerado.'
    Write-Host ''
    Write-Host '    Agora preencha a parte do Oracle/MV no .env (copie do seu .env.local antigo).' -ForegroundColor Yellow
    Write-Host '    O Bloco de Notas vai abrir. Salve, feche e volte aqui.' -ForegroundColor Yellow
    Start-Process notepad.exe $EnvFile -Wait
}

Write-Step '4/9 Instalando dependencias (npm ci)'
& npm ci --no-audit --no-fund
Assert-ExitCode 'npm ci'

Write-Step '5/9 Gerando as telas (npm run build)'
& npm run build
Assert-ExitCode 'npm run build'

Write-Step '6/9 Criando as tabelas (npm run db:migrate)'
& npm run db:migrate
Assert-ExitCode 'npm run db:migrate'

if ($ImportJson) {
    Write-Step 'Importando dados do sistema antigo'
    & npm run db:import-json -- $ImportJson
    Assert-ExitCode 'Importacao do users.json'
}

Write-Step '7/9 Registrando os servicos do Windows'
New-Item -ItemType Directory -Force $LogsDir | Out-Null
$template = Install-WinSw
foreach ($service in $Services) {
    $wrapper = Get-ServiceWrapperPath $service.Id
    if (Get-Service -Name $service.Id -ErrorAction SilentlyContinue) {
        Stop-Service -Name $service.Id -Force -ErrorAction SilentlyContinue
        & $wrapper uninstall | Out-Null
    }
    Copy-Item $template $wrapper -Force
    Write-ServiceConfig $service $nodePath $service.Script $pgService
    & $wrapper install
    Assert-ExitCode "Instalar o servico $($service.Id)"
    Write-Ok "$($service.Id) instalado (inicia sozinho com o Windows)"
}

Write-Step '8/9 Firewall e backup diario'
$envValues = Read-DotEnv
$port = [int]$envValues['PORT']
if (-not $port) { $port = 3000 }
if ($envValues['HOST'] -eq '127.0.0.1') {
    Write-Ok "HOST=127.0.0.1: a porta $port fica so interna (acesso pelo proxy, veja deploy\windows\proxy)"
} else {
    $ruleName = "Higi Leito PRO (TCP $port)"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Domain, Private | Out-Null
    }
    Write-Ok "Porta $port liberada para a rede do dominio/privada"
}

$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "$ServicePrefix-Backup" -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Write-Ok 'Backup agendado todos os dias as 02:00'

Write-Step '9/9 Iniciando'
Start-AppServices
if (Wait-AppHealth 60) {
    Write-Ok 'Sistema no ar!'
} else {
    Write-Warn 'A API nao respondeu em 60s. Rode deploy\windows\status.ps1 e veja os logs em logs\.'
    exit 1
}

$hostName = [System.Net.Dns]::GetHostName()
Write-Host ''
Write-Host "Acesso na rede do hospital: $(Get-AppUrl $hostName)" -ForegroundColor Green
Write-Host "Primeiro acesso: abra $(Get-AppUrl) NESTE servidor e crie o administrador com o e-mail do .env." -ForegroundColor Green
