# Progresso Gang - Chat

## Abrir depois de ligar o PC

1. Entre normalmente no Windows e confira se o Tailscale esta conectado.
2. Clique duas vezes em **Progresso Gang Chat** na Area de Trabalho. O mesmo atalho aparece ao pesquisar esse nome no menu Iniciar.
3. O atalho inicia os servicos que estiverem parados, confere o link privado e abre o navegador. Pode usar o atalho novamente sem criar copias dos servicos.

Os servicos iniciados ficam em segundo plano enquanto este PC estiver ligado. O atalho e manual: ele nao altera a inicializacao automatica do Windows.

## Canais

- **#geral**: conversa por texto. Entrar na comunidade nao conecta a uma chamada nem pede acesso ao microfone.
- **Geral**: voz, camera e compartilhamento de tela.
- **Jogatina**: segundo canal de voz independente.

Abra um canal de voz e clique em Entrar. Enquanto estiver conectado, clicar no outro canal troca sua chamada para la. Microfone desligado continua desligado durante a troca. Camera e transmissao sao encerradas ao trocar de canal.

Clicar em **#geral** abre o texto e mantem a voz conectada. **Sair do canal** encerra somente a chamada: o texto continua disponivel.

## Historico e backup

As mensagens novas do #geral ficam em `server/data/chat.sqlite`. As mensagens do antigo chat temporario de voz nao podem ser recuperadas automaticamente. Para um backup completo, pare o backend antes de copiar a pasta `server/data`; nao substitua o banco com o servidor ligado. As configuracoes secretas ficam em `server/.env` e `server/livekit.tailscale.yaml`.

Registros de inicializacao e de falhas: `server/logs/launcher.log`. Se a abertura falhar, o atalho mostra uma orientacao e pode ser usado novamente depois de conectar o Tailscale.

Mantenha este PC acordado para os amigos acessarem. Cada amigo usa o site com seu proprio acesso autorizado no Tailscale.

## Verificacoes de desenvolvimento

- `client`: npm run build e npm run lint.
- `server`: npm test (testes isolados; nao escrevem no chat da comunidade).
## Controles de chamada

- Use os botoes de camera/tela para escolher o destaque. **Automatico** prioriza uma transmissao ativa e **Ver em grade** mostra as fontes disponiveis. No celular, use o seletor **Destaque**.
- **Tela cheia** expande o destaque. Se o navegador nao permitir a tela cheia nativa, o site expande dentro da pagina. Use **Reduzir** ou Escape para voltar.
- **Reduzir ruidos** liga ou desliga a supressao nativa do navegador para seu microfone, mantendo cancelamento de eco e controle de ganho. A preferencia fica salva neste navegador. O resultado depende do suporte do navegador e do dispositivo; o site informa quando nao consegue confirmar a ativacao.
- No painel **Audio dos amigos · so para voce**, controle **Voz** e **Transmissao** separadamente. O botao de alto-falante ao lado de um amigo na barra lateral tambem silencia ou reativa a voz dele apenas para voce. Esses controles nao alteram o microfone do amigo nem o audio recebido pelas outras pessoas.
- O silenciamento individual vale para os participantes dessa conexao. Ele nao e uma moderacao global nem uma configuracao de conta de usuario.

## Imagens, GIFs e conversas das calls

- No #geral ou no chat lateral da call, use **Imagem / GIF**, cole uma imagem ou arraste arquivos para a area de escrita.
- Cada mensagem aceita ate quatro anexos PNG, JPG, WebP ou GIF, com ate 8 MB por arquivo. Para preservar a animacao, prefira anexar o arquivo .gif.
- Clique na imagem para ampliar. GIFs podem ser pausados e retomados; a preferencia de reduzir movimentos do navegador e respeitada inicialmente.
- O botao **Chat da call** abre a conversa do canal de voz em que voce esta. Geral e Jogatina tem historicos diferentes, separados do #geral. Esses historicos continuam salvos depois de sair da chamada.
- O texto e os anexos ficam no mesmo banco `server/data/chat.sqlite`; o backup da pasta data inclui ambos. As imagens sao verificadas e processadas no servidor antes de serem publicadas.
- O limite inicial e de 512 MB de anexos armazenados. Atingir esse limite impede novos anexos, mas nao o envio de texto. Anexos enviados mas nao publicados em nenhuma mensagem por mais de 24 horas sao descartados pelo servidor.
- Ainda nao ha contas de usuario. A rede Tailscale continua controlando o acesso ao site; conversas separadas nao representam permissoes individuais por conta.
