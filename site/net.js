/* Cliente de rede do ARENA 32 online (sem dependências). Usado por online.html e testado contra o servidor real. */
(function (root) {
  function Net(url) { this.url = url; this.h = {}; this.ws = null; this.ready = false; this.user = null; }
  Net.prototype.on = function (t, f) { (this.h[t] = this.h[t] || []).push(f); return this; };
  Net.prototype.emit = function (t, m) { (this.h[t] || []).forEach(function (f) { f(m); }); (this.h['*'] || []).forEach(function (f) { f(m, t); }); };
  Net.prototype.connect = function (token) {
    var self = this;
    return new Promise(function (res, rej) {
      var ws = self.ws = new WebSocket(self.url), done = false;
      ws.onopen = function () { ws.send(JSON.stringify({ t: 'auth', token: token })); };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.t === 'ready') { self.ready = true; self.user = m.user; done = true; res(m.user); }
        if (m.t === 'err' && !self.ready && !done) { done = true; rej(new Error(m.msg)); }
        self.emit(m.t, m);
      };
      ws.onclose = function (e) { self.ready = false; if (!done) { done = true; rej(new Error('conexão fechada')); } self.emit('close', e); };
      ws.onerror = function () { if (!done) { done = true; rej(new Error('não foi possível conectar ao servidor')); } };
    });
  };
  Net.prototype.send = function (o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); };
  Net.prototype.createRoom = function (mode) { this.send({ t: 'room_create', mode: mode }); };
  Net.prototype.join = function (code) { this.send({ t: 'room_join', code: String(code || '').trim().toUpperCase() }); };
  Net.prototype.leave = function () { this.send({ t: 'room_leave' }); };
  Net.prototype.start = function () { this.send({ t: 'start' }); };
  Net.prototype.team = function (t) { this.send({ t: 'team', team: t }); };
  Net.prototype.invite = function (id) { this.send({ t: 'invite', to: id }); };
  Net.prototype.rematch = function () { this.send({ t: 'rematch' }); };
  Net.prototype.presence = function (ids) { this.send({ t: 'presence', ids: ids }); };
  Net.prototype.input = function (i) { this.send({ t: 'in', mx: i.mx, mz: i.mz, yaw: i.yaw, fire: !!i.fire }); };
  Net.prototype.close = function () { if (this.ws) this.ws.close(); };
  root.A32Net = Net;
  if (typeof module === 'object' && module.exports) module.exports = Net;
})(typeof window !== 'undefined' ? window : globalThis);
