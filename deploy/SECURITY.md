# Segurança e limites antes da publicação

## Proteções mantidas ou preparadas

- Senhas Argon2id; sessão `HttpOnly`, `Secure`, `SameSite=Strict`; convites de uso único; CSRF e `Origin` exato em métodos de escrita; administração e exclusão verificadas no servidor. O backend usa o domínio do site, não o domínio LiveKit, como origem em produção.
- Login limitado por IP e por nome normalizado; convites, uploads, tokens e música têm limites por IP. O proxy é confiável apenas no loopback; essa configuração pressupõe API acessível apenas em `127.0.0.1` e Caddy diretamente na internet. Os limites são em memória, reiniciam com a API e não substituem proteção de borda ou WAF. Bloqueio por conta pode causar negação de serviço direcionada.
- Os uploads são validados, imagens reprocessadas, arquivos genéricos baixados com tipo genérico e nomes sanitizados. Um upload por vez e até dois downloads de arquivo acima de 8 MiB, com 100 MiB por arquivo, limitam concorrência. Ainda há buffers em memória, e uma conexão lenta pode ocupar uma vaga; meça e avalie timeouts/proxy antes da exposição. Nenhum antivírus ou detecção de malware foi implementado.
- Tokens de chamada restritos à sala duram 10 minutos; token do bot dura 1 hora e permite publicação sem assinatura. Não exponha nem registre tokens, segredos do LiveKit ou URL do banco. A conexão PostgreSQL valida a CA e o hostname; o esquema privado e RLS existentes não são alterados.
- Compose usa versões fixas, `restart`, limites de memória/processos e rotação de logs; API executa como `node` e LiveKit com UID próprio, sem capabilities e sem Docker socket. Rede host é necessária para o modelo LiveKit e não isola processos por rede: mantenha o sistema e firewall atualizados. O bot compartilha usuário, contêiner e limite de memória da API; não é um limite de CPU independente e ainda requer medição em carga.
- Caddy configura HTTPS automático, encaminha `/api`, remove cabeçalho Server e adiciona `nosniff`, `DENY` e Referrer-Policy. HSTS e CSP global não foram ativados sem teste real com os domínios, chamadas e recursos; mídias têm CSP restritiva própria.

## Checklist do operador

- [ ] Verificar existência e integridade do backup cifrado, restaurá-lo em ambiente isolado e guardar a chave privada fora da VPS.
- [ ] Confirmar que o domínio, endereço e banco indicam os recursos corretos; nunca usar um projeto vazio por engano. Não reimportar SQLite no Supabase existente.
- [ ] Trocar todos os exemplos por segredos únicos e fortes, guardados somente em `/etc/progresso-gang` com permissões restritas. Não registrar variáveis de ambiente em diagnósticos. Rever e atualizar periodicamente versões e dependências.
- [ ] Configurar acesso SSH por chaves e confirmar uma sessão nova antes de remover autenticação por senha; restringir por IP e habilitar atualizações automáticas de segurança. Configurar Fail2ban para SSH se adequado; ele não protege automaticamente as rotas da API.
- [ ] Configurar firewall do provedor e UFW com apenas as portas documentadas e testar de fora que 3001/7880/5173 e métricas não estão públicas.
- [ ] Verificar certificados, Caddy, WSS, cookies seguros, CORS e CSRF; testar bloqueios de contas sem permissão, convites repetidos e anexo pertencente a outra conta.
- [ ] Testar voz, vídeo, tela, áudio, música e reconexão em redes externas. TURN não está configurado; redes restritas podem falhar. Aplicar CSP e HSTS apenas após ensaios e plano de reversão.
- [ ] Monitorar e alertar indisponibilidade, health, disco, memória, CPU/créditos, tráfego e capacidade do banco; não disponibilizar métricas publicamente. `restart` não reinicia automaticamente um contêiner somente por estar unhealthy.
- [ ] Fazer `node scripts/check-secrets.cjs` antes de preparar o commit e usar `.githooks/pre-commit`. Se um valor real for exposto, rotacioná-lo e avaliar o histórico; não publicar relatórios com o valor.

O chat foi concebido para a comunidade autenticada: pessoas ativas podem ler os canais existentes e os perfis da comunidade. Não existem canais com ACLs individuais; não interprete a separação dos históricos por canal como privacidade seletiva. Bot de música depende de serviços externos, que podem bloquear ou modificar acesso. O provedor e o responsável pela comunidade devem avaliar as regras de uso de cada conteúdo.
