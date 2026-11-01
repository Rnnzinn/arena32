# Hospedar o servidor multiplayer

O Netlify NÃO roda servidores WebSocket. Use um host de Node/Docker com HTTPS (para o `wss://`):

**Render.com (simples):** New → Web Service → conecte o repositório → *Environment: Docker* (usa o `Dockerfile` da raiz) → defina as variáveis de `server/.env.example` → Deploy. A URL `https://seu-app.onrender.com` vira `wss://seu-app.onrender.com/ws` no `config.js`. (Planos gratuitos "dormem"; para jogo real use um plano sempre ligado.)

**Fly.io / Railway / VPS:** o mesmo Dockerfile. Porta `8080` (variável `PORT`). Em VPS, coloque um proxy com TLS (Caddy/Nginx) na frente.

Variáveis: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, (`SUPABASE_JWT_SECRET` se HS256), `ALLOWED_ORIGINS=https://arena32.netlify.app`, `ALLOW_GUEST=0`.

Verificação: abra `https://SEU-SERVIDOR/health` → `{"ok":true,...}`.

Capacidade: cada sala roda a 20 ticks/s no mesmo processo. Uma sala de Battle Royale (32 entidades) é leve; comece com 1 instância e monitore a CPU.
