# Preparação para VPS: Progresso Gang

> Atualização de 16/11/2026: a aplicação foi publicada na VPS em `https://progressogang.tech`, com a API e o LiveKit saudáveis. O endereço de voz, o HTTPS, a proteção de origem e a indisponibilidade das portas internas foram verificados. O proprietário vinculou a conta e entrou no site; o histórico foi exibido. Após corrigir a consulta interna ao LiveKit, a ocupação voltou a aparecer, áudio e vídeo sintéticos funcionaram e o proprietário confirmou que ele e um amigo se ouviram e assistiram à transmissão. A recuperação de senha ainda precisa ser testada. A versão publicada foi preparada localmente, sem commit ou push.

Os procedimentos abaixo descrevem a preparação anterior à publicação e continuam úteis para manutenção. O fluxo Windows/Tailscale continua separado. A conta, os canais, as mensagens, os anexos, as sessões e os sons continuam no PostgreSQL Supabase já existente; não rode `migrate-to-supabase.js` para esta mudança. A coluna `reply_to_id` e a tabela `auth_links` já foram confirmadas no banco ativo; não reaplique migrações automaticamente.

O Supabase Auth está habilitado na API da VPS; a instalação antiga no PC permanece no modo anterior. Consulte [a avaliação e as pendências](AVALIACAO-SUPABASE-AUTH.md) antes de alterar usuários ou fazer rollback. O SMTP do Resend foi configurado e o envio de um convite foi testado.

## Como funciona

Em uma VPS Linux, Caddy serve o React compilado, termina HTTPS e encaminha `/api/` para Fastify em `127.0.0.1:3001`. Outro domínio HTTPS encaminha sinalização/WebSocket ao LiveKit em `127.0.0.1:7880`. LiveKit usa rede host para mídia, TCP 7881 e UDP 7882 (ICE UDP mux); não é preciso abrir 50000–60000. A API e o bot de música Python compartilham um contêiner limitado e executam como usuário sem privilégios. O Supabase é externo; não há banco no Compose. As imagens são versionadas e devem ser revistas/atualizadas antes da implantação.

