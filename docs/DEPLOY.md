# Implantação no Windows Server

Guia passo a passo para colocar o Higi Leito PRO no ar no servidor do hospital e mantê-lo rodando 24h.
Tudo é feito pela Área de Trabalho Remota (mstsc), num **PowerShell aberto como administrador**.

## Como o sistema roda no servidor

```
Navegadores na rede do hospital
            │  http://NOME-DO-SERVIDOR:3000
            ▼
┌─ Serviço "HigiLeitoPro-API" ──────┐    ┌─ Serviço "HigiLeitoPro-Worker" ─┐
│ node server/api.js                │    │ node server/worker.js            │
│ • telas (pasta dist/)             │    │ • consulta o Oracle a cada 2s    │
│ • API /api/... (login, leitos...) │    │ • entrega webhooks (com retry)   │
│ • avisos em tempo real (SSE)      │    │ • limpa sessões vencidas         │
└──────────────┬────────────────────┘    └───────────────┬──────────────────┘
               │                                         │
               └──────────►  PostgreSQL (serviço)  ◄─────┘
                             banco "higi_leito"
                             └ backup diário às 02:00 (tarefa agendada)
```

- Os dois serviços sobem sozinhos quando o Windows liga e são reiniciados automaticamente se caírem.
- Não dependem de ninguém estar logado no mstsc: pode desconectar à vontade.
- O worker fica separado da API. Se o Oracle ficar lento ou cair, as telas continuam funcionando.

---

## Instalação (uma vez só)

### Passo 1: instalar o Node.js e o Git

1. Baixe e instale o **Node.js 22 LTS** (ou mais novo) em https://nodejs.org (instalador `.msi`, "Windows Installer 64-bit"). Pode deixar as opções padrão.
2. Baixe e instale o **Git** em https://git-scm.com/download/win. Também pode deixar as opções padrão.
3. Feche e abra o PowerShell de novo e confira:
   ```powershell
   node -v    # deve mostrar v22.x ou mais novo
   git --version
   ```

### Passo 2: instalar o PostgreSQL 17

1. Baixe o instalador do **PostgreSQL 17 para Windows** em https://www.postgresql.org/download/windows/ (link "Download the installer", da EDB).
2. Na instalação:
   - Componentes: deixe **PostgreSQL Server** e **Command Line Tools** marcados (o pgAdmin é opcional; o Stack Builder pode desmarcar).
   - **Senha do superusuário `postgres`**: crie uma senha forte e **guarde-a** (no cofre de senhas da TI). O instalador do Higi vai pedi-la.
   - Porta: **5432** (padrão).
   - Locale: pode deixar o padrão.
3. O PostgreSQL fica instalado como serviço do Windows (`postgresql-x64-17`) e só aceita conexões do próprio servidor. Não abra a porta 5432 no firewall.

### Passo 3: Oracle Instant Client (integração com o MV)

A integração usa o Oracle Instant Client, igual à sua máquina hoje (`C:\Oracle\instantclient...`).

1. Copie a pasta do Instant Client para o servidor (ex.: `C:\Oracle\instantclient_23_0`). A pasta precisa ter o `oci.dll`.
2. Se o Instant Client reclamar de DLL ausente, instale o **Visual C++ Redistributable x64** mais recente da Microsoft.
3. Anote o caminho: ele vai no `.env` como `HIGI_ORACLE_CLIENT_LIB_DIR`.
4. Confirme com a TI/DBA se o servidor alcança o Oracle (mesmo connect string usado no seu `.env.local`).

### Passo 4: baixar o projeto

Use uma pasta **sem espaços e sem acentos** no caminho, por exemplo `C:\HigiLeitoPro`:

```powershell
cd C:\
git clone https://github.com/naok1m/Higi-LeitoPRO.git HigiLeitoPro
cd C:\HigiLeitoPro
```

> Se o repositório for privado, o Git vai pedir login. Use uma conta com acesso de leitura e, como senha, um
> **token de acesso pessoal** do GitHub (Settings → Developer settings → Fine-grained tokens → acesso
> "Contents: Read-only" só a este repositório). O Windows guarda a credencial para os próximos `git pull`.

### Passo 5: rodar o instalador

```powershell
cd C:\HigiLeitoPro
powershell -ExecutionPolicy Bypass -File deploy\windows\install.ps1
```

O instalador:
1. confere o Node.js e o PostgreSQL;
2. pergunta o **e-mail do administrador de TI** e a **senha do `postgres`**, cria o usuário `higi_app` e o banco `higi_leito` com uma senha aleatória e gera o arquivo `.env`;
3. abre o `.env` no Bloco de Notas para você preencher o **Oracle**. Copie do seu `.env.local` as linhas `HIGI_ORACLE_USER`, `HIGI_ORACLE_PASSWORD`, `HIGI_ORACLE_CONNECT_STRING`, `HIGI_ORACLE_CLIENT_LIB_DIR` (com o caminho do passo 3) e `HIGI_ORACLE_COMPANIES` (antes se chamava `HIGI_ORACLE_COMPANY`; os dois nomes funcionam). Salve e feche;
4. instala as dependências, gera as telas e cria as tabelas;
5. registra os serviços **HigiLeitoPro-API** e **HigiLeitoPro-Worker**, libera a porta no firewall e agenda o backup das 02:00;
6. inicia tudo e testa se a API responde.

