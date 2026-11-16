# Configuração preparada para o Progresso Gang

> Atualização de 15/11/2026: `auth.progressogang.tech` foi verificado no Resend e o SMTP foi configurado pelo proprietário no Supabase. Um convite de teste foi enviado e o proprietário confirmou seu recebimento; a confirmação e a recuperação pelo chat ainda precisam ser testadas. O site e o endpoint LiveKit estão publicados com HTTPS; chamadas reais ainda precisam ser verificadas.

O domínio informado pelo proprietário é `progressogang.tech`. A configuração planejada usa `https://progressogang.tech` para o site e `wss://live.progressogang.tech` para o LiveKit. Esses endereços não comprovam que DNS, TLS ou serviços estejam configurados.

Para implantação futura, depois de conferir registros existentes e autorizações, o DNS deve apontar o domínio principal e `live` ao IPv4 da VPS. Não substituir registros existentes sem verificar impacto nem adicionar AAAA sem IPv6 funcional. Os endereços correspondentes devem ser preenchidos nos arquivos privados de configuração da VPS descritos em `README.md`.

Para autenticação de e-mail, configure um provedor SMTP que suporte autenticação e domínio verificado; o [Supabase lista provedores e orientações](https://supabase.com/docs/guides/auth/auth-smtp). O proprietário escolhe o serviço e conclui seu cadastro; não inclua credenciais neste repositório. Configure também o template de recuperação `supabase-reset-email.html` no Supabase após o ambiente isolado e a restauração do backup terem sido validados.

Esta preparação não executa implantação, não configura DNS, não compra serviços e não altera o banco Supabase.
