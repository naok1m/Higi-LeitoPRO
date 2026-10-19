# Higi Leito PRO

Aplicação local para controle de higienização de leitos. O frontend é executado com Vite, e as contas e os dados do sistema são armazenados no computador que hospeda o app. Não é necessário configurar Base44, Deno ou OAuth.

## Requisitos

- Node.js 20.19+ ou 22.12+
- npm

## Executar em desenvolvimento

Na pasta do projeto, instale as dependências e inicie o Vite:

```bash
npm install
npm run dev
```

No computador que está executando o projeto, abra o endereço informado pelo Vite, normalmente `http://localhost:5173`. Para acessar de outro dispositivo conectado à mesma rede:

1. Descubra o endereço IPv4 do computador que está executando o Vite com `ipconfig` no Windows.
2. No outro dispositivo, abra `http://ENDERECO-IP:5173`, substituindo `ENDERECO-IP` pelo IPv4 encontrado (por exemplo, `http://192.168.1.20:5173`).
3. Se o Firewall do Windows solicitar, permita o acesso em redes privadas.

O acesso pela rede funciona enquanto o computador e o servidor Vite estiverem ligados. Configure o primeiro administrador conforme a seção abaixo; depois, o administrador cria as contas dos gestores, colaboradores e usuários de rouparia. As contas e os dados compartilhados ficam em `%LOCALAPPDATA%\HigiLeitoPro\users.json` no computador que executa o app. Como o app não envia e-mails, solicite o link de redefinição em `http://localhost:5173` no próprio computador host.

Na primeira utilização depois desta atualização, abra o app em `http://localhost:5173` no computador host e entre na conta usada anteriormente. Os registros que estavam salvos nesse navegador serão importados uma única vez para o armazenamento compartilhado; depois, ficarão disponíveis nos outros dispositivos. Mantenha o computador host ligado e conectado à rede para que os demais dispositivos possam consultar e alterar os dados.

## Webhook e atualizações em tempo real

Para enviar eventos a uma URL de webhook (por exemplo, n8n, Make, Power Automate ou seu próprio servidor), crie `.env.local` na pasta do projeto no computador host:

```dotenv
HIGI_WEBHOOK_URL=https://seu-destino.example/webhook
HIGI_WEBHOOK_SECRET=troque-por-um-segredo-compartilhado
```

`HIGI_WEBHOOK_SECRET` é opcional. Quando definido, o app assina o corpo JSON com HMAC-SHA256 e envia a assinatura no cabeçalho `X-Higi-Signature` (`sha256=<hex>`). O destino também recebe `X-Higi-Event` e `X-Higi-Delivery`. Salve o arquivo e reinicie `npm run dev` para carregar a configuração; mantenha a URL e o segredo somente no host.

O webhook envia um `POST` JSON para criações, edições e exclusões de unidades, leitos, equipe, materiais, verificações e tarefas, além de criação, alteração de perfil/estado e redefinição de contas. Os eventos de registro usam `entity.created`, `entity.updated` ou `entity.deleted`; uma mudança no status do leito usa `bed.status_changed`. Esses eventos contêm `id`, `source`, `occurredAt`, `actor`, `entity` e `record`; atualizações também contêm `previousRecord` e `changedFields`. O ator informa a conta autenticada que realizou a alteração. A importação inicial emite `entities.imported`. Falhas temporárias são repetidas até três vezes e registradas no console do servidor.

As telas abertas recebem os mesmos eventos em tempo real e atualizam consultas e relatórios automaticamente. Por isso, o webhook recebe os registros afetados, que podem incluir informações da equipe e da operação; configure apenas um destino confiável e protegido por HTTPS.

## Integração Oracle

No computador host, configure a conexão de leitura ao Oracle no arquivo `.env.local` e reinicie o Vite:

```dotenv
HIGI_ORACLE_USER=usuario_de_consulta
HIGI_ORACLE_PASSWORD=senha_do_usuario
HIGI_ORACLE_CONNECT_STRING=//servidor-oracle:1521/nome-do-servico
HIGI_ORACLE_CLIENT_LIB_DIR=C:\oracle\instantclient_23_9
HIGI_ORACLE_COMPANIES=1,18,19
HIGI_ORACLE_POLL_INTERVAL_MS=2000
```

Esta conexão usa o Thick mode do `node-oracledb`, necessário para autenticar com o verificador de senha Oracle deste banco. Instale no computador host o Oracle Instant Client **Basic** (ou Basic Light), da mesma arquitetura do Node.js — normalmente Windows x64 — e aponte `HIGI_ORACLE_CLIENT_LIB_DIR` para a pasta descompactada que contém `OCI.dll`. O caminho acima é apenas um exemplo; use a pasta realmente instalada. Se as bibliotecas estiverem disponíveis no `PATH` do processo, a variável pode ser omitida. Reinicie o Vite depois de instalar/configurar o client.

Use um usuário Oracle autorizado a consultar a view `YGOR_HUBCE.VW_HIGIENIZACAO_LEITOS` e executar `YGOR_HUBCE.PRC_LIBERAR_LEITO_HIGIENIZACAO`. A conexão do exemplo usa o formato `//host:porta/serviço`; também é possível usar um alias TNS se ele estiver configurado para o usuário do Windows que executa o Vite. O intervalo mínimo aceito é de 2 segundos. `HIGI_ORACLE_COMPANIES` aceita uma lista separada por vírgulas: `1` (Otoclínica), `18` (Gastroclínica) e `19` (São Mateus). O app consulta os leitos retornados pela view para essas empresas, mantendo cada registro associado à empresa de origem, e não consulta dados de atendimento. A variável antiga `HIGI_ORACLE_COMPANY` continua aceita para instalações de uma única empresa; para habilitar as três, substitua-a por `HIGI_ORACLE_COMPANIES=1,18,19`.

