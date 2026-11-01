'use strict';
const http = require('http');
const { accept } = require('./lib/ws');
const { verify } = require('./lib/auth');
const { Rooms } = require('./lib/rooms');
const makeSupa = require('./lib/supa');

function createServer(o = {}) {
  const env = process.env;
  const cfg = {
    allowGuest: o.allowGuest ?? env.ALLOW_GUEST === '1',
    jwtSecret: o.jwtSecret ?? env.SUPABASE_JWT_SECRET,
    jwksUrl: o.jwksUrl ?? ((o.supabaseUrl ?? env.SUPABASE_URL) ? (o.supabaseUrl ?? env.SUPABASE_URL) + '/auth/v1/.well-known/jwks.json' : ''),
    origins: String(o.origins ?? env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  };
  const supa = makeSupa({ url: o.supabaseUrl ?? env.SUPABASE_URL, serviceKey: o.serviceKey ?? env.SUPABASE_SERVICE_ROLE_KEY });
  const rooms = new Rooms({ countdownMs: o.countdownMs ?? 5000, tickMs: o.tickMs ?? 50 }, supa);
  const online = new Map();

  const srv = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, online: online.size })); return; }
    res.writeHead(404); res.end();
  });
  srv.on('upgrade', (req, socket) => {
    if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
    if (cfg.origins.length && !cfg.origins.includes(req.headers.origin)) { socket.destroy(); return; }
    accept(req, socket, conn => onConn(conn));
  });

  const send = (c, o2) => { if (c.open) c.send(JSON.stringify(o2)); };
  const err = (c, code, msg) => send(c, { t: 'err', code, msg });

  function onConn(c) {
    c.user = null; let count = 0;
    const tm = setInterval(() => { count = 0; }, 1000);
    const authTimer = setTimeout(() => { if (!c.user) c.close(4000); }, 10000);
    c.on('message', async raw => {
      if (++count > 80) return c.close(1008); // limite de mensagens por segundo
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      try { await handle(c, m); } catch (e) { err(c, 'server', 'Erro interno'); }
    });
    c.on('close', () => {
      clearInterval(tm); clearTimeout(authTimer);
      if (c.user) { rooms.leave(c.user.id); if (online.get(c.user.id) === c) online.delete(c.user.id); }
    });
  }

  async function handle(c, m) {
    if (m.t === 'auth') {
      let u; try { u = await verify(m.token, cfg); } catch (e) { err(c, 'auth', 'Login inválido'); return c.close(4001); }
      let code = null;
      try { const p = await supa.profile(u.id); if (p) { u.name = p.nickname; code = p.player_code; } } catch (e) { /* segue com os dados do token */ }
      const old = online.get(u.id); if (old && old !== c) { old.user = null; old.close(4002); } // 1 sessão por conta
      c.user = { id: u.id, name: u.name, code }; online.set(u.id, c);
      return send(c, { t: 'ready', user: c.user, supabase: supa.enabled });
    }
    if (!c.user) return err(c, 'auth', 'Faça login primeiro');
    const me = c.user;
    switch (m.t) {
      case 'ping': return send(c, { t: 'pong' });
      case 'presence': {
        const ids = Array.isArray(m.ids) ? m.ids.slice(0, 200).filter(x => typeof x === 'string') : [];
        return send(c, { t: 'presence', online: ids.filter(i => online.has(i)) });
      }
      case 'room_create': {
        rooms.leave(me.id); const r = rooms.create({ id: me.id, name: me.name, conn: c }, m.mode);
        if (!r) return err(c, 'bad_mode', 'Modo inválido'); return r.push();
      }
      case 'room_join': {
        rooms.leave(me.id); const j = rooms.join({ id: me.id, name: me.name, conn: c }, m.code);
        if (j.err) return err(c, j.err, j.msg); return j.room.push();
      }
      case 'room_leave': rooms.leave(me.id); return send(c, { t: 'left' });
      case 'team': { const r = rooms.byUser.get(me.id); if (!r) return; const e = r.swap(me.id, m.team); if (e) err(c, e, 'Não foi possível trocar de lado'); return; }
      case 'start': {
        const r = rooms.byUser.get(me.id); if (!r) return err(c, 'no_room', 'Você não está em uma sala');
        const e = r.start(me.id); if (e) err(c, e.code, e.msg); return;
      }
      case 'rematch': { const r = rooms.byUser.get(me.id); if (r) r.rematch(me.id); return; }
      case 'in': { const r = rooms.byUser.get(me.id); if (r && r.status === 'playing' && r.game) r.game.input(me.id, m); return; }
      case 'invite': {
        const r = rooms.byUser.get(me.id); if (!r || r.status !== 'lobby') return err(c, 'no_room', 'Crie uma sala antes de convidar');
        if (typeof m.to !== 'string' || m.to === me.id) return;
        const target = online.get(m.to); if (!target) return err(c, 'offline', 'Seu amigo está offline');
        if (!(await supa.areFriends(me.id, m.to))) return err(c, 'not_friends', 'Vocês ainda não são amigos');
        send(target, { t: 'invited', code: r.code, mode: r.mode, from: { id: me.id, name: me.name } });
        return send(c, { t: 'invite_ok' });
      }
    }
  }
  return { http: srv, rooms, online, listen: (port, cb) => srv.listen(port, cb), close: () => { for (const r of rooms.rooms.values()) r.destroy(); srv.close(); srv.closeAllConnections && srv.closeAllConnections(); } };
}

module.exports = { createServer };
if (require.main === module) {
  try { for (const l of require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch (e) { /* sem .env: usa variáveis do ambiente */ }
  const port = Number(process.env.PORT || 8080);
  const s = createServer();
  s.listen(port, () => console.log('Arena32 server ouvindo na porta ' + port + (process.env.ALLOW_GUEST === '1' ? ' [ALLOW_GUEST=1: SOMENTE PARA TESTES]' : '')));
}
