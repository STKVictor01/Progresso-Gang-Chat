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
