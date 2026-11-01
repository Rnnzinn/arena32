'use strict';
// Rode com:  node test/run.js      (Node 22 ou superior)
const assert = require('assert'), crypto = require('crypto'), http = require('http');
const { createServer } = require('../server');
const W = require('../../shared/world');

const results = []; let fails = 0;
const test = async (name, fn) => { try { await fn(); results.push('PASS ' + name); } catch (e) { fails++; results.push('FAIL ' + name + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class C {
  constructor(port) { this.log = []; this.cur = 0; this.w = []; this.ws = new WebSocket('ws://127.0.0.1:' + port + '/ws'); this.opened = new Promise(r => this.ws.onopen = r); this.closed = new Promise(r => this.ws.onclose = e => r(e.code));
    this.ws.onmessage = e => { const m = JSON.parse(e.data); this.log.push(m); for (const w of [...this.w]) if (w.f(m)) { this.w.splice(this.w.indexOf(w), 1); this.cur = this.log.length; w.r(m); } }; }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async auth(token) { await this.opened; this.send({ t: 'auth', token }); return this.expect(m => m.t === 'ready' || m.t === 'err'); }
  expect(f, ms = 4000) {
    for (let i = this.cur; i < this.log.length; i++) if (f(this.log[i])) { this.cur = i + 1; return Promise.resolve(this.log[i]); }
    return new Promise((res, rej) => { const w = { f, r: v => { clearTimeout(t); res(v); } }; const t = setTimeout(() => { this.w.splice(this.w.indexOf(w), 1); rej(new Error('timeout esperando mensagem; últimas: ' + JSON.stringify(this.log.slice(-3)).slice(0, 300))); }, ms); this.w.push(w); });
  }
  async guest(name) { const r = await this.auth('guest:' + name); assert.strictEqual(r.t, 'ready'); return this; }
  close() { try { this.ws.close(); } catch (e) { /* ok */ } }
}
const mkServer = async o => { const s = createServer(Object.assign({ allowGuest: true, countdownMs: 300, tickMs: 1e9 }, o)); await new Promise(r => s.listen(0, r)); s.port = s.http.address().port; return s; };
const step = (room, n) => { for (let i = 0; i < n; i++) room.game.step(); };

(async () => {
  const S = await mkServer(); // tickMs enorme: a simulação é avançada manualmente nos testes (determinístico)

  await test('health responde ok', async () => { const j = await (await fetch('http://127.0.0.1:' + S.port + '/health')).json(); assert.strictEqual(j.ok, true); });

  await test('sem login: mensagens são recusadas; token inválido fecha conexão', async () => {
    const a = new C(S.port); await a.opened; a.send({ t: 'room_create', mode: 'x1' }); const e = await a.expect(m => m.t === 'err'); assert.strictEqual(e.code, 'auth');
    const b = new C(S.port); const r = await b.auth('lixo.lixo.lixo'); assert.strictEqual(r.t, 'err'); assert.strictEqual(await b.closed, 4001); a.close();
  });

  await test('jwt HS256 válido entra; assinatura errada e token expirado são recusados', async () => {
    const T = await mkServer({ allowGuest: false, jwtSecret: 'segredo-de-teste' });
    const sign = (p, sec) => { const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), b = Buffer.from(JSON.stringify(p)).toString('base64url'); return h + '.' + b + '.' + crypto.createHmac('sha256', sec).update(h + '.' + b).digest('base64url'); };
    const uid = crypto.randomUUID(), good = sign({ sub: uid, exp: Math.floor(Date.now() / 1000) + 60, user_metadata: { nickname: 'Ana_01' } }, 'segredo-de-teste');
    const a = new C(T.port); const r = await a.auth(good); assert.strictEqual(r.t, 'ready'); assert.strictEqual(r.user.name, 'Ana_01'); assert.strictEqual(r.user.id, uid);
    const b = new C(T.port); assert.strictEqual((await b.auth(sign({ sub: uid, exp: 9999999999 }, 'outro-segredo'))).t, 'err');
    const c = new C(T.port); assert.strictEqual((await c.auth(sign({ sub: uid, exp: 100 }, 'segredo-de-teste'))).t, 'err');
    const d = new C(T.port); assert.strictEqual((await d.auth('guest:x')).t, 'err'); // convidado desligado em produção
    a.close(); T.close();
  });

  await test('jwt ES256 via JWKS (formato dos projetos novos do Supabase)', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'ES256' });
    const stub = http.createServer((q, s) => { s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ keys: [jwk] })); }); await new Promise(r => stub.listen(0, r));
    const T = await mkServer({ allowGuest: false, supabaseUrl: 'http://127.0.0.1:' + stub.address().port });
    const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k1' })).toString('base64url'), b = Buffer.from(JSON.stringify({ sub: crypto.randomUUID(), exp: 9999999999, email: 'zeca@x.com' })).toString('base64url');
    const sig = crypto.sign('sha256', Buffer.from(h + '.' + b), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const a = new C(T.port); const r = await a.auth(h + '.' + b + '.' + sig); assert.strictEqual(r.t, 'ready'); assert.strictEqual(r.user.name, 'zeca');
    const bad = new C(T.port); assert.strictEqual((await bad.auth(h + '.' + b + '.' + sig.slice(0, -4) + 'AAAA')).t, 'err');
    a.close(); T.close(); stub.close();
  });

  await test('Battle Royale: 1, 2, 3 e 4 jogadores reais + bots até 32; líder inicia; 5º jogador é recusado', async () => {
    for (const n of [1, 2, 3, 4]) {
      const cs = []; for (let i = 0; i < n; i++) cs.push(await new C(S.port).guest('br' + n + '_' + i));
      cs[0].send({ t: 'room_create', mode: 'br' }); const room = await cs[0].expect(m => m.t === 'room'); assert.strictEqual(room.room.code.length, 6); assert.strictEqual(room.room.leader, cs[0] && room.room.members[0].id);
      for (let i = 1; i < n; i++) { cs[i].send({ t: 'room_join', code: room.room.code.toLowerCase() }); await cs[i].expect(m => m.t === 'room' && m.room.members.length === i + 1); }
      if (n > 1) { cs[1].send({ t: 'start' }); assert.strictEqual((await cs[1].expect(m => m.t === 'err')).code, 'not_leader'); }
      if (n === 4) { const x = await new C(S.port).guest('extra'); x.send({ t: 'room_join', code: room.room.code }); assert.strictEqual((await x.expect(m => m.t === 'err')).code, 'full'); x.close(); }
      cs[0].send({ t: 'start' }); const st = await cs[0].expect(m => m.t === 'start');
      assert.strictEqual(st.players.length, 32, 'total 32'); assert.strictEqual(st.players.filter(p => !p.bot).length, n); assert.strictEqual(st.players.filter(p => p.bot).length, 32 - n);
      const sn = await cs[0].expect(m => m.t === 'snap').catch(() => null); // com tick manual ainda não há snap; ok
      cs.forEach(c => c.close()); await sleep(30);
    }
  });

  await test('X1: não inicia com 1 jogador, não aceita 3º, inicia com 2 reais e SEM bots', async () => {
    const a = await new C(S.port).guest('x1a'), b = await new C(S.port).guest('x1b'), c = await new C(S.port).guest('x1c');
    a.send({ t: 'room_create', mode: 'x1' }); const r = (await a.expect(m => m.t === 'room')).room;
    a.send({ t: 'start' }); assert.strictEqual((await a.expect(m => m.t === 'err')).code, 'need_players');
    b.send({ t: 'room_join', code: r.code }); const r2 = (await b.expect(m => m.t === 'room' && m.room.members.length === 2)).room;
    assert.deepStrictEqual(r2.members.map(m => m.team).sort(), [0, 1]);
    c.send({ t: 'room_join', code: r.code }); assert.strictEqual((await c.expect(m => m.t === 'err')).code, 'full');
    b.send({ t: 'start' }); assert.strictEqual((await b.expect(m => m.t === 'err')).code, 'not_leader');
    a.send({ t: 'start' }); await a.expect(m => m.t === 'countdown'); const st = await a.expect(m => m.t === 'start');
    assert.strictEqual(st.players.length, 2); assert.ok(st.players.every(p => !p.bot)); assert.strictEqual(st.mode, 'x1');
    [a, b, c].forEach(x => x.close()); await sleep(30);
  });

  await test('2X2: precisa de 4 reais, times 2x2, troca de lado, sem bots', async () => {
    const cs = []; for (let i = 0; i < 4; i++) cs.push(await new C(S.port).guest('d' + i));
    cs[0].send({ t: 'room_create', mode: '2x2' }); const code = (await cs[0].expect(m => m.t === 'room')).room.code;
    for (let i = 1; i < 3; i++) { cs[i].send({ t: 'room_join', code }); await cs[i].expect(m => m.t === 'room' && m.room.members.length === i + 1); }
    cs[0].send({ t: 'start' }); assert.strictEqual((await cs[0].expect(m => m.t === 'err')).code, 'need_players');
    cs[3].send({ t: 'room_join', code }); const full = (await cs[3].expect(m => m.t === 'room' && m.room.members.length === 4)).room;
    const t = full.members.map(m => m.team); assert.strictEqual(t.filter(x => x === 0).length, 2); assert.strictEqual(t.filter(x => x === 1).length, 2);
    cs[0].send({ t: 'team', team: 1 }); assert.strictEqual((await cs[0].expect(m => m.t === 'err')).code, 'team_full'); // time 1 já tem 2
    cs[0].send({ t: 'start' }); const st = await cs[0].expect(m => m.t === 'start');
    assert.strictEqual(st.players.length, 4); assert.ok(st.players.every(p => !p.bot));
    cs.forEach(x => x.close()); await sleep(30);
  });

  await test('X1: combate autoritativo, rodadas, vitória, placar e revanche', async () => {
    const a = await new C(S.port).guest('ca'), b = await new C(S.port).guest('cb');
    a.send({ t: 'room_create', mode: 'x1' }); const code = (await a.expect(m => m.t === 'room')).room.code; b.send({ t: 'room_join', code }); await b.expect(m => m.t === 'room' && m.room.members.length === 2);
    a.send({ t: 'start' }); await a.expect(m => m.t === 'start'); await b.expect(m => m.t === 'start');
    const room = S.rooms.rooms.get(code), g = room.game; g.world.obs = [];
    const pa = g.get('guest_ca'), pb = g.get('guest_cb'); assert.notStrictEqual(pa.team, pb.team);
    for (let r = 0; r < 2; r++) { // jogador A vence 2 rodadas
      pa.x = -10; pa.z = 0; pb.x = 10; pb.z = 0; pa.hp = pb.hp = 100;
      a.send({ t: 'in', mx: 0, mz: 0, yaw: pa.team === 0 ? -Math.PI / 2 : Math.PI / 2, fire: true }); await sleep(20);
      if (pa.team === 1) { pa.x = 10; pb.x = -10; }
      for (let i = 0; i < 400 && g.state === 'running' && g.rounds[pa.team] === r; i++) { g.step(); pb.hp = Math.min(pb.hp, pb.hp); }
      assert.strictEqual(g.rounds[pa.team], r + 1, 'rodada ' + (r + 1) + ' ganha');
      if (g.state === 'running') for (let i = 0; i < 80; i++) g.step(); // pausa entre rodadas
    }
    const end = await a.expect(m => m.t === 'end'); assert.strictEqual(end.result.winner, pa.team);
    const row = end.result.rows.find(x => x.id === 'guest_ca'); assert.ok(row.won); assert.ok(row.kills >= 2); assert.ok(row.dmg >= 90);
    assert.deepStrictEqual(end.result.rounds[pa.team], 2);
    // revanche: os dois precisam aceitar
    a.send({ t: 'rematch' }); await b.expect(m => m.t === 'rematch' && m.votes === 1);
    b.send({ t: 'rematch' }); await a.expect(m => m.t === 'countdown'); const st2 = await a.expect(m => m.t === 'start'); assert.notStrictEqual(st2.seed, g.seed);
    a.close(); b.close(); await sleep(30);
  });

  await test('mesma equipe não causa dano (fogo amigo desligado) e obstáculo bloqueia tiro', async () => {
    const cs = []; for (let i = 0; i < 4; i++) cs.push(await new C(S.port).guest('f' + i));
    cs[0].send({ t: 'room_create', mode: '2x2' }); const code = (await cs[0].expect(m => m.t === 'room')).room.code;
    for (let i = 1; i < 4; i++) { cs[i].send({ t: 'room_join', code }); await cs[i].expect(m => m.t === 'room' && m.room.members.length === i + 1); }
    cs[0].send({ t: 'start' }); await cs[0].expect(m => m.t === 'start'); const g = S.rooms.rooms.get(code).game; g.world.obs = [];
    const me = g.players[0], mate = g.players.find(p => p !== me && p.team === me.team), foe = g.players.find(p => p.team !== me.team);
    me.x = 0; me.z = 0; mate.x = 0; mate.z = -10; foe.x = 0; foe.z = -20; me.inp = { mx: 0, mz: 0, yaw: 0, fire: 1 };
    step(S.rooms.rooms.get(code), 6); assert.strictEqual(mate.hp, 100, 'colega intacto'); assert.ok(foe.hp < 100, 'inimigo atrás do colega leva dano');
    foe.hp = 100; g.world.obs = [{ x: 0, z: -15, w: 4, d: 2 }]; step(S.rooms.rooms.get(code), 6); assert.strictEqual(foe.hp, 100, 'parede bloqueia');
    cs.forEach(x => x.close()); await sleep(30);
  });

  await test('servidor limita velocidade e valida entradas (anti-teletransporte)', async () => {
    const a = await new C(S.port).guest('sp'); a.send({ t: 'room_create', mode: 'br' }); const code = (await a.expect(m => m.t === 'room')).room.code;
    a.send({ t: 'start' }); await a.expect(m => m.t === 'start'); const room = S.rooms.rooms.get(code), g = room.game, p = g.get('guest_sp'); g.world.obs = [];
    p.x = 0; p.z = 0; a.send({ t: 'in', mx: 9999, mz: 0, yaw: 0, fire: false }); await sleep(30);
    for (let i = 0; i < 20; i++) g.step(); assert.ok(p.x <= 8.01 && p.x > 7, 'andou ~8 em 1s, andou ' + p.x);
    a.send({ t: 'in', mx: 'NaN', mz: {}, yaw: 'x', fire: 'sim' }); await sleep(30); const x0 = p.x; g.step(); assert.strictEqual(p.x, x0); assert.ok(Number.isFinite(p.yaw));
    a.close(); await sleep(30);
  });

  await test('Battle Royale: 31 bots jogam sozinhos, zona encolhe, sem erros; vitória encerra e premia', async () => {
    const a = await new C(S.port).guest('bro'); a.send({ t: 'room_create', mode: 'br' }); const code = (await a.expect(m => m.t === 'room')).room.code;
    a.send({ t: 'start' }); await a.expect(m => m.t === 'start'); const room = S.rooms.rooms.get(code), g = room.game, me = g.get('guest_bro');
    me.alive = true; for (let i = 0; i < 1400; i++) { me.hp = 100; g.step(); } // 70 s de jogo simulado
    assert.ok(g.zone.phase >= 1 || g.zone.r < g.world.size * .72, 'zona começou a fechar');
    assert.ok(g.players.some(p => p.bot && p.kills > 0) || g.players.filter(p => p.alive).length < 32, 'bots lutam entre si');
    for (const p of g.players) if (p !== me && p.alive) g.die(p, me); g.step();
    const end = await a.expect(m => m.t === 'end'); assert.strictEqual(end.result.rows[0].place, 1); assert.ok(end.result.rows[0].xp > 100);
    a.close(); await sleep(30);
  });

  await test('desistência: quem sai no meio do X1 perde; o outro vence', async () => {
    const a = await new C(S.port).guest('la'), b = await new C(S.port).guest('lb');
    a.send({ t: 'room_create', mode: 'x1' }); const code = (await a.expect(m => m.t === 'room')).room.code; b.send({ t: 'room_join', code }); await b.expect(m => m.t === 'room' && m.room.members.length === 2);
    a.send({ t: 'start' }); await a.expect(m => m.t === 'start'); const g = S.rooms.rooms.get(code).game;
    b.close(); await sleep(60); g.step(); const end = await a.expect(m => m.t === 'end'); assert.ok(end.result.rows.find(r => r.id === 'guest_la').won);
    a.close(); await sleep(30);
  });

  await test('líder sai e a liderança passa para outro jogador; sala vazia some', async () => {
    const a = await new C(S.port).guest('ma'), b = await new C(S.port).guest('mb');
    a.send({ t: 'room_create', mode: 'br' }); const code = (await a.expect(m => m.t === 'room')).room.code; b.send({ t: 'room_join', code }); await b.expect(m => m.t === 'room' && m.room.members.length === 2);
    a.send({ t: 'room_leave' }); const r = (await b.expect(m => m.t === 'room' && m.room.members.length === 1)).room; assert.strictEqual(r.leader, 'guest_mb');
    b.send({ t: 'room_leave' }); await sleep(40); assert.ok(!S.rooms.rooms.has(code)); a.close(); b.close();
  });

  await test('presença online e convite exigem estar online; sem Supabase o convite vai direto (modo local)', async () => {
    const a = await new C(S.port).guest('pa'), b = await new C(S.port).guest('pb');
    a.send({ t: 'presence', ids: ['guest_pb', 'guest_nao_existe'] }); assert.deepStrictEqual((await a.expect(m => m.t === 'presence')).online, ['guest_pb']);
    a.send({ t: 'room_create', mode: '2x2' }); const code = (await a.expect(m => m.t === 'room')).room.code;
    a.send({ t: 'invite', to: 'guest_nao_existe' }); assert.strictEqual((await a.expect(m => m.t === 'err')).code, 'offline');
    a.send({ t: 'invite', to: 'guest_pb' }); const inv = await b.expect(m => m.t === 'invited'); assert.strictEqual(inv.code, code); assert.strictEqual(inv.from.name, 'pa');
    a.close(); b.close(); await sleep(30);
  });

  await test('Supabase (stub): amizade verificada no convite, apelido oficial do banco e prêmio da partida enviado', async () => {
    const A = crypto.randomUUID(), B = crypto.randomUUID(), Cc = crypto.randomUUID(), awards = [];
    const stub = http.createServer((q, s) => {
      let body = ''; q.on('data', d => body += d); q.on('end', () => {
        s.setHeader('Content-Type', 'application/json');
        if (q.url.startsWith('/rest/v1/profiles')) return s.end(JSON.stringify([{ nickname: 'Oficial' + (q.url.includes(A) ? 'A' : q.url.includes(B) ? 'B' : 'C'), player_code: '00007' }]));
        if (q.url.startsWith('/rest/v1/friendships')) return s.end(JSON.stringify(q.url.includes(A) && q.url.includes(B) ? [{ id: 1 }] : []));
        if (q.url.startsWith('/rest/v1/rpc/award_match')) { awards.push(JSON.parse(body)); return s.end('{}'); }
        s.statusCode = 404; s.end('[]');
      });
    }); await new Promise(r => stub.listen(0, r));
    const T = await mkServer({ allowGuest: false, jwtSecret: 's3', supabaseUrl: 'http://127.0.0.1:' + stub.address().port, serviceKey: 'chave-de-servico-fake' });
    const tok = id => { const h = Buffer.from('{"alg":"HS256"}').toString('base64url'), b = Buffer.from(JSON.stringify({ sub: id, exp: 9999999999 })).toString('base64url'); return h + '.' + b + '.' + crypto.createHmac('sha256', 's3').update(h + '.' + b).digest('base64url'); };
    const a = new C(T.port), b = new C(T.port), c = new C(T.port); const ra = await a.auth(tok(A)); await b.auth(tok(B)); await c.auth(tok(Cc));
    assert.strictEqual(ra.user.name, 'OficialA'); assert.strictEqual(ra.user.code, '00007'); assert.strictEqual(ra.supabase, true);
    a.send({ t: 'room_create', mode: 'x1' }); const code = (await a.expect(m => m.t === 'room')).room.code;
    a.send({ t: 'invite', to: Cc }); assert.strictEqual((await a.expect(m => m.t === 'err')).code, 'not_friends');
    a.send({ t: 'invite', to: B }); assert.strictEqual((await b.expect(m => m.t === 'invited')).code, code);
    b.send({ t: 'room_join', code }); await b.expect(m => m.t === 'room' && m.room.members.length === 2);
    a.send({ t: 'start' }); await a.expect(m => m.t === 'start'); const g = T.rooms.rooms.get(code).game; g.world.obs = [];
    const pa = g.get(A), pb = g.get(B); for (let r = 0; r < 2; r++) { pa.x = pa.team === 0 ? -10 : 10; pb.x = -pa.x; pa.z = pb.z = 0; pa.hp = pb.hp = 100; pa.inp = { mx: 0, mz: 0, fire: 1, yaw: pa.team === 0 ? -Math.PI / 2 : Math.PI / 2 }; for (let i = 0; i < 400 && g.state === 'running' && g.rounds[pa.team] === r; i++) g.step(); for (let i = 0; i < 80 && g.state === 'running'; i++) g.step(); }
    await a.expect(m => m.t === 'end'); await sleep(100); assert.strictEqual(awards.length, 1); assert.strictEqual(awards[0].p_rows.length, 2);
    a.close(); b.close(); c.close(); T.close(); stub.close();
  });

  await test('limite de mensagens por segundo derruba conexão abusiva', async () => {
    const a = await new C(S.port).guest('spam'); for (let i = 0; i < 300; i++) a.send({ t: 'ping' }); assert.strictEqual(await a.closed, 1008);
  });

  await test('origem não autorizada é recusada quando ALLOWED_ORIGINS está configurado', async () => {
    const T = await mkServer({ origins: 'https://arena32.netlify.app' });
    const tryOrigin = origin => new Promise(res => { const q = http.request({ port: T.port, path: '/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), Origin: origin } }); q.on('upgrade', (r, s) => { s.destroy(); res(true); }); q.on('error', () => res(false)); q.on('response', () => res(false)); q.end(); });
    assert.strictEqual(await tryOrigin('https://arena32.netlify.app'), true); assert.strictEqual(await tryOrigin('https://site-malicioso.example'), false); T.close();
  });

  await test('mapa é idêntico no servidor e no cliente (mesma semente)', async () => {
    const fs = require('fs'), a = fs.readFileSync(__dirname + '/../../shared/world.js'), b = fs.readFileSync(__dirname + '/../../site/world.js');
    assert.ok(a.equals(b), 'site/world.js precisa ser cópia de shared/world.js'); assert.deepStrictEqual(W.gen('x1', 7), W.gen('x1', 7)); assert.notDeepStrictEqual(W.gen('br', 1), W.gen('br', 2));
  });

  S.close();
  console.log(results.join('\n')); console.log('\n' + (results.length - fails) + '/' + results.length + ' testes passaram'); process.exit(fails ? 1 : 0);
})();