**Trazendo os dados do sistema antigo:** se o app já estava rodando na sua máquina, os dados estão em
`%LOCALAPPDATA%\HigiLeitoPro\users.json`. Copie esse arquivo para o servidor e rode:

```powershell
npm run db:import-json -- C:\caminho\users.json
```

Você também pode passar `-ImportJson C:\caminho\users.json` para o `install.ps1`. A importação pode ser repetida
sem duplicar nada, e os usuários mantêm as senhas atuais.

### Passo 6: primeiro acesso

1. **No próprio servidor** (pelo mstsc), abra o navegador em `http://localhost:3000`.
2. Crie o administrador com o e-mail informado no instalador. Por segurança, essa tela só funciona no próprio servidor.
3. Dentro do sistema, cadastre os demais usuários (menu de usuários).
4. Nos computadores do hospital, o endereço é `http://NOME-DO-SERVIDOR:3000`. O instalador mostra o endereço exato
   no final; peça à TI um nome amigável no DNS (ex.: `higileito.hospital.local`).

### Passo 7: conferir o backup (obrigatório)

Rode um backup manual e confira se o arquivo `.dump` foi criado:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\backup.ps1
```

Os backups vão para `C:\HigiLeitoPro\backups` e são mantidos por 14 dias. **Recomendado:** apontar
`HIGI_BACKUP_DIR` no `.env` para uma pasta de rede **fora deste servidor** (peça à TI). Se o disco do servidor
morrer, um backup que está nele mesmo não ajuda.

---

## Porta compartilhada com a API FastAPI (porta 8000)

Enquanto a segurança não liberar uma porta só para o Higi, ele usa a mesma porta 8000 da API FastAPI que já roda
no servidor. Quem divide a porta é o **Caddy**, um proxy que roda como serviço do Windows:

```
http://10.85.250.25:8000/higi/...  →  Higi Leito PRO   (127.0.0.1:3000, só interno)
http://10.85.250.25:8000/...       →  API FastAPI      (127.0.0.1:8001, só interno)
```

Para quem usa a FastAPI, os endereços continuam os mesmos. Nada no código da FastAPI muda: só o comando que a inicia.

### Antes de começar

- O Higi já instalado (passos 1 a 7 acima).
- O **comando que inicia a FastAPI** à mão. Hoje ela sobe num cmd com algo como
  `uvicorn main:app --host 10.85.250.25 --port 8000`.
- Um horário combinado com quem usa a FastAPI. Ela fica fora do ar por cerca de 1 minuto durante a troca.

### Instalar

```powershell
cd C:\HigiLeitoPro
powershell -ExecutionPolicy Bypass -File deploy\windows\proxy\install-proxy.ps1
```

O script:
1. baixa o Caddy e confere a integridade dele;
2. coloca o Higi em `/higi` e deixa a porta 3000 só interna (gera as telas de novo e reinicia o Higi);
3. **pausa e pede para você mover a FastAPI**:
   - feche o cmd dela;
   - inicie de novo **só na porta interna**:
     ```
     uvicorn main:app --host 127.0.0.1 --port 8001 --proxy-headers --forwarded-allow-ips 127.0.0.1
     ```
     As duas opções `--proxy-headers ...` fazem a FastAPI continuar vendo o IP real de quem acessa, e não o do proxy.
   - volte ao PowerShell e aperte Enter;
4. instala o serviço **HigiLeitoPro-Proxy** na porta 8000 e testa os dois sistemas.

No final:
- Higi: `http://10.85.250.25:8000/higi`.
- Primeiro administrador e links de redefinição de senha: **no próprio servidor**, em `http://localhost:3000/higi`.

> **Atenção:** a FastAPI continua rodando num cmd aberto. Se o servidor reiniciar ou a sessão do mstsc
> for encerrada, ela para. Como agora o Caddy encaminha para ela, a raiz da porta 8000 responde com erro 502 até
> ela ser iniciada de novo. Vale combinar com o responsável por ela transformá-la em serviço do Windows.

### Quando a segurança liberar uma porta só para o Higi

Ex.: porta 3000.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\proxy\remove-proxy.ps1 -HigiPort 3000
```

O script remove o proxy, volta o Higi para a raiz (`http://10.85.250.25:3000`) e libera a porta no firewall. Depois,
**volte a FastAPI para o comando original** (`--host 10.85.250.25 --port 8000`).

