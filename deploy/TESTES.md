# Verificações da preparação

Registro de 13/11/2026. Nenhuma ação de implantação, alteração de DNS, reinicialização do site real ou operação no Supabase de produção foi executada nesta tarefa.

## Executados

- Windows, servidor com bancos isolados: `npm test`, **29 testes passaram**, incluindo contas, limites por IP e por conta, autorização, origens HTTPS simuladas, cookies, CSRF, canais, respostas, bot e arquivos de 100 MB.
- Linux/WSL Ubuntu: em cópia temporária sem segredos, Node 24.22.3 verificado por SHA-256, `npm ci` no cliente e no servidor, build, lint e **12 testes do cliente e 29 do servidor passaram**. Nenhum banco real foi usado.
- Linux/WSL: dependências Python diretas e transitivas fixadas foram instaladas em ambiente temporário com Python 3.14 e os módulos do bot foram importados. A primeira tentativa encontrou ausência de `ensurepip`; outra foi interrompida por uma edição simultânea do próprio script. O teste final completo passou. Isso não substitui o teste da imagem Debian/Python 3.11 nem reprodução real de música.
- `docker compose --env-file deploy/compose.env.example -f deploy/compose.yaml config --no-env-resolution --quiet`: sintaxe válida com placeholders, sem carregar segredos.
- `sh deploy/test-caddy.sh`: binário oficial Caddy 2.11.9 conferido pelo checksum e configuração validada; houve apenas aviso de formatação do arquivo.
- `node scripts/check-secrets.cjs`: histórico de 14 commits e arquivos publicáveis sem achados na verificação final. Um falso positivo de placeholder foi corrigido e a verificação repetida.
- `npm audit --omit=dev` para cliente e servidor: zero vulnerabilidades reportadas nas dependências de produção. O audit completo do cliente reportou **9 moderadas** em ferramentas de desenvolvimento relacionadas a `minimatch`/ESLint/TypeScript-ESLint; a correção sugerida com `--force` altera versões de forma potencialmente incompatível. Não aplicada automaticamente; revisar atualizações compatíveis depois.
- PostgreSQL 18 local e temporário, com certificado de teste e verificação TLS ativada: `npm run test:postgres` passou 3 testes, incluindo gravação e leitura de arquivo de 100 MB; `npm run test:migration` passou 1 teste em outro esquema vazio, com dados fictícios. Nenhum projeto Supabase foi acessado.
- Docker: as imagens da API e do site foram construídas e iniciadas; LiveKit v1.9.12 iniciou sem privilégios, e seu healthcheck respondeu. O teste usou rede Docker privada, com PostgreSQL fictício, e não executou a topologia pública nem o `compose up` de produção.
- API, Caddy e PostgreSQL fictício foram exercitados juntos: site, fallback SPA, cookies, origem/CSRF, convite, contas, mensagens/respostas, permissão de exclusão e token LiveKit passaram. Um certificado de banco com nome incompatível foi rejeitado. O proxy usou HTTP local para o teste; TLS público/ACME ainda não foram validados.
- Foi identificada uma falha na ordem das regras Caddy: `/api/health` e `/api/ready` estavam acessíveis. A configuração foi corrigida, a imagem reconstruída e ambas as rotas passaram a retornar 404 pelo proxy.
- Dois participantes sintéticos trocaram áudio e vídeo no LiveKit isolado. Outro teste conectou 20 clientes sintéticos e observou a presença de todos em 1,6 s; o contêiner LiveKit tinha limite de 2 CPUs e 1,5 GiB. Não houve carga de vídeo nesse teste, os clientes compartilhavam rede local, e houve avisos do SDK de fechamento de `_data_track`; é necessário investigar seu impacto em testes reais.
- Em cópia temporária do cliente, `overrides.minimatch=11.0.1` eliminou os 9 alertas no `npm audit`; lint, build e os 12 testes passaram. A alteração força uma versão principal fora das faixas declaradas por dependências transitivas e não foi aplicada ao projeto: precisa de revisão de compatibilidade antes de adotada.

## Ainda não comprovados

- Não foram executados `compose up` na topologia host da VPS, LiveKit pela internet, certificados públicos, ICE/TURN em redes diferentes ou conexão à instância Supabase real. O PostgreSQL local simula a estrutura e TLS, mas não a rede, o pooler ou os limites do Supabase gerenciado. A migração de produção não foi executada.
- As dependências Python estão fixadas por versão, mas não por hashes; revisão de cadeia de suprimentos continua pendente.
- Falha do banco após a API iniciar, reconexão, rate limiting sob distribuição, limites de memória com vários envios/downloads, carga real e rotação de logs de longa duração ainda exigem testes no ambiente final.

## Aceite manual depois da compra e configuração

Com dois computadores em redes diferentes e um celular, em um ambiente autorizado:

1. Criar convite; registrar conta; login/logout; conferir proteção de administrador e que um membro não edita/exclui mensagens alheias.
2. Enviar texto, resposta, menção, imagem e arquivo próximo de 100 MB no canal geral e nos chats de voz; trocar canais, recarregar e conferir persistência.
3. Testar microfone, câmera, duas transmissões de tela com áudio quando o navegador permitir, volume individual, soundboard, bot por link e pesquisa, troca de canal e reconexão.
4. No celular testar Wi-Fi e rede móvel, navegação, teclado, chat, voz e câmera; testar tela bloqueada e anotar limitações do navegador.
5. Reiniciar serviços e VPS somente em janela autorizada; conferir histórico, recuperação, readiness e logs. Restaurar backup apenas em banco isolado.
6. Simular 10–20 participantes, duas telas em torno de 8 Mb/s cada e três espectadores por tela por tempo sustentado. Medir CPU/créditos e limitação da Hostinger, RAM, tráfego mensal, latência/perda, disco, banco e eventual transcoding. Registrar números e, se insuficiente, avaliar KVM 4. **Nenhuma capacidade foi garantida sem esse teste.**
7. Em rede restrita testar fallback TCP 7881. Com TURN desativado, registrar falhas e não prometer acesso universal; preparar TURN/TLS separadamente se necessário.
