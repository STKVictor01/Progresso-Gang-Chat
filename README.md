# Progresso Gang - Chat

Chat criado para reunir amigos em uma comunidade privada, com identidade visual construtivista brasileira em vermelho, carvao e tons de papel.

## Recursos

- Canal de texto **#geral**, independente de chamadas, com historico salvo em SQLite.
- Dois canais de voz separados: **Geral** e **Jogatina**.
- Microfone, camera e compartilhamento de tela com audio quando permitido pelo navegador.
- Conversa de texto enquanto a chamada continua conectada.
- Destaque alternavel entre cameras e transmissoes, grade e tela cheia.
- Supressao de ruido nativa com opcao salva no navegador.
- Silenciamento local por amigo, separado para voz e audio da transmissao.
- Interface em portugues, adaptada para computador e celular.
- Acesso privado com Tailscale e atalho de abertura no Windows.

## Estrutura

- `client/`: React, TypeScript, Vite e componentes LiveKit.
- `server/`: API Fastify, emissao de acessos LiveKit e historico em SQLite.
- `scripts/abrir-chat.cjs`: iniciador manual para Windows.
- `COMO-ABRIR.md`: guia de uso no PC que hospeda o projeto.

## Preparar o ambiente

O projeto foi testado no Windows com Node.js 26, npm e LiveKit Server. A hospedagem privada tambem usa Tailscale.

1. Instale as dependencias:

   ```powershell
   cd client
   npm ci
   cd ../server
   npm ci
   ```

2. Copie `server/.env.example` para `server/.env` e configure o endereco e as chaves do seu LiveKit.
3. Para o servidor LiveKit, use `server/livekit.example.yaml` como referencia. O arquivo real e suas chaves ficam apenas no seu PC. As chaves devem corresponder as definidas no `.env`.
4. Inicie o LiveKit com sua configuracao. Para a instalacao atual do iniciador Windows, o executavel fica em `C:\livekit\livekit-server.exe` e a configuracao privada em `server/livekit.tailscale.yaml`.
5. Em terminais separados, inicie a API e o site:

   ```powershell
   # Na pasta server
   npm start
   ```

   ```powershell
   # Na pasta client
   npm run dev
   ```

6. Abra `http://localhost:5173`.

## Acesso privado e iniciador

Com o Tailscale conectado, `node scripts/abrir-chat.cjs` inicia os servicos necessarios e abre o endereco HTTPS privado da maquina. O iniciador pressupoe as dependencias e a configuracao local acima. O acesso de outros PCs depende de autorizacao na sua rede Tailscale.

O nome privado da maquina e passado pelo iniciador para o Vite na variavel `PG_CHAT_HOST`; nao precisa ser publicado no codigo.

## Audio da transmissao

Em navegadores compativeis, compartilhe uma aba com a opcao **Compartilhar audio da aba** marcada. O site informa se existe uma faixa de audio compartilhada. A disponibilidade de audio de janela ou sistema depende do navegador.

## Verificacoes

```powershell
# Na pasta client
npm run build
npm run lint
npm test

# Na pasta server
npm test
```

Os testes do servidor usam bancos isolados e nao escrevem na conversa da comunidade.

## Dados locais

O historico fica em `server/data/chat.sqlite` no PC hospedeiro. Credenciais, banco, registros, dependencias e builds sao ignorados pelo Git. A identificacao atual e feita por apelido; o controle de acesso e fornecido pela rede privada. Este projeto nao implementa contas de usuario nem permissoes administrativas por participante.

As pastas duplicadas de tentativas antigas de criacao do projeto continuam preservadas no PC e ficam fora do repositorio.