Se a instalação do proxy der errado no meio, o mesmo comando desfaz tudo. Use `-HigiPort 3000` e volte a FastAPI
para a 8000.

---

## Dia a dia

### Publicar uma versão nova

Na sua máquina: faça as alterações, rode os testes (`npm run test:server`) e dê `git push` na branch `main`.
No servidor:

```powershell
cd C:\HigiLeitoPro
powershell -ExecutionPolicy Bypass -File deploy\windows\update.ps1
```

O script baixa a versão nova, faz backup do banco, para os serviços, instala dependências, gera as telas,
atualiza o banco e sobe tudo de novo, ficando fora do ar por cerca de 1 a 2 minutos. Se algo der errado, ele mostra
os comandos para voltar à versão anterior. Prefira atualizar em horário de menor movimento.

### Ver se está tudo funcionando

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\status.ps1
```

Mostra os serviços, o teste de saúde (`/api/health`) e as últimas linhas dos logs.

| O que | Onde |
|---|---|
| Logs da API | `logs\HigiLeitoPro-API.out.log` e `.err.log` |
| Logs do worker (Oracle, webhook) | `logs\HigiLeitoPro-Worker.out.log` e `.err.log` |
| Log dos backups | `backups\backup.log` |
| Logs do proxy (porta 8000) | `logs\HigiLeitoPro-Proxy.*.log` e `logs\proxy-access.log` |
| Serviços | `services.msc` → "Higi Leito PRO - API" / "- Worker" |

Os logs giram sozinhos a cada 10 MB (são mantidos os 10 últimos).

### Reiniciar, parar, iniciar

```powershell
Restart-Service HigiLeitoPro-API, HigiLeitoPro-Worker
Stop-Service HigiLeitoPro-API, HigiLeitoPro-Worker
Start-Service HigiLeitoPro-API, HigiLeitoPro-Worker
```

Depois de mudar o `.env`, reinicie os dois serviços.

### Restaurar um backup

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\restore.ps1 -BackupFile C:\HigiLeitoPro\backups\higi_leito_AAAAMMDD_HHMMSS.dump
```

**Apaga os dados atuais** e coloca os do backup no lugar. O script pede confirmação e faz um backup do estado atual antes.

---

## Problemas comuns

| Sintoma | O que verificar |
|---|---|
| Página não abre nos outros computadores | `status.ps1`; firewall do Windows (regra "Higi Leito PRO"); antivírus/firewall da rede; usar o nome ou IP certo do servidor. |
| `/api/health` responde `database_unavailable` | Serviço `postgresql-x64-17` parado (`services.msc`) ou `DATABASE_URL` errada no `.env`. |
| Leitos do MV não aparecem | `logs\HigiLeitoPro-Worker.err.log`. Mensagens de "Thick mode" indicam caminho errado do Instant Client em `HIGI_ORACLE_CLIENT_LIB_DIR`; mensagens `ORA-` são de conexão ou permissão no Oracle. |
| Serviço fica reiniciando | `logs\*.err.log`. A causa mais comum é um erro no `.env`; a mensagem diz qual variável. |
| "Frontend não encontrado" | Rode `npm run build` na pasta do projeto e reinicie a API. |

## Segurança: o que já está feito e próximos passos

Já está feito:
- Senhas com PBKDF2 (310 mil iterações).
- Sessões gravadas só como hash e com validade de 12h.
- Cookie `HttpOnly` + `SameSite=Strict`.
- Bloqueio de leitura de arquivos fora de `dist/`.
- PostgreSQL acessível só pelo próprio servidor.
- Usuário de banco próprio (`higi_app`) com senha aleatória.
- Trilha de auditoria de todas as alterações (tabela `change_events`: quem fez, o quê e quando).

Recomendado em seguida, com a TI:
1. **HTTPS**: peça à TI um certificado (`.pfx`) para o nome do servidor, coloque o caminho em `HIGI_TLS_PFX_PATH` e a senha em `HIGI_TLS_PFX_PASSPHRASE`, e reinicie a API. O endereço passa a ser `https://...`.
2. **Backups fora do servidor** (`HIGI_BACKUP_DIR` numa pasta de rede).
3. **Usuário Oracle só com o necessário**: leitura na view `vw_higienizacao_leitos` e execução da procedure de liberação.
4. Os serviços rodam como **LocalSystem**. Para endurecer, a TI pode criar uma conta de serviço dedicada
   com permissão só na pasta do projeto e configurá-la em `services.msc` (aba "Logon").

> O proxy usado aqui é o Caddy, que grava o IP real de quem acessa no cabeçalho `X-Forwarded-For` e descarta o
> valor que vier do navegador. O Higi usa esse cabeçalho para manter as telas "somente no servidor" fechadas para a
> rede (`server/http/io.js`, `isHostConnection`). Se um dia trocar o Caddy por outro proxy (IIS, nginx), confira se
> ele faz o mesmo antes de colocar em produção.
