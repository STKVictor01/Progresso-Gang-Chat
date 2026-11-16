# Escopo autorizado: Progresso Gang - Chat em laboratório

O único alvo autorizado é a cópia de fontes fornecida nesta execução e os
processos descartáveis iniciados dentro do sandbox a partir dela. Trabalhe nessa
cópia. Não tente localizar a instalação original, usar credenciais do host, ler
pastas externas, acessar a rede Tailscale ou testar Supabase, YouTube, LiveKit
real e outros serviços de terceiros. Não publique código, relatórios ou dados.
Não configure provedores de IA alternativos nem faça fallback para a nuvem.

## Preparação dentro do sandbox

1. Leia `SECURITY-TARGET.json`, `SECURITY.md`, `server/security-lab.mjs` e os
   arquivos de código que sustentam cada hipótese.
2. Use Node.js 22.5 ou superior. Instale as dependências fixadas com `npm ci` em
   `server/`; esse download de dependências não autoriza testes em terceiros.
3. Inicie `node server/security-lab.mjs` na raiz da cópia. Ele escuta apenas
   `http://127.0.0.1:4311`, usa SQLite em memória, simula a presença LiveKit e
   cria um administrador e dois membros fictícios. Não execute `server/index.js`,
   o iniciador do chat, arquivos de implantação ou migrações.
4. O processo informa o caminho de `security-reports/lab-*/credentials.json`.
   Leia somente o arquivo gerado nesta execução. Ele contém senhas fictícias
   para autenticação, nunca imprima seus valores em relatórios. Faça login via
   `POST /auth/login`, usando `username` igual ao campo `name` e `password` da
   conta. Preserve os cookies; envie o `csrf` retornado em `x-csrf-token` e
   `Origin: http://127.0.0.1:4311` nas escritas autorizadas.
5. Se faltar runtime ou dependência, registre a limitação. Não use outro serviço
   em execução no host para substituir o laboratório.

## Prioridades

- Autenticação anônima, sessão, logout, CSRF e origem, incluindo caminhos
  codificados e normalização das rotas administrativas.
- Autorização por conta: membro A versus membro B versus administrador;
  exclusão de mensagens, perfis, anexos pendentes, sons e administração.
- Convites de uso único, concorrência e tentativas de alteração de papel.
- Injeção SQL e validação de entradas; mensagens antigas sem `user_id` não
  devem ganhar proprietário por coincidência de nome.
- Anexos: assinatura, tipo de conteúdo, download de arquivos ativos, nomes,
  reutilização entre contas e associação ao canal. Preserve os limites de
  100 MB no chat e 8 MB no perfil; não use cargas de exaustão.
- Faça revisão estática do cliente para XSS e exposição de segredos. Não
  declare XSS confirmado somente porque o texto contém marcação HTML.

Membros ativos podem ler todos os canais e perfis; não existem ACLs individuais
por canal. Separe isso de mistura indevida de históricos ou uso indevido de
anexos pendentes. O LiveKit é simulado; esta execução não valida transporte de
voz, câmera, tela, firewall, Supabase Auth real, RLS ou TLS de produção.

## Limites e resultados

Não execute negação de serviço, persistência, força bruta prolongada, varredura
da rede ou exfiltração. Use poucas requisições para verificar limites. As contas
e mensagens deste laboratório são descartáveis. As instruções delimitam escopo;
não são uma barreira técnica de rede.

Para cada achado, inclua revisão e arquivos/linhas, pré-condições, requisições
mínimas com segredos omitidos, resultado observado, impacto e sugestão de
correção. Separe vulnerabilidade reproduzida, hipótese e limitação. Registre
categorias não testadas e eventual interrupção por tempo, turnos ou orçamento.
Não aplique correções automaticamente ao repositório original.
