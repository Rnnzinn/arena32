// Mini mapas de X1 e 2X2 + armas ORIGINAIS + geometria. Mesmo arquivo no servidor e no cliente.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.A32Mini = f(); })(this, function () {
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // Mesmos números das armas do jogo original (index.html): dano, intervalo, dispersão, pente, recarga, projéteis.
  const WEAPONS = [
    { n: 'Pistola', d: 14, r: .35, s: .02, mg: 12, rl: .9 }, { n: 'SMG', d: 9, r: .1, s: .05, mg: 30, rl: 1.2 },
    { n: 'Fuzil', d: 19, r: .17, s: .025, mg: 25, rl: 1.5 }, { n: 'Escopeta', d: 11, r: .9, s: .07, p: 6, mg: 6, rl: 1.9 },
    { n: 'Sniper', d: 70, r: 1.4, s: .004, rg: 160, mg: 5, rl: 2.1 }];
  const DEFS = {
    1: { name: 'Arena Urbana', theme: 'urban', w: 72, d: 48, seed: 11 },
    2: { name: 'Área Industrial', theme: 'industrial', w: 76, d: 52, seed: 22 },
    3: { name: 'Floresta com Obstáculos', theme: 'forest', w: 80, d: 56, seed: 33 }
  };
  // Cada mapa é simétrico (ponto central): os dois lados têm exatamente os mesmos obstáculos = jogo justo.
  function gen(id) {
    const D = DEFS[id], r = rng(D.seed), hx = D.w / 2, hz = D.d / 2;
    const spawns = [[{ x: -hx + 7, z: -5 }, { x: -hx + 7, z: 5 }], [{ x: hx - 7, z: -5 }, { x: hx - 7, z: 5 }]];
    const half = [], sp = spawns.flat();
    const ok = (x, z, w, d) => sp.every(s => Math.abs(s.x - x) > w / 2 + 6 || Math.abs(s.z - z) > d / 2 + 6) && x < -(w / 2 + .8) && half.every(o => Math.abs(o.x - x) > (o.w + w) / 2 + .6 || Math.abs(o.z - z) > (o.d + d) / 2 + .6);
    const put = (t, w, d, h, n) => { for (let i = 0, k = 0; i < n && k < 400; k++) { const x = -r() * (hx - 3), z = (r() * 2 - 1) * (hz - 3); if (ok(x, z, w, d)) { half.push({ x: +x.toFixed(2), z: +z.toFixed(2), w, d, h, t }); i++; } } };
    if (D.theme === 'urban') { for (let i = 0; i < 5; i++) put('bld', 6 + Math.floor(r() * 4), 6 + Math.floor(r() * 4), 8 + Math.floor(r() * 6), 1); put('wall', 4, 1, 1.4, 6); put('crate', 1.6, 1.6, 1.6, 4); }
    else if (D.theme === 'industrial') { put('wh', 12, 8, 7, 2); put('ctn', 6, 2.4, 2.6, 8); put('ctn2', 6, 2.4, 5.2, 3); put('crate', 1.6, 1.6, 1.6, 3); }
    else { put('tree', 1.2, 1.2, 7, 22); put('rock', 2.6, 2.6, 1.6, 6); put('log', 5, 1, 1.1, 4); }
    const obs = []; half.forEach(o => { obs.push(Object.assign({}, o)); obs.push({ x: -o.x, z: -o.z, w: o.w, d: o.d, h: o.h, t: o.t }); });
    return { id, name: D.name, theme: D.theme, w: D.w, d: D.d, hx, hz, obs, spawns };
  }
  const MAPS = { 1: gen(1), 2: gen(2), 3: gen(3) };

  // ---- geometria ----
  function push(x, z, rad, obs, hx, hz) {
    for (const o of obs) {
      const cx = Math.max(o.x - o.w / 2, Math.min(x, o.x + o.w / 2)), cz = Math.max(o.z - o.d / 2, Math.min(z, o.z + o.d / 2)), dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d < rad) {
        if (d > 1e-6) { x = cx + dx / d * rad; z = cz + dz / d * rad; }
        else { const l = x - (o.x - o.w / 2), rr = o.x + o.w / 2 - x, t = z - (o.z - o.d / 2), b = o.z + o.d / 2 - z, m = Math.min(l, rr, t, b); if (m === l) x = o.x - o.w / 2 - rad; else if (m === rr) x = o.x + o.w / 2 + rad; else if (m === t) z = o.z - o.d / 2 - rad; else z = o.z + o.d / 2 + rad; }
      }
    }
    return [Math.max(-hx + rad, Math.min(hx - rad, x)), Math.max(-hz + rad, Math.min(hz - rad, z))];
  }
  function pushObb(x, z, rad, w) { // parede de gelo (retângulo girado)
    const c = Math.cos(w.a), s = Math.sin(w.a), X = x - w.x, Z = z - w.z; let lx = X * c - Z * s, lz = X * s + Z * c;
    const ax = w.hw + rad - Math.abs(lx), az = w.ht + rad - Math.abs(lz);
    if (ax > 0 && az > 0) { if (az < ax) lz = Math.sign(lz || 1) * (w.ht + rad); else lx = Math.sign(lx || 1) * (w.hw + rad); return [w.x + lx * c + lz * s, w.z - lx * s + lz * c]; }
    return [x, z];
  }
  function rayBox(ox, oy, oz, dx, dy, dz, max, b) { // caixa b: {x,z,w,d,h}, altura 0..h
    let t0 = 0, t1 = max;
    for (const [p, v, lo, hi] of [[ox, dx, b.x - b.w / 2, b.x + b.w / 2], [oy, dy, 0, b.h], [oz, dz, b.z - b.d / 2, b.z + b.d / 2]]) {
      if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return Infinity; }
      else { let a = (lo - p) / v, c = (hi - p) / v; if (a > c) { const q = a; a = c; c = q; } t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return Infinity; }
    }
    return t0;
  }
  function rayObs(ox, oy, oz, dx, dy, dz, max, obs) { let b = Infinity; for (const o of obs) { const t = rayBox(ox, oy, oz, dx, dy, dz, max, o); if (t < b) b = t; } return b; }
  function rayObb(ox, oy, oz, dx, dy, dz, max, w) {
    const c = Math.cos(w.a), s = Math.sin(w.a), X = ox - w.x, Z = oz - w.z;
    return rayBox(X * c - Z * s, oy, X * s + Z * c, dx * c - dz * s, dy, dx * s + dz * c, max, { x: 0, z: 0, w: w.hw * 2, d: w.ht * 2, h: w.hh * 2 });
  }
  function rayCyl(ox, oy, oz, dx, dy, dz, cx, cz, r, y0, y1, max) {
    const a = dx * dx + dz * dz; if (a < 1e-9) return Infinity;
    const rx = ox - cx, rz = oz - cz, b = 2 * (rx * dx + rz * dz), c = rx * rx + rz * rz - r * r, disc = b * b - 4 * a * c; if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc); let t = (-b - sq) / (2 * a); if (t < 0) t = (-b + sq) / (2 * a); if (t < 0 || t > max) return Infinity;
    const y = oy + dy * t; return y >= y0 && y <= y1 ? t : Infinity;
  }
  function raySph(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, max) {
    const px = cx - ox, py = cy - oy, pz = cz - oz, t = px * dx + py * dy + pz * dz; if (t < 0 || t > max) return Infinity;
    const d2 = px * px + py * py + pz * pz - t * t; if (d2 > r * r) return Infinity; return t - Math.sqrt(r * r - d2);
  }
  return { rng, WEAPONS, DEFS, MAPS, push, pushObb, rayBox, rayObs, rayObb, rayCyl, raySph };
});
