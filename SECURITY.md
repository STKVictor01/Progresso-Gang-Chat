# Política de segurança

## Versões mantidas

As correções de segurança são feitas na versão atual da branch `main`. Cópias
antigas e pastas duplicadas não são mantidas. Atualize uma instalação somente
depois de revisar as alterações e preservar o banco ativo.

## Relatar uma vulnerabilidade

Comunique o problema em particular ao responsável pelo repositório. No GitHub,
use **Security → Advisories → Report a vulnerability**, se essa opção estiver
habilitada. Caso contrário, use um canal privado já conhecido com o mantenedor;
não publique a vulnerabilidade em uma issue ou conversa da comunidade.

Inclua a revisão afetada, o comportamento esperado e observado, o impacto e os
passos mínimos para reproduzir com dados fictícios. Oculte senhas, cookies,
tokens, endereços privados, dados pessoais e conteúdo de mensagens ou anexos.
Combine a divulgação pública com o mantenedor depois da correção. Não há prazo
de resposta nem programa de recompensa garantidos.

## Escopo dos testes

- Teste apenas cópias isoladas e recursos para os quais exista autorização.
- Use contas fictícias, SQLite em memória ou PostgreSQL dedicado aos testes.
  Nunca aponte scanners ao banco, à rede Tailscale ou às contas da comunidade.
- Supabase, LiveKit e outros serviços externos exigem escopo próprio; a posse
  deste código não autoriza testes na infraestrutura de terceiros.
- Antes de qualquer operação sobre dados reais, faça backup consistente do banco
  ativo e valide sua restauração em ambiente isolado.
- Relatórios, provas de conceito com dados sensíveis e ferramentas baixadas ficam
  em `security-reports/` e `.tools/`, já ignorados pelo Git. Revise qualquer
  material antes de compartilhá-lo ou enviá-lo a um provedor de IA.

## Proteções que devem ser preservadas

A autenticação, as permissões por conta, o CSRF e a validação de origem são
verificados no servidor. Mensagens antigas sem conta vinculada não pertencem a
uma pessoa apenas por terem o mesmo apelido. Os canais separam históricos, mas
não oferecem ACLs individuais: membros ativos podem ler a comunidade.

O PostgreSQL usa o esquema privado `progresso_gang`, RLS e TLS com verificação do
certificado. Não conceda acesso ao esquema a `anon` ou `authenticated`, nem
desative TLS para contornar erros. Anexos de conversa têm limite de 100 MB;
imagens de perfil, 8 MB. Arquivos genéricos são downloads sem execução no
navegador. Logs administrativos não devem guardar conteúdo ou credenciais.

Siga também as [instruções do repositório](AGENTS.md) e os
[limites de implantação](deploy/SECURITY.md). O
[roteiro de testes de segurança](docs/security-testing.md) descreve o uso de
Trail of Bits Skills e Strix, os pré-requisitos e as limitações de cobertura.

## Verificação de contribuições

Ative o hook com `git config core.hooksPath .githooks` e execute
`node scripts/check-secrets.cjs` antes de preparar um commit. A verificação de
segredos e os testes automatizados ajudam a detectar problemas, mas não
substituem revisão nem demonstram ausência de vulnerabilidades.
