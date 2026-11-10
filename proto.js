/* ============================================================
   «Зубцы» — сетевой протокол.

   Сервер 10 раз в секунду отправляет каждому игроку «снимок» —
   что сейчас происходит рядом с его героем. Чтобы не тратить
   интернет, снимок упакован в байты (а не в текст), и в него
   попадают только бойцы в зоне видимости игрока.

   Этот файл знает обе стороны: как сервер упаковывает снимок
   (encodeSnap) и как браузер его распаковывает (decodeSnap).
   ============================================================ */
(function (root) {
  'use strict';
  const ZB = root.ZB = root.ZB || {};

  // Справочники: вместо слов по сети летят их номера
  const UK = ['hero', 'sword', 'archer', 'rider', 'ram', 'worker', 'grunt'];
  const BK = ['citadel', 'sawmill', 'mine', 'market', 'tower', 'palisade', 'barracks', 'range', 'stable', 'workshop', 'forge'];
  const CMD = ['follow', 'hold', 'attack'];
  const RES = ['wood', 'iron', 'gold'];
  const STAT = ['dmg', 'hp', 'spd'];
  const UNITK = ['sword', 'archer', 'rider', 'ram'];
  const POS = 8;            // координаты передаются с точностью 1/8 единицы

  // События (вспышки, монетки, выстрелы). xy — есть координаты; b — поля в 1 байт; w — поля в 2 байта.
  const EV = [null,
    { t: 'hit', xy: 1 },
    { t: 'hitb', xy: 1 },
    { t: 'chop', xy: 1, b: ['res', 'n', 'pid'], w: ['ni'] },
    { t: 'shake', w: ['ni'] },
    { t: 'die', xy: 1, b: ['pid'] },
    { t: 'crash', xy: 1 },
    { t: 'spark', xy: 1 },
    { t: 'hired', xy: 1 },
    { t: 'shot', xy: 1, b: ['k', 'owner', 'z0', 'tb'], w: ['speed', 'tid'] },
    { t: 'coin', b: ['n'] },
    { t: 'deliver', xy: 1, b: ['res', 'n'] },
    { t: 'trade', xy: 1, b: ['res', 'n'] },
    { t: 'pay', xy: 1, b: ['res'] },
    { t: 'cmd', b: ['mode'] },
    { t: 'alert' },
    { t: 'out', b: ['pid'] },
  ];
  const EVID = {};
  EV.forEach((e, i) => { if (e) EVID[e.t] = i; });

  // ---------- запись и чтение байтов ----------
  function Writer(size) { this.b = new ArrayBuffer(size || 8192); this.v = new DataView(this.b); this.o = 0; }
  Writer.prototype.need = function (n) {
    if (this.o + n <= this.b.byteLength) return;
    const nb = new ArrayBuffer(Math.max(this.b.byteLength * 2, this.o + n));
    new Uint8Array(nb).set(new Uint8Array(this.b));
    this.b = nb; this.v = new DataView(nb);
  };
  Writer.prototype.u8 = function (x) { this.need(1); this.v.setUint8(this.o, x); this.o += 1; };
  Writer.prototype.u16 = function (x) { this.need(2); this.v.setUint16(this.o, x); this.o += 2; };
  Writer.prototype.u32 = function (x) { this.need(4); this.v.setUint32(this.o, x); this.o += 4; };
  Writer.prototype.pos = function (x) { this.u16(x <= 0 ? 0 : x >= 8191 ? 65528 : Math.round(x * POS)); };
  Writer.prototype.set16 = function (at, x) { this.v.setUint16(at, x); };
  Writer.prototype.set8 = function (at, x) { this.v.setUint8(at, x); };
  Writer.prototype.bytes = function () { return new Uint8Array(this.b, 0, this.o); };

  function Reader(buf) { this.v = buf instanceof DataView ? buf : new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength); this.o = 0; }
  Reader.prototype.u8 = function () { const x = this.v.getUint8(this.o); this.o += 1; return x; };
  Reader.prototype.u16 = function () { const x = this.v.getUint16(this.o); this.o += 2; return x; };
  Reader.prototype.u32 = function () { const x = this.v.getUint32(this.o); this.o += 4; return x; };
  Reader.prototype.pos = function () { return this.u16() / POS; };

  // =====================================================================
  //  СЕРВЕР: события симуляции → сетевые события
  //  who: -1 — видят все, кто рядом; -2 — видят все; 0..5 — только этот игрок
  // =====================================================================
  function netEvent(e) {
    switch (e.t) {
      case 'hit': return { id: e.b ? EVID.hitb : EVID.hit, who: -1, x: e.x, y: e.y };
      case 'chop': return { id: EVID.chop, who: -1, x: e.x, y: e.y, res: RES.indexOf(e.res), n: e.n, pid: e.pid, ni: e.ni, me: e.pid };
      case 'shake': return { id: EVID.shake, who: -1, x: e.x, y: e.y, ni: e.ni };
      case 'die': return { id: EVID.die, who: -1, x: e.x, y: e.y, pid: e.pid < 0 ? 255 : e.pid };
      case 'crash': return { id: EVID.crash, who: -1, x: e.x, y: e.y };
      case 'built': case 'upgraded': case 'forged': return { id: EVID.spark, who: -1, x: e.x, y: e.y };
      case 'hired': return { id: EVID.hired, who: -1, x: e.x, y: e.y };
      case 'shot': return { id: EVID.shot, who: -1, x: e.x, y: e.y, k: e.k, owner: e.owner, z0: e.z0, tb: e.tb ? 1 : 0, speed: e.speed, tid: e.tid & 65535 };
      case 'coin': return { id: EVID.coin, who: e.pid, n: Math.min(255, e.n) };
      case 'deliver': return { id: EVID.deliver, who: e.pid, x: e.x, y: e.y, res: RES.indexOf(e.res), n: Math.min(255, e.n) };
      case 'trade': return { id: EVID.trade, who: e.pid, x: e.x, y: e.y, res: RES.indexOf(e.res), n: Math.min(255, e.n) };
      case 'pay': return { id: EVID.pay, who: e.pid, x: e.x, y: e.y, res: RES.indexOf(e.res) };
      case 'cmd': return { id: EVID.cmd, who: e.pid, mode: CMD.indexOf(e.mode) };
      case 'alert': return { id: EVID.alert, who: e.pid };
      case 'out': return { id: EVID.out, who: -2, pid: e.pid };
    }
    return null;                       // остальные события клиенту не нужны
  }

  // =====================================================================
  //  СЕРВЕР: упаковка снимка для одного игрока
  //    pi   — номер игрока; aoi — зона видимости { x, y, hw, hh }
  //    evs  — сетевые события для этого игрока; nodeIdx — номера изменившихся деревьев/руды
  //    withB / withMini — приложить ли полный список зданий и точки для мини-карты
  // =====================================================================
  function encodeSnap(w, S, pi, aoi, evs, nodeIdx, withB, withMini) {
    const p = S.players[pi], map = S.map;
    w.o = 0;
    w.u8(1);                                        // тип сообщения: снимок
    w.u32(Math.round(S.time * 1000));
    w.u8((withB ? 1 : 0) | (withMini ? 2 : 0));

    // --- личное: ресурсы, войско, улучшения, площадка под героем ---
    w.u16(Math.min(65535, p.res.wood)); w.u16(Math.min(65535, p.res.iron)); w.u16(Math.min(65535, p.res.gold));
    w.u8(Math.min(255, p.armyUsed)); w.u8(p.armyCap); w.u8(Math.min(255, p.army.length));
    w.u8(p.alive && p.hero.dead ? Math.max(1, Math.min(255, Math.ceil(p.respawnT))) : 0);
    w.pos(p.hold ? p.hold.x : 0); w.pos(p.hold ? p.hold.y : 0);
    let bits = 0, sh = 0;
    for (const k of UNITK) for (const st of STAT) { bits |= (p.up[k][st] & 3) << sh; sh += 2; }
    w.u8(bits & 255); w.u8((bits >>> 8) & 255); w.u8((bits >>> 16) & 255);
    let on = null;
    for (const pad of S.pads) if (pad.owner === pi && pad.on && !pad.dead) { on = pad; break; }
    w.u16(on ? on.id & 65535 : 0);
    w.u8(on ? Math.min(255, on.paid.wood) : 0); w.u8(on ? Math.min(255, on.paid.iron) : 0); w.u8(on ? Math.min(255, on.paid.gold) : 0);
    w.u8(on ? ((on.lack ? 1 : 0) | (on.dwell > 0.12 ? 2 : 0)) : 0);

    // --- все игроки: жив ли, прочность Цитадели, где герой ---
    w.u8(S.players.length);
    for (const q of S.players) {
      w.u8((q.alive ? 1 : 0) | (q.hero.dead ? 2 : 0) | (S.time - q.underAttackT < 3 ? 4 : 0) | (q.isBot ? 8 : 0));
      w.u16(q.alive ? Math.min(65535, Math.ceil(q.citadel.hp)) : 0);
      w.u8((q.citadel.level & 3) | ((q.palLevel & 3) << 2) | (Math.max(0, CMD.indexOf(q.cmd)) << 4));
      w.u8(Math.min(6, Math.ceil(q.res.wood / 10)) | (Math.min(5, Math.ceil(q.res.iron / 10)) << 3) | (Math.min(3, Math.ceil(q.res.gold / 10)) << 6));
      w.pos(q.hero.x); w.pos(q.hero.y);
    }

    // --- бойцы в зоне видимости ---
    const x0 = aoi.x - aoi.hw, x1 = aoi.x + aoi.hw, y0 = aoi.y - aoi.hh, y1 = aoi.y + aoi.hh;
    let at = w.o, n = 0;
    w.u16(0);
    for (const u of S.units) {
      if (u.dead || u.x < x0 || u.x > x1 || u.y < y0 || u.y > y1) continue;
      w.u16(u.id & 65535);
      w.u8(UK.indexOf(u.kind) | ((u.owner < 0 ? 7 : u.owner) << 3) | (u.face > 0 ? 64 : 0));
      w.pos(u.x); w.pos(u.y);
      w.u8(Math.max(1, Math.min(255, Math.ceil(u.hp / u.maxHp * 255))));
      w.u8((u.an & 1) | ((u.hn & 1) << 1) | (u.load > 0 ? 4 : 0) | (u.res === 'iron' ? 8 : 0) | (u.state === 'work' ? 16 : 0));
      n++;
    }
    w.set16(at, n);

    // --- монеты рядом ---
    at = w.o; n = 0;
    w.u8(0);
    for (const c of S.coins) {
      if (c.dead || n >= 255 || c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
      w.u16(c.id & 65535); w.pos(c.x); w.pos(c.y);
      n++;
    }
    w.set8(at, n);

    // --- деревья и руда, у которых изменился запас ---
    w.u16(nodeIdx.length);
    for (const i of nodeIdx) { w.u16(i); w.u8(Math.max(0, S.nodes[i].left)); }

    // --- в каких лагерях ещё есть Ворчуны ---
    let mask = 0;
    S.camps.forEach((cp, i) => { if (cp.spots.some(sp => sp.unit && !sp.unit.dead)) mask |= 1 << i; });
    w.u8(mask);

    // --- здания (не в каждом снимке) ---
    if (withB) {
      at = w.o; n = 0;
      w.u8(0);
      for (const b of S.buildings) {
        if (b.dead) continue;
        w.u16(b.id & 65535);
        w.u8(BK.indexOf(b.kind) | (b.owner << 4));
        w.u8(b.slot < 0 ? 255 : b.slot);
        w.u8(b.level);
        w.u16(Math.min(65535, Math.ceil(b.hp)));
        n++;
      }
      w.set8(at, n);
    }

    // --- точки для мини-карты: всё войско на карте, грубо (не в каждом снимке) ---
    if (withMini) {
      at = w.o; n = 0;
      w.u16(0);
      for (const u of S.units) {
        if (u.dead || u.owner < 0 || u.kind === 'hero') continue;
        w.u8(Math.max(0, Math.min(255, Math.round(u.x / map.w * 255))));
        w.u8(Math.max(0, Math.min(255, Math.round(u.y / map.h * 255))));
        w.u8(u.owner);
        n++;
      }
      w.set16(at, n);
    }

    // --- события ---
    const en = Math.min(255, evs.length);
    w.u8(en);
    for (let i = 0; i < en; i++) {
      const e = evs[i], sc = EV[e.id];
      w.u8(e.id);
      if (sc.xy) { w.pos(e.x); w.pos(e.y); }
      if (sc.b) for (const f of sc.b) w.u8(e[f] & 255);
      if (sc.w) for (const f of sc.w) w.u16(e[f] & 65535);
    }
    return w;
  }

  // =====================================================================
  //  КЛИЕНТ: распаковка снимка
  // =====================================================================
  function decodeSnap(buf) {
    const r = new Reader(buf);
    if (r.u8() !== 1) return null;
    const sn = { time: r.u32(), me: null, players: [], units: [], coins: [], nodes: [], camps: 0, blds: null, mini: null, evs: [] };
    const fl = r.u8();

    const me = sn.me = { res: { wood: r.u16(), iron: r.u16(), gold: r.u16() } };
    me.armyUsed = r.u8(); me.armyCap = r.u8(); me.armyCount = r.u8();
    me.respawn = r.u8();
    me.holdX = r.pos(); me.holdY = r.pos();
    let bits = r.u8() | (r.u8() << 8) | (r.u8() << 16), sh = 0;
    me.up = {};
    for (const k of UNITK) { me.up[k] = {}; for (const st of STAT) { me.up[k][st] = (bits >>> sh) & 3; sh += 2; } }
    me.pad = { id: r.u16(), paid: { wood: r.u8(), iron: r.u8(), gold: r.u8() } };
    const pf = r.u8();
    me.pad.lack = !!(pf & 1); me.pad.dwell = !!(pf & 2);

    const np = r.u8();
    for (let i = 0; i < np; i++) {
      const f = r.u8(), hp = r.u16(), lv = r.u8(), st = r.u8();
      sn.players.push({
        alive: !!(f & 1), heroDead: !!(f & 2), hit: !!(f & 4), bot: !!(f & 8),
        citHp: hp, citLevel: (lv & 3) || 1, pal: (lv >> 2) & 3, cmd: CMD[(lv >> 4) & 3] || 'follow',
        sw: st & 7, si: (st >> 3) & 7, sg: (st >> 6) & 3,
        hx: r.pos(), hy: r.pos(),
      });
    }

    let n = r.u16();
    for (let i = 0; i < n; i++) {
      const id = r.u16(), ko = r.u8(), x = r.pos(), y = r.pos(), hp = r.u8(), f = r.u8(), ow = (ko >> 3) & 7;
      sn.units.push({ id, kind: UK[ko & 7], owner: ow === 7 ? -1 : ow, face: ko & 64 ? 1 : -1, x, y, hp, an: f & 1, hn: (f >> 1) & 1, load: f & 4 ? 1 : 0, res: f & 8 ? 'iron' : 'wood', work: !!(f & 16) });
    }
    n = r.u8();
    for (let i = 0; i < n; i++) sn.coins.push({ id: r.u16(), x: r.pos(), y: r.pos() });
    n = r.u16();
    for (let i = 0; i < n; i++) sn.nodes.push([r.u16(), r.u8()]);
    sn.camps = r.u8();

    if (fl & 1) {
      sn.blds = [];
      n = r.u8();
      for (let i = 0; i < n; i++) {
        const id = r.u16(), ko = r.u8(), slot = r.u8(), level = r.u8(), hp = r.u16();
        sn.blds.push({ id, kind: BK[ko & 15], owner: ko >> 4, slot: slot === 255 ? -1 : slot, level, hp });
      }
    }
    if (fl & 2) {
      n = r.u16();
      sn.mini = new Uint8Array(n * 3);
      for (let i = 0; i < n * 3; i++) sn.mini[i] = r.u8();
    }

    n = r.u8();
    for (let i = 0; i < n; i++) {
      const id = r.u8(), sc = EV[id];
      if (!sc) break;
      const e = { t: sc.t };
      if (sc.xy) { e.x = r.pos(); e.y = r.pos(); }
      if (sc.b) for (const f of sc.b) e[f] = r.u8();
      if (sc.w) for (const f of sc.w) e[f] = r.u16();
      sn.evs.push(e);
    }
    return sn;
  }

  // ---------- клиент → сервер: джойстик (и куда смотрит зритель) ----------
  function encodeInput(x, y, cam) {
    const w = new Writer(8);
    w.u8(cam ? 2 : 1);
    w.u8(Math.round(Math.max(-1, Math.min(1, x)) * 127) & 255);
    w.u8(Math.round(Math.max(-1, Math.min(1, y)) * 127) & 255);
    if (cam) { w.pos(cam.x); w.pos(cam.y); }
    return w.bytes();
  }
  function decodeInput(buf) {
    if (!buf || buf.length < 3 || (buf[0] !== 1 && buf[0] !== 2)) return null;
    const s8 = v => (v > 127 ? v - 256 : v) / 127;
    const m = { x: s8(buf[1]), y: s8(buf[2]), cam: null };
    if (buf[0] === 2 && buf.length >= 7) m.cam = { x: ((buf[3] << 8) | buf[4]) / POS, y: ((buf[5] << 8) | buf[6]) / POS };
    return m;
  }

  ZB.Proto = { Writer, Reader, netEvent, encodeSnap, decodeSnap, encodeInput, decodeInput, UK, BK, CMD, RES, STAT, UNITK, EV, EVID };
})(typeof globalThis !== 'undefined' ? globalThis : this);
