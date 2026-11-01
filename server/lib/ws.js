'use strict';
// Implementação mínima de WebSocket (RFC 6455) usando só módulos nativos do Node.
// Suporta mensagens de texto (sem fragmentação), ping/pong e fechamento.
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 16 * 1024;

class Conn {
  constructor(socket) {
    this.s = socket; this.buf = Buffer.alloc(0); this.open = true; this.h = {};
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  on(ev, f) { this.h[ev] = f; return this; }
  _closed() { if (!this.open) return; this.open = false; if (this.h.close) this.h.close(); }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 128, op = b[0] & 15, masked = b[1] & 128; let len = b[1] & 127, o = 2;
      if (!masked) return this.close(1002);
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); o = 10; }
      if (len > MAX) return this.close(1009);
      const end = o + 4 + len; if (b.length < end) return;
      const m = b.subarray(o, o + 4), p = Buffer.from(b.subarray(o + 4, end));
      for (let i = 0; i < p.length; i++) p[i] ^= m[i & 3];
      this.buf = b.subarray(end);
      if (op === 8) return this.close(1000);
      if (op === 9) { this._frame(10, p); continue; }
      if (op === 10) continue;
      if (op !== 1 || !fin) return this.close(1003); // só texto, sem fragmentos
      if (this.h.message) this.h.message(p.toString('utf8'));
    }
  }
  _frame(op, p) {
    if (!this.open) return;
    const n = p.length; let h;
    if (n < 126) h = Buffer.from([128 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 128 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 128 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    this.s.write(Buffer.concat([h, p]));
  }
  send(str) { this._frame(1, Buffer.from(str)); }
  close(code) {
    if (!this.open) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000);
    this._frame(8, b); this.open = false; this.s.end();
    if (this.h.close) this.h.close();
  }
}

function accept(req, socket, onConn) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  onConn(new Conn(socket), req);
}
module.exports = { accept };
