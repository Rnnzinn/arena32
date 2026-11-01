'use strict';
const crypto = require('crypto');
const b64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
let jwksCache = { at: 0, keys: [] };

async function jwks(url) {
  if (Date.now() - jwksCache.at < 600000 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(url); if (!r.ok) throw new Error('jwks_http_' + r.status);
  jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}

// Retorna { id, name, email } ou lança erro. Nunca confia no cliente.
async function verify(token, cfg) {
  if (typeof token !== 'string' || token.length > 4000) throw new Error('bad_token');
  if (token.startsWith('guest:')) { // só para testes locais (ALLOW_GUEST=1)
    if (!cfg.allowGuest) throw new Error('guest_disabled');
    const name = token.slice(6).replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'convidado';
    return { id: 'guest_' + name, name, email: null };
  }
  const parts = token.split('.'); if (parts.length !== 3) throw new Error('bad_token');
  const head = JSON.parse(b64u(parts[0]).toString()), body = JSON.parse(b64u(parts[1]).toString());
  const data = Buffer.from(parts[0] + '.' + parts[1]), sig = b64u(parts[2]);
  let ok = false;
  if (head.alg === 'HS256' && cfg.jwtSecret) {
    const mac = crypto.createHmac('sha256', cfg.jwtSecret).update(data).digest();
    ok = mac.length === sig.length && crypto.timingSafeEqual(mac, sig);
  } else if ((head.alg === 'ES256' || head.alg === 'RS256') && cfg.jwksUrl) {
    const k = (await jwks(cfg.jwksUrl)).find(x => x.kid === head.kid);
    if (k) {
      const key = crypto.createPublicKey({ key: k, format: 'jwk' });
      ok = head.alg === 'ES256' ? crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig) : crypto.verify('sha256', data, key, sig);
    }
  }
  if (!ok) throw new Error('bad_signature');
  if (!body.sub || (body.exp && body.exp * 1000 < Date.now())) throw new Error('expired');
  const md = body.user_metadata || {};
  return { id: String(body.sub), name: String(md.nickname || md.name || (body.email || 'jogador').split('@')[0]).replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'jogador', email: body.email || null };
}
module.exports = { verify };
