'use strict';
// Teste de ponta a ponta: o cliente de rede REAL (site/net.js) conversando com o servidor REAL em tempo real.
const assert = require('assert');
const Net = require('../../site/net.js');
const { createServer } = require('../server');
const W = require('../../shared/world');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const waitFor = (net, t, f = () => true, ms = 4000) => new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('timeout ' + t)), ms); net.on(t, m => { if (f(m)) { clearTimeout(to); res(m); } }); });
(async () => {
  const s = createServer({ allowGuest: true, countdownMs: 1000, tickMs: 50 }); await new Promise(r => s.listen(0, r)); const url = 'ws://127.0.0.1:' + s.http.address().port + '/ws';
  const a = new Net(url), b = new Net(url);
  await a.connect('guest:Alice'); await b.connect('guest:Bob');
  const rooms = waitFor(a, 'room'); a.createRoom('x1'); const code = (await rooms).room.code;
  b.join(code); await waitFor(a, 'room', m => m.room.members.length === 2);
  const snapsA = [], snapsB = []; a.on('snap', m => snapsA.push(m)); b.on('snap', m => snapsB.push(m));
  const startA = waitFor(a, 'start'), startB = waitFor(b, 'start'); a.start();
  const sa = await startA; await startB;
  // cliente regenera o mesmo mapa a partir da semente
  assert.deepStrictEqual(W.gen(sa.mode, sa.seed).obs, sa.world.obs, 'mapa do cliente == mapa do servidor');
  const me = sa.players.find(p => p.id === 'guest_Alice'), idx = sa.players.indexOf(me);
  a.input({ mx: 1, mz: 0, yaw: 0, fire: false }); await sleep(700);
  assert.ok(snapsA.length >= 8 && snapsB.length >= 8, 'recebeu snapshots em tempo real (' + snapsA.length + ')');
  const p0 = snapsA[0].p[idx], p1 = snapsA[snapsA.length - 1].p[idx];
  const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); assert.ok(moved > 2 && moved < 8, 'A se moveu pelo servidor: ' + moved.toFixed(2));
  const q0 = snapsB[0].p[idx], q1 = snapsB[snapsB.length - 1].p[idx]; assert.ok(Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) > 2, 'B vê A se movendo');
  a.close(); b.close(); s.close();
  console.log('PASS cliente de rede <-> servidor em tempo real (' + snapsA.length + ' snapshots, movimento ' + moved.toFixed(1) + ' un)'); process.exit(0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