Quando o gestor inicia e aprova a revisão, depois da higienização, rouparia e conferência, o app chama a procedure para o leito importado do Oracle. Em caso de sucesso, a procedure e o commit liberam o leito como vago no MV e o app conclui o processo local. Em caso de erro Oracle com rollback confirmado, a revisão permanece pendente e pode ser tentada novamente depois de corrigir a causa. Se a conexão cair com resultado incerto, a revisão não é concluída e a liberação não é repetida automaticamente; confira o estado do leito no MV antes de qualquer nova ação. Leitos manuais não são enviados ao MV. Unidades/postos e leitos passaram a ser exclusivamente importados do MV; o gestor ou administrador pode excluir os cadastros manuais antigos na tela **Unidades e leitos**. A limpeza desses cadastros preserva os processos históricos locais.

Leitos retornados são importados/atualizados no armazenamento compartilhado do app. Se a view fornecer um leito sem `CD_SOLIC_LIMPEZA`, ele é sinalizado na tela para que a equipe identifique a solicitação sem código. Quando uma solicitação deixa de aparecer na view, ela permanece na fila local; a integração não consegue inferir se foi cancelada, iniciada ou concluída no MV e não apaga nem cancela registros automaticamente.

## Perfis de acesso

Configure o e-mail autorizado para ser o primeiro administrador em `.env.local`, no computador host:

```dotenv
HIGI_ADMIN_EMAIL=ti@exemplo.com
```

Reinicie o Vite e, no próprio computador host, abra `http://localhost:5173/register`. Crie a conta usando exatamente esse e-mail; se ele já tiver uma conta legada no servidor, informe a senha atual para promovê-la. Depois, entre como administrador e abra **Usuários** para criar e gerenciar contas. O cadastro público de novas contas fica desativado.

- **Administrador de TI:** acessa todas as áreas, cria e gerencia usuários, perfis e contas ativas.
- **Gestor do setor:** acessa leitos, limpeza, rouparia, equipe, histórico, relatórios e o painel de monitoramento; em **Utensílios**, gerencia somente os materiais usados na conferência. Não gerencia usuários nem unidades.
- **Colaborador:** acessa somente as telas Limpeza e Rouparia. O cadastro da equipe define se cada matrícula pertence à função **Higienização e limpeza** ou **Rouparia**; ao iniciar uma etapa, a pessoa informa a matrícula e o sistema confirma o nome e a função. Uma matrícula não pode iniciar a etapa da outra função.
- **Rouparia:** acessa somente a tela Rouparia e inicia/conclui essa etapa informando a matrícula de um colaborador ativo da função Rouparia; não acessa as demais etapas ou áreas administrativas.

O TI pode vincular uma ou mais empresas a cada conta. A pessoa troca a empresa ativa pelo seletor no topo da tela, sem sair da conta; os registros, indicadores, relatórios e operações ficam isolados pela empresa selecionada. Ao cadastrar um colaborador, selecione a empresa a que ele pertence. Usuários antigos e registros manuais/históricos sem empresa são associados à Otoclínica (código 1); leitos e unidades Oracle mantêm o código MV correspondente.

Os relatórios aceitam datas inicial e final personalizadas. **Processos e tempos** mostra a proporção entre operação e ociosidade em gráficos de pizza, no total e por unidade. As tabelas podem ser exportadas em CSV compatível com Excel; use **Imprimir** e escolha salvar como PDF para gerar um PDF do relatório.

O painel **Monitoramento**, disponível para administradores e gestores, apresenta a situação das filas e dos processos ativos e atualiza os indicadores automaticamente a cada 10 segundos. As tabelas dos relatórios se adaptam a telas menores, exibindo os registros em cartões.

Contas antigas sem perfil explícito continuam com acesso de gestor. Proteja o `.env.local` e use apenas uma rede confiável.

## Processo de liberação do leito

Cada solicitação segue as etapas de higienização, rouparia (incluindo a troca de roupas de cama) e revisão do líder de hotelaria. Ao concluir a higienização, o leito sai da tela Limpeza e aparece na fila de espera da Rouparia; o tempo da rouparia só começa quando o usuário inicia essa etapa. Após sua conclusão, o leito aguarda o início da revisão pelo líder, que também realiza a conferência dos utensílios nessa etapa. O leito só fica disponível após a aprovação da revisão. Se um problema exigir manutenção, registre o motivo em **Acionar manutenção**; o tempo contabilizado para a hotelaria congela nesse instante e não inclui o período posterior. Um administrador ou gestor retoma a etapa depois de confirmar a conclusão da manutenção, sem reiniciar ou acrescentar tempo ao cronômetro congelado. A aba **Processos e tempos** nos relatórios detalha, para cada etapa, o tempo ativo e o tempo ocioso até o início (incluindo a espera desde a solicitação da higienização), além do total da hotelaria; o histórico também apresenta esses tempos.

## Build de produção

```bash
npm run build
npm run preview
```

## Dados e autenticação

Os dados de unidades, leitos, equipe, materiais, verificações e tarefas são armazenados no computador host e compartilhados entre usuários autenticados. A autenticação e o armazenamento locais não substituem um serviço seguro para publicação na internet. Para redefinir uma senha, o app gera um link na própria tela — não envia e-mail.

> Use apenas em uma rede confiável. O servidor de desenvolvimento usa HTTP e não deve ser exposto à internet ou usado para transmitir informações sensíveis.
