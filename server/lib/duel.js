'use strict';
// Motor AUTORITATIVO de X1 e 2X2 com as mecânicas do jogo original: 5 armas (mesmos números), pular, agachar,
// correr, mirar, tiro na cabeça (x2), colete/capacete, granadas, paredes de gelo, rounds, contagem e estatísticas.
// O cliente só manda intenções; vida, munição, posição, dano e resultado são decididos aqui.
const M = require('../../shared/minimaps');
const WP = M.WEAPONS;
const DT = .05, SPEED = 8, GRAV = 22, PREP = 5, END_WAIT = 3, ROUND_TIME = 90, TEAM_SIZE = { x1: 1, '2x2': 2 };
const nz = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const cl = (v, a, b) => Math.max(a, Math.min(b, v));

class Duel {
  constructor(mode, members, settings, hooks) {
    this.mode = mode; this.hooks = hooks || {}; this.map = M.MAPS[settings.map]; this.rounds = settings.rounds; this.need = Math.floor(settings.rounds / 2) + 1;
    this.rand = M.rng((Date.now() ^ (settings.seed || 0)) >>> 0); this.tick = 0; this.ev = []; this.result = null; this.state = 'prep'; this.t = PREP;
    this.rs = [0, 0]; this.round = 0; this.done = 0; this.pending = null; this.walls = []; this.gr = []; this.nid = 1; this.hist = [];
    this.players = members.map(m => ({
      id: m.id, name: m.name, team: m.team, w: m.weapon, cfg: m.cfg || null, left: false, conn: true,
      st: { shots: 0, hits: 0, hs: 0, dmg: 0, kills: 0, deaths: 0, rw: 0 }, inp: this.blank(), seen: { j: 0, r: 0, g: 0, i: 0 }
    }));
    this.newRound();
  }
  blank() { return { mx: 0, mz: 0, yaw: 0, pitch: 0, fire: 0, cr: 0, ad: 0, run: 0 }; }
  newRound() {
    this.round++; this.walls = []; this.gr = []; const idx = [0, 0];
    for (const p of this.players) {
      const w = WP[p.w], sp = this.map.spawns[p.team][idx[p.team]++ % this.map.spawns[p.team].length];
      Object.assign(p, { x: sp.x, z: sp.z, y: 0, vy: 0, yaw: p.team === 0 ? -Math.PI / 2 : Math.PI / 2, pitch: 0, hp: 100, alive: !p.left, mag: w.mg, am: w.mg * 3, rt: 0, cool: 0, grn: 2, ice: 2, wcd: 0, vs: 80, hm: 30, cr: 0, ad: 0, run: 0, inp: this.blank() });
      p.inp.yaw = p.yaw;
    }
    this.state = 'prep'; this.t = PREP; this.ev.push({ k: 'ph', st: 'prep', rd: this.round });
  }
  get(id) { return this.players.find(p => p.id === id); }
  input(id, m) {
    const p = this.get(id); if (!p || p.left) return;
    p.inp = { mx: cl(nz(m.mx), -1, 1), mz: cl(nz(m.mz), -1, 1), yaw: nz(m.yaw), pitch: cl(nz(m.pitch), -1.45, 1.45), fire: m.fire ? 1 : 0, cr: m.cr ? 1 : 0, ad: m.ad ? 1 : 0, run: m.run ? 1 : 0 };
    const c = k => Math.max(0, Math.floor(nz(m[k]))); const seen = p.seen;
    // ações pontuais chegam como contadores (não se perdem nem repetem se uma mensagem atrasar)
    if (this.state === 'fight' && p.alive) {
      if (c('jc') > seen.j) this.jump(p); if (c('rc') > seen.r) this.reload(p); if (c('gc') > seen.g && c('gc') - seen.g < 4) this.grenade(p); if (c('ic') > seen.i) this.ice(p);
    }
    seen.j = Math.max(seen.j, c('jc')); seen.r = Math.max(seen.r, c('rc')); seen.g = Math.max(seen.g, c('gc')); seen.i = Math.max(seen.i, c('ic'));
  }
  forward(p) { const cp = Math.cos(p.pitch); return [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp]; }
  jump(p) { if (p.y === 0) { p.vy = 7.5; p.cr = 0; } }
  reload(p) { const w = WP[p.w]; if (p.rt > 0 || p.mag >= w.mg || p.am <= 0) return; p.rt = w.rl; this.ev.push({ k: 'rl', i: p.id }); }
  grenade(p) {
    if (p.grn < 1) return; p.grn--; const f = this.forward(p);
    this.gr.push({ id: this.nid++, x: p.x, y: p.y + 1.7, z: p.z, vx: f[0] * 15, vy: f[1] * 15 + 4.5, vz: f[2] * 15, t: 2.3, o: p.id });
  }
  ice(p) {
    if (p.ice < 1 || p.wcd > 0 || this.walls.length >= 12) return; p.ice--; p.wcd = 1;
    const w = { id: this.nid++, x: p.x - Math.sin(p.yaw) * 3.5, z: p.z - Math.cos(p.yaw) * 3.5, a: p.yaw, hw: 2.5, ht: .3, hh: 1.5, hp: 150 };
    this.walls.push(w); this.ev.push({ k: 'w+', id: w.id, x: w.x, z: w.z, a: w.a });
  }
  hurtWall(w, d) { w.hp -= d; if (w.hp <= 0) { this.walls = this.walls.filter(x => x !== w); this.ev.push({ k: 'w-', id: w.id }); } }
  // aplica dano com colete/capacete (60% absorvido até acabar), igual ao jogo original
  damage(e, by, dmg, hd) {
    if (!e.alive) return 0;
    if (dmg >= 1) { const a = hd ? 'hm' : 'vs'; if (e[a] > 0) { const ab = Math.min(e[a], dmg * .6); e[a] -= ab; dmg -= ab; } }
    if (by && by !== e) by.st.dmg += Math.min(dmg, e.hp); // estatística = dano EFETIVO (não conta o excesso de um abate)
    e.hp -= dmg;
    this.ev.push({ k: 'h', i: e.id, by: by ? by.id : null, d: Math.round(dmg), hd: !!hd });
    if (e.hp <= 0) { e.hp = 0; e.alive = false; e.st.deaths++; if (by && by !== e) by.st.kills++; this.ev.push({ k: 'k', i: e.id, by: by ? by.id : null, hd: !!hd }); }
    return dmg;
  }
  shoot(p) {
    const w = WP[p.w], f = this.forward(p), cx = Math.cos(p.yaw), cz = -Math.sin(p.yaw), cs = p.cr ? 1.2 : 1.6;
    // origem igual à do jogo original: câmera atrás do ombro + 5,5 na direção da mira
    const ox = p.x + cx * .7 + f[0] * .5, oy = p.y + cs + f[1] * .5, oz = p.z + cz * .7 + f[2] * .5, spread = w.s * (p.ad ? .4 : 1) * (p.cr ? .7 : 1), n = w.p || 1, max = w.rg || 90;
    p.mag--; p.st.shots++; let landed = false;
    for (let q = 0; q < n; q++) {
      let dx = f[0] + (this.rand() * 2 - 1) * spread, dy = f[1] + (this.rand() * 2 - 1) * spread, dz = f[2] + (this.rand() * 2 - 1) * spread; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      let best = Math.min(max, M.rayObs(ox, oy, oz, dx, dy, dz, max, this.map.obs)), tw = null, te = null, hd = false;
      for (const wl of this.walls) { const t = M.rayObb(ox, oy, oz, dx, dy, dz, best, wl); if (t < best) { best = t; tw = wl; te = null; } }
      for (const e of this.players) {
        if (!e.alive || e === p || e.team === p.team) continue; const s = e.cr ? .78 : 1;
        const th = M.raySph(ox, oy, oz, dx, dy, dz, e.x, e.y + 1.95 * s, e.z, .38, best), tb = M.rayCyl(ox, oy, oz, dx, dy, dz, e.x, e.z, .5, e.y + .2, e.y + 1.7 * s, best);
        const t = Math.min(th, tb); if (t < best) { best = t; te = e; hd = th <= tb; tw = null; }
      }
      this.ev.push({ k: 's', i: p.id, ox: +ox.toFixed(2), oy: +oy.toFixed(2), oz: +oz.toFixed(2), dx: +dx.toFixed(3), dy: +dy.toFixed(3), dz: +dz.toFixed(3), l: +best.toFixed(1) });
      if (te) { landed = true; if (hd) p.st.hs++; this.damage(te, p, w.d * (hd ? 2 : 1), hd); }
      else if (tw) this.hurtWall(tw, w.d);
    }
    if (landed) p.st.hits++;
    if (p.mag <= 0) this.reload(p);
  }
  alive(t) { return this.players.filter(p => p.team === t && p.alive).length; }

