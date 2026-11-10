/* ============================================================
   «Зубцы» — сеть в браузере.

   Что тут происходит:
     • соединение с сервером и сообщения лобби;
     • приём «снимков» игры 10 раз в секунду;
     • сглаживание: экран рисует не последний снимок, а плавно
       едет между двумя соседними с небольшим отставанием;
     • свой герой откликается на джойстик сразу, не дожидаясь
       сервера, и мягко подтягивается к серверной точке;
     • при обрыве связи — попытки вернуться в матч.
   На выходе получается такой же объект состояния S, как в
   одиночной игре, — поэтому рисование и интерфейс общие.
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG, Sim = ZB.Sim, Proto = ZB.Proto;
  const Net = ZB.Net = {};
  const DELAY = 160;                 // на сколько миллисекунд картинка отстаёт от сервера (цена плавности)
  const SESS = 'zubcy-session';      // где в браузере хранится «пропуск» для возврата в матч
  const RETRY_MS = 60000;            // сколько пытаемся вернуться после обрыва

  let ws = null, queue = [];
  let G = null;                      // идущий сетевой матч (или null)
  let sess = null;                   // { code, id, key, name }
  let lostAt = 0, retryTimer = 0, pingTimer = 0;

  Net.room = null;                   // что сейчас в лобби
  Net.S = null; Net.me = 0;          // состояние матча для экрана
  Net.spec = null;                   // куда смотрит зритель
  Net.status = 'off';                // off | connecting | open | lost
  Net.rtt = 90;                      // задержка сети туда-обратно, мс
  // эти обработчики назначают другие файлы
  Net.onRoom = Net.onStart = Net.onOver = Net.onError = Net.onStatus = Net.onEvent = null;

  const call = (fn, a, b, c) => { if (fn) fn(a, b, c); };
  function setStatus(s) { if (Net.status !== s) { Net.status = s; call(Net.onStatus, s); } }

  // Онлайн работает, только когда страница открыта с сервера (а не файлом с диска)
  Net.available = function () { return location.protocol === 'http:' || location.protocol === 'https:'; };
  Net.inGame = function () { return !!G; };
  Net.lostFor = function () { return lostAt ? (performance.now() - lostAt) / 1000 : 0; };

  // =====================================================================
  //  СОЕДИНЕНИЕ
  // =====================================================================
  function connect() {
    if (ws) return;
    if (Net.status !== 'lost') setStatus('connecting');
    const sock = ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      if (sock !== ws) return;
      lostAt = 0; clearTimeout(retryTimer);
      setStatus('open');
      for (const m of queue) sock.send(m);
      queue = [];
      clearInterval(pingTimer);
      pingTimer = setInterval(() => raw({ t: 'p', n: Math.round(performance.now()) }), 2000);   // замер задержки
    };
    sock.onmessage = ev => {
      if (sock !== ws) return;
      if (typeof ev.data === 'string') { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onJson(m); }
      else onSnap(ev.data);
    };
    sock.onerror = () => { /* за ошибкой всегда следует onclose */ };
    sock.onclose = () => { if (sock === ws) { ws = null; clearInterval(pingTimer); onDown(); } };
  }

  function raw(obj) {
    const s = JSON.stringify(obj);
    if (ws && ws.readyState === 1) ws.send(s);
    else if (obj.t !== 'p') { queue.push(s); connect(); }
  }

  // Соединение пропало. Если мы были в комнате — пробуем вернуться.
  function onDown() {
    queue = [];
    if (!sess || (!G && !Net.room)) { setStatus('off'); return; }
    if (!lostAt) lostAt = performance.now();
    if (performance.now() - lostAt > RETRY_MS) { giveUp('Связь с сервером потеряна'); return; }
    setStatus('lost');
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { raw(Object.assign({ t: 'resume' }, sess)); }, 1500);
  }
  function giveUp(msg) {
    clearTimeout(retryTimer);
    lostAt = 0; forget();
    G = null; Net.S = null; Net.room = null;
    setStatus('off');
    call(Net.onError, msg, true);
  }

  function remember(s) { sess = s; try { localStorage.setItem(SESS, JSON.stringify(Object.assign({ at: Date.now() }, s))); } catch (e) { /* не страшно */ } }
  function forget() { sess = null; try { localStorage.removeItem(SESS); } catch (e) { /* не страшно */ } }

  // При открытии страницы: если недавно были в комнате — тихо пробуем вернуться (например, после обновления)
  Net.tryResume = function () {
    if (!Net.available()) return false;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SESS) || 'null'); } catch (e) { s = null; }
    if (!s || !s.code || Date.now() - (s.at || 0) > 2 * 3600 * 1000) return false;
    sess = { code: s.code, id: s.id, key: s.key, name: s.name };
    raw(Object.assign({ t: 'resume' }, sess));
    return true;
  };

  // ---------- лобби ----------
  Net.create = function (name) { sess = { name }; raw({ t: 'create', name }); };
  Net.join = function (code, name) { sess = { name }; raw({ t: 'join', code, name }); };
  Net.send = function (obj) { raw(obj); };                       // настройки комнаты: режим, боты, цвет, команда, старт
  Net.leave = function () {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' }));
    forget(); G = null; Net.S = null; Net.room = null; lostAt = 0; clearTimeout(retryTimer);
  };
  Net.backToRoom = function () { G = null; Net.S = null; };       // матч кончился — возвращаемся в лобби комнаты

  // ---------- матч ----------
  Net.command = function (c) { raw({ t: 'c', c }); return true; };
  Net.sendView = function (hw, vh) { raw({ t: 'view', hw: Math.round(hw), vh: Math.round(vh) }); };

  function onJson(m) {
    switch (m.t) {
      case 'room':
        Net.room = m;
        if (m.key) remember({ code: m.code, id: m.you, key: m.key, name: (sess && sess.name) || '' });
        call(Net.onRoom, m);
        break;
      case 'start': beginGame(m); call(Net.onStart, G.S, G.me, m); break;
      case 'pads': if (G) setPads(m.list); break;
      case 'over':
        if (G) { G.S.over = true; G.S.winnerTeam = m.winnerTeam; G.S.reason = m.reason; }
        call(Net.onOver, m);
        break;
      case 'err':
        if (m.fatal) { giveUp(m.msg); return; }
        call(Net.onError, m.msg, false);
        break;
      case 'p': { const r = performance.now() - m.n; if (r >= 0 && r < 5000) Net.rtt += (r - Net.rtt) * 0.3; break; }
    }
  }

  // =====================================================================
  //  СОСТОЯНИЕ МАТЧА (то, что рисует экран)
  // =====================================================================
  function beginGame(m) {
    const map = Sim.buildMap(m.n, m.seed);            // та же карта, что на сервере: строится по зерну
    const S = {
      net: true, mode: m.mode, map, time: m.time || 0, timeLeft: 0, over: false, winnerTeam: -1, reason: '',
      players: [], units: [], buildings: [], nodes: [], pads: [], coins: [], shots: [], camps: [], pals: [], events: [], mini: null,
    };
    map.nodes.forEach((nd, i) => {
      const def = CFG.NODES[nd.kind];
      S.nodes.push({ id: i + 1, i, kind: nd.kind, x: nd.x, y: nd.y, v: nd.v, r: def.r, left: def.amount, max: def.amount, regrowT: 0, shake: 0 });
    });
    Sim.buildGrid(S);                                   // сетка препятствий — чтобы свой герой не «проходил» сквозь деревья
    m.players.forEach((po, i) => {
      const base = map.bases[i], up = {};
      for (const k of Sim.UNIT_KINDS) up[k] = { dmg: 0, hp: 0, spd: 0 };
      S.players.push({
        id: i, name: po.name, color: po.color, team: po.team, isBot: po.bot, alive: true,
        res: { wood: 0, iron: 0, gold: 0 }, armyCap: CFG.ARMY_CAP_BASE, armyUsed: 0, army: { length: 0 }, buildings: [], up,
        cmd: 'follow', hold: null, base, palLevel: 0, respawnT: 0, underAttackT: -99, hit: false, hx: base.x + 58, hy: base.y + 112, heroDead: false,
        hero: { dead: false, x: base.x + 58, y: base.y + 112, px: base.x + 58, py: base.y + 112, hp: 1, maxHp: 1 },
        citadel: { id: -1 - i, isB: true, kind: 'citadel', owner: i, team: po.team, x: base.x, y: base.y, r: CFG.BUILDINGS.citadel.r, hp: 3000, maxHp: 3000, level: 1, slot: -1, dead: false, born: -99, hurtT: 0, workers: [] },
      });
    });
    map.camps.forEach(c => S.camps.push({ x: c.x, y: c.y, alive: true }));
    if (m.nodes) for (const q of m.nodes) setNode(S, q[0], q[1]);
    const b0 = map.bases[m.me];
    G = {
      S, me: m.me, snaps: [], off: null, A: null, B: null, gen: 0,
      uv: new Map(), cv: new Map(), bv: new Map(),      // объекты бойцов, монет и зданий по номерам
      myHero: null, pred: null, idleT: 0,
      lastIn: { x: 99, y: 99, t: 0 },
      spec: { x: b0.x, y: b0.y - 60 },
    };
    Net.S = S; Net.me = m.me; Net.spec = G.spec;
  }

  function setNode(S, i, left) {
    const nd = S.nodes[i];
    if (!nd) return;
    if (left <= 0 && nd.left > 0) nd.regrowT = CFG.NODES[nd.kind].regrow;     // только что срубили — пошёл отсчёт до отрастания
    nd.left = left;
  }

  function setPads(list) {
    const S = G.S, old = {};
    for (const p of S.pads) old[p.id] = p;
    S.pads = list.map(q => {
      const o = old[q.id];
      return {
        id: q.id, owner: G.me, kind: q.kind, what: q.what, slot: q.slot, x: q.x, y: q.y, r: q.r,
        cost: q.cost || null, choice: !q.cost, paid: q.paid || { wood: 0, iron: 0, gold: 0 },
        dwell: o ? o.dwell : 0, on: o ? o.on : false, lack: false, blocked: '', dead: false,
        bld: q.lvl ? { level: q.lvl, kind: q.bk } : null,
      };
    });
  }

  function setBuildings(list) {
    const S = G.S, keep = new Map(), out = [];
    for (const b of list) {
      const pl = S.players[b.owner];
      if (!pl) continue;
      let v;
      if (b.kind === 'citadel') { v = pl.citadel; v.id = b.id; }
      else {
        v = G.bv.get(b.id);
        if (!v) {
          const s = pl.base.slots[b.slot];
          v = { id: b.id, isB: true, kind: b.kind, owner: b.owner, team: pl.team, slot: b.slot, x: s.x, y: s.y, r: CFG.BUILDINGS[b.kind].r, hp: b.hp, maxHp: 1, level: b.level, dead: false, born: S.time > 2 ? S.time : -99, hurtT: 0, workers: [] };
        }
        v.level = b.level; v.hp = b.hp; v.maxHp = Sim.maxHpOf(CFG.BUILDINGS[b.kind], b.level);
        keep.set(b.id, v);
      }
      out.push(v);
    }
    for (const v of G.bv.values()) if (!keep.has(v.id)) v.dead = true;
    G.bv = keep; S.buildings = out;
    for (const pl of S.players) pl.buildings = out.filter(b => b.owner === pl.id);
  }

  // Пришёл снимок с сервера
  function onSnap(buf) {
    if (!G) return;
    let sn;
    try { sn = Proto.decodeSnap(buf); } catch (e) { return; }
    if (!sn) return;
    const now = performance.now();
    sn.fired = false; sn.byId = null;
    sn.myHero = null;
    for (const u of sn.units) if (u.kind === 'hero' && u.owner === G.me) { sn.myHero = u; break; }

    // на сколько часы сервера отличаются от наших (берём самую быструю доставку за последнее время)
    const d = now - sn.time;
    if (G.off == null || d < G.off || Math.abs(d - G.off) > 1500) G.off = d; else G.off += (d - G.off) * 0.02;
    G.snaps.push(sn);
    if (G.snaps.length > 8) G.snaps.shift();

    // всё, что не требует плавности, применяем сразу
    const S = G.S, me = S.players[G.me], pm = sn.me;
    me.res.wood = pm.res.wood; me.res.iron = pm.res.iron; me.res.gold = pm.res.gold;
    me.armyUsed = pm.armyUsed; me.armyCap = pm.armyCap; me.army.length = pm.armyCount;
    me.respawnT = pm.respawn; me.up = pm.up;
    S.pals = [];
    sn.players.forEach((q, i) => {
      const pl = S.players[i];
      if (!pl) return;
      pl.alive = q.alive; pl.isBot = q.bot; pl.cmd = q.cmd; pl.palLevel = q.pal; pl.hit = q.hit;
      pl.hx = q.hx; pl.hy = q.hy; pl.heroDead = q.heroDead;
      if (i !== G.me) { pl.res.wood = q.sw * 10; pl.res.iron = q.si * 10; pl.res.gold = q.sg * 10; }   // для стопки за спиной чужого героя
      const c = pl.citadel;
      c.dead = !q.alive; c.level = q.citLevel; c.maxHp = CFG.BUILDINGS.citadel.hpL[q.citLevel - 1]; c.hp = q.citHp;
      if (q.alive && q.pal) S.pals.push({ x: pl.base.x, y: pl.base.y, team: pl.team, slow: CFG.BUILDINGS.palisade.slow[q.pal - 1] });
    });
    me.hold = me.cmd === 'hold' ? { x: pm.holdX, y: pm.holdY } : null;
    for (const q of sn.nodes) setNode(S, q[0], q[1]);
    S.camps.forEach((c, i) => { c.alive = !!(sn.camps & (1 << i)); });
    if (sn.blds) setBuildings(sn.blds);
    if (sn.mini) S.mini = sn.mini;
    for (const pad of S.pads) {
      const on = pad.id === pm.pad.id;
      pad.on = on;
      if (on) { pad.paid = pm.pad.paid; pad.lack = pm.pad.lack; pad.dwell = pm.pad.dwell ? 1 : 0; } else { pad.lack = false; pad.dwell = 0; }
      pad.blocked = pad.kind === 'hire' && me.armyUsed + CFG.UNITS[pad.what].cap > me.armyCap ? 'cap' : '';
    }
  }

  // Собираем список бойцов для экрана: у каждого «откуда» (снимок A) и «куда» (снимок B)
  function rebuild(A, B) {
    const S = G.S, gen = ++G.gen, out = S.units;
    if (!A.byId) { A.byId = new Map(); for (const u of A.units) A.byId.set(u.id, u); }
    const span = Math.max(0.03, (B.time - A.time) / 1000);
    out.length = 0;
    G.myHero = null;
    for (const ub of B.units) {
      let v = G.uv.get(ub.id);
      if (!v || v.kind !== ub.kind) {
        v = { id: ub.id, kind: ub.kind, owner: ub.owner, x: ub.x, y: ub.y, px: ub.x, py: ub.y, hp: ub.hp, maxHp: 255, face: ub.face, moving: false, atkAnim: 0, hurtT: 0, dead: false, an: ub.an, hn: ub.hn, load: 0, res: 'wood', state: '', gen: 0 };
        G.uv.set(ub.id, v);
      }
      const ua = A.byId.get(ub.id) || ub;
      v.px = ua.x; v.py = ua.y; v.x = ub.x; v.y = ub.y;
      v.hp = ub.hp; v.face = ub.face;
      v.moving = Math.hypot(ub.x - ua.x, ub.y - ua.y) / span > 22;
      if (ub.an !== v.an) { v.an = ub.an; v.atkAnim = 0.25; }      // боец ударил
      if (ub.hn !== v.hn) { v.hn = ub.hn; v.hurtT = 0.12; }        // бойца ранили
      v.load = ub.load; v.res = ub.res; v.state = ub.work ? 'work' : '';
      v.gen = gen;
      out.push(v);
      if (ub.kind === 'hero' && ub.owner === G.me) G.myHero = v;
    }
    if (G.uv.size > out.length + 80) for (const [id, v] of G.uv) if (v.gen !== gen) { v.dead = true; G.uv.delete(id); }

    const coins = S.coins;
    if (!A.coinId) { A.coinId = new Map(); for (const c of A.coins) A.coinId.set(c.id, c); }
    coins.length = 0;
    for (const cb of B.coins) {
      const ca = A.coinId.get(cb.id) || cb;
      coins.push({ id: cb.id, px: ca.x, py: ca.y, x: cb.x, y: cb.y });
    }

    // герои: свой — настоящий объект (за ним следит камера), чужие — метки для мини-карты
    S.players.forEach((pl, i) => {
      if (i === G.me && G.myHero) pl.hero = G.myHero;
      else pl.hero = { dead: i === G.me ? true : pl.heroDead, x: pl.hx, y: pl.hy, px: pl.hx, py: pl.hy, hp: 1, maxHp: 1 };
    });
  }

  // События снимка превращаем в эффекты
  function fire(sn) {
    const S = G.S, me = G.me, P = ZB.Proto;
    const emit = e => call(Net.onEvent, e);
    const h = G.myHero || S.players[me].hero;
    for (const e of sn.evs) {
      switch (e.t) {
        case 'hit': emit({ t: 'hit', x: e.x, y: e.y, b: false }); break;
        case 'hitb':
          for (const b of S.buildings) if (Math.abs(b.x - e.x) < 2 && Math.abs(b.y - e.y) < 2) b.hurtT = 0.12;
          emit({ t: 'hit', x: e.x, y: e.y, b: true });
          break;
        case 'chop': {
          const nd = S.nodes[e.ni];
          if (nd) nd.shake = 0.3;
          emit({ t: 'chop', pid: e.pid, res: P.RES[e.res], n: e.n, x: e.x, y: e.y, hx: h.x, hy: h.y });
          break;
        }
        case 'shake': { const nd = S.nodes[e.ni]; if (nd) nd.shake = 0.3; break; }
        case 'die': emit({ t: 'die', x: e.x, y: e.y, pid: e.pid === 255 ? -1 : e.pid }); break;
        case 'crash': emit({ t: 'crash', x: e.x, y: e.y }); break;
        case 'spark': emit({ t: 'built', x: e.x, y: e.y }); break;
        case 'hired': emit({ t: 'hired', x: e.x, y: e.y }); break;
        case 'shot': addShot(e); break;
        case 'coin': emit({ t: 'coin', pid: me, n: e.n, x: h.x, y: h.y }); break;
        case 'deliver': emit({ t: 'deliver', pid: me, res: P.RES[e.res], n: e.n, x: e.x, y: e.y }); break;
        case 'trade': emit({ t: 'trade', pid: me, res: P.RES[e.res], n: e.n, x: e.x, y: e.y }); break;
        case 'pay': emit({ t: 'pay', pid: me, res: P.RES[e.res], x: e.x, y: e.y, hx: h.x, hy: h.y }); break;
        case 'cmd': emit({ t: 'cmd', pid: me, mode: P.CMD[e.mode] }); break;
        case 'alert': emit({ t: 'alert', pid: me }); break;
        case 'out': emit({ t: 'out', pid: e.pid }); break;
      }
    }
  }

  // Снаряды летят прямо в браузере: сервер сообщает только «кто в кого выстрелил»
  function addShot(e) {
    const S = G.S;
    const tg = e.tb ? S.buildings.find(b => b.id === e.tid) : G.uv.get(e.tid);
    if (!tg) return;
    if (S.shots.length > 90) S.shots.shift();
    S.shots.push({ x: e.x, y: e.y, px: e.x, py: e.y, sx: e.x, sy: e.y, z0: e.z0, k: e.k, owner: e.owner, speed: e.speed, target: tg, age: 0 });
    call(Net.onEvent, { t: 'shot', k: e.k, x: e.x, y: e.y });   // для звука выстрела
  }
  function moveShots(dt) {
    const arr = G.S.shots;
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i], t = s.target;
      s.age += dt; s.px = s.x; s.py = s.y;
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), st = s.speed * dt;
      if (t.dead || s.age > 3 || d <= st + 5 + (t.isB ? t.r * 0.6 : 0)) { arr.splice(i, 1); continue; }
      s.x += dx / d * st; s.y += dy / d * st;
    }
  }

  // Свой герой: двигаем сразу по джойстику и мягко подтягиваем к точке с сервера
  function predict(dt, inp) {
    const S = G.S, me = S.players[G.me], v = G.myHero;
    const sv = G.snaps[G.snaps.length - 1].myHero;
    if (!v || !sv || !me.alive) { G.pred = null; return; }
    let P = G.pred;
    if (!P || P.id !== v.id) P = G.pred = { id: v.id, x: sv.x, y: sv.y, r: CFG.HERO.r, vx: 0, vy: 0, team: me.team };
    let ix = inp.x, iy = inp.y;
    const m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }
    const sp = CFG.HERO.speed * (S.pals.length ? Sim.slowAt(S, P) : 1);
    P.vx = ix * sp; P.vy = iy * sp;
    P.x += P.vx * dt; P.y += P.vy * dt;

    const lead = Math.min(0.45, Net.rtt / 1000 + 0.09);      // на столько секунд сервер «отстаёт» от наших нажатий
    const moving = m > 0.15;
    let tx = sv.x, ty = sv.y, k = 0;
    if (moving) { G.idleT = 0; tx += P.vx * lead; ty += P.vy * lead; k = 5; }
    else { G.idleT += dt; if (G.idleT > lead + 0.15) k = 8; }  // остановились — ждём, пока сервер тоже остановит героя
    const ex = tx - P.x, ey = ty - P.y;
    if (Math.hypot(ex, ey) > 170) { P.x = sv.x; P.y = sv.y; }  // сильно разошлись (героя оттолкнули) — ставим на серверную точку
    else if (k) { const f = Math.min(1, k * dt); P.x += ex * f; P.y += ey * f; }
    Sim.collideStatic(S, P, dt);                               // сквозь деревья и здания не проходим

    v.px = v.x = P.x; v.py = v.y = P.y;
    v.moving = moving;
    if (Math.abs(ix) > 0.12) v.face = ix > 0 ? 1 : -1;
  }

  // Вызывается каждый кадр. Возвращает число от 0 до 1 — на сколько мы между двумя снимками.
  Net.update = function (now, dt, inp) {
    if (!G || !G.snaps.length) return 1;
    const S = G.S, sn = G.snaps;
    let rt = now - G.off - DELAY;                              // «время на экране» по часам сервера
    let A = sn[0], B = null;
    for (let i = 0; i < sn.length; i++) { if (sn[i].time <= rt) A = sn[i]; else { B = sn[i]; break; } }
    if (!B) B = A;                                             // свежих снимков нет — стоим на последнем
    if (rt < A.time) rt = A.time;
    const alpha = B === A ? 1 : Math.min(1, (rt - A.time) / (B.time - A.time));
    const tm = Math.min(rt, B.time) / 1000;
    if (tm > S.time || S.time - tm > 2) S.time = tm;
    if (A !== G.A || B !== G.B) { G.A = A; G.B = B; rebuild(A, B); }
    for (const q of sn) if (!q.fired && q.time <= rt + 1) { q.fired = true; fire(q); }

    for (const u of S.units) { if (u.atkAnim > 0) u.atkAnim -= dt; if (u.hurtT > 0) u.hurtT -= dt; }
    for (const b of S.buildings) if (b.hurtT > 0) b.hurtT -= dt;
    for (const nd of S.nodes) { if (nd.shake > 0) nd.shake -= dt; if (nd.left <= 0 && nd.regrowT > 0) nd.regrowT -= dt; }
    for (const pl of S.players) pl.underAttackT = pl.hit ? S.time : -99;
    moveShots(dt);

    const me = S.players[G.me], spec = !me.alive;
    if (spec) {                                                // зритель двигает камеру джойстиком
      G.spec.x = Math.max(0, Math.min(S.map.w, G.spec.x + inp.x * 620 * dt));
      G.spec.y = Math.max(0, Math.min(S.map.h, G.spec.y + inp.y * 620 * dt));
    } else {
      predict(dt, inp);
      const h = G.myHero;
      if (h) { G.spec.x = h.x; G.spec.y = h.y; }
    }

    // отправляем джойстик: при изменении, но не чаще 30 раз в секунду
    const q = G.lastIn, x = Math.round(inp.x * 127), y = Math.round(inp.y * 127);
    if (ws && ws.readyState === 1 && now - q.t > 33 && (x !== q.x || y !== q.y || now - q.t > (spec ? 150 : 600))) {
      q.x = x; q.y = y; q.t = now;
      ws.send(Proto.encodeInput(inp.x, inp.y, spec ? G.spec : null));
    }
    return alpha;
  };
})();
