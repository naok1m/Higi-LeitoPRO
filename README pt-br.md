# Higi Leito PRO

Sistema de controle de higienização de leitos. O frontend é React (Vite) e o backend é Node.js com banco **PostgreSQL**, rodando em dois processos: a **API** (telas + `/api`) e o **worker** (sincronização com o Oracle/MV, webhooks e limpezas). Não é necessário configurar Base44, Deno ou OAuth.

- **Colocar em produção no Windows Server:** siga [docs/DEPLOY.md](docs/DEPLOY.md).
- **Desenvolver na sua máquina:** veja abaixo.

## Requisitos

- Node.js 22.12+ e npm
- PostgreSQL 17 (em desenvolvimento, `npm run dev:db` sobe um PostgreSQL local sem instalar nada)

## Executar em desenvolvimento

1. Instale as dependências: `npm install`.
2. Copie `.env.example` para `.env.local` e use o banco de desenvolvimento:
   ```dotenv
   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54320/higi_leito
   ```
3. Abra três terminais na pasta do projeto:
   ```bash
   npm run dev:db      # PostgreSQL local (dados em .dev-db/)
   npm run dev:api     # API em http://localhost:3000 (reinicia ao salvar arquivos)
   npm run dev         # telas em http://localhost:5173 (repassa /api para a API)
   ```
   O worker (`npm run dev:worker`) só é necessário para testar a sincronização com o Oracle e os webhooks.
4. Para trazer os dados do antigo `%LOCALAPPDATA%\HigiLeitoPro\users.json`: `npm run db:import-json`.

Testes do backend (sobem um PostgreSQL temporário): `npm run test:server`.

Configure o primeiro administrador conforme a seção **Perfis de acesso**. Depois, o administrador cria as contas dos gestores, colaboradores e usuários de rouparia. Como o app não envia e-mails, o link de redefinição de senha é gerado no próprio servidor (`http://localhost:3000`).

### Organização do backend

```
server/
  api.js, worker.js   pontos de entrada dos dois processos
  app.js              roteamento de /api
  config/             variáveis de ambiente (.env) e empresas
  routes/             auth, admin, entities, workflow, oracle, structure, events
  services/           regras de negócio, sessões, Oracle, webhooks, tempo real
  repositories/       SQL de usuários, sessões, tokens e estado
  db/                 conexão, migrations (db/migrations/*.sql) e armazenamento dos registros
  integrations/       cliente Oracle (MV)
  scripts/            migrate, import-json, dev-db
  test/               testes com PostgreSQL real
deploy/windows/       install, update, backup, restore, status, uninstall
```

## Webhook e atualizações em tempo real

Para enviar eventos a uma URL de webhook (por exemplo, n8n, Make, Power Automate ou seu próprio servidor), configure no `.env` do servidor (ou `.env.local` em desenvolvimento):

```dotenv
HIGI_WEBHOOK_URL=https://seu-destino.example/webhook
HIGI_WEBHOOK_SECRET=troque-por-um-segredo-compartilhado
```

`HIGI_WEBHOOK_SECRET` é opcional. Quando definido, o app assina o corpo JSON com HMAC-SHA256 e envia a assinatura no cabeçalho `X-Higi-Signature` (`sha256=<hex>`). O destino também recebe `X-Higi-Event` e `X-Higi-Delivery`. Reinicie os serviços (ou `npm run dev:api`/`dev:worker`) para carregar a configuração; mantenha a URL e o segredo somente no servidor.

O webhook envia um `POST` JSON para criações, edições e exclusões de unidades, leitos, equipe, materiais, verificações e tarefas, além de criação, alteração de perfil/estado e redefinição de contas. Os eventos de registro usam `entity.created`, `entity.updated` ou `entity.deleted`; uma mudança no status do leito usa `bed.status_changed`. Esses eventos contêm `id`, `source`, `occurredAt`, `actor`, `entity` e `record`; atualizações também contêm `previousRecord` e `changedFields`. O ator informa a conta autenticada que realizou a alteração. A importação inicial emite `entities.imported`. Cada evento é gravado na tabela `change_events` (trilha de auditoria) e entregue pelo worker; falhas são repetidas até 10 vezes com espera crescente (de 10s até 30min), e o resultado de cada entrega fica registrado na própria tabela.

