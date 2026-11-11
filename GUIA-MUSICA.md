# Música nas calls

A integração segue a ideia do [Stoat Simple Music Bot](https://github.com/ANBAL534/stoat-simple-music-bot): obter áudio de vídeos e publicá-lo em uma sala LiveKit. Os comandos e a autenticação foram implementados para o Progresso Gang; o código do bot Stoat não é incorporado. O projeto de referência é licenciado sob GPL-3.0.

No PC do servidor, instale Python 64 bits e execute `powershell -ExecutionPolicy Bypass -File scripts/preparar-musica.ps1` uma vez na raiz do projeto. O comando instala as dependências isoladamente em `.tools/music-venv`; depois reabra o atalho do chat. Não configure tokens ou credenciais nesse ambiente. As permissões para a sala são criadas pelo servidor do chat.

Entre na call, clique no ícone de música e adicione um link do YouTube. A fila é separada por canal e fica apenas em memória: reiniciar o servidor a limpa. Somente quem estiver na call pode consultar ou controlar a fila. O áudio aparece como participante Música, e cada pessoa pode ajustar seu volume individualmente. Reproduções dependem da disponibilidade do vídeo e do serviço de origem.
