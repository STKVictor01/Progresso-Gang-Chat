# Backlog: testes de segurança na esteira

Registrado a pedido do proprietário. Nenhuma ferramenta foi instalada ou executada contra o serviço real.

- [ ] Avaliar [Trail of Bits Skills](https://github.com/trailofbits/skills): selecionar as análises relevantes para autenticação, código e configuração, verificar compatibilidade e versões e planejar como integrar uma revisão reproduzível à esteira.
- [ ] Avaliar [Strix](https://github.com/usestrix/strix) para testes de segurança de API e aplicação em uma instância descartável, com contas fictícias, banco isolado e permissões mínimas. Definir custos e fornecedor de modelo, limites de uso, acesso aos relatórios e política de falhas antes de adicionar à automação.
- [ ] Preservar Gitleaks e os testes atuais; não expor segredos nem permitir execução dinâmica ou dados de produção em pull requests não confiáveis. Fixar e revisar versões ou ações antes de ativar qualquer fluxo.

Em 15/11/2026 foi preparada uma esteira de build, lint, testes e auditoria das dependências de produção em `.github/workflows/testes.yml`, além do fluxo existente do Gitleaks. A esteira ainda não está no GitHub e não executou no Actions. Trail of Bits reúne orientações e habilidades, não é um verificador de CI executável por si só; ainda é necessário escolher e integrar uma análise específica. O Strix requer Docker e um modelo de IA configurado; o proprietário informou não ter chave de API. Ele não foi instalado nem executado, e não se deve reportar sua análise como concluída. Um modelo local é outra possibilidade a avaliar. Consulte [as instruções oficiais do Strix](https://github.com/usestrix/strix/blob/main/docs/integrations/github-actions.mdx) para requisitos e custos.
