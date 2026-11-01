# SETUP — instalar e rodar

Requisitos: **Node.js 22+**. Não há `npm install`.

## 1) Rodar tudo localmente (sem Supabase, só para testar)
```
cd server
cp .env.example .env        # edite: deixe SUPABASE_* vazios e coloque ALLOW_GUEST=1
node server.js              # ouve em ws://localhost:8080/ws
```
Em outro terminal, sirva a pasta `site` (ex.: `npx serve site` ou `python3 -m http.server 5500 -d site`).
Edite `site/config.js`: `WS_URL: "ws://localhost:8080/ws"`. Abra `http://localhost:5500/online.html` em 2 abas e use **Convidado (teste local)**.

## 2) Produção
1. Crie o projeto no Supabase → `docs/SUPABASE.md`.
2. Hospede o servidor → `docs/HOSTING_SERVER.md` (guarde a URL `wss://...`).
3. Preencha `site/config.js` (URL e chave **anon** do Supabase + `WS_URL`).
4. Publique a pasta `site` no Netlify → `docs/NETLIFY.md`.
5. **Remova ALLOW_GUEST** (ou deixe 0) no servidor.

## Segredos
Só `config.js` (público) vai para o Netlify. `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` ficam **apenas** nas variáveis do servidor. Nunca no GitHub, nunca no site.
