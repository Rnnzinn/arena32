'use strict';
// Simulação AUTORITATIVA: o servidor move os jogadores, valida tiros, aplica dano e decide vencedores.
// O cliente só envia intenções (direção, mira, atirar). Nada de vida/posição vem do cliente.
const W = require('../../shared/world');
const TICK = 20, DT = 1 / TICK, SPEED = 8, RAD = .6, DMG = 18, RATE = .17, RANGE = 80, SPREAD = .025, ROUND_WIN = 2;

class Game {
  constructor(mode, humans, seed, hooks) {
    this.mode = mode; this.seed = seed; this.hooks = hooks || {}; this.world = W.gen(mode, seed);
    this.rand = W.rng(seed ^ 0x9e3779b9); this.tick = 0; this.t = 0; this.state = 'running';
    this.round = 1; this.rounds = [0, 0]; this.pause = 0; this.ev = []; this.result = null;
    this.players = humans.map((h, i) => this.mk(h.id, h.name, mode === 'br' ? i : h.team, false));
    if (mode === 'br') for (let i = humans.length; i < W.MODES.br.total; i++) this.players.push(this.mk('bot' + i, 'Bot' + (i + 1), i, true));
    this.zone = { x: 0, z: 0, r: this.world.size * .72, phase: 0, t: 15, shr: false, from: 0, to: 0 };
    this.spawn();
  }
  mk(id, name, team, bot) { return { id, name, team, bot, x: 0, z: 0, yaw: 0, hp: 100, alive: true, kills: 0, deaths: 0, dmg: 0, cool: 0, place: 0, left: false, inp: { mx: 0, mz: 0, fire: 0, yaw: 0 }, ai: null }; }
  get(id) { return this.players.find(p => p.id === id); }

  spawn() {
    const h = this.world.size / 2, sp = W.spawns(this.mode), idx = [0, 0];
    for (const p of this.players) {
      p.hp = 100; p.alive = !p.left; p.cool = 0; p.inp = { mx: 0, mz: 0, fire: 0, yaw: 0 };
      if (sp) { const s = sp[p.team][idx[p.team]++ % sp[p.team].length]; p.x = s.x; p.z = s.z; p.yaw = p.team === 0 ? -Math.PI / 2 : Math.PI / 2; p.inp.yaw = p.yaw; }
      else {
        for (let k = 0; k < 40; k++) {
          const x = (this.rand() * 2 - 1) * (h - 5), z = (this.rand() * 2 - 1) * (h - 5), q = W.push(x, z, RAD + .2, this.world.obs, h);
          p.x = q[0]; p.z = q[1];
          if (Math.hypot(q[0] - x, q[1] - z) < .01 && !this.players.some(o => o !== p && o.x !== 0 && Math.hypot(o.x - p.x, o.z - p.z) < 10)) break;
        }
      }
    }
  }
  // Entrada vinda do cliente: sempre validada
  input(id, m) {
    const p = this.get(id); if (!p || p.bot || !p.alive) return;
    const n = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
    p.inp = { mx: Math.max(-1, Math.min(1, n(m.mx))), mz: Math.max(-1, Math.min(1, n(m.mz))), yaw: n(m.yaw), fire: m.fire ? 1 : 0 };
  }
  leave(id) { const p = this.get(id); if (!p || p.left) return; p.left = true; if (p.alive && this.state === 'running') this.die(p, null); }

