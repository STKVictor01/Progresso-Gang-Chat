# Resultados da esteira — 15/11/2026

> Publicação: `https://progressogang.tech` respondeu com HTTPS e Auth Supabase, a origem indevida foi recusada e a rota interna de saúde está bloqueada no proxy. O endpoint HTTPS do LiveKit respondeu e recusou WebSocket sem token; API, site e LiveKit estão saudáveis na VPS. O administrador vinculou a conta e entrou com o histórico preservado. Depois de um ajuste de comunicação local com o LiveKit, a ocupação dos canais voltou a aparecer; áudio e vídeo sintéticos foram recebidos por participantes de teste na própria VPS. Falta testar recuperação, áudio e vídeo com participantes reais em redes diferentes e dispositivos móveis.

> Teste adicional em 16/11/2026: dois clientes sintéticos executados neste computador conectaram-se ao LiveKit da VPS pelo endereço público e trocaram áudio e vídeo. Isso não substitui testes com microfone, navegador, compartilhamento de tela ou outras redes e aparelhos.

> Validação com participantes: o proprietário confirmou que ele e um amigo conseguiram se ouvir e assistir à transmissão no site publicado. O Fail2ban foi habilitado para o SSH, com bloqueio temporário após cinco falhas em dez minutos; uma nova conexão administrativa por chave foi confirmada. O backup cifrado do esquema do chat foi renovado depois do vínculo e restaurado em ambiente isolado. Esse backup não inclui o esquema de usuários do Supabase Auth nem substitui o backup do projeto inteiro.

> Atualização: o proprietário confirmou o recebimento de um convite real enviado pelo SMTP do Resend. A vinculação de identidade Auth já existente foi preparada com comprovação das duas senhas e passou com provedor simulado e GoTrue real descartável; o build, o lint, 12 testes do cliente e 36 testes do servidor passaram. A migração e suas proteções passaram em PostgreSQL descartável e foram aplicadas ao esquema privado de produção após backup restaurado. As imagens foram construídas na VPS, a API e o LiveKit iniciaram saudáveis, e a interface respondeu em um teste local na máquina. As portas internas da API e da sinalização foram verificadas fechadas externamente. Ainda falta apontar o domínio e validar a entrada completa em produção; o envio do convite, por si só, não demonstra o login completo do chat.

## Escopo e ambiente

Execução local Windows nesta cópia de trabalho isolada, com Node 26.13.0 e bancos de testes efêmeros. A configuração do GitHub Actions usa Node 24 e ainda não foi executada no GitHub: não houve commit, push, deploy ou operação no Supabase real. Não foi executada uma auditoria independente completa nem teste em dispositivos reais nesta rodada.

## Resultados

- Cliente: instalação limpa `npm ci`, build, lint e 12 testes passaram.
- Servidor: instalação limpa `npm ci` e 35 testes passaram, incluindo seis cenários de autenticação com provedor simulado.
- Gitleaks: histórico e arquivos elegíveis para publicação verificados; nenhum segredo encontrado.
- `npm audit --omit=dev`: nenhuma vulnerabilidade relatada nas dependências de produção do cliente e do servidor.
- `npm audit` completo do cliente: nove alertas moderados em dependências de desenvolvimento, relacionados a minimatch, ESLint e TypeScript-ESLint. A solução sugerida pode alterar versões de forma incompatível; não aplicar `--force` sem revisão. O resultado não equivale a nove falhas confirmadas no site em produção.
- A sintaxe YAML e os dois jobs da esteira foram analisados localmente; o comportamento do GitHub Actions ainda precisa ser confirmado em execução real.
- SDK e API passaram contra GoTrue/PostgreSQL descartáveis, com certificado TLS conferido. Confirmação de conta existente, convite, recuperação de senha e renovação de sessão passaram com e-mails capturados pelo Mailpit isolado. A migração SQL foi examinada anteriormente em esquema isolado com RLS e privilégios restritos.

## Limites e próximas ações

O login Supabase continua desabilitado: falta testar confirmação e recuperação com SMTP externo e endereços reais de teste. Antes de mudar a comunidade real, deve haver backup consistente, restauração isolada validada e procedimento de migração e reversão. Não foi demonstrada a migração ou reversão de contas reais.

O Strix não foi executado: exige um modelo de IA configurado, e o proprietário ainda não possui chave de API. As habilidades da Trail of Bits ainda não foram instaladas nem executadas como uma ferramenta automática. Ver o backlog de segurança. Os testes existentes não substituem auditoria completa de segurança, testes de carga ou uso real no celular.