  step() {
    if (this.state === 'ended') return; this.tick++;
    if (this.state === 'prep') { this.t -= DT; if (this.t <= 0) { this.state = 'fight'; this.t = ROUND_TIME; this.ev.push({ k: 'ph', st: 'fight', rd: this.round }); } return; }
    if (this.state === 'round_end') { this.t -= DT; if (this.t <= 0) { if (this.pending !== null) this.finish(this.pending); else this.newRound(); } return; }
    this.t -= DT;
    for (const p of this.players) if (p.alive) this.move(p);
    this.grenades();
    for (const p of this.players) if (p.alive) this.combat(p);
    const a0 = this.alive(0), a1 = this.alive(1);
    if (!a0 || !a1) this.roundEnd(a0 ? 0 : a1 ? 1 : -1, 'elim');
    else if (this.t <= 0) { const h = t => this.players.filter(p => p.team === t).reduce((s, p) => s + p.hp, 0), h0 = h(0), h1 = h(1); this.roundEnd(h0 > h1 ? 0 : h1 > h0 ? 1 : -1, 'tempo'); }
  }
  move(p) {
    const i = p.inp; let mx = i.mx, mz = i.mz; const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
    p.cr = i.cr && p.y === 0 ? 1 : 0; p.ad = i.ad; p.run = i.run && !p.cr && !p.ad ? 1 : 0; p.yaw = i.yaw; p.pitch = i.pitch;
    const sp = SPEED * (p.cr ? .5 : 1) * (p.ad ? .7 : 1) * (p.run ? 1.5 : 1);
    let q = M.push(p.x + mx * sp * DT, p.z + mz * sp * DT, .5, this.map.obs, this.map.hx, this.map.hz);
    for (const w of this.walls) q = M.pushObb(q[0], q[1], .5, w);
    p.x = q[0]; p.z = q[1];
    if (p.y > 0 || p.vy > 0) { p.vy -= GRAV * DT; p.y = Math.max(0, p.y + p.vy * DT); if (p.y === 0) p.vy = 0; }
    p.wcd -= DT;
  }
  combat(p) {
    const w = WP[p.w]; p.cool -= DT;
    if (p.rt > 0) { p.rt -= DT; if (p.rt <= 0) { p.rt = 0; const t = Math.min(w.mg - p.mag, p.am); p.mag += t; p.am -= t; } }
    else if (p.mag <= 0 && p.am > 0) this.reload(p);
    let n = 0; while (p.inp.fire && p.cool <= 0 && p.mag > 0 && p.rt <= 0 && n < 3) { this.shoot(p); p.cool += w.r; n++; }
    if (!p.inp.fire && p.cool < 0) p.cool = 0; if (p.cool < -w.r) p.cool = -w.r;
  }
  grenades() {
    for (const g of [...this.gr]) {
      g.t -= DT; g.vy -= 14 * DT; const ox = g.x, oz = g.z; g.x += g.vx * DT; g.y += g.vy * DT; g.z += g.vz * DT;
      if (g.y < .3) { g.y = .3; g.vy *= -.4; g.vx *= .6; g.vz *= .6; }
      for (const o of this.map.obs) if (g.y < o.h && Math.abs(g.x - o.x) < o.w / 2 && Math.abs(g.z - o.z) < o.d / 2) { g.x = ox; g.z = oz; g.vx *= -.4; g.vz *= -.4; break; }
      g.x = cl(g.x, -this.map.hx, this.map.hx); g.z = cl(g.z, -this.map.hz, this.map.hz);
      for (const w of this.walls) { const c = Math.cos(w.a), s = Math.sin(w.a), X = g.x - w.x, Z = g.z - w.z; if (Math.abs(X * c - Z * s) < w.hw && Math.abs(X * s + Z * c) < w.ht + .15 && g.y < w.hh * 2) { g.x = ox; g.z = oz; g.vx *= -.4; g.vz *= -.4; break; } }
      if (g.t <= 0) { this.gr = this.gr.filter(x => x !== g); this.explode(g); }
    }
  }
  explode(g) {
    this.ev.push({ k: 'x', x: +g.x.toFixed(2), y: +g.y.toFixed(2), z: +g.z.toFixed(2) }); const owner = this.get(g.o);
    for (const e of this.players) {
      if (!e.alive) continue; const dx = e.x - g.x, dy = e.y + 1 - g.y, dz = e.z - g.z, d = Math.hypot(dx, dy, dz) || .01; if (d >= 7) continue;
      if (owner && e !== owner && e.team === owner.team) continue; // sem fogo amigo
      let b = M.rayObs(g.x, g.y, g.z, dx / d, dy / d, dz / d, d, this.map.obs); for (const w of this.walls) b = Math.min(b, M.rayObb(g.x, g.y, g.z, dx / d, dy / d, dz / d, d, w));
      if (b < d - .3) continue; this.damage(e, owner || null, Math.max(10, Math.round(100 * (1 - d / 7))), false);
    }
    for (const w of [...this.walls]) { const d = Math.hypot(w.x - g.x, w.z - g.z); if (d < 9) this.hurtWall(w, Math.round(220 * (1 - d / 9))); }
  }
  roundEnd(w, why) {
    if (w >= 0) { this.rs[w]++; for (const p of this.players) if (p.team === w) p.st.rw++; } this.done++; this.hist.push({ round: this.round, w, why });
    this.ev.push({ k: 'r', w, rs: this.rs.slice(), rd: this.round, why });
    let win = null; if (this.rs[0] >= this.need) win = 0; else if (this.rs[1] >= this.need) win = 1; else if (this.done >= this.rounds && this.rs[0] !== this.rs[1]) win = this.rs[0] > this.rs[1] ? 0 : 1;
    this.pending = win; this.state = 'round_end'; this.t = END_WAIT;
  }
  leave(id) {
    const p = this.get(id); if (!p || p.left) return; p.left = true; if (p.alive) { p.alive = false; p.hp = 0; p.st.deaths++; }
    if (this.state === 'ended') return; const rest = t => this.players.some(x => x.team === t && !x.left);
    if (!rest(0) || !rest(1)) this.finish(rest(0) ? 0 : rest(1) ? 1 : null, true);
  }
  finish(win, forfeit) {
    if (this.state === 'ended') return; this.state = 'ended';
    const rows = this.players.map(p => ({ id: p.id, name: p.name, team: p.team, w: p.w, kills: p.st.kills, deaths: p.st.deaths, dmg: Math.round(p.st.dmg), shots: p.st.shots, hits: p.st.hits, hs: p.st.hs, acc: p.st.shots ? Math.round(p.st.hits / p.st.shots * 100) : 0, rw: p.st.rw, left: p.left }));
    const pool = rows.filter(r => win === null || r.team === win).sort((a, b) => b.kills - a.kills || b.dmg - a.dmg || b.hs - a.hs);
    const mvp = pool.length ? pool[0].id : null; // MVP = melhor jogador da equipe vencedora (abates, depois dano, depois tiros na cabeça)
    this.result = { mode: this.mode, map: this.map.id, rounds: this.rounds, winner: win, rs: this.rs.slice(), forfeit: !!forfeit, hist: this.hist, rows, mvp };
    this.ev.push({ k: 'e' }); if (this.hooks.onEnd) this.hooks.onEnd(this.result);
  }
  startMsg() { return { t: 'dstart', mode: this.mode, map: this.map.id, rounds: this.rounds, need: this.need, players: this.players.map(p => ({ id: p.id, name: p.name, team: p.team, w: p.w, cfg: p.cfg })) }; }
  snap() {
    return {
      t: 'dsnap', n: this.tick, st: this.state, rd: this.round, rs: this.rs, tm: +this.t.toFixed(2),
      p: this.players.map(p => [+p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), Math.round(p.hp), p.alive ? 1 : 0, (p.cr ? 1 : 0) | (p.ad ? 2 : 0) | (p.run ? 4 : 0) | (p.rt > 0 ? 8 : 0) | (p.conn ? 0 : 16), p.mag, p.am, p.grn, p.ice, Math.round(p.vs), Math.round(p.hm), p.st.kills, p.st.deaths]),
      wl: this.walls.map(w => [w.id, +w.x.toFixed(2), +w.z.toFixed(2), +w.a.toFixed(2), Math.round(w.hp)]), gn: this.gr.map(g => [g.id, +g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2)]), ev: this.ev
    };
  }
}
module.exports = { Duel, TEAM_SIZE, PREP };