**Limitação de rede:** TURN não está ativado. Redes que bloqueiam UDP e TCP 7881 podem não conectar, mesmo com HTTPS funcionando. TURN/TLS na porta 443 requer roteamento L4 por domínio e certificados apropriados; não é seguro apontar simplesmente outro serviço para a mesma porta do Caddy. Use o [gerador oficial de VM do LiveKit](https://docs.livekit.io/transport/self-hosting/vm/) ou projete e teste uma solução L4 separada antes de prometer cobertura nessas redes. TURN/UDP também exigiria porta e faixa de relay adicionais.

## Depois da contratação — preparação

1. Escolha Ubuntu LTS e a região disponível que ofereça menor latência para o grupo; confirme na contratação preços, disponibilidade, transferência e política de CPU. Segundo a [Hostinger](https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/), KVM 2 tem 2 vCPU, 8 GB e 100 GB, sujeito a créditos de CPU. Teste uso contínuo antes de decidir por KVM 4.
2. Configure uma chave SSH, confirme que uma **segunda sessão por chave funciona** e mantenha a primeira aberta. Restrinja SSH no firewall da Hostinger ao seu IP quando possível. Somente depois ajuste `PasswordAuthentication no` no sshd, valide `sudo sshd -t` e recarregue o serviço. Não desative a única forma funcional de acesso.
3. Instale Docker Engine e o plugin Compose a partir da [documentação oficial do Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/). A rede host requer Docker em Linux; Docker Desktop em Windows não valida a topologia de rede da VPS.
4. Crie registros DNS `A` (e `AAAA` somente se IPv6 estiver configurado e testado) para os dois domínios. Libere no firewall da Hostinger e UFW: TCP **22** para IPs administrativos, **80**, **443**, **7881** e UDP **7882**. Confirme SSH primeiro:

   ```sh
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw allow 7881/tcp
   sudo ufw allow 7882/udp
   sudo ufw enable
   sudo ufw status verbose
   ```

   UFW é adicional ao firewall do provedor. Nesta topologia host não há redirecionamento de portas Docker. Não libere 3001, 5173, 7880, PostgreSQL, métricas ou Docker socket. Verifique com `ss -lntup` e testes externos. Não exponha 3478 nem a faixa 50000–60000 enquanto TURN e essa faixa estiverem desativados.
5. Obtenha uma cópia revisada do repositório, sem o `.env`, bancos, credenciais ou logs. Após revisão e autorização, por exemplo:

   ```sh
   cd /opt/Progresso-Gang-Chat
   sudo install -d -m 0700 /etc/progresso-gang
   sudo install -m 0600 deploy/compose.env.example /etc/progresso-gang/compose.env
   sudo install -m 0600 deploy/app.env.example /etc/progresso-gang/app.env
   sudo install -m 0600 deploy/livekit.yaml.example /etc/progresso-gang/livekit.yaml
   sudoedit /etc/progresso-gang/compose.env
   sudoedit /etc/progresso-gang/app.env
   sudoedit /etc/progresso-gang/livekit.yaml
   ```

   `compose.env` contém apenas os dois domínios e uma versão identificável. Em `app.env`, informe a origem HTTPS exata **sem barra final**, o WSS do LiveKit, a conexão existente e chaves. Em `livekit.yaml`, use a mesma chave/segredo do backend, gerados aleatoriamente, com pelo menos 32 caracteres no segredo. Para que somente o processo LiveKit sem privilégios possa ler sua configuração montada, execute `sudo chown root:65532 /etc/progresso-gang/livekit.yaml` e `sudo chmod 640 /etc/progresso-gang/livekit.yaml`. Nunca cole segredos em chats, Git, linha de comando ou logs. A URL deve codificar caracteres especiais da senha. A CA fornecida pelo Supabase deve ser copiada por canal seguro e instalada como `/etc/progresso-gang/supabase-ca.crt` (o certificado público precisa ser legível pelo usuário do contêiner, por exemplo `0644`; o diretório e os outros arquivos continuam restritos). Não armazene chave privada junto à CA.
6. O banco exige TLS com verificação de CA e hostname e o esquema privado existente. Use conexão direta quando houver conectividade IP adequada; para IPv4 sem conexão direta disponível, consulte o painel do Supabase e use **Session Pooler, porta 5432**. Não use Transaction Pooler 6543: a API depende do `search_path` por conexão. Não adicione `sslmode` à URL: a CA e TLS já são configurados separadamente. Confira os dados atuais no [guia Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
7. Antes da primeira troca, crie e teste um backup criptografado do banco e dos arquivos de configuração conforme abaixo. Confirme que o banco é o correto e que contém o proprietário existente. A aplicação falha se o banco ou a conta proprietária não existir; não cria um histórico vazio em produção. A inicialização normal remove sessões expiradas e anexos abandonados, portanto faça backup validado **antes** de iniciá-la contra o banco real.

## Implantar, somente após autorização

Com DNS resolvendo e portas conferidas, execute na VPS, a partir da raiz revisada:

```sh
cd /opt/Progresso-Gang-Chat
sudo sh deploy/validate.sh
sudo sh deploy/deploy.sh
sudo docker compose --env-file /etc/progresso-gang/compose.env -f deploy/compose.yaml ps
```

O Caddy pede e renova certificados automaticamente; mantenha 80/443 acessíveis. O endpoint interno `/ready` verifica conexão SQL e não é público; `/health` é bloqueado pelo Caddy. Um contêiner unhealthy não é reiniciado automaticamente só pelo healthcheck: configure alerta. A conferência de SQL não garante LiveKit ou mídia. Rode os testes manuais de `TESTES.md` em duas redes antes de convidar todos.

Para inspecionar sem publicar segredos:

```sh
sudo docker compose --env-file /etc/progresso-gang/compose.env -f deploy/compose.yaml ps
sudo docker compose --env-file /etc/progresso-gang/compose.env -f deploy/compose.yaml logs --tail=100
sudo docker stats --no-stream
df -h
ss -lntup
```

Logs e `docker inspect` podem conter informações privadas: não publique sua saída. Monitore CPU, memória, disco, tráfego, créditos de CPU, latência/perda e disponibilidade. Um upload por vez e dois downloads grandes simultâneos reduzem picos, mas arquivos `bytea` e processamento de imagens ainda ocupam memória. O limite acumulado atual de anexos da API é 512 MiB; monitore também a cota do Supabase. Em uma fase futura avalie armazenamento de objetos com autorização e política de acesso; nenhuma migração de anexos está incluída.

## Backup consistente e restauração isolada

O backup da VPS/volumes **não contém o banco externo** e não substitui backup do Supabase. Verifique o plano, retenção e PITR no [Supabase](https://supabase.com/docs/guides/platform/backups). Planeje cópias externas criptografadas, retenção e teste periódico de restauração; a chave de recuperação deve ficar fora da VPS. Os comandos a seguir são um procedimento futuro para um operador autorizado, nunca uma restauração em produção.

Instale `postgresql-client` compatível com a versão do servidor e `age`. Configure um arquivo `.pg_service.conf` restrito com `host`, `port`, `dbname`, `user`, `sslmode=verify-full` e `sslrootcert`; guarde a senha em `.pgpass` (`chmod 600`), não na linha de comando. Tenha um serviço `gang_origem` apontando ao banco correto e, em outro projeto ou banco vazio e isolado, `gang_teste`. Use uma chave pública age de backup controlada pelo proprietário:

```bash
set -o pipefail
umask 077
mkdir -p "$HOME/backups-gang"
PGSERVICE=gang_origem pg_dump --format=custom --schema=progresso_gang --no-owner --no-privileges \
  | age -r 'CHAVE_PUBLICA_AGE_DO_PROPRIETARIO' -o "$HOME/backups-gang/chat-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
```

Confira o código de saída; descarte com segurança qualquer arquivo incompleto. Transfira a cópia cifrada para outro local e preserve a chave privada separadamente. Para uma restauração **somente em destino isolado vazio**, depois de confirmar nome e endereço com cuidado:

```bash
set -o pipefail
age -d -i "$HOME/.config/age/chave-backup.txt" "$HOME/backups-gang/ARQUIVO.dump.age" \
  | pg_restore --dbname='service=gang_teste' --exit-on-error --no-owner --no-privileges
```

Confirme contagens, integridade de anexos, login, isolamento do esquema e RLS no destino; não copie essas informações para logs públicos. A restauração não cobre privilégios/roles, configurados e auditados separadamente. Não rode `DROP`, `--clean` nem restaure sobre o banco real sem plano e aprovação específicos.

## Atualização e rollback

Antes de uma versão, preserve imagens antigas (`progresso-gang-api:VERSAO` e `progresso-gang-web:VERSAO`), configuração e backup externo testado; defina uma nova `PG_RELEASE` em `compose.env`, então execute os mesmos scripts. O rollback troca só as imagens da API e do site e mantém os volumes e o banco:

```sh
sudo sh deploy/rollback.sh release-001
sudoedit /etc/progresso-gang/compose.env
```

Ajuste `PG_RELEASE` para a versão restaurada. O rollback não reverte alterações do banco: confirme compatibilidade da versão anterior antes de usá-la. Reversão de schema ou restauração do banco exige análise, cópia validada e autorização própria. Os scripts nunca removem volumes nem executam migrações.

## Componentes e referências

- [Portas e ICE do LiveKit](https://docs.livekit.io/transport/self-hosting/ports-firewall/); [deploy e TURN](https://docs.livekit.io/transport/self-hosting/deployment/).
- [Backup Supabase](https://supabase.com/docs/guides/platform/backups); armazenamento dos dados continua em PostgreSQL.
- O bot roda um processo Python por sala com fila limitada; em produção aceita por padrão música simultânea em até duas salas (`PG_CHAT_MUSIC_MAX_ROOMS`, de 1 a 10), e o limite deve acompanhar a capacidade medida da VPS. Dificuldades no provedor de vídeo podem interromper música sem interromper o chat. As versões diretas e transitivas Python do build estão fixadas; ainda não há lock com hashes nem imagem validada no Docker. Confira licenças e condições de uso do conteúdo e provedor antes de publicar.
- Atualizações críticas do SO, rotação de credenciais, proteção SSH, alertas e procedimento de recuperação precisam de configuração do operador; veja `SECURITY.md`.
