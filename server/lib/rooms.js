'use strict';
const crypto = require('crypto');
const { Game } = require('./game');
const W = require('../../shared/world');
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class Room {
  constructor(mgr, code, mode, user) {
    this.m = mgr; this.code = code; this.mode = mode; this.leader = user.id; this.members = new Map();
    this.status = 'lobby'; this.game = null; this.votes = new Set(); this.timer = null; this.cd = null;
    this.add(user);
  }
  cap() { return W.MODES[this.mode].humans; }
  teamMode() { return this.mode !== 'br'; }
  add(u) {
    let team = 0;
    if (this.teamMode()) { const per = this.mode === 'x1' ? 1 : 2, c = [0, 0]; for (const m of this.members.values()) c[m.team]++; team = c[0] < per ? 0 : 1; }
    this.members.set(u.id, { id: u.id, name: u.name, conn: u.conn, team, connected: true });
  }
  info() { return { code: this.code, mode: this.mode, leader: this.leader, status: this.status, max: this.cap(), members: [...this.members.values()].map(m => ({ id: m.id, name: m.name, team: m.team, leader: m.id === this.leader, connected: m.connected })) }; }
  send(m, obj) { if (m.conn && m.conn.open) m.conn.send(JSON.stringify(obj)); }
  broadcast(obj) { const s = JSON.stringify(obj); for (const m of this.members.values()) if (m.conn && m.conn.open) m.conn.send(s); }
  push() { this.broadcast({ t: 'room', room: this.info() }); }
  swap(id, team) {
    if (this.status !== 'lobby' || !this.teamMode() || (team !== 0 && team !== 1)) return 'bad_state';
    const per = this.mode === 'x1' ? 1 : 2; let c = 0; for (const m of this.members.values()) if (m.team === team && m.id !== id) c++;
    if (c >= per) return 'team_full';
    this.members.get(id).team = team; this.push(); return null;
  }
  problem() { // por que não pode iniciar?
    const n = this.members.size;
    if (this.mode === 'x1' && n !== 2) return 'X1 precisa de exatamente 2 jogadores reais';
    if (this.mode === '2x2') { if (n !== 4) return '2X2 precisa de exatamente 4 jogadores reais'; const c = [0, 0]; for (const m of this.members.values()) c[m.team]++; if (c[0] !== 2 || c[1] !== 2) return 'As equipes precisam ter 2 jogadores cada'; }
    if (this.mode === 'x1') { const c = [0, 0]; for (const m of this.members.values()) c[m.team]++; if (c[0] !== 1) return 'Cada lado precisa de 1 jogador'; }
    return null;
  }
  start(id) {
    if (id !== this.leader) return { code: 'not_leader', msg: 'Só o líder pode iniciar' };
    if (this.status !== 'lobby') return { code: 'bad_state', msg: 'A sala já está em partida' };
    const p = this.problem(); if (p) return { code: 'need_players', msg: p };
    this.countdown(); return null;
  }
  countdown() {
    this.status = 'countdown'; let n = Math.max(1, Math.round(this.m.o.countdownMs / 1000)); const ms = this.m.o.countdownMs / n;
    this.push(); this.broadcast({ t: 'countdown', n });
    this.cd = setInterval(() => { n--; if (n <= 0) { clearInterval(this.cd); this.begin(); } else this.broadcast({ t: 'countdown', n }); }, ms);
  }
  begin() {
    const seed = crypto.randomInt(1, 2147483646), humans = [...this.members.values()].filter(m => m.connected).map(m => ({ id: m.id, name: m.name, team: m.team }));
    if (!humans.length) return this.destroy();
    this.status = 'playing'; this.votes.clear();
    this.game = new Game(this.mode, humans, seed, { onEnd: r => this.ended(r) });
    this.push(); this.broadcast(this.game.startMsg());
    const g = this.game, every = g.players.length > 8 ? 2 : 1;
    this.timer = setInterval(() => {
      g.step(); if (g.tick % every === 0 || g.state === 'ended') { this.broadcast(g.snap()); g.ev = []; }
      if (g.state === 'ended') clearInterval(this.timer);
    }, this.m.o.tickMs);
  }
  ended(r) {
    this.status = 'ended'; this.broadcast({ t: 'end', result: r, need: this.need() });
    this.push(); this.m.supa.award(r.rows.filter(x => !String(x.id).startsWith('guest_')), r.mode).catch(() => {});
  }
  need() { return [...this.members.values()].filter(m => m.connected).length; }
  rematch(id) {
    if (this.status !== 'ended') return;
    this.votes.add(id); this.broadcast({ t: 'rematch', votes: this.votes.size, need: this.need() });
    this.tryRematch();
  }
  tryRematch() { if (this.status === 'ended' && this.votes.size >= this.need() && this.need() > 0) { this.status = 'lobby'; this.votes.clear(); const p = this.problem(); if (p) { this.push(); this.broadcast({ t: 'err', code: 'need_players', msg: p }); } else this.countdown(); } }
  leave(id) {
    const m = this.members.get(id); if (!m) return;
    if (this.game && this.status === 'playing') { this.game.leave(id); m.connected = false; m.conn = null; }
    else this.members.delete(id);
    this.votes.delete(id);
    if (![...this.members.values()].some(x => x.connected)) return this.destroy();
    if (id === this.leader) this.leader = [...this.members.values()].find(x => x.connected).id;
    this.push(); this.tryRematch();
  }
  destroy() { clearInterval(this.timer); clearInterval(this.cd); this.m.rooms.delete(this.code); for (const id of this.members.keys()) if (this.m.byUser.get(id) === this) this.m.byUser.delete(id); }
}

class Rooms {
  constructor(o, supa) { this.o = Object.assign({ countdownMs: 5000, tickMs: 50 }, o); this.supa = supa; this.rooms = new Map(); this.byUser = new Map(); }
  code() { for (;;) { let c = ''; for (let i = 0; i < 6; i++) c += ALPHA[crypto.randomInt(ALPHA.length)]; if (!this.rooms.has(c)) return c; } }
  create(user, mode) {
    if (!W.MODES[mode]) return null;
    const r = new Room(this, this.code(), mode, user); this.rooms.set(r.code, r); this.byUser.set(user.id, r); return r;
  }
  join(user, code) {
    const r = this.rooms.get(String(code || '').toUpperCase()); if (!r) return { err: 'not_found', msg: 'Sala não encontrada' };
    if (r.status !== 'lobby') return { err: 'in_progress', msg: 'A partida já começou' };
    if (r.members.size >= r.cap()) return { err: 'full', msg: 'Sala cheia' };
    r.add(user); this.byUser.set(user.id, r); return { room: r };
  }
  leave(id) { const r = this.byUser.get(id); if (!r) return; this.byUser.delete(id); r.leave(id); }
}
module.exports = { Rooms };
