// Mundo compartilhado entre servidor e cliente (mesmo código, mesma semente = mesmo mapa).
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.A32World = f(); })(this, function () {
  function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const MODES = { br: { size: 300, humans: 4, total: 32 }, x1: { size: 70, humans: 2, total: 2 }, '2x2': { size: 90, humans: 4, total: 4 } };
  function spawns(mode) {
    const h = MODES[mode].size / 2;
    if (mode === 'x1') return [[{ x: -h + 8, z: 0 }], [{ x: h - 8, z: 0 }]];
    if (mode === '2x2') return [[{ x: -h + 8, z: -5 }, { x: -h + 8, z: 5 }], [{ x: h - 8, z: -5 }, { x: h - 8, z: 5 }]];
    return null;
  }
  function gen(mode, seed) {
    const M = MODES[mode], r = rng(seed), h = M.size / 2, n = mode === 'br' ? 80 : 18, sp = spawns(mode), obs = [];
    for (let i = 0; i < n; i++) {
      const w = 2 + r() * 7, d = 2 + r() * 7, x = (r() * 2 - 1) * (h - 6), z = (r() * 2 - 1) * (h - 6);
      if (sp && sp.some(t => t.some(s => Math.abs(s.x - x) < w / 2 + 7 && Math.abs(s.z - z) < d / 2 + 7))) continue;
      obs.push({ x: +x.toFixed(2), z: +z.toFixed(2), w: +w.toFixed(2), d: +d.toFixed(2) });
    }
    return { size: M.size, obs };
  }
  // empurra um círculo (x,z,raio) para fora dos retângulos e para dentro da arena
  function push(x, z, rad, obs, half) {
    for (const o of obs) {
      const cx = Math.max(o.x - o.w / 2, Math.min(x, o.x + o.w / 2)), cz = Math.max(o.z - o.d / 2, Math.min(z, o.z + o.d / 2));
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d < rad) {
        if (d > 1e-6) { x = cx + dx / d * rad; z = cz + dz / d * rad; }
        else { const l = x - (o.x - o.w / 2), rr = o.x + o.w / 2 - x, t = z - (o.z - o.d / 2), b = o.z + o.d / 2 - z, m = Math.min(l, rr, t, b); if (m === l) x = o.x - o.w / 2 - rad; else if (m === rr) x = o.x + o.w / 2 + rad; else if (m === t) z = o.z - o.d / 2 - rad; else z = o.z + o.d / 2 + rad; }
      }
    }
    const lim = half - rad; return [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z))];
  }
  // distância até o primeiro retângulo atingido pelo raio (Infinity se nenhum)
  function ray(ox, oz, dx, dz, max, obs) {
    let best = Infinity;
    for (const o of obs) {
      let t0 = 0, t1 = max, ok = true;
      for (const [p, v, lo, hi] of [[ox, dx, o.x - o.w / 2, o.x + o.w / 2], [oz, dz, o.z - o.d / 2, o.z + o.d / 2]]) {
        if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } }
        else { let a = (lo - p) / v, b = (hi - p) / v; if (a > b) { const q = a; a = b; b = q; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) { ok = false; break; } }
      }
      if (ok && t0 <= t1 && t0 < best) best = t0;
    }
    return best;
  }
  return { rng, MODES, spawns, gen, push, ray };
});
