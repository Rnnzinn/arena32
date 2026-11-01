# Supabase — contas, banco e login com Google

1. supabase.com → **New project**. Anote a **Project URL** e as chaves em *Project Settings → API*:
   - `anon public` → vai em `site/config.js` (pode ser pública).
   - `service_role` → só no `.env` do servidor (SECRETA).
2. **SQL Editor** → cole `supabase/schema.sql` → Run. (Teste primeiro em um projeto de teste; este SQL não foi executado por mim em banco real.)
3. **Authentication → Providers → Email**: ative. Em *Authentication → URL Configuration*: *Site URL* = `https://arena32.netlify.app` e adicione `https://arena32.netlify.app/online.html` em *Redirect URLs* (e `http://localhost:5500/online.html` para testes). Configure o SMTP (e-mails de confirmação e recuperação de senha).
4. **Login com Google**: Google Cloud Console → *APIs e serviços → Credenciais → ID do cliente OAuth (Aplicativo da Web)*. Em "URIs de redirecionamento autorizados" coloque o *Callback URL* mostrado em *Supabase → Authentication → Providers → Google*. Copie *Client ID* e *Client Secret* para esse mesmo painel e ative.
5. **IDs sequenciais**: já vêm do schema (`player_seq`): o 1º cadastro é `00001`, depois `00002`... e continua além de 5 dígitos sem limite prático.
6. **Apelido**: 1ª escolha grátis; trocas custam 1.000 moedas, com confirmação e verificação de saldo (função `set_nickname`, no banco).
7. **Servidor multiplayer**: precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Projetos novos usam chave ES256 (o servidor lê o JWKS automaticamente). Projetos antigos com HS256: defina também `SUPABASE_JWT_SECRET`.
