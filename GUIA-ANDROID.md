# Como usar o Progresso Gang Chat no Android

## Antes de começar

- O PC que hospeda o chat precisa estar ligado, conectado ao Tailscale e com o atalho **Progresso Gang Chat** aberto.
- Cada pessoa precisa de acesso autorizado ao PC pela rede privada do Tailscale e de uma conta no chat. Se não tiver uma conta no chat, peça um convite ao administrador.

## Entrar pelo celular

1. Instale o [Tailscale para Android](https://tailscale.com/docs/install/android) pela loja indicada na página oficial.
2. Abra o aplicativo, entre com sua própria conta e aceite a solicitação de conexão VPN do Android. Deixe o Tailscale conectado.
3. Confirme com o administrador que seu aparelho foi autorizado a acessar o PC do chat.
4. Peça ao administrador o endereço privado atual do site. No PC, ele pode usar **Copiar endereço**. Abra o link HTTPS no Chrome ou no Opera do celular.
5. Entre com sua conta. Se ainda não tiver uma, use o convite individual enviado pelo administrador para criá-la.

## Conversar e entrar em uma call

1. Toque no botão de três linhas no canto superior esquerdo para abrir os canais.
2. Toque em **#geral** para conversar por texto ou escolha um canal de voz, como **Geral** ou **Jogatina**.
3. Na página do canal de voz, escolha se quer entrar com o microfone ligado e toque em **Entrar**. Quando o navegador pedir, permita o acesso ao microfone. Para usar câmera, autorize também o acesso à câmera ao ligá-la.
4. Durante a call, use os controles inferiores para o microfone, câmera, chat da call e saída. Para ajustar o volume de uma pessoa, abra o menu de canais e toque no nome dela na lista da call.
5. Para marcar alguém, digite **@** no campo de mensagem e selecione a pessoa. Se o site estiver fechado, o aviso será mostrado quando ela voltar a abri-lo; não é uma notificação externa com o navegador fechado.

## Música

Na call, toque no ícone de música. Digite o nome da música ou cole um link do YouTube e escolha **Adicionar à fila**. A busca usa o primeiro resultado. O bot aparece na call como **Música**, com volume ajustável como os demais participantes. Alguns vídeos podem estar indisponíveis.

## Tela e áudio

O teste no Android confirmou mensagens, microfone, áudio e retorno após trocar de aplicativo. Também há um botão com ícone de celular e **+** que solicita ao navegador manter a tela ligada enquanto o chat estiver visível. O botão não impede bloquear a tela manualmente. No teste informado, o áudio parou ao bloquear a tela; esse comportamento ainda está em investigação. Câmera e transmissão de tela variam conforme o navegador e precisam ser testadas no aparelho.

## Se não abrir

- Confirme se o Tailscale está conectado no celular e no PC, e se o aparelho tem acesso autorizado ao PC.
- Confirme se o atalho do chat está aberto e peça o endereço HTTPS atual; ele pode mudar se o nome do PC mudar.
- Se a página abrir sem áudio, confira o volume, o botão de microfone e as permissões do navegador. Atualize a página e entre novamente na call.
- Se o problema ocorrer apenas fora do Wi-Fi, confira a conexão de dados do celular e se o Tailscale permanece conectado.
