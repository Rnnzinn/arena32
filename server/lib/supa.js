'use strict';
// Integração opcional com o Supabase usando a service_role KEY (fica só no servidor, nunca no navegador).
// Sem SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY o servidor roda em "modo local" (sem banco).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = function (cfg) {
  const on = !!(cfg.url && cfg.serviceKey);
  const H = { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, 'Content-Type': 'application/json' };
  const get = async path => { const r = await fetch(cfg.url + '/rest/v1/' + path, { headers: H }); if (!r.ok) throw new Error('supabase_' + r.status); return r.json(); };
  return {
    enabled: on,
    async profile(uid) { // apelido e código oficiais, do banco
      if (!on || !UUID.test(uid)) return null;
      const r = await get('profiles?id=eq.' + uid + '&select=nickname,player_code,avatar,level');
      return r[0] || null;
    },
    async areFriends(a, b) {
      if (!on) return true; // modo local: sem banco, permite (apenas para testes)
      if (!UUID.test(a) || !UUID.test(b)) return false;
      const r = await get('friendships?status=eq.accepted&or=(and(requester.eq.' + a + ',addressee.eq.' + b + '),and(requester.eq.' + b + ',addressee.eq.' + a + '))&select=id&limit=1');
      return r.length > 0;
    },
    async award(rows, mode) { // resultado oficial da partida -> XP, moedas e histórico
      if (!on || !rows.length) return false;
      const r = await fetch(cfg.url + '/rest/v1/rpc/award_match', { method: 'POST', headers: H, body: JSON.stringify({ p_rows: rows, p_mode: mode || 'br' }) });
      return r.ok;
    }
  };
};
