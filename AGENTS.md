# Convenções do repositório

Este projeto é o Progresso Gang - Chat. O cliente React/TypeScript e Vite está em `client/`; a API Fastify e o banco SQLite ficam em `server/`. O LiveKit atende as chamadas, e `scripts/abrir-chat.cjs` inicia os serviços no Windows com acesso privado via Tailscale.

## Alterações

- Leia o código e o estado do Git antes de editar. Preserve alterações locais, as pastas duplicadas e o histórico de conversas existentes.
- Faça alterações pequenas, legíveis e compatíveis com dados e usuários existentes. Use os componentes e padrões do projeto antes de criar dependências.
- Mantenha a interface em português, acessível por teclado e adaptável a computador e celular. Confira as telas afetadas e os estados de erro.
- Separe permissões por conta no servidor. Não confie em verificações feitas apenas no navegador. Mensagens antigas sem conta vinculada não devem ser atribuídas a alguém com base no apelido.
- Ao alterar a versão necessária da API, mantenha sincronizados o indicador de saúde do servidor e a versão exigida pelo iniciador.

## Dados e segurança

- `server/data/chat.sqlite` contém dados reais, incluindo mensagens, anexos, contas e sons. Antes de operações que possam alterar ou migrar o banco real, faça um backup consistente do SQLite. Use bancos isolados nos testes e preserve os arquivos originais.
- Nunca inclua senhas, tokens, chaves LiveKit, links privados de configuração, arquivos `.env`, banco de dados, logs ou configurações privadas no Git, em exemplos ou em saídas de comandos. Não revele seus valores ao inspecionar erros.
- Mantenha a autenticação, autorização, proteção contra CSRF, validação de arquivos e separação de canais nas alterações de API. Use os mecanismos existentes para sessões e senhas.
- Não enfraqueça a configuração de rede privada, as regras do Gitleaks ou os arquivos ignorados para contornar erros. Investigue detecções e trate segredos expostos como comprometidos.
- O hook de pre-commit é `.githooks/pre-commit`. Ele verifica o conteúdo preparado com `git diff --cached --check` e Gitleaks, ocultando valores detectados. Ative-o em cada clone com `git config core.hooksPath .githooks`. A verificação falha se o Gitleaks não estiver instalado em `.tools/gitleaks/` ou disponível no PATH.
- Para verificar o histórico e os arquivos publicáveis, execute `node scripts/check-secrets.cjs` na raiz. O fluxo do GitHub também verifica segredos no histórico ao receber commits e pull requests.

## Verificação

- No cliente, execute `npm run build`, `npm run lint` e `npm test` quando aplicáveis.
- No servidor, execute `npm test` para alterações de API, banco ou autenticação. Os testes usam bancos isolados.
- Para alterações na chamada ou em mídia, verifique o comportamento no navegador e informe o que ainda depender de teste com outra pessoa ou com dispositivos reais.
