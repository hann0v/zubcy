/* ============================================================
   «Зубцы» — WebSocket своими руками.

   WebSocket — это постоянное соединение между браузером и
   сервером: по нему обе стороны в любой момент шлют друг другу
   сообщения. В Node.js такого сервера «из коробки» нет, а ставить
   ради него сторонние пакеты не хочется — поэтому здесь небольшая
   собственная реализация (по стандарту RFC 6455). Игре из этого
   файла нужны только три вещи: conn.send(), conn.onmessage и
   conn.onclose.
   ============================================================ */
'use strict';
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';   // «волшебная строка» из стандарта
const MAX_MSG = 64 * 1024;                              // сообщения от игрока крошечные; больше — значит что-то не так

class Conn {
  constructor(socket) {
    this.s = socket;
    this.open = true;
    this.alive = true;          // были ли данные с прошлой проверки связи
    this.buf = null;            // недочитанные байты
    this.frag = null;           // части сообщения, пришедшего кусками
    this.fragOp = 0; this.fragLen = 0;
    this.onmessage = null;      // (данные, это_байты?) → вызывается на каждое сообщение
    this.onclose = null;        // вызывается один раз, когда соединение закрылось
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  // Сколько байт ещё не ушло к игроку (если много — у него «затор» в сети)
  get backlog() { return this.s.writableLength; }

  send(data) {
    if (typeof data === 'string') this._send(0x1, Buffer.from(data, 'utf8'));
    else this._send(0x2, data);
  }
  ping() { this._send(0x9, Buffer.alloc(0)); }

  close(code) {
    if (!this.open) return;
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16BE(code || 1000, 0);
    this._send(0x8, b);
    this.open = false;
    try { this.s.end(); } catch (e) { /* уже закрыт */ }
    setTimeout(() => { try { this.s.destroy(); } catch (e) { /* уже закрыт */ } }, 500);
    if (this.onclose) this.onclose();
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    try { this.s.destroy(); } catch (e) { /* уже закрыт */ }
    if (this.onclose) this.onclose();
  }

  // Отправка одного «кадра»: заголовок с длиной + данные
  _send(op, data) {
    if (!this.open) return;
    const len = data.length;
    let head;
    if (len < 126) { head = Buffer.allocUnsafe(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    try { this.s.write(len ? Buffer.concat([head, data]) : head); } catch (e) { this._closed(); }
  }

  // Разбор входящих байтов на кадры
  _data(d) {
    this.alive = true;
    this.buf = this.buf ? Buffer.concat([this.buf, d]) : d;
    while (this.open && this.buf) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) { this.close(1009); return; }
        len = b.readUInt32BE(6); off = 10;
      }
      // браузер обязан «маскировать» данные; слишком длинные сообщения и неизвестные флаги не принимаем
      if (!masked || (b[0] & 0x70) !== 0) { this.close(1002); return; }
      if (len > MAX_MSG) { this.close(1009); return; }
      if (b.length < off + 4 + len) return;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ b[off + (i & 3)];
      this.buf = b.length > off + 4 + len ? b.subarray(off + 4 + len) : null;
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, payload) {
    if (op === 0x8) { this.close(1000); return; }             // «закрываюсь»
    if (op === 0x9) { this._send(0xA, payload); return; }     // пинг → отвечаем понгом
    if (op === 0xA) return;                                   // понг — просто знак, что связь жива
    if (op === 0x1 || op === 0x2) {
      if (fin) { this._msg(op, payload); return; }
      this.frag = [payload]; this.fragOp = op; this.fragLen = payload.length;   // начало сообщения из нескольких частей
      return;
    }
    if (op === 0x0 && this.frag) {
      this.frag.push(payload); this.fragLen += payload.length;
      if (this.fragLen > MAX_MSG) { this.close(1009); return; }
      if (fin) { const all = Buffer.concat(this.frag), o = this.fragOp; this.frag = null; this._msg(o, all); }
      return;
    }
    this.close(1002);
  }

  _msg(op, payload) {
    if (!this.onmessage) return;
    try { this.onmessage(op === 0x1 ? payload.toString('utf8') : payload, op === 0x2); }
    catch (e) { console.log('Ошибка при обработке сообщения:', e); }
  }
}

// Подключает WebSocket к обычному http-серверу. onConn(conn) вызывается для каждого нового игрока.
function attach(server, onConn) {
  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.setNoDelay(true);     // отправлять сразу, не копить мелкие пакеты
    socket.setTimeout(0);
    const conn = new Conn(socket);
    onConn(conn, req);
    if (head && head.length) conn._data(head);
  });
}

module.exports = { attach, Conn };