As telas abertas recebem os mesmos eventos em tempo real e atualizam consultas e relatórios automaticamente. Por isso, o webhook recebe os registros afetados, que podem incluir informações da equipe e da operação; configure apenas um destino confiável e protegido por HTTPS.

## Integração Oracle

Configure a conexão ao Oracle no `.env` do servidor e reinicie os serviços:

```dotenv
HIGI_ORACLE_USER=usuario_de_consulta
HIGI_ORACLE_PASSWORD=senha_do_usuario
HIGI_ORACLE_CONNECT_STRING=//servidor-oracle:1521/nome-do-servico
HIGI_ORACLE_CLIENT_LIB_DIR=C:\oracle\instantclient_23_9
HIGI_ORACLE_COMPANIES=1,18,19
HIGI_ORACLE_POLL_INTERVAL_MS=2000
```

Esta conexão usa o Thick mode do `node-oracledb`, necessário para autenticar com o verificador de senha Oracle deste banco. Instale no servidor o Oracle Instant Client **Basic** (ou Basic Light), da mesma arquitetura do Node.js — normalmente Windows x64 — e aponte `HIGI_ORACLE_CLIENT_LIB_DIR` para a pasta descompactada que contém `OCI.dll`. O caminho acima é apenas um exemplo; use a pasta realmente instalada. Se as bibliotecas estiverem disponíveis no `PATH` do processo, a variável pode ser omitida. Reinicie os serviços depois de instalar/configurar o client.

Use um usuário Oracle autorizado a consultar a view `YGOR_HUBCE.VW_HIGIENIZACAO_LEITOS` e executar `YGOR_HUBCE.PRC_LIBERAR_LEITO_HIGIENIZACAO`. A conexão do exemplo usa o formato `//host:porta/serviço`; também é possível usar um alias TNS se ele estiver configurado para a conta que executa os serviços. O intervalo mínimo aceito é de 2 segundos. `HIGI_ORACLE_COMPANIES` aceita uma lista separada por vírgulas: `1` (Otoclínica), `18` (Gastroclínica) e `19` (São Mateus). O app consulta os leitos retornados pela view para essas empresas, mantendo cada registro associado à empresa de origem, e não consulta dados de atendimento. A variável antiga `HIGI_ORACLE_COMPANY` continua aceita para instalações de uma única empresa; para habilitar as três, substitua-a por `HIGI_ORACLE_COMPANIES=1,18,19`.

Quando o gestor inicia e aprova a revisão, depois da higienização, rouparia e conferência, o app chama a procedure para o leito importado do Oracle. Em caso de sucesso, a procedure e o commit liberam o leito como vago no MV e o app conclui o processo local. Em caso de erro Oracle com rollback confirmado, a revisão permanece pendente e pode ser tentada novamente depois de corrigir a causa. Se a conexão cair com resultado incerto, a revisão não é concluída e a liberação não é repetida automaticamente; confira o estado do leito no MV antes de qualquer nova ação. Leitos manuais não são enviados ao MV. Unidades/postos e leitos passaram a ser exclusivamente importados do MV; o gestor ou administrador pode excluir os cadastros manuais antigos na tela **Unidades e leitos**. A limpeza desses cadastros preserva os processos históricos locais.

Leitos retornados são importados/atualizados no PostgreSQL pelo worker. Se a view fornecer um leito sem `CD_SOLIC_LIMPEZA`, ele é sinalizado na tela para que a equipe identifique a solicitação sem código. Quando uma solicitação deixa de aparecer na view, ela permanece na fila local; a integração não consegue inferir se foi cancelada, iniciada ou concluída no MV e não apaga nem cancela registros automaticamente.

## Perfis de acesso

Configure o e-mail autorizado para ser o primeiro administrador no `.env` do servidor:

