# Redefine a senha do usuario "postgres" quando ela nao funciona mais.
# Use SO se este PostgreSQL foi instalado para o Higi (nao em um banco de outro projeto).
#
# Como funciona: libera o acesso sem senha SOMENTE a partir do proprio servidor, troca a
# senha e devolve a configuracao original, mesmo que algo de errado no meio.
#
# Uso (PowerShell como administrador, na pasta do projeto):
#   powershell -ExecutionPolicy Bypass -File deploy\windows\reset-postgres-password.ps1

. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator

$service = Get-PostgresService
if (-not $service) { throw 'Nenhum servico do PostgreSQL encontrado.' }
if ($service.PathName -notmatch '-D\s+"([^"]+)"') { throw "Nao consegui achar a pasta de dados no servico: $($service.PathName)" }
$dataDir = $Matches[1]
$hba = Join-Path $dataDir 'pg_hba.conf'
if (-not (Test-Path $hba)) { throw "Arquivo nao encontrado: $hba" }
$pgBin = Get-PostgresBin
$port = Get-PostgresPort

Write-Host ''
Write-Host 'Este PostgreSQL vai ter a senha do usuario "postgres" redefinida:' -ForegroundColor Yellow
Write-Host "  Servico: $($service.Name)  (estado: $($service.State))"
Write-Host "  Dados:   $dataDir"
Write-Host "  Porta:   $port"
Write-Host 'Confirme que ele foi instalado para o Higi (e nao e de outro sistema).' -ForegroundColor Yellow
if ((Read-Host 'Digite REDEFINIR para continuar') -ne 'REDEFINIR') { Write-Host 'Cancelado.'; exit 0 }

$newPassword = Read-Host 'Nova senha do usuario "postgres"' -AsSecureString
$confirmPassword = Read-Host 'Repita a nova senha' -AsSecureString
$toPlain = { param($secure) [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)) }
$plain = & $toPlain $newPassword
if ($plain -ne (& $toPlain $confirmPassword)) { throw 'As senhas digitadas nao sao iguais. Nada foi alterado.' }
if ($plain.Length -lt 12) { throw 'Use uma senha com pelo menos 12 caracteres. Nada foi alterado.' }

$backup = "$hba.antes-reset"
Copy-Item $hba $backup -Force
$changed = $false
try {
    Write-Step 'Liberando acesso local temporario'
    $lines = [System.IO.File]::ReadAllLines($hba)
    $patched = foreach ($line in $lines) {
        if ($line -match '^\s*host\s+all\s+all\s+(127\.0\.0\.1/32|::1/128)\s') {
            $line -replace '(scram-sha-256|md5|password)\s*$', 'trust'
        } else {
            $line
        }
    }
    [System.IO.File]::WriteAllLines($hba, $patched, $Utf8NoBom)
    $changed = $true
    Restart-Service -Name $service.Name -Force

    Write-Step 'Trocando a senha'
    $sql = "ALTER USER postgres PASSWORD '$($plain.Replace("'", "''"))'"
    $output = Invoke-Native { & "$pgBin\psql.exe" -h 127.0.0.1 -p $port -U postgres -d postgres -w -c $sql }
    if ($LASTEXITCODE -ne 0) { throw "O PostgreSQL nao aceitou a troca: $($output -join ' ')" }
    Write-Ok 'Senha alterada'
} finally {
    Write-Step 'Devolvendo a configuracao original de acesso'
    Copy-Item $backup $hba -Force
    Remove-Item $backup -Force
    if ($changed) { Restart-Service -Name $service.Name -Force }
    Write-Ok "pg_hba.conf restaurado e $($service.Name) reiniciado"
}

Write-Step 'Testando a senha nova'
$env:PGPASSWORD = $plain
try {
    $test = Invoke-Native { & "$pgBin\psql.exe" -h 127.0.0.1 -p $port -U postgres -d postgres -tAc 'SELECT 1' }
    if ($LASTEXITCODE -eq 0) {
        Write-Ok 'Funcionou. Guarde a senha nova no cofre da TI e rode o install.ps1 de novo.'
    } else {
        Write-Warn "A senha nova nao funcionou: $($test -join ' ')"
    }
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
