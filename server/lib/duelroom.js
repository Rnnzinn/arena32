'use strict';
const { Duel } = require('./duel');
const SIZE = { x1: 2, '2x2': 4 };
const CFG_KEYS = ['s', 'p', 'k', 'h', 'ws', 'hs', 'hr', 'sc', 'gl', 'bk'];
const cleanCfg = c => { if (!c || typeof c !== 'object') return null; const o = {}; for (const k of CFG_KEYS) if (typeof c[k] === 'number' && isFinite(c[k]) && c[k] >= 0 && c[k] <= 16777215) o[k] = Math.floor(c[k]); return o; };

class DuelRoom {
  constructor(mgr, code, mode, user) {
    this.m = mgr; this.code = code; this.mode = mode; this.leader = user.id; this.members = new Map(); this.status = 'lobby';
    this.settings = { map: 1, rounds: 3 }; this.duel = null; this.votes = new Set(); this.timer = null; this.loadT = null; this.duelRoom = true;
    this.add(user);
  }
  cap() { return SIZE[this.mode]; }
  add(u) {
    const per = SIZE[this.mode] / 2, c = [0, 0]; for (const m of this.members.values()) c[m.team]++;
    this.members.set(u.id, { id: u.id, name: u.name, conn: u.conn, team: c[0] < per ? 0 : 1, connected: true, weapon: 2, ready: false, loaded: false, cfg: cleanCfg(u.cfg), grace: null });
  }
  info() {
    return { code: this.code, mode: this.mode, leader: this.leader, status: this.status, max: this.cap(), settings: this.settings, duel: true,
      members: [...this.members.values()].map(m => ({ id: m.id, name: m.name, team: m.team, leader: m.id === this.leader, connected: m.connected, weapon: m.weapon, ready: m.ready || m.id === this.leader, loaded: m.loaded })) };
  }
  send(m, o) { if (m.conn && m.conn.open) m.conn.send(JSON.stringify(o)); }
  broadcast(o) { const s = JSON.stringify(o); for (const m of this.members.values()) if (m.connected && m.conn && m.conn.open) m.conn.send(s); }
  push() { this.broadcast({ t: 'room', room: this.info() }); }
  editable() { return this.status === 'lobby' || this.status === 'ended'; }
  // ---- configuração da sala ----
  setSettings(id, s) {
    if (id !== this.leader) return 'not_leader'; if (!this.editable()) return 'bad_state';
    const map = Number(s && s.map), rounds = Number(s && s.rounds);
    if (![1, 2, 3].includes(map) || !Number.isInteger(rounds) || rounds < 1 || rounds > 7) return 'bad_value'; // só inteiros de 1 a 7
    this.settings = { map, rounds }; for (const m of this.members.values()) m.ready = false; this.push(); return null;
  }
  setWeapon(id, w) { if (!this.editable()) return 'bad_state'; w = Math.floor(Number(w)); if (!(w >= 0 && w <= 4)) return 'bad_value'; const m = this.members.get(id); m.weapon = w; m.ready = false; this.push(); return null; }
  setReady(id, r) { if (!this.editable()) return 'bad_state'; this.members.get(id).ready = !!r; this.push(); return null; }
  setCfg(id, c) { const m = this.members.get(id); if (m) m.cfg = cleanCfg(c); }
  swap(id, team) {
    if (!this.editable() || (team !== 0 && team !== 1)) return 'bad_state';
    let c = 0; for (const m of this.members.values()) if (m.team === team && m.id !== id) c++;
    if (c >= SIZE[this.mode] / 2) return 'team_full'; const m = this.members.get(id); m.team = team; m.ready = false; this.push(); return null;
  }
  problem() {
    const n = this.members.size, per = SIZE[this.mode] / 2, c = [0, 0]; for (const m of this.members.values()) c[m.team]++;
    if (n !== SIZE[this.mode]) return (this.mode === 'x1' ? 'X1 precisa de exatamente 2 jogadores reais' : '2X2 precisa de exatamente 4 jogadores reais');
    if (c[0] !== per || c[1] !== per) return 'As equipes precisam ter ' + per + ' jogador(es) cada';
    if ([...this.members.values()].some(m => !m.connected)) return 'Há jogador desconectado';
    const notReady = [...this.members.values()].filter(m => m.id !== this.leader && !m.ready); if (notReady.length) return 'Aguardando todos ficarem prontos: ' + notReady.map(m => m.name).join(', ');
    return null;
  }
  // ---- início: todos precisam carregar o jogo 3D antes da contagem ----
  start(id) {
    if (id !== this.leader) return { code: 'not_leader', msg: 'Só o líder pode iniciar' };
    if (this.status !== 'lobby') return { code: 'bad_state', msg: 'A sala já está em partida' };
    const p = this.problem(); if (p) return { code: 'need_players', msg: p };
    this.status = 'loading'; for (const m of this.members.values()) m.loaded = false;
    this.push(); this.broadcast({ t: 'goto', code: this.code });
    this.loadT = setTimeout(() => { if (this.status === 'loading') { this.status = 'lobby'; for (const m of this.members.values()) { m.ready = false; m.loaded = false; } this.push(); this.broadcast({ t: 'err', code: 'load_timeout', msg: 'Nem todos conseguiram carregar o jogo a tempo. Voltando para a sala.' }); } }, this.m.o.loadMs);
    return null;
  }
  loaded(id, cfg) {
    const m = this.members.get(id); if (!m) return; if (cfg) m.cfg = cleanCfg(cfg);
    if (this.status === 'playing' && this.duel) { m.loaded = true; return this.sendState(m); }
    if (this.status !== 'loading') return; m.loaded = true; this.push();
    if ([...this.members.values()].every(x => x.connected && x.loaded)) { clearTimeout(this.loadT); this.beginDuel(); }
  }
  beginDuel() {
    this.status = 'playing'; this.votes.clear();
    const members = [...this.members.values()].map(m => ({ id: m.id, name: m.name, team: m.team, weapon: m.weapon, cfg: m.cfg }));
    this.duel = new Duel(this.mode, members, this.settings, { onEnd: r => this.ended(r) });
    this.push(); this.broadcast(this.duel.startMsg());
    const d = this.duel; this.timer = setInterval(() => { d.step(); this.broadcast(d.snap()); d.ev = []; if (d.state === 'ended') clearInterval(this.timer); }, this.m.o.tickMs);
  }
  sendState(m) { if (this.duel) { this.send(m, this.duel.startMsg()); this.send(m, Object.assign(this.duel.snap(), { ev: [] })); if (this.duel.state === 'ended') this.send(m, { t: 'end', result: this.duel.result, need: this.need() }); } }
  ended(r) {
    this.status = 'ended'; this.votes.clear(); this.push(); this.broadcast({ t: 'end', result: r, need: this.need() });
    this.m.supa.award(r.rows.filter(x => !String(x.id).startsWith('guest_')).map(x => ({ id: x.id, place: x.team === r.winner ? 1 : 2, kills: x.kills, deaths: x.deaths, dmg: x.dmg, won: x.team === r.winner, xp: 20 + x.kills * 10 + (x.team === r.winner ? 60 : 10), coins: Math.round((20 + x.kills * 10 + (x.team === r.winner ? 60 : 10)) / 4) })), r.mode).catch(() => { });
  }
  need() { return [...this.members.values()].filter(m => m.connected).length; }
  rematch(id) {
    if (this.status !== 'ended') return; this.votes.add(id); this.broadcast({ t: 'rematch', votes: this.votes.size, need: this.need() }); this.tryRematch();
  }
  tryRematch() { // revanche: mesmos participantes, sem sair da sala, com o mapa/rounds atuais
    if (this.status === 'ended' && this.need() > 0 && this.votes.size >= this.need() && [...this.members.values()].every(m => m.connected)) { clearInterval(this.timer); this.beginDuel(); }
  }
  toLobby(id) { if (this.status !== 'ended' || !this.members.has(id)) return; clearInterval(this.timer); this.status = 'lobby'; this.duel = null; this.votes.clear(); for (const m of this.members.values()) { m.ready = false; m.loaded = false; } this.push(); }
  // ---- saída e reconexão ----
  leave(id) {
    const m = this.members.get(id); if (!m) return; clearTimeout(m.grace);
    if (this.duel && this.status === 'playing') this.duel.leave(id);
    this.members.delete(id); this.votes.delete(id);
    if (this.members.size === 0 || (this.duel && this.status === 'playing' && ![...this.members.values()].some(x => x.connected))) return this.destroy();
    if (id === this.leader) { const n = [...this.members.values()].find(x => x.connected) || [...this.members.values()][0]; if (n) this.leader = n.id; }
    if (this.status === 'loading') { clearTimeout(this.loadT); this.status = 'lobby'; for (const x of this.members.values()) { x.ready = false; x.loaded = false; } }
    this.push(); this.tryRematch();
  }
  disconnect(id, conn) {
    const m = this.members.get(id); if (!m || m.conn !== conn) return; m.connected = false; m.conn = null; if (this.duel) { const p = this.duel.get(id); if (p) { p.conn = false; p.inp = this.duel.blank(); } }
    clearTimeout(m.grace); m.grace = setTimeout(() => { if (!m.connected) this.leave(id); }, this.m.o.graceMs); this.push();
  }
  rejoin(id, conn) {
    const m = this.members.get(id); if (!m) return false; clearTimeout(m.grace); m.conn = conn; m.connected = true; if (this.duel) { const p = this.duel.get(id); if (p) p.conn = true; }
    this.push(); if (this.status === 'playing' || this.status === 'ended') this.sendState(m); return true;
  }
  destroy() { clearInterval(this.timer); clearTimeout(this.loadT); for (const m of this.members.values()) clearTimeout(m.grace); this.m.rooms.delete(this.code); for (const id of this.members.keys()) if (this.m.byUser.get(id) === this) this.m.byUser.delete(id); }
}
module.exports = { DuelRoom };