```dotenv
HIGI_ADMIN_EMAIL=ti@exemplo.com
```

Reinicie a API e, no próprio servidor, abra `http://localhost:3000/register`. Crie a conta usando exatamente esse e-mail; se ele já tiver uma conta legada no servidor, informe a senha atual para promovê-la. Depois, entre como administrador e abra **Usuários** para criar e gerenciar contas. O cadastro público de novas contas fica desativado.

- **Administrador de TI:** acessa todas as áreas, cria e gerencia usuários, perfis e contas ativas.
- **Gestor do setor:** acessa leitos, limpeza, rouparia, equipe, histórico, relatórios e o painel de monitoramento; em **Utensílios**, gerencia somente os materiais usados na conferência. Não gerencia usuários nem unidades.
- **Colaborador:** acessa somente as telas Limpeza e Rouparia. O cadastro da equipe define se cada matrícula pertence à função **Higienização e limpeza** ou **Rouparia**; ao iniciar uma etapa, a pessoa informa a matrícula e o sistema confirma o nome e a função. Uma matrícula não pode iniciar a etapa da outra função.
- **Rouparia:** acessa somente a tela Rouparia e inicia/conclui essa etapa informando a matrícula de um colaborador ativo da função Rouparia; não acessa as demais etapas ou áreas administrativas.

O TI pode vincular uma ou mais empresas a cada conta. A pessoa troca a empresa ativa pelo seletor no topo da tela, sem sair da conta; os registros, indicadores, relatórios e operações ficam isolados pela empresa selecionada. Ao cadastrar um colaborador, selecione a empresa a que ele pertence. Usuários antigos e registros manuais/históricos sem empresa são associados à Otoclínica (código 1); leitos e unidades Oracle mantêm o código MV correspondente.

Os relatórios aceitam datas inicial e final personalizadas. **Processos e tempos** mostra a proporção entre operação e ociosidade em gráficos de pizza, no total e por unidade. As tabelas podem ser exportadas em CSV compatível com Excel; use **Imprimir** e escolha salvar como PDF para gerar um PDF do relatório.

O painel **Monitoramento**, disponível para administradores e gestores, apresenta a situação das filas e dos processos ativos e atualiza os indicadores automaticamente a cada 10 segundos. As tabelas dos relatórios se adaptam a telas menores, exibindo os registros em cartões.

Contas antigas sem perfil explícito continuam com acesso de gestor. Proteja o `.env` (ele contém as senhas do banco e do Oracle).

## Processo de liberação do leito

Cada solicitação segue as etapas de higienização, rouparia (incluindo a troca de roupas de cama) e revisão do líder de hotelaria. Ao concluir a higienização, o leito sai da tela Limpeza e aparece na fila de espera da Rouparia; o tempo da rouparia só começa quando o usuário inicia essa etapa. Após sua conclusão, o leito aguarda o início da revisão pelo líder, que também realiza a conferência dos utensílios nessa etapa. O leito só fica disponível após a aprovação da revisão. Se um problema exigir manutenção, registre o motivo em **Acionar manutenção**; o tempo contabilizado para a hotelaria congela nesse instante e não inclui o período posterior. Um administrador ou gestor retoma a etapa depois de confirmar a conclusão da manutenção, sem reiniciar ou acrescentar tempo ao cronômetro congelado. A aba **Processos e tempos** nos relatórios detalha, para cada etapa, o tempo ativo e o tempo ocioso até o início (incluindo a espera desde a solicitação da higienização), além do total da hotelaria; o histórico também apresenta esses tempos.

## Dados e autenticação

Usuários, sessões e todos os registros (unidades, leitos, equipe, materiais, verificações e tarefas) ficam no PostgreSQL. As sessões duram 12 horas, sobrevivem a reinícios do servidor e são gravadas apenas como hash. Para redefinir uma senha, o app gera um link na própria tela, sem enviar e-mail.

> Use apenas na rede interna do hospital. Para HTTPS, configure o certificado da TI (`HIGI_TLS_PFX_PATH`); veja [docs/DEPLOY.md](docs/DEPLOY.md).
