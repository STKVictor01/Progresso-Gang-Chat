# Perfis personalizados

Os cartões de perfil precisam do código do cliente e da API e da migração
`supabase/migrations/20261117112442_profile_appearance.sql`. A migração deve ser
aplicada manualmente; a publicação automática não modifica o banco.

Antes de publicar:

1. Confirmar o marco da insígnia de fundador: **17/11/2026 às 01:01:55** no
   horário de São Paulo, data do commit que introduziu os perfis. Contas de
   e-mail confirmadas no Supabase Auth antes desse instante são elegíveis;
   contas criadas no instante ou depois não recebem a insígnia automaticamente.
2. Fazer um novo backup consistente do banco ativo e validar sua restauração em
   ambiente isolado. Preservar o esquema privado e as regras de acesso.
3. Com autorização para alterar a produção, aplicar a migração e verificar sua
   conclusão antes de publicar a API e o cliente compatíveis. A migração lê a
   data de criação no Supabase Auth, mas não altera suas contas.
4. Testar o cartão, a edição de banner e cores, os perfis de outros usuários e
   a aparência em celular. Uma conta antiga só recebe automaticamente a
   insígnia quando sua identidade de e-mail estiver confirmada e vinculada.

Administradores podem conceder ou remover a insígnia. A remoção manual é
preservada em novos acessos e reaplicações da migração. Enquanto a migração não
for aplicada, o site mantém o comportamento anterior sem ativar o editor de
aparência.
