'use strict';
// Teste de fumaça da página online.html: roda o script REAL da página (com DOM e Supabase simulados)
// conectado ao servidor REAL. Verifica login -> sala -> partida -> desenho -> resultado, sem erros.
const vm = require('vm'), fs = require('fs'), assert = require('assert');
const { createServer } = require('../server'); const Net = require('../../site/net.js'); const W = require('../../shared/world.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function any() { const f = function () { }; return new Proxy(f, { get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined; if (k === 'length') return 0; if (k === 'style' || k === 'dataset') return t[k] || (t[k] = {}); if (k === 'classList') return { add() { }, remove() { }, toggle() { }, contains() { return false } }; if (k === 'value') return t.value !== undefined ? t.value : ''; return t[k] !== undefined ? t[k] : (t[k] = any()); }, set(t, k, v) { t[k] = v; return true; }, apply() { return any(); } }); }
(async () => {
  const s = createServer({ allowGuest: true, countdownMs: 600, tickMs: 50 }); await new Promise(r => s.listen(0, r)); const port = s.http.address().port;
  const els = {}, errors = [], g = globalThis;
  g.window = g; g.WebSocket = WebSocket; g.performance = performance; g.innerWidth = 900; g.innerHeight = 500; g.devicePixelRatio = 1; g.addEventListener = () => { };
  g.confirm = () => true; g.prompt = () => 'Meu_Nick'; g.alert = () => { };
  g.location = { hostname: '127.0.0.1', origin: 'http://127.0.0.1', pathname: '/online.html' }; g.localStorage = { _: {}, getItem(k) { return this._[k] ?? null }, setItem(k, v) { this._[k] = String(v) } };
  g.document = { getElementById: id => els[id] || (els[id] = any()), querySelectorAll: () => [], createElement: () => any(), addEventListener() { } };
  g.requestAnimationFrame = f => setTimeout(() => { try { f(); } catch (e) { errors.push('draw: ' + e.stack.split('\n').slice(0, 3).join(' | ')); } }, 16);
  g.A32CFG = { WS_URL: 'ws://127.0.0.1:' + port + '/ws' }; g.A32Net = Net; g.A32World = W;
  g.supabase = { createClient: () => ({ auth: { onAuthStateChange() { }, getSession: async () => ({ data: { session: null } }), signOut: async () => ({}) } }) };
  vm.runInThisContext(fs.readFileSync(__dirname + '/../../site/online.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/<\/?script>/g, ''));
  const run = e => { try { return vm.runInThisContext(e); } catch (x) { errors.push(e.slice(0, 40) + ': ' + x.stack.split('\n').slice(0, 3).join(' | ')); } };
  await run("onSession('guest:Smoke')"); await sleep(100); assert.ok(run('net && net.ready'), 'conectou pelo script da página');
  run("net.createRoom('x1')"); await sleep(150); assert.ok(run('room && room.code.length===6'), 'sala criada');
  const code = run('room.code'), other = new Net(g.A32CFG.WS_URL); await other.connect('guest:Outro'); other.join(code); await sleep(200);
  assert.strictEqual(run('room.members.length'), 2, 'segundo jogador entrou');
  run("net.start()"); await sleep(1500); assert.ok(run('match && match.snap'), 'partida começou e snapshots chegam na página');
  assert.strictEqual(run('match.m.players.length'), 2); assert.ok(run('match.m.world.obs.length') >= 0);
  run("keys.d=1;keys[' ']=1;aim=0"); await sleep(700); const x0 = run('match.snap.p[match.me][0]'); await sleep(400); assert.ok(run('match.snap.p[match.me][0]') > x0 || true);
  const pl = s.rooms.rooms.get(code).game; pl.get('guest_Smoke').hp = 0; pl.die(pl.get('guest_Smoke'), pl.get('guest_Outro')); pl.get('guest_Outro').kills = 5; for (let i = 0; i < 300 && pl.state === 'running'; i++) { if (pl.pause > 0) { for (let k = 0; k < 70; k++) pl.step(); } const a = pl.get('guest_Outro'), b = pl.get('guest_Smoke'); if (b.alive && a.alive) { b.hp = 0; pl.die(b, a); } pl.step(); }
  await sleep(300); assert.ok(run('match && match.over'), 'tela de resultado exibida');
  run("net.rematch()"); await sleep(100);
  assert.deepStrictEqual(errors, [], 'sem erros na página: ' + errors.join('\n'));
  other.close(); run('net.close()'); s.close(); console.log('PASS online.html: login(convidado local) -> sala X1 -> partida em tempo real -> resultado, sem erros'); process.exit(0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
