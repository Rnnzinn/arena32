# STATUS — o que está pronto, testado e pendente (Etapa 1)

## Jogo offline (site/index.html)
| Item | Estado |
|---|---|
| Todos os recursos anteriores (mapa, armas, veículos, skins, HUD, PC, missões...) | Mantidos |
| **Atraso nos tiros** | **Corrigido e medido** (ver abaixo) |
| Metatag do Google Search Console | Intacta, exatamente como estava, dentro do `<head>` |

**Causa do atraso nos tiros:** o cronômetro entre disparos usava um tempo "travado" em 0,05 s por quadro. Depois que o mapa ficou maior (mais casas, itens e prédios), celulares passaram a rodar a ~10–20 quadros/s, e nesse ritmo o jogo andava em "câmera lenta" (a cadência da pistola caía de 14 para 7 tiros em 5 s). Também há as recargas, que não existiam nas versões antigas. **Correções:** cadência e recarga em tempo real (independente do FPS, com tiros "atrasados" compensados), recargas ~25% mais rápidas, proteção automática de desempenho (reduz o gráfico se o FPS cair), cenário estático sem recalcular matrizes a cada quadro e menos alocação por tiro. **Medido** no simulador: 14 tiros em 5 s a 60, 20 e 10 FPS.
Não pude medir FPS real em celular: se ainda houver lentidão, o gráfico "Baixo" e o aviso automático ajudam; me envie o modelo do aparelho.

## Multiplayer
| Item | Estado | Como foi verificado |
|---|---|---|
| Servidor WebSocket próprio (sem dependências) | **Pronto** | 18 testes automáticos |
| Login validado no servidor (JWT do Supabase: HS256 e ES256/JWKS) | **Pronto** | testado com tokens reais assinados localmente |
| Salas privadas com código, líder, lista de jogadores, saída/troca de líder | **Pronto** | testes |
| **Battle Royale** 1–4 reais + bots até 32; líder inicia sozinho | **Pronto** (arena simplificada) | testes |
| **X1** (2 reais, sem bots, rodadas melhor de 3, placar, desistência, revanche) | **Pronto** | testes |
| **2X2** (4 reais, equipes 2x2, troca de lado, sem fogo amigo, placar, revanche) | **Pronto** | testes |
| Servidor autoritativo (movimento com velocidade máxima, tiros, dano, vida, zona, vitória) | **Pronto** | testes (anti-teletransporte, parede bloqueia tiro) |
| Convites e status online (servidor) | **Pronto** | testes (com Supabase simulado) |
| Cliente de rede ↔ servidor em tempo real | **Pronto** | teste ponta a ponta |
| Página online.html (login, perfil, amigos, salas, partida 2D) | Escrita; fluxo de partida testado com Supabase **simulado** | `client-smoke.js` |

## O que depende de configuração SUA (não pude testar sem suas contas)
- **Supabase real:** rodar `supabase/schema.sql`, pegar as chaves, preencher `site/config.js` e o `.env` do servidor. O SQL **nunca foi executado em um banco real** por mim — rode primeiro em um projeto de teste.
- **Login com Google:** criar credencial OAuth no Google Cloud e ativar no Supabase (docs/SUPABASE.md). Não testado.
- **E-mail/senha e recuperação de senha:** usam o Supabase Auth (o código chama as funções oficiais), **não testado** com projeto real; configure o SMTP/URLs de redirecionamento.
- **Hospedar o servidor** (Render, Fly, Railway, VPS...) com `wss://`. Não testado na internet.
- Foto de perfil (Supabase Storage): código e política escritos, **não testados**.

## O que AINDA NÃO FOI FEITO (próximas etapas)
1. **Integrar o multiplayer ao jogo 3D.** Hoje a partida online usa uma visão 2D de cima (`online.html`), para validar a rede primeiro. O jogo 3D (`index.html`) continua 100% offline.
2. **Battle Royale online com o mapa completo** (cidades, casas com interior). O mapa do jogo 3D usa aleatoriedade própria; precisa virar determinístico por semente e ter a lógica de colisão no servidor.
3. **Sincronizar**: loot e inventário, veículos, granadas, paredes de gelo, avião e paraquedas. (Servidor já sincroniza posição, mira, tiros, dano, vida, zona e resultados.)
4. Conquistas, histórico de partidas na interface (a tabela existe), aviso de "amigo online" por Realtime do Supabase (hoje usa o servidor).
5. Moedas/XP do jogo OFFLINE são calculados no navegador (confiança no cliente). Os de partidas ONLINE vêm do servidor.
6. Teste com jogadores reais em celulares diferentes pela internet (latência, reconexão).
