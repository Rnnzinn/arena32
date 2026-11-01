# Como testar

## Automático (nada a instalar, Node 22+)
`npm test` → 18 testes do servidor + 1 de rede em tempo real + 1 da página online. Cobrem: login/JWT, salas, líder, BR com 1–4 reais + bots até 32, X1, 2X2, tiros/dano/rodadas/vitória/revanche, anti-teletransporte, convites e presença, prêmio de partida, limites de abuso.

## Manual com pessoas reais (depois de configurar tudo)
1. **Conta:** online.html → "Criar conta" → confirme o e-mail → entre. Teste "Esqueci a senha" e "Entrar com Google". Confira apelido (grátis na 1ª vez), ID `0000N` e a troca de apelido (pede confirmação; recusa com saldo < 1.000).
2. **Nuvem:** jogue um pouco no `index.html`, entre em `online.html`, clique "Enviar progresso". Em outro aparelho, entre na mesma conta → "Baixar progresso" → abra o jogo e confira moedas/skins.
3. **Amigos:** duas contas: buscar por apelido/ID → solicitação → aceitar → ver 🟢 online → remover.
4. **BR:** 1 pessoa cria a sala e inicia sozinha (31 bots). Repita com 2, 3 e 4 (códigos de convite/amigos). Só o líder inicia.
5. **X1:** 2 pessoas; com 1 só o botão deve recusar. Jogue até uma vencer 2 rodadas; teste "Revanche".
6. **2X2:** 4 pessoas, 2 por lado, teste "Trocar lado" e o fogo amigo (não causa dano).
7. Teste no celular (toque: esquerda move, direita mira/atira) e no PC (WASD + mouse).