  step() {
    if (this.state !== 'running') return;
    this.tick++; this.t += DT;
    if (this.pause > 0) { this.pause -= DT; if (this.pause <= 0) { this.round++; this.spawn(); this.ev.push({ k: 'n', r: this.round }); } return; }
    for (const p of this.players) if (p.alive) { if (p.bot) this.ai(p); this.move(p); this.fire(p); }
    if (this.mode === 'br') this.zoneStep();
    this.check();
  }
  move(p) {
    let mx = p.inp.mx, mz = p.inp.mz; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    p.yaw = p.inp.yaw; // velocidade máxima fixa no servidor: cliente não consegue "teleportar"
    const q = W.push(p.x + mx * SPEED * DT, p.z + mz * SPEED * DT, RAD, this.world.obs, this.world.size / 2); p.x = q[0]; p.z = q[1];
  }
  fire(p) {
    p.cool -= DT; if (!p.inp.fire || p.cool > 0) return;
    p.cool = p.bot ? RATE * 2.4 : RATE;
    const a = p.yaw + (this.rand() - .5) * 2 * SPREAD * (p.bot ? 3 : 1), dx = -Math.sin(a), dz = -Math.cos(a);
    let best = Math.min(RANGE, W.ray(p.x, p.z, dx, dz, RANGE, this.world.obs)), hit = null;
    for (const e of this.players) {
      if (!e.alive || e === p || e.team === p.team) continue;
      const rx = e.x - p.x, rz = e.z - p.z, t = rx * dx + rz * dz; if (t < 0 || t > best) continue;
      if (rx * rx + rz * rz - t * t < RAD * RAD) { best = t; hit = e; }
    }
    this.ev.push({ k: 's', i: p.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2), a: +a.toFixed(3), l: +best.toFixed(1) });
    if (hit) { p.dmg += DMG; hit.hp -= DMG; this.ev.push({ k: 'h', i: hit.id, by: p.id, d: DMG }); if (hit.hp <= 0) this.die(hit, p); }
  }
  die(e, by) {
    e.alive = false; e.hp = 0; e.deaths++; if (by && by !== e) by.kills++;
    e.place = this.players.filter(p => p.alive).length + 1;
    this.ev.push({ k: 'd', i: e.id, by: by ? by.id : null });
  }
  zoneStep() {
    const z = this.zone, S = this.world.size, targets = [S * .45, S * .28, S * .15, S * .07, 6];
    z.t -= DT;
    if (z.t <= 0) {
      if (z.shr) { z.shr = false; z.phase++; z.t = 15; }
      else if (z.phase < targets.length) { z.shr = true; z.from = z.r; z.to = targets[z.phase]; z.t = 12; }
      else z.t = 999;
    }
    if (z.shr) z.r = z.to + (z.from - z.to) * Math.max(0, z.t / 12);
    for (const p of this.players) if (p.alive && Math.hypot(p.x - z.x, p.z - z.z) > z.r) { p.hp -= (1 + z.phase) * 2 * DT; if (p.hp <= 0) this.die(p, null); }
  }
  ai(p) {
    const a = p.ai || (p.ai = { wx: p.x, wz: p.z, t: 0 }), z = this.zone; a.t -= DT;
    let e = null, bd = 45;
    for (const q of this.players) if (q.alive && q.team !== p.team) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd && d > .01 && W.ray(p.x, p.z, (q.x - p.x) / d, (q.z - p.z) / d, d, this.world.obs) > d) { bd = d; e = q; }
    }
    if (e) { const dx = e.x - p.x, dz = e.z - p.z, s = Math.sin(this.t * 1.7 + p.x); p.inp.yaw = Math.atan2(-dx, -dz) + (this.rand() - .5) * .2; p.inp.fire = 1; p.inp.mx = -dz / bd * s * .6; p.inp.mz = dx / bd * s * .6; return; }
    p.inp.fire = 0;
    if (Math.hypot(p.x - z.x, p.z - z.z) > z.r * .85) { a.wx = z.x; a.wz = z.z; a.t = 2; }
    else if (a.t <= 0 || Math.hypot(a.wx - p.x, a.wz - p.z) < 2) { const g = this.rand() * 6.283, r = this.rand() * z.r * .8; a.wx = z.x + Math.cos(g) * r; a.wz = z.z + Math.sin(g) * r; a.t = 4 + this.rand() * 4; }
    const dx = a.wx - p.x, dz = a.wz - p.z, d = Math.hypot(dx, dz) || 1; p.inp.mx = dx / d * .8; p.inp.mz = dz / d * .8; p.inp.yaw = Math.atan2(-dx, -dz);
  }
  check() {
    if (this.mode === 'br') {
      const al = this.players.filter(p => p.alive), hu = al.filter(p => !p.bot);
      if (al.length <= 1 || hu.length === 0) { if (al.length === 1) al[0].place = 1; this.end(al.length === 1 ? al[0].team : null); }
      return;
    }
    const act = [0, 1].map(t => this.players.some(p => p.team === t && !p.left));
    if (!act[0] || !act[1]) { this.end(act[0] ? 0 : act[1] ? 1 : null); return; } // desistência = derrota
    const a = [0, 1].map(t => this.players.some(p => p.team === t && p.alive));
    if (a[0] && a[1]) return;
    const w = a[0] ? 0 : a[1] ? 1 : -1; if (w >= 0) this.rounds[w]++;
    this.ev.push({ k: 'r', w, rs: this.rounds.slice() });
    if (w >= 0 && this.rounds[w] >= ROUND_WIN) this.end(w); else this.pause = 3;
  }
  end(win) {
    if (this.state === 'ended') return; this.state = 'ended';
    const rows = this.players.filter(p => !p.bot).map(p => {
      const won = this.mode === 'br' ? p.place === 1 : p.team === win;
      const xp = this.mode === 'br' ? 20 + p.kills * 15 + Math.max(0, 33 - (p.place || 32)) * 2 + (won ? 100 : 0) : 20 + p.kills * 10 + (won ? 60 : 10);
      return { id: p.id, name: p.name, team: p.team, kills: p.kills, deaths: p.deaths, dmg: p.dmg, place: p.place || (won ? 1 : 0), won, xp, coins: Math.round(xp / 4) };
    });
    this.result = { mode: this.mode, winner: win, rounds: this.rounds.slice(), rows, seed: this.seed };
    this.ev.push({ k: 'e' });
    if (this.hooks.onEnd) this.hooks.onEnd(this.result);
  }
  startMsg() { return { t: 'start', mode: this.mode, seed: this.seed, world: this.world, roundWin: ROUND_WIN, players: this.players.map(p => ({ id: p.id, name: p.name, team: p.team, bot: p.bot })) }; }
  snap() {
    const z = this.zone;
    return { t: 'snap', n: this.tick, st: this.state, rd: this.round, rs: this.rounds, ps: this.pause > 0 ? 1 : 0, z: this.mode === 'br' ? [+z.x.toFixed(1), +z.z.toFixed(1), +z.r.toFixed(1)] : null,
      p: this.players.map(p => [+p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), Math.max(0, Math.round(p.hp)), p.alive ? 1 : 0, p.kills, p.deaths]), ev: this.ev };
  }
}
module.exports = { Game, TICK };
