# Convenções do repositório

Este projeto é o Progresso Gang - Chat. O cliente React/TypeScript e Vite está em `client/`; a API Fastify fica em `server/` e usa PostgreSQL no Supabase quando `PG_CHAT_DATABASE=postgres`, ou SQLite local quando não configurado. O LiveKit atende as chamadas, e `scripts/abrir-chat.cjs` inicia os serviços no Windows com acesso privado via Tailscale.

## Alterações

- Leia o código e o estado do Git antes de editar. Preserve alterações locais, as pastas duplicadas e o histórico de conversas existentes.
- Faça alterações pequenas, legíveis e compatíveis com dados e usuários existentes. Use os componentes e padrões do projeto antes de criar dependências.
- Mantenha a interface em português, acessível por teclado e adaptável a computador e celular. Confira as telas afetadas e os estados de erro.
- Separe permissões por conta no servidor. Não confie em verificações feitas apenas no navegador. Mensagens antigas sem conta vinculada não devem ser atribuídas a alguém com base no apelido.
- Ao alterar a versão necessária da API, mantenha sincronizados o indicador de saúde do servidor e a versão exigida pelo iniciador.

## Dados e segurança

- O PostgreSQL é o banco ativo quando configurado; contém mensagens, anexos, contas e sons. `server/data/chat.sqlite` é o banco local anterior e pode estar desatualizado. Antes de migrar ou alterar dados reais, faça um backup consistente do banco ativo e valide sua restauração. Use bancos isolados nos testes e preserve os arquivos originais.
- As tabelas do chat ficam no esquema privado `progresso_gang`, sem acesso `anon` ou `authenticated` ao esquema; preserve a proteção por RLS. A conexão PostgreSQL deve validar o certificado em `server/data/supabase-ca.crt`. Nunca desative a verificação TLS para contornar erros.
- O Chat Geral aceita anexos de até 100 MB; outros canais de conversa e fotos de perfil mantêm o limite de 8 MB para imagens. Arquivos que não são imagens devem ser servidos como download, com tipo genérico e sem execução no navegador.
- Os logs administrativos ficam em `server/logs/activity.jsonl`, no PC do servidor, e são restritos a administradores. Registre somente eventos e metadados necessários; não grave conteúdo de mensagens, senhas, tokens ou anexos.
- Nunca inclua senhas, tokens, chaves LiveKit, links privados de configuração, arquivos `.env`, banco de dados, logs ou configurações privadas no Git, em exemplos ou em saídas de comandos. Não revele seus valores ao inspecionar erros.
- Mantenha a autenticação, autorização, proteção contra CSRF, validação de arquivos e separação de canais nas alterações de API. Use os mecanismos existentes para sessões e senhas.
- Não enfraqueça a configuração de rede privada, as regras do Gitleaks ou os arquivos ignorados para contornar erros. Investigue detecções e trate segredos expostos como comprometidos.
- O hook de pre-commit é `.githooks/pre-commit`. Ele verifica o conteúdo preparado com `git diff --cached --check` e Gitleaks, ocultando valores detectados. Ative-o em cada clone com `git config core.hooksPath .githooks`. A verificação falha se o Gitleaks não estiver instalado em `.tools/gitleaks/` ou disponível no PATH.
- Para verificar o histórico e os arquivos publicáveis, execute `node scripts/check-secrets.cjs` na raiz. O fluxo do GitHub também verifica segredos no histórico ao receber commits e pull requests.

## Verificação

- No cliente, execute `npm run build`, `npm run lint` e `npm test` quando aplicáveis.
- No servidor, execute `npm test` para alterações de API, banco ou autenticação. Os testes usam bancos isolados.
- Para alterações na chamada ou em mídia, verifique o comportamento no navegador e informe o que ainda depender de teste com outra pessoa ou com dispositivos reais.
