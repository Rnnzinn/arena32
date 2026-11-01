# ARENA 32 — Projeto completo (Etapa 1)

Jogo + servidor multiplayer real + contas (Supabase) + amigos + salas Battle Royale / X1 / 2X2.

```
site/        → o que vai para o Netlify (publique ESTA pasta)
  index.html   jogo offline completo (com a metatag do Google Search Console, intacta)
  online.html  página multiplayer: login, perfil, amigos, salas, partida
  config.js    endereços públicos (você preenche)    net.js / world.js   código de rede e mapa
server/      → servidor multiplayer (Node 22, ZERO dependências npm) + testes
shared/      → world.js: mapa compartilhado servidor/cliente (site/world.js é cópia)
supabase/    → schema.sql (tabelas, segurança, funções)
docs/        → SETUP, SUPABASE, HOSTING_SERVER, NETLIFY, TESTES, STATUS
Dockerfile   → imagem do servidor        server/.env.example → variáveis (sem segredos)
```

**Leia primeiro: `docs/STATUS.md`** (o que está pronto, o que foi testado e o que ainda falta).

Testar tudo (precisa de Node 22+; não precisa instalar nada):
```
npm test        # ou: node server/test/run.js && node server/test/net.js && node server/test/client-smoke.js
```
