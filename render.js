/* ============================================================
   «Зубцы» — отрисовка мира: камера, земля, дороги, все объекты,
   эффекты (искры, всплывающие цифры) и стрелки-указатели.
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG, D = ZB.Draw, Sim = ZB.Sim;
  const TILT = CFG.TILT, TAU = Math.PI * 2, OUT = D.OUT;
  const R = ZB.Render = {};

  let canvas, ctx, W = 1, H = 1, dpr = 1, zoom = 1, ox = 0, oy = 0;
  const cam = { x: 0, y: 0 };
  let HY = 0.54, hyTarget = 0.54;      // где по высоте экрана стоит герой (чуть ниже середины)
  let grass = null;
  let parts = [], texts = [], flies = [], rings = [];
  const list = [];                    // объекты кадра, отсортированные «дальние — раньше»
  const stacks = {};                  // стопки ресурсов за спиной героев
  const padLift = {};                 // подписи площадок приподнимаются, когда герой стоит на них
  const bFade = {};                   // прозрачность зданий, за которыми кто-то стоит
  let insetTop = 96, insetBottom = 24;
  let objective = null;               // текущая цель-подсказка: { x, y, icon, h }
  let spec = null;                    // точка, на которую смотрит зритель (когда наш игрок выбыл)

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  // высота полоски здоровья над бойцом
  const HP_Y = { sword: -40, archer: -39, rider: -54, ram: -45, worker: -33, grunt: -42 };
  const PAD_NAME = { slot: 'Построить', forge: 'Улучшения', trade: 'Обмен' };

  R.init = function (cv) {
    canvas = cv;
    ctx = cv.getContext('2d', { alpha: false });
    makeGrass();
    R.resize();
  };

  R.resize = function () {
    dpr = Math.min(window.devicePixelRatio || 1, 2);     // больше 2 не берём — бережём телефон
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    zoom = clamp(Math.min(W / 450, H / 780), 0.55, 1.5);  // на телефоне в ширину видно около 450 единиц мира
  };

  R.reset = function (S, me) {
    const p = S.players[me];
    cam.x = p.hero.x; cam.y = p.hero.y;
    parts = []; texts = []; flies = []; rings = []; objective = null;
    for (const o of [stacks, padLift, bFade]) for (const k in o) delete o[k];
  };
  R.setInsets = function (top, bottom) { insetTop = top; insetBottom = bottom; };
  R.setObjective = function (o) { objective = o; };
  R.setSpec = function (p) { spec = p; };
  // Сколько мира помещается на экране — сервер по этому решает, каких бойцов нам присылать
  R.viewSize = function () { return { hw: W / 2 / zoom, vh: H / (zoom * TILT) }; };
  // Панель выбора открыта — поднимаем героя выше, чтобы она его не закрывала
  R.setPanel = function (open) { hyTarget = open ? 0.3 : 0.54; };
  // Какой кусок мира сейчас виден — нужно мини-карте
  R.view = function () {
    const halfW = W / 2 / zoom;
    return { x0: cam.x - halfW, x1: cam.x + halfW, y0: cam.y - H * HY / (zoom * TILT), y1: cam.y + H * (1 - HY) / (zoom * TILT) };
  };

  // Плитка травы — рисуем один раз и потом замощаем ею землю
  function makeGrass() {
    const s = 192, g = document.createElement('canvas');
    g.width = g.height = s;
    const c = g.getContext('2d');
    c.fillStyle = '#8fd053'; c.fillRect(0, 0, s, s);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * s, y = rnd() * s, rx = 10 + rnd() * 22, ry = rx * (0.5 + rnd() * 0.3);
      c.fillStyle = i % 2 ? 'rgba(175,232,105,0.35)' : 'rgba(95,175,60,0.22)';
      for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {   // с «заворотом», чтобы не было швов
        c.beginPath(); c.ellipse(x + ax * s, y + ay * s, rx, ry, 0, 0, TAU); c.fill();
      }
    }
    c.strokeStyle = 'rgba(80,160,50,0.5)'; c.lineWidth = 2; c.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const x = 6 + rnd() * (s - 12), y = 8 + rnd() * (s - 12);
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + 2, y - 5); c.moveTo(x + 4, y); c.lineTo(x + 5, y - 4); c.stroke();
    }
    grass = ctx.createPattern(g, 'repeat');
  }

  // Стопка добытого за спиной героя (каждая плашка — около 10 единиц ресурса)
  function stackOf(pl) {
    const w = Math.min(6, Math.ceil(pl.res.wood / 10)), i = Math.min(5, Math.ceil(pl.res.iron / 10)), g = Math.min(4, Math.ceil(pl.res.gold / 10));
    const key = w * 100 + i * 10 + g;
    let st = stacks[pl.id];
    if (!st || st.key !== key) {
      st = stacks[pl.id] = { key, items: [] };
      for (let k = 0; k < w; k++) st.items.push('wood');
      for (let k = 0; k < i; k++) st.items.push('iron');
      for (let k = 0; k < g; k++) st.items.push('gold');
    }
    return st.items;
  }

  // =====================================================================
  //  ЭФФЕКТЫ
  // =====================================================================
  function burst(x, y, z, n, color, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = speed * (0.4 + Math.random() * 0.6);
      parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: 40 + Math.random() * speed, life: 0.35 + Math.random() * 0.25, color, size: (size || 3) * (0.7 + Math.random() * 0.6) });
    }
    if (parts.length > 260) parts.splice(0, parts.length - 260);
  }
  function note(x, y, z, str, icon, size) { if (texts.length < 40) texts.push({ x, y, z, str, icon, size: size || 16, life: 1 }); }

  // Симуляция сообщает «что случилось» — здесь превращаем это в искры и цифры
  R.onEvent = function (e, S, me) {
    switch (e.t) {
      case 'hit': burst(e.x, e.y, e.b ? 40 : 18, e.b ? 3 : 2, '#ffffff', 70, 3); break;
      case 'chop':
        burst(e.x, e.y, 22, 4, e.res === 'wood' ? '#d9a066' : '#c3cfdb', 80, 3.2);
        if (e.pid === me) note(e.hx, e.hy, 58, '+' + e.n, e.res);
        break;
      case 'coin': if (e.pid === me) note(e.x, e.y, 62, '+' + e.n, 'gold'); break;
      case 'deliver': if (e.pid === me) note(e.x, e.y, 74, '+' + e.n, e.res, 14); break;
      case 'trade': if (e.pid === me) note(e.x, e.y, 50, '+' + e.n, e.res, 18); break;
      case 'die': {
        const col = e.pid >= 0 ? CFG.COLORS[S.players[e.pid].color].main : '#a69a8c';
        burst(e.x, e.y, 16, 9, col, 110, 4); burst(e.x, e.y, 14, 5, '#ffffff', 80, 3.5);
        break;
      }
      case 'crash': burst(e.x, e.y, 40, 26, '#ddd6c6', 190, 6); burst(e.x, e.y, 30, 14, '#8a5a33', 150, 5); break;
      case 'built': case 'upgraded': case 'forged': burst(e.x, e.y, 30, 16, '#fff3a8', 150, 4); break;
      case 'hired': burst(e.x, e.y, 14, 6, '#ffffff', 80, 3); break;
      case 'pay': if (e.pid === me && flies.length < 30) flies.push({ res: e.res, x0: e.hx, y0: e.hy, x1: e.x, y1: e.y, t: 0 }); break;
      case 'cmd': {                                           // приказ войску — круг расходится от героя
        const h = S.players[e.pid].hero;
        if (e.pid === me && !h.dead) rings.push({ x: h.x, y: h.y, t: 0, big: e.mode === 'attack' });
        break;
      }
    }
  };

  // =====================================================================
  //  СТРЕЛКА У КРАЯ ЭКРАНА (к базе и к цели)
  // =====================================================================
  // Возвращает точку на экране, где нарисована стрелка, или null, если цель и так видна.
  // dry = true — только посчитать место, не рисуя.
  function edgeArrow(c, wx, wy, fill, icon, col, pulse, t, extra, dry) {
    const sx = (wx - cam.x) * zoom + W / 2, sy = (wy - cam.y) * TILT * zoom + H * HY;
    const m = 36 + extra, top = insetTop + 30 + extra, bottom = H - insetBottom - 40 - extra;
    if (sx > 20 && sx < W - 20 && sy > insetTop + 10 && sy < H - 20) return null;
    const cx0 = W / 2, cy0 = H * HY, dx = sx - cx0, dy = sy - cy0;
    let s = Infinity;
    if (dx > 0) s = Math.min(s, (W - m - cx0) / dx); else if (dx < 0) s = Math.min(s, (m - cx0) / dx);
    if (dy > 0) s = Math.min(s, (bottom - cy0) / dy); else if (dy < 0) s = Math.min(s, (top - cy0) / dy);
    if (!isFinite(s)) return null;
    const at = { x: cx0 + dx * s, y: cy0 + dy * s };
    if (dry) return at;
    const sc = 1 + (pulse ? Math.sin(t * 12) * 0.14 : Math.sin(t * 3) * 0.04);
    c.save();
    c.translate(at.x, at.y); c.scale(sc, sc);
    c.lineJoin = 'round';
    c.save(); c.rotate(Math.atan2(dy, dx));
    c.beginPath(); c.moveTo(33, 0); c.lineTo(17, -12); c.lineTo(17, 12); c.closePath(); D.fs(c, fill, OUT, 3);
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.arc(0, 3, 21, 0, TAU); c.fill();
    c.beginPath(); c.arc(0, 0, 21, 0, TAU); D.fs(c, fill, OUT, 3);
    c.beginPath(); c.arc(0, 0, 15.5, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
    D.icon(c, icon, 24, col);
    c.restore();
    return at;
  }

  // =====================================================================
  //  ГЛАВНАЯ ФУНКЦИЯ: НАРИСОВАТЬ КАДР
  // =====================================================================
  R.draw = function (S, me, alpha, dt, t) {
    const c = ctx, map = S.map, P = S.players[me], myCol = CFG.COLORS[P.color];
    const lerp = (a, b) => a + (b - a) * alpha;
    const colOf = pid => CFG.COLORS[S.players[pid].color];

    // ---------- камера следует за героем ----------
    HY += (hyTarget - HY) * Math.min(1, dt * 9);
    const hero = P.hero, heroOk = hero && !hero.dead;
    let tx = cam.x, ty = cam.y;
    if (spec) { tx = spec.x; ty = spec.y; }                    // зритель сам двигает камеру
    else if (heroOk) { tx = lerp(hero.px, hero.x); ty = lerp(hero.py, hero.y); }
    else if (P.citadel && !P.citadel.dead) { tx = P.citadel.x; ty = P.citadel.y - 60; }
    const ck = Math.min(1, dt * (heroOk || spec ? 14 : 3));
    cam.x += (tx - cam.x) * ck; cam.y += (ty - cam.y) * ck;
    const halfW = W / 2 / zoom, upH = H * HY / (zoom * TILT), downH = H * (1 - HY) / (zoom * TILT);
    const lox = halfW - 70, hix = map.w - halfW + 70;         // камера почти не заглядывает за край карты
    cam.x = lox > hix ? map.w / 2 : clamp(cam.x, lox, hix);
    cam.y = clamp(cam.y, Math.min(upH - 70, map.h / 2), Math.max(map.h - downH + 70, map.h / 2));

    ox = W / 2 - cam.x * zoom; oy = H * HY - cam.y * TILT * zoom;
    const vx0 = cam.x - halfW - 70, vx1 = cam.x + halfW + 70;
    const vy0 = cam.y - upH - 50, vy1 = cam.y + downH + 200;   // снизу запас больше: высокие объекты «торчат» вверх
    const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
    const gz = dpr * zoom;
    const hx = heroOk ? tx : -9999, hy = heroOk ? ty : -9999;  // где наш герой (для подписей площадок)

    // ---------- земля ----------
    c.globalAlpha = 1;
    c.setTransform(gz, 0, 0, gz * TILT, dpr * ox, dpr * oy);  // «земляные» координаты (со сжатием по вертикали)
    c.fillStyle = grass; c.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    if (vx0 < 0 || vy0 < 0 || vx1 > map.w || vy1 > map.h) {   // за краем карты трава темнее — туда не пройти
      c.beginPath(); c.rect(vx0, vy0, vx1 - vx0, vy1 - vy0); c.rect(0, 0, map.w, map.h);
      c.fillStyle = 'rgba(16,58,28,0.55)'; c.fill('evenodd');
      c.strokeStyle = '#2f6e2f'; c.lineWidth = 14; c.strokeRect(0, 0, map.w, map.h);
    }

    // песочные дороги и площади (сначала тёмный край, потом светлая середина)
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      c.strokeStyle = c.fillStyle = pass ? '#eed79a' : '#d2b56f';
      c.lineWidth = pass ? 90 : 104;
      const grow = pass ? 0 : 7;
      for (const rd of map.roads) { c.beginPath(); c.moveTo(rd.x0, rd.y0); c.quadraticCurveTo(rd.cx, rd.cy, rd.x1, rd.y1); c.stroke(); }
      c.beginPath(); c.arc(map.cx, map.cy, 205 + grow, 0, TAU); c.fill();
      for (const b of map.bases) { c.beginPath(); c.arc(b.x, b.y, 328 + grow, 0, TAU); c.fill(); }
    }
    // вытоптанная земля в лагерях нейтралов
    for (const cp of map.camps) if (inView(cp.x, cp.y)) { c.beginPath(); c.arc(cp.x, cp.y, 82, 0, TAU); c.fillStyle = 'rgba(190,160,100,0.75)'; c.fill(); }

    // зоны обстрела: Цитадели — жирным кругом, Башни — тонким
    for (const b of S.buildings) {
      if (b.dead) continue;
      const atk = CFG.BUILDINGS[b.kind].atk;
      if (!atk) continue;
      const rg = atk.range[b.level - 1];
      if (b.x + rg < vx0 || b.x - rg > vx1 || b.y + rg < vy0 || b.y - rg > vy1) continue;
      const col = colOf(b.owner), big = b.kind === 'citadel';
      c.beginPath(); c.arc(b.x, b.y, rg, 0, TAU);
      if (big) {
        c.globalAlpha = 0.08; c.fillStyle = col.main; c.fill();
        c.globalAlpha = 0.3; c.strokeStyle = OUT; c.lineWidth = 7; c.stroke();
      }
      c.globalAlpha = big ? 0.9 : 0.55; c.strokeStyle = col.main; c.lineWidth = big ? 4 : 2.5;
      c.setLineDash(big ? [18, 13] : [8, 10]); c.lineDashOffset = -t * 14; c.stroke(); c.setLineDash([]);
      c.globalAlpha = 1;
    }

    // точка, где войску приказано держать позицию
    const holding = P.alive && P.cmd === 'hold' && P.hold;
    if (holding && inView(P.hold.x, P.hold.y)) {
      c.beginPath(); c.arc(P.hold.x, P.hold.y, 46, 0, TAU);
      c.globalAlpha = 0.16; c.fillStyle = myCol.main; c.fill();
      c.globalAlpha = 0.9; c.strokeStyle = myCol.main; c.lineWidth = 3.5; c.setLineDash([10, 8]); c.lineDashOffset = t * 12; c.stroke(); c.setLineDash([]);
      c.globalAlpha = 1;
    }
    // круги от приказов
    for (let i = rings.length - 1; i >= 0; i--) {
      const q = rings[i];
      q.t += dt / 0.6;
      if (q.t >= 1) { rings.splice(i, 1); continue; }
      c.globalAlpha = 1 - q.t; c.strokeStyle = '#fff'; c.lineWidth = 5 * (1 - q.t) + 1.5;
      c.beginPath(); c.arc(q.x, q.y, 30 + q.t * (q.big ? 330 : 150), 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;

    // площадки (круги на земле)
    for (const pad of S.pads) {
      if (pad.owner !== me || !inView(pad.x, pad.y)) continue;
      c.beginPath(); c.arc(pad.x, pad.y, pad.r, 0, TAU);
      c.fillStyle = pad.on ? 'rgba(70,45,15,0.5)' : 'rgba(70,45,15,0.3)'; c.fill();
      if (!pad.choice) {
        let total = 0, paid = 0;
        for (const r of Sim.RES) { total += pad.cost[r] || 0; paid += pad.paid[r]; }
        if (paid > 0) {                                         // сколько уже оплачено — жёлтый сектор
          c.beginPath(); c.moveTo(pad.x, pad.y); c.arc(pad.x, pad.y, pad.r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * paid / total); c.closePath();
          c.fillStyle = 'rgba(255,214,70,0.85)'; c.fill();
        }
      }
      c.beginPath(); c.arc(pad.x, pad.y, pad.r, 0, TAU);
      c.strokeStyle = 'rgba(46,34,24,0.55)'; c.lineWidth = 7; c.stroke();
      c.strokeStyle = (pad.blocked || (pad.on && pad.lack)) ? '#ff7a6b' : '#ffffff'; c.lineWidth = 4;
      c.setLineDash([12, 9]); c.lineDashOffset = pad.on ? -t * 34 : 0; c.stroke(); c.setLineDash([]);
    }

    // ---------- всё, что «стоит» на земле ----------
    c.setTransform(gz, 0, 0, gz, dpr * ox, dpr * oy);
    c.lineJoin = 'round';
    for (const d of map.decor) {
      if (!inView(d.x, d.y)) continue;
      c.save(); c.translate(d.x, d.y * TILT); D.decor(c, d); c.restore();
    }
    // иконки на площадках
    for (const pad of S.pads) {
      if (pad.owner !== me || !inView(pad.x, pad.y)) continue;
      c.save(); c.translate(pad.x, pad.y * TILT - 3 - Math.sin(t * 3 + pad.id) * 1.5);
      const ic = pad.kind === 'slot' ? 'plus' : pad.kind === 'hire' ? pad.what : pad.kind === 'upgrade' ? 'up' : pad.kind;
      D.icon(c, ic, pad.r + 2, myCol);
      c.restore();
    }
    if (holding && inView(P.hold.x, P.hold.y)) { c.save(); c.translate(P.hold.x, P.hold.y * TILT); D.holdFlag(c, myCol, t); c.restore(); }

    // собираем объекты и сортируем: кто выше на экране — тот рисуется раньше
    list.length = 0;
    for (const nd of S.nodes) if (inView(nd.x, nd.y)) list.push({ y: nd.y, x: nd.x, k: 0, o: nd });
    for (const b of S.buildings) if (!b.dead && inView(b.x, b.y)) list.push({ y: b.y, x: b.x, k: 1, o: b });
    for (const u of S.units) {
      if (u.dead) continue;
      const x = lerp(u.px, u.x), y = lerp(u.py, u.y);
      if (inView(x, y)) list.push({ y, x, k: 2, o: u });
    }
    for (const co of S.coins) {
      const x = lerp(co.px, co.x), y = lerp(co.py, co.y);
      if (inView(x, y)) list.push({ y, x, k: 3, o: co });
    }
    for (const f of map.fences) if (inView(f.x1, f.y1)) list.push({ y: Math.max(f.y1, f.y2), x: f.x1, k: 4, o: f });
    for (const cp of map.camps) if (inView(cp.x, cp.y)) list.push({ y: cp.y, x: cp.x, k: 5, o: cp });
    list.sort((a, b) => a.y - b.y);

    for (let i = 0; i < list.length; i++) {
      const e = list[i], o = e.o;
      c.save();
      c.translate(e.x, e.y * TILT);
      switch (e.k) {
        case 0:
          if (o.kind === 'tree') D.tree(c, o, CFG.NODES.tree.regrow); else D.ore(c, o, CFG.NODES.ore.regrow, t);
          break;
        case 1: {
          const col = colOf(o.owner), cit = o.kind === 'citadel';
          // если кто-то зашёл за здание — оно плавно становится полупрозрачным, чтобы бойцов было видно
          const tall = cit ? 104 : D.BLD[o.kind].h, wide = o.r - 4;
          let behind = false;
          for (const u of S.units) {
            if (u.dead) continue;
            const bk = (o.y - u.y) * TILT;
            if (bk > 2 && bk < tall && u.x > o.x - wide && u.x < o.x + wide) { behind = true; break; }
          }
          let fd = bFade[o.id] || 0;
          fd += ((behind ? 1 : 0) - fd) * Math.min(1, dt * 9);
          bFade[o.id] = fd;
          c.globalAlpha = 1 - fd * 0.55;
          if (cit) {
            D.citadel(c, o, col, t);
            c.globalAlpha = 1;
            D.text(c, String(Math.ceil(o.hp)), 0, -41, 20, '#fff');   // прочность — крупным числом прямо на башне
          } else {
            D.building(c, o, col, t, S.time - o.born);
            c.globalAlpha = 1;
            if (o.hp < o.maxHp) D.hpBar(c, -D.BLD[o.kind].h - 14, 44, o.hp / o.maxHp, col.light);
          }
          break;
        }
        case 2: {
          const k = o.kind;
          if (k === 'hero') {
            const pl = S.players[o.owner], col = CFG.COLORS[pl.color];
            D.hero(c, o, col, t, stackOf(pl));
            D.hpBar(c, -60, 30, o.hp / o.maxHp, o.owner === me ? '#5fe36a' : col.light);
            if (S.net && o.owner !== me) D.text(c, pl.name, 0, -73, 11.5, '#fff');   // в онлайне над чужими героями — имена
          } else if (k === 'grunt') {
            D.grunt(c, o, t);
            if (o.hp < o.maxHp) D.hpBar(c, HP_Y.grunt, 26, o.hp / o.maxHp, '#ffe14a');
          } else {
            const col = colOf(o.owner);
            D[k](c, o, col, t);
            if (o.hp < o.maxHp) D.hpBar(c, HP_Y[k], k === 'ram' ? 28 : 20, o.hp / o.maxHp, col.light);
          }
          break;
        }
        case 3: D.coin(c, o, t); break;
        case 4: D.fence(c, o.x2 - o.x1, (o.y2 - o.y1) * TILT, S.players[o.b].alive && S.players[o.b].palLevel > 0); break;
        case 5: D.chest(c); break;
      }
      c.restore();
    }

    // ---------- поверх объектов ----------
    // снаряды: шары Цитаделей и Башен летят с вершины по дуге, стрелы лучников — почти прямо
    for (const s of S.shots) {
      const tg = s.target;
      if (!tg) continue;
      const x = lerp(s.px, s.x), y = lerp(s.py, s.y);
      if (!inView(x, y)) continue;
      const done = Math.hypot(x - s.sx, y - s.sy), rest = Math.hypot(tg.x - x, tg.y - y), f = done / (done + rest + 0.001);
      const z = s.z0 * (1 - f) + 14 * f + Math.sin(f * Math.PI) * (s.k ? 14 : 26);
      const sy = y * TILT - z;
      if (s.k) {                                                // стрела
        const zp = s.z0 * (1 - f + 0.05) + 14 * (f - 0.05) + Math.sin((f - 0.05) * Math.PI) * 14;
        let dx = s.x - s.px, dy = (s.y - s.py) * TILT - (z - zp);
        const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        c.strokeStyle = OUT; c.lineWidth = 3.4; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x - dx * 9, sy - dy * 9); c.lineTo(x + dx * 5, sy + dy * 5); c.stroke();
        c.strokeStyle = '#f4e3b5'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x - dx * 9, sy - dy * 9); c.lineTo(x + dx * 4, sy + dy * 4); c.stroke();
      } else {
        const col = colOf(s.owner);
        c.globalAlpha = 0.35; c.beginPath(); c.arc(x, sy, 9, 0, TAU); c.fillStyle = col.light; c.fill(); c.globalAlpha = 1;
        c.beginPath(); c.arc(x, sy, 4.6, 0, TAU); D.fs(c, '#fff6bd', OUT, 2);
      }
    }

    // полоска прочности под Цитаделью
    for (const b of S.buildings) {
      if (b.kind !== 'citadel' || b.dead || !inView(b.x, b.y)) continue;
      c.save(); c.translate(b.x, b.y * TILT); D.hpBar(c, 27, 66, b.hp / b.maxHp, colOf(b.owner).main); c.restore();
    }

    // подписи площадок: название и сколько ещё нужно заплатить (только рядом с героем, чтобы не рябило)
    for (const pad of S.pads) {
      if (pad.owner !== me || !inView(pad.x, pad.y)) continue;
      const near = pad.on || Math.hypot(pad.x - hx, pad.y - hy) < 270;
      if (!near) continue;
      let lf = padLift[pad.id] || 0;
      lf += ((pad.on ? 1 : 0) - lf) * Math.min(1, dt * 10);
      padLift[pad.id] = lf;
      c.save(); c.translate(pad.x, pad.y * TILT - pad.r * TILT - 14 - lf * 48);
      const name = pad.kind === 'hire' ? CFG.UNITS[pad.what].name : pad.kind === 'upgrade' ? (pad.what === 'citadel' ? 'Укрепить' : 'Улучшить') : PAD_NAME[pad.kind];
      if (pad.choice) { D.text(c, name, 0, 0, 13, '#fff'); c.restore(); continue; }
      D.text(c, name, 0, -19, 13, '#fff');
      if (pad.blocked === 'cap') D.text(c, 'Лимит войска', 0, 0, 13, '#ff9a8c');
      else {
        let n = 0;
        for (const r of Sim.RES) if (Sim.need(pad, r) > 0) n++;
        let x = -(n * 46) / 2 + 9;
        for (const r of Sim.RES) {
          const nd = Sim.need(pad, r);
          if (nd <= 0) continue;
          c.save(); c.translate(x, 0); D.icon(c, r, 17); c.restore();
          D.text(c, String(nd), x + 11, 0.5, 16, P.res[r] >= nd ? '#fff' : '#ff8d80', 'left');   // красным — чего не хватает
          x += 46;
        }
      }
      c.restore();
    }

    // искры
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 420 * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.4; }
      if (!inView(p.x, p.y)) continue;
      c.globalAlpha = Math.min(1, p.life / 0.2);
      c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y * TILT - p.z, p.size, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;

    // ресурсы летят от героя к площадке при оплате
    for (let i = flies.length - 1; i >= 0; i--) {
      const f = flies[i];
      f.t += dt / 0.26;
      if (f.t >= 1) { flies.splice(i, 1); continue; }
      const x = f.x0 + (f.x1 - f.x0) * f.t, y = f.y0 + (f.y1 - f.y0) * f.t, z = 26 * (1 - f.t) + Math.sin(f.t * Math.PI) * 30;
      c.save(); c.translate(x, y * TILT - z); D.icon(c, f.res, 15); c.restore();
    }

    // всплывающие «+2»
    for (let i = texts.length - 1; i >= 0; i--) {
      const q = texts[i];
      q.life -= dt;
      if (q.life <= 0) { texts.splice(i, 1); continue; }
      q.z += 34 * dt;
      c.globalAlpha = Math.min(1, q.life / 0.3);
      c.save(); c.translate(q.x, q.y * TILT - q.z);
      c.save(); c.translate(-13, 0); D.icon(c, q.icon, q.size); c.restore();
      D.text(c, q.str, -2, 0.5, q.size, '#fff', 'left');
      c.restore();
    }
    c.globalAlpha = 1;

    // ---------- стрелки-указатели (в координатах экрана) ----------
    const baseHit = P.alive && S.time - P.underAttackT < 3;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineJoin = 'round';
    let objOff = null;
    if (objective) objOff = edgeArrow(c, objective.x, objective.y, '#ffd23f', objective.icon, myCol, false, t, 0);
    if (P.alive && P.citadel) {
      // если стрелка к базе попадает туда же, где стрелка-подсказка, сдвигаем её внутрь экрана
      const bx = P.citadel.x, by = P.citadel.y - 40;
      const q = objOff && edgeArrow(c, bx, by, '', '', myCol, false, t, 0, true);
      const clash = q && Math.hypot(q.x - objOff.x, q.y - objOff.y) < 58;
      edgeArrow(c, bx, by, baseHit ? '#ff4b3e' : myCol.main, 'citadel', myCol, baseHit, t, clash ? 48 : 0);
    }
    if (objective && !objOff && !objective.hide) {              // прыгающая стрелка над целью, если она на экране
      c.setTransform(gz, 0, 0, gz, dpr * ox, dpr * oy);
      c.save(); c.translate(objective.x, objective.y * TILT - objective.h - Math.abs(Math.sin(t * 5)) * 10);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(-11, -15); c.lineTo(-4.5, -15); c.lineTo(-4.5, -28); c.lineTo(4.5, -28); c.lineTo(4.5, -15); c.lineTo(11, -15); c.closePath();
      D.fs(c, '#ffd23f', OUT, 2.6);
      c.restore();
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
})();
