# Central de Controle TBF300

Painel: https://rverao1.github.io/ResultadosTBF300/central-controle.html

Fonte do Prism (inalterada): https://rverao1.github.io/ResultadosTBF300/rodape-scroll-circuito.html

## Ativação segura

O painel fica bloqueado enquanto não existir o segredo `CENTRAL_PASSWORD` no Worker, com pelo menos 16 caracteres. Não use seu token Cloudflare ou GitHub como senha. Não publique a senha no repositório ou em links.

Opção A: no repositório GitHub, em Settings → Secrets and variables → Actions, adicione um repository secret chamado `CENTRAL_PASSWORD`. Escolha uma senha forte e exclusiva (16–256 caracteres). Depois execute novamente o workflow **Deploy Cloudflare Worker**, em Actions → Run workflow. O workflow envia o segredo ao Worker sem publicá-lo no HTML.

Opção B: no Cloudflare, abra Workers & Pages → noisy-sea-5a8a → Settings → Variables and Secrets e adicione `CENTRAL_PASSWORD` do tipo Secret, aplicando a alteração. Não é necessário conceder acesso ao token para o painel.

As rotas públicas de leitura e a transmissão funcionam sem esse segredo; os comandos e uploads não. A sessão do painel expira em 8 horas e é armazenada somente na aba do navegador. Cinco tentativas incorretas bloqueiam o login por 15 minutos por origem de rede.

## Operação

- Automático: placar por nova linha concluída, por 3 minutos; grupos de 3 a cada 30 segundos.
- Placar ligado: mantém o placar manualmente até mudar de modo. Sem resultados, mantém o rodapé.
- Somente rodapé: impede o acionamento do placar enquanto estiver selecionado.
- Ocultar tudo: torna esta página transparente. Não interrompe o vídeo, áudio ou outros elementos do Prism.
- Mensagem: acrescenta texto ou substitui a classificação no scroll, mantendo os créditos.
- Imagem: URL HTTPS ou envio de PNG/JPG/WebP até 500 KB; até 10 uploads. Prévia local antes de aplicar. Imagens ficam atrás do placar/rodapé.

Os comandos são persistidos em um Durable Object SQLite no Worker, com revisão para evitar sobrescrita de comandos simultâneos. A fonte consulta a Central a cada 5 segundos. Falhas de conexão preservam a última configuração conhecida; não é possível garantir um comando remoto enquanto o dispositivo do Prism estiver sem internet. Dados esportivos continuam sendo atualizados separadamente pelo Worker.

O contador de fontes mede comunicação da página, incluindo prévias. Não comprova que o Prism está transmitindo. Uma fonte que confirma a revisão recebeu o comando; modos e carregamento de imagem são informados separadamente.

## Backup e restauração

Ponto anterior à Central: branch `backup/pre-central-20261007` no GitHub, criado antes das alterações. Contém HTML, Worker e configuração anteriores. Segredos de conta não são copiados para o repositório.

Para abandonar a Central sem apagar dados ou alterar o endereço da transmissão:

1. Restaure **apenas** `rodape-scroll-circuito.html` dessa branch em um novo commit na `main`.
2. Aguarde o deploy de GitHub Pages. A verificação de versão da fonte buscará o HTML restaurado.
3. Mantenha o Worker atual e o Durable Object: a API esportiva é compatível, e a página antiga não consultará a Central.

Não remova uma classe Durable Object ou sua migração por simples reversão da configuração: mudanças no armazenamento precisam de migração específica. Não é necessário excluir o armazenamento para restaurar o sistema anterior.

## Testes locais

`node tests/rodape.test.cjs`

`node tests/central.test.cjs`

Não efetue testes de comandos em uma transmissão ativa sem coordenação. Use um ambiente separado ou janela sem transmissão para validar ligar/desligar e a imagem no Prism.
