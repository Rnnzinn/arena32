# Atualizar no Netlify (mesmo projeto)

1. Edite `site/config.js` (URL e chave anon do Supabase, `WS_URL`).
2. Netlify → seu site → **Deploys** → arraste a pasta **`site`** (não o ZIP inteiro: o servidor não deve ir para o site).
3. Abra https://arena32.netlify.app/ (jogo) e https://arena32.netlify.app/online.html (online).

**Google Search Console:** a metatag está em `site/index.html` exatamente como você enviou. Se você também tinha um arquivo `googleXXXXXXXX.html` de verificação, copie-o para dentro de `site/` antes de publicar (o deploy por arrastar substitui o site inteiro). Não alterei nenhuma configuração de indexação.
