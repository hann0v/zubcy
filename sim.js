/* ============================================================
   «Зубцы» — симуляция игры: ВСЯ игровая логика живёт здесь.

   Этот файл ничего не рисует и не знает про экран. Он только
   считает: кто куда идёт, кто кого бьёт, сколько ресурсов и т.д.
   Сейчас он работает прямо в браузере, а на этапе 3 тот же
   самый файл будет работать на сервере (защита от читов).

   Игрок влияет на игру только двумя способами:
     1) джойстик:  player.input = { x, y }
     2) команды:   Sim.command(S, номерИгрока, { ... })
   ============================================================ */
(function (root) {
  'use strict';
  const ZB = root.ZB = root.ZB || {};
  const CFG = ZB.CFG;
  const RES = ['wood', 'iron', 'gold'];
  const UNIT_KINDS = Object.keys(CFG.UNITS);
  const TAU = Math.PI * 2;
  const TMP = { x: 0, y: 0 };   // временная точка, чтобы не создавать лишние объекты
  const ZERO = () => ({ wood: 0, iron: 0, gold: 0 });

  // Генератор случайных чисел с «зерном»: одно и то же зерно — одна и та же карта
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // =====================================================================
  //  КАРТА
  // =====================================================================
  function buildMap(n, seed) {
    const rnd = makeRng(seed);
    const two = n <= 2;
    const R = two ? 1050 : 1100 + n * 70;              // расстояние от центра карты до баз
    const w = two ? 1700 : R * 2 + 1300, h = R * 2 + 1300;
    const cx = w / 2, cy = h / 2;
    const map = { n, seed, w, h, cx, cy, bases: [], nodes: [], camps: [], roads: [], decor: [], fences: [] };

    // --- базы стоят по кругу; игрок 0 — внизу карты ---
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + i * TAU / n;
      const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
      const fx = -Math.cos(a), fy = -Math.sin(a);      // «вперёд» — в сторону центра карты
      const fa = Math.atan2(fy, fx);
      const slots = [];                                 // 8 мест под постройки вокруг Цитадели
      for (let k = 0; k < 8; k++) {
        const sa = fa + k * TAU / 8;
        slots.push({ x: x + Math.cos(sa) * CFG.SLOT_R, y: y + Math.sin(sa) * CFG.SLOT_R, a: sa });
      }
      map.bases.push({ x, y, fx, fy, fa, slots });

      // слегка изогнутая песочная дорога от базы к центру
      const lx = fy, ly = -fx;
      const bend = (rnd() - 0.5) * 260;
      const rd = {
        x0: x + fx * 60, y0: y + fy * 60,
        cx: (x + cx) / 2 + lx * bend, cy: (y + cy) / 2 + ly * bend,
        x1: cx, y1: cy, pts: [],
      };
      for (let t = 0; t <= 22; t++) {
        const u = t / 22, v = 1 - u;
        rd.pts.push({ x: v * v * rd.x0 + 2 * v * u * rd.cx + u * u * rd.x1, y: v * v * rd.y0 + 2 * v * u * rd.cy + u * u * rd.y1 });
      }
      map.roads.push(rd);
    }

    // --- нейтральные лагеря в центре (между дорогами) ---
    const nc = Math.max(2, n), cr = two ? 330 : 400;
    for (let i = 0; i < nc; i++) {
      const a = Math.PI / 2 + (i + 0.5) * TAU / nc;
      const x = cx + Math.cos(a) * cr, y = cy + Math.sin(a) * cr, spots = [];
      for (let k = 0; k < 3; k++) {
        const sa = a + k * TAU / 3;
        spots.push({ x: x + Math.cos(sa) * 38, y: y + Math.sin(sa) * 38 });
      }
      map.camps.push({ x, y, spots });
    }

    // --- деревья и руда ---
    const hit = (x, y, arr, gap) => {
      for (const q of arr) { const dx = q.x - x, dy = q.y - y; if (dx * dx + dy * dy < gap * gap) return true; }
      return false;
    };
    const nearRoad = (x, y, gap) => { for (const rd of map.roads) if (hit(x, y, rd.pts, gap)) return true; return false; };
    function put(kind, x, y, gap, baseGap) {
      if (x < 60 || y < 60 || x > w - 60 || y > h - 60) return false;
      if (hit(x, y, map.nodes, gap) || hit(x, y, map.bases, baseGap) || hit(x, y, map.camps, 135)) return false;
      if (nearRoad(x, y, 84)) return false;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < 225 * 225) return false;   // центральная площадь остаётся свободной
      map.nodes.push({ kind, x, y, v: rnd() });
      return true;
    }
    function cluster(kind, x0, y0, rad, count, gap, baseGap) {
      for (let t = 0, done = 0; t < count * 15 && done < count; t++) {
        const a = rnd() * TAU, d = Math.sqrt(rnd()) * rad;
        if (put(kind, x0 + Math.cos(a) * d, y0 + Math.sin(a) * d, gap, baseGap)) done++;
      }
    }
    for (const b of map.bases) {
      const lx = b.fy, ly = -b.fx;                       // «влево» от базы
      cluster('tree', b.x + lx * 450, b.y + ly * 450, 105, 10, 54, 340);   // роща слева от базы
      cluster('ore', b.x - lx * 440, b.y - ly * 440, 90, 6, 72, 340);      // руда справа от базы
      const mx = b.x + b.fx * R * 0.48, my = b.y + b.fy * R * 0.48;        // запасы на полпути к центру
      cluster('ore', mx + lx * 300, my + ly * 300, 80, 4, 72, 350);
      cluster('tree', mx - lx * 300, my - ly * 300, 100, 8, 54, 350);
    }
    const area = w * h;
    for (let i = 0, m = Math.floor(area / 30000); i < m; i++) put('tree', 60 + rnd() * (w - 120), 60 + rnd() * (h - 120), 62, 365);
    for (let i = 0, m = Math.floor(area / 260000); i < m; i++) put('ore', 60 + rnd() * (w - 120), 60 + rnd() * (h - 120), 95, 365);

    // --- украшения (только для красоты, на игру не влияют) ---
    const drnd = makeRng(seed ^ 0x5bd1e995);
    for (let i = 0, m = Math.floor(area / 6500); i < m; i++) {
      const x = drnd() * w, y = drnd() * h, k = Math.floor(drnd() * 6), v = drnd();
      const dx = x - cx, dy = y - cy;
      const onSand = hit(x, y, map.bases, 335) || nearRoad(x, y, 52) || dx * dx + dy * dy < 215 * 215;
      if (onSand && k !== 5) continue;                   // на песке — только камешки
      map.decor.push({ x, y, k, v });
    }
    // заборы вокруг баз; разрывы — выходы к дороге, к лесу и к руде
    map.bases.forEach((b, bi) => {
      const arcs = [[0.5, 1.2], [1.95, 4.33], [5.08, 5.78]];
      for (const arc of arcs) {
        const steps = Math.max(1, Math.round((arc[1] - arc[0]) / 0.2));
        for (let s = 0; s < steps; s++) {
          const u0 = b.fa + arc[0] + (arc[1] - arc[0]) * s / steps;
          const u1 = b.fa + arc[0] + (arc[1] - arc[0]) * (s + 1) / steps;
          map.fences.push({
            b: bi,
            x1: b.x + Math.cos(u0) * CFG.BASE_R, y1: b.y + Math.sin(u0) * CFG.BASE_R,
            x2: b.x + Math.cos(u1) * CFG.BASE_R, y2: b.y + Math.sin(u1) * CFG.BASE_R,
          });
        }
      }
    });
    return map;
  }

  // =====================================================================
  //  СОЗДАНИЕ МАТЧА
  // =====================================================================
  // Готовые «планы застройки» для ботов — у каждого бота свой путь развития
  const BOT_PLANS = [
    ['barracks', 'sawmill', 'range', 'mine', 'forge', 'tower', 'stable', 'workshop'],
    ['sawmill', 'barracks', 'mine', 'range', 'tower', 'forge', 'stable', 'palisade'],
    ['barracks', 'range', 'sawmill', 'tower', 'mine', 'stable', 'forge', 'workshop'],
  ];
  // Какие места бот предпочитает: лесопилка — ближе к лесу, рудник — к руде, башня — спереди
  const BOT_SLOTS = { sawmill: [6, 5, 7], mine: [2, 3, 1], tower: [0, 1, 7], palisade: [4, 3, 5] };
  const BOT_SLOT_ANY = [1, 7, 0, 2, 6, 3, 5, 4];
  const HIRE_W = { sword: 0.42, archer: 0.36, rider: 0.22, ram: 0 };   // каким бот хочет видеть состав войска

  // Сетка, чтобы быстро искать деревья и руду рядом (нужна и серверу, и клиенту)
  function buildGrid(S) {
    const cs = 100, map = S.map;
    S.gcs = cs; S.gw = Math.ceil(map.w / cs); S.gh = Math.ceil(map.h / cs);
    S.grid = new Array(S.gw * S.gh);
    for (const nd of S.nodes) {
      const k = Math.floor(nd.y / cs) * S.gw + Math.floor(nd.x / cs);
      (S.grid[k] || (S.grid[k] = [])).push(nd);
    }
  }

  // opts = { seed, players: [{ name, color, team, isBot, botLevel }] }
  function createGame(opts) {
    const list = opts.players;
    const seed = opts.seed || 12345;
    const map = buildMap(list.length, seed);
    const S = {
      map, time: 0, timeLeft: CFG.MATCH_TIME, tick: 0,
      over: false, winnerTeam: -1, reason: '',
      players: [], units: [], buildings: [], nodes: [], pads: [], coins: [], shots: [], camps: [],
      pals: [],              // базы с Частоколом (там враги замедляются)
      nodeDirty: [],         // номера деревьев и руды, у которых изменился запас (их рассылает сервер)
      events: [],            // «что случилось за шаг» — по ним экран рисует эффекты
      nextId: 1, rnd: makeRng(seed ^ 0x9e3779b9), dirty: false,
    };

    // деревья и руда + сетка, чтобы быстро искать препятствия рядом
    for (const nd of map.nodes) {
      const def = CFG.NODES[nd.kind];
      S.nodes.push({ id: S.nextId++, i: S.nodes.length, kind: nd.kind, x: nd.x, y: nd.y, v: nd.v, r: def.r, left: def.amount, max: def.amount, regrowT: 0, shake: 0 });
    }
    buildGrid(S);

    list.forEach((po, i) => addPlayer(S, po, i));

    map.camps.forEach((c, ci) => {
      const camp = { id: ci, x: c.x, y: c.y, spots: c.spots.map(s => ({ x: s.x, y: s.y, unit: null, respawnT: 0 })) };
      S.camps.push(camp);
      for (const sp of camp.spots) spawnGrunt(S, camp, sp);
    });
    return S;
  }

  function addPlayer(S, po, i) {
    const base = S.map.bases[i];
    const L = CFG.BOT.LEVELS[po.botLevel || CFG.BOT.level] || CFG.BOT.LEVELS.normal;
    const p = {
      id: i,
      name: po.name || ('Игрок ' + (i + 1)),
      color: po.color != null ? po.color : i,
      team: po.team != null ? po.team : i,
      isBot: !!po.isBot,
      alive: true,
      res: { wood: CFG.START_RES.wood, iron: CFG.START_RES.iron, gold: CFG.START_RES.gold },
      armyCap: CFG.ARMY_CAP_BASE, armyUsed: 0, army: [], buildings: [],
      up: {},                      // улучшения Кузницы: up.sword.dmg = 0..3 и т.д.
      slow: 0, armor: 0, palLevel: 0,   // что даёт Частокол
      input: { x: 0, y: 0 },      // куда игрок тянет джойстик
      cmd: 'follow',               // приказ войску: follow / hold / attack
      hold: null,                  // точка для приказа «Держать позицию»
      heading: base.fa,            // куда «смотрит» строй войска
      base, hero: null, citadel: null,
      respawnT: 0, underAttackT: -99, alertT: -99,
      bot: { L, thinkT: 0.6 + i * 0.13, idleT: 0, mode: '', task: 'mine', goal: null, gt: '', node: null, skip: null, camp: null,
             wave: L.firstWave, lastCamp: -99, stuckT: 0, sideT: 0, side: 1, wasDead: false,
             plan: BOT_PLANS[Math.floor(S.rnd() * BOT_PLANS.length)] },
    };
    for (const k of UNIT_KINDS) p.up[k] = { dmg: 0, hp: 0, spd: 0 };
    S.players.push(p);
    p.citadel = addBuilding(S, p, 'citadel', base.x, base.y, -1);
    spawnHero(S, p);
    for (let k = 0; k < 8; k++) addSlotPad(S, p, k);                  // 8 свободных мест под постройки
    // площадка «Укрепить Цитадель» — перед башней
    makePad(S, p, 'upgrade', 'citadel', -1, p.citadel, base.x - 58, base.y + 112, 26, CFG.BUILDINGS.citadel.upgrades[0]);
    return p;
  }

  function addUnit(S, kind, owner, x, y) {
    const def = kind === 'hero' ? CFG.HERO : kind === 'worker' ? CFG.WORKER : (CFG.UNITS[kind] || CFG.NEUTRAL[kind]);
    const u = {
      id: S.nextId++, kind, owner, team: owner >= 0 ? S.players[owner].team : -1,
      x, y, px: x, py: y, vx: 0, vy: 0, spd: 0, moving: false,
      hp: def.hp, maxHp: def.hp, r: def.r, speed: def.speed,
      dmg: def.dmg || 0, cd: def.cd || 1, range: def.range || 0, aggro: def.aggro || 0,
      bld: def.bld == null ? 1 : def.bld, shot: def.shot || 0, onlyB: !!def.onlyB, capUse: def.cap || 0,
      cdT: 0, retT: S.rnd() * 0.25, harvT: 0, target: null, slot: 0,
      face: 1, atkAnim: 0, hurtT: 0, lastHurt: -99, dead: false,
      an: 0, hn: 0,              // счётчики ударов и ранений — по ним клиент в сети показывает анимацию
    };
    S.units.push(u);
    return u;
  }

  // Характеристики бойца с учётом улучшений Кузницы
  function applyStats(p, u) {
    const d = CFG.UNITS[u.kind], up = p.up[u.kind], F = CFG.FORGE.stats;
    const mh = Math.round(d.hp * (1 + F.hp.per * up.hp));
    u.hp = u.hp / u.maxHp * mh; u.maxHp = mh;
    u.dmg = d.dmg * (1 + F.dmg.per * up.dmg);
    u.speed = d.speed * (1 + F.spd.per * up.spd);
  }

  function spawnHero(S, p) {
    const b = p.base;
    // герой появляется «перед» башней на экране, чтобы она его не загораживала
    const h = addUnit(S, 'hero', p.id, b.x + 58, b.y + 112);
    p.hero = h; p.heading = b.fa;
    return h;
  }

  function spawnGrunt(S, camp, sp) {
    const u = addUnit(S, 'grunt', -1, sp.x, sp.y);
    u.home = { x: sp.x, y: sp.y }; u.spot = sp; u.camp = camp; u.back = false;
    sp.unit = u;
    return u;
  }

  function spawnWorker(S, b) {
    const def = CFG.BUILDINGS[b.kind];
    const a = S.rnd() * TAU;
    const u = addUnit(S, 'worker', b.owner, b.x + Math.cos(a) * (b.r + 12), b.y + Math.sin(a) * (b.r + 12));
    u.home = b; u.nodeKind = def.node; u.res = CFG.NODES[def.node].res;
    u.state = 'go'; u.node = null; u.load = 0; u.workT = 0;
    b.workers.push(u);
    return u;
  }

  const maxHpOf = (def, level) => def.hpL ? def.hpL[level - 1] : Math.round(def.hp * (1 + 0.35 * (level - 1)));

  function addBuilding(S, p, kind, x, y, slot) {
    const def = CFG.BUILDINGS[kind], hp = maxHpOf(def, 1);
    const b = {
      id: S.nextId++, isB: true, kind, owner: p.id, team: p.team,
      x, y, r: def.r, hp, maxHp: hp, level: 1, slot,
      cdT: 0, hurtT: 0, lastHurt: -99, dead: false, born: S.time,
      workers: [], spawnT: 1.2,
    };
    S.buildings.push(b); p.buildings.push(b);
    return b;
  }

  // ---------------------------------------------------------------------
  // Площадки на земле. Виды:
  //   slot    — свободное место: встал → выбираешь постройку в панели
  //   hire    — найм бойца: стоишь → ресурсы списываются → появляется боец
  //   upgrade — улучшение здания (или Цитадели)
  //   forge   — Кузница: выбор улучшения войск в панели
  //   trade   — Рынок: выбор обмена в панели
  // У площадок с выбором (choice) цены нет: платишь нажатием на карточку.
  // ---------------------------------------------------------------------
  function makePad(S, p, kind, what, slot, bld, x, y, r, cost) {
    const pad = {
      id: S.nextId++, owner: p.id, kind, what, slot, bld: bld || null,
      x, y, r, cost: cost || null, choice: !cost, paid: ZERO(),
      dwell: 0, cdT: 0.4, acc: 0, on: false, lack: false, blocked: '', dead: false,
    };
    S.pads.push(pad);
    return pad;
  }
  function addSlotPad(S, p, slot) {
    const s = p.base.slots[slot];
    return makePad(S, p, 'slot', null, slot, null, s.x, s.y, 34, null);
  }
  function addBuildingPads(S, p, b) {
    const def = CFG.BUILDINGS[b.kind], base = p.base, s = base.slots[b.slot];
    const at = off => ({ x: base.x + Math.cos(s.a + off) * CFG.PAD_R, y: base.y + Math.sin(s.a + off) * CFG.PAD_R });
    const act = def.unit ? 'hire' : def.forge ? 'forge' : def.trade ? 'trade' : null;
    if (act) {
      const q = at(-0.14);
      makePad(S, p, act, def.unit || b.kind, b.slot, b, q.x, q.y, 30, def.unit ? CFG.UNITS[def.unit].cost : null);
    }
    if (def.upgrades && def.upgrades.length) {
      const q = at(act ? 0.14 : 0);
      makePad(S, p, 'upgrade', b.kind, b.slot, b, q.x, q.y, 30, def.upgrades[0]);
    }
  }

  const need = (pad, r) => (pad.cost[r] || 0) - pad.paid[r];
  function canPay(p, pad) { for (const r of RES) if (p.res[r] < need(pad, r)) return false; return true; }
  function payable(p, cost) { for (const r of RES) if (p.res[r] < (cost[r] || 0)) return false; return true; }
  function pay(p, cost) { if (!payable(p, cost)) return false; for (const r of RES) p.res[r] -= cost[r] || 0; return true; }
  function findPad(S, p, kind) { for (const q of S.pads) if (q.owner === p.id && q.kind === kind && !q.dead) return q; return null; }
  function findBuilding(p, kind) { for (const b of p.buildings) if (b.kind === kind && !b.dead) return b; return null; }
  function countBuildings(p, kind) { let n = 0; for (const b of p.buildings) if (b.kind === kind && !b.dead) n++; return n; }
  // Можно ли построить ещё одно такое здание (большинство — только в одном экземпляре)
  function canBuild(p, kind) {
    const def = CFG.BUILDINGS[kind];
    return !!def && !!def.cost && countBuildings(p, kind) < (def.max || 1);
  }

  // Пересчёт всего, что зависит от набора зданий: лимит войска и Частокол
  function recalc(S, p) {
    let cap = CFG.ARMY_CAP_BASE, pal = 0;
    for (const b of p.buildings) {
      if (b.dead) continue;
      const d = CFG.BUILDINGS[b.kind];
      if (d.cap) cap += d.cap[b.level - 1];
      if (d.slow && b.level > pal) pal = b.level;
    }
    p.armyCap = Math.min(CFG.ARMY_CAP_MAX, cap);
    const pd = CFG.BUILDINGS.palisade;
    p.palLevel = pal; p.slow = pal ? pd.slow[pal - 1] : 0; p.armor = pal ? pd.armor[pal - 1] : 0;
    S.pals = [];
    for (const q of S.players) if (q.alive && q.slow > 0) S.pals.push({ x: q.base.x, y: q.base.y, team: q.team, slow: q.slow });
  }

  // =====================================================================
  //  ДВИЖЕНИЕ И СТОЛКНОВЕНИЯ
  // =====================================================================
  // Замедление на чужой базе с Частоколом
  function slowAt(S, u) {
    let f = 1;
    for (const q of S.pals) {
      if (q.team === u.team) continue;
      const dx = u.x - q.x, dy = u.y - q.y;
      if (dx * dx + dy * dy < CFG.BASE_R * CFG.BASE_R && 1 - q.slow < f) f = 1 - q.slow;
    }
    return f;
  }

  function moveTo(S, u, tx, ty, dt, slow) {
    const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
    if (d < 1.5) { u.vx = 0; u.vy = 0; return; }
    let sp = u.speed;
    if (S.pals.length) sp *= slowAt(S, u);
    if (slow) sp = Math.min(sp, d * 6);                 // плавно тормозим у цели
    u.vx = dx / d * sp; u.vy = dy / d * sp;
    u.x += u.vx * dt; u.y += u.vy * dt;
    if (Math.abs(u.vx) > 10) u.face = u.vx > 0 ? 1 : -1;
  }

  // Выталкиваем из круглого препятствия и даём «соскользнуть» вбок, чтобы не упираться лбом
  function pushOut(u, ox, oy, rr, dt) {
    let dx = u.x - ox, dy = u.y - oy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    let d = Math.sqrt(d2);
    if (d < 0.001) { dx = 1; dy = 0; d = 1; }
    const nx = dx / d, ny = dy / d;
    u.x = ox + nx * rr; u.y = oy + ny * rr;
    const sp = Math.hypot(u.vx, u.vy);
    if (sp > 1) {
      const dot = (u.vx * nx + u.vy * ny) / sp;
      if (dot < -0.5) {
        const tx = -ny, ty = nx;
        let side = (u.vx * tx + u.vy * ty) / sp;
        if (Math.abs(side) < 0.2) side = (u.id & 1) ? 1 : -1;
        const k = sp * dt * 0.85 * -dot * (side > 0 ? 1 : -1);
        u.x += tx * k; u.y += ty * k;
      }
    }
  }

  function collideStatic(S, u, dt) {
    for (const b of S.buildings) if (!b.dead) pushOut(u, b.x, b.y, b.r + u.r * 0.6, dt);
    const cs = S.gcs, gx = Math.floor(u.x / cs), gy = Math.floor(u.y / cs);
    for (let iy = gy - 1; iy <= gy + 1; iy++) {
      if (iy < 0 || iy >= S.gh) continue;
      for (let ix = gx - 1; ix <= gx + 1; ix++) {
        if (ix < 0 || ix >= S.gw) continue;
        const cell = S.grid[iy * S.gw + ix];
        if (cell) for (const nd of cell) pushOut(u, nd.x, nd.y, nd.r + u.r * 0.6, dt);
      }
    }
    const m = 30, w = S.map.w, h = S.map.h;
    if (u.x < m) u.x = m; else if (u.x > w - m) u.x = w - m;
    if (u.y < m) u.y = m; else if (u.y > h - m) u.y = h - m;
  }

  // Бойцы не стоят друг в друге
  function separate(S) {
    const us = S.units, n = us.length;
    for (let i = 0; i < n; i++) {
      const a = us[i];
      if (a.dead) continue;
      for (let j = i + 1; j < n; j++) {
        const b = us[j];
        if (b.dead) continue;
        const rr = (a.r + b.r) * 0.85;
        const dx = b.x - a.x;
        if (dx >= rr || dx <= -rr) continue;
        const dy = b.y - a.y;
        if (dy >= rr || dy <= -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2);
        let nx = 1, ny = 0;
        if (d > 0.02) { nx = dx / d; ny = dy / d; } else { const an = (a.id * 2.399) % TAU; nx = Math.cos(an); ny = Math.sin(an); }
        const wa = a.kind === 'hero' ? 0.15 : 1, wb = b.kind === 'hero' ? 0.15 : 1;   // героя почти не толкают
        const push = (rr - d) / (wa + wb);
        a.x -= nx * push * wa; a.y -= ny * push * wa;
        b.x += nx * push * wb; b.y += ny * push * wb;
      }
    }
  }

  // Место бойца в строю. (ax, ay) — точка, за которой строится войско, head — куда смотрит строй.
  function slotPos(k, n, ax, ay, head) {
    const cols = n <= 12 ? 4 : n <= 25 ? 5 : 6;
    const row = Math.floor(k / cols), col = k % cols;
    const inRow = Math.min(cols, n - row * cols);
    const back = 44 + row * 28, lat = (col - (inRow - 1) / 2) * 28;
    const ca = Math.cos(head), sa = Math.sin(head);
    TMP.x = ax - ca * back - sa * lat;
    TMP.y = ay - sa * back + ca * lat;
    return TMP;
  }

  // =====================================================================
  //  БОЙ
  // =====================================================================
  // Ближайший враг в пределах range (от края до края).
  // mode: 0 — сначала бойцы, потом здания; 1 — только бойцы; 2 — только здания (таран).
  // Если задан «якорь» (ax, ay) и привязь leash — враги дальше привязи от якоря не считаются.
  function findEnemy(S, u, range, mode, ax, ay, leash) {
    let best = null, bd = range;
    const tied = leash != null;
    if (mode !== 2) {
      for (const o of S.units) {
        if (o.dead || o.team === u.team) continue;
        const dx = o.x - u.x, dy = o.y - u.y;
        const lim = bd + o.r + u.r;
        if (dx > lim || dx < -lim || dy > lim || dy < -lim) continue;
        const d = Math.sqrt(dx * dx + dy * dy) - o.r - u.r;
        if (d >= bd) continue;
        if (tied && Math.hypot(o.x - ax, o.y - ay) - o.r > leash) continue;
        bd = d; best = o;
      }
      if (best || mode === 1) return best;
    }
    for (const b of S.buildings) {
      if (b.dead || b.team === u.team) continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y) - b.r - u.r;
      if (d >= bd) continue;
      if (tied && Math.hypot(b.x - ax, b.y - ay) - b.r > leash) continue;
      bd = d; best = b;
    }
    return best;
  }

  // Урон с учётом того, кто кого бьёт сильнее
  function dmgVs(u, t) {
    if (t.isB) return u.dmg * u.bld;
    const c = CFG.COUNTER[u.kind];
    return c && c[t.kind] ? u.dmg * c[t.kind] : u.dmg;
  }

  function strike(S, u, t) {
    u.cdT = u.cd; u.atkAnim = 0.25; u.an = (u.an + 1) & 255;
    if (t.x !== u.x) u.face = t.x > u.x ? 1 : -1;
    const dmg = dmgVs(u, t);
    if (u.shot) {                                         // стрелок выпускает стрелу
      S.shots.push({ id: 0, x: u.x, y: u.y, px: u.x, py: u.y, sx: u.x, sy: u.y, z0: 24, k: 1, owner: u.owner, target: t, dmg, speed: u.shot, dead: false });
      S.events.push({ t: 'shot', k: 1, owner: u.owner, x: u.x, y: u.y, z0: 24, speed: u.shot, tid: t.id, tb: !!t.isB });
    } else damage(S, t, dmg);
  }

  function damage(S, t, dmg) {
    if (t.dead) return;
    if (t.isB) {
      const p = S.players[t.owner];
      dmg *= 1 - p.armor;                                 // Частокол делает здания крепче
      p.underAttackT = S.time;
      if (S.time - p.alertT > 5) { p.alertT = S.time; S.events.push({ t: 'alert', pid: p.id }); }
    }
    t.hp -= dmg; t.hurtT = 0.12; t.lastHurt = S.time; t.hn = ((t.hn || 0) + 1) & 255;
    S.events.push({ t: 'hit', x: t.x, y: t.y, b: !!t.isB });
    if (t.hp <= 0) { t.hp = 0; kill(S, t); }
  }

  function kill(S, t) {
    if (t.dead) return;
    t.dead = true; S.dirty = true;
    if (t.isB) {
      const p = S.players[t.owner];
      S.events.push({ t: 'crash', x: t.x, y: t.y, kind: t.kind, pid: t.owner });
      if (t.kind === 'citadel') { eliminate(S, p); return; }
      // обычное здание разрушено: место освобождается, можно построить заново
      const i = p.buildings.indexOf(t);
      if (i >= 0) p.buildings.splice(i, 1);
      for (const pad of S.pads) if (pad.bld === t) pad.dead = true;
      for (const w of t.workers) if (!w.dead) { w.dead = true; S.events.push({ t: 'die', x: w.x, y: w.y, kind: 'worker', pid: p.id }); }
      t.workers.length = 0;
      addSlotPad(S, p, t.slot);
      recalc(S, p);
      return;
    }
    S.events.push({ t: 'die', x: t.x, y: t.y, kind: t.kind, pid: t.owner });
    let gold = 0;
    if (t.kind === 'hero') {
      S.players[t.owner].respawnT = CFG.HERO.respawn;
      gold = CFG.HERO.gold;
    } else if (t.kind === 'worker') {
      const i = t.home.workers.indexOf(t);
      if (i >= 0) t.home.workers.splice(i, 1);
      t.home.spawnT = CFG.WORKER.respawn;
      gold = CFG.WORKER.gold;
    } else if (t.owner >= 0) {
      const p = S.players[t.owner], i = p.army.indexOf(t);
      if (i >= 0) p.army.splice(i, 1);
      gold = CFG.UNITS[t.kind].gold;
    } else {
      const def = CFG.NEUTRAL[t.kind];
      gold = def.gold;
      if (t.spot) { t.spot.unit = null; t.spot.respawnT = def.respawn; }
    }
    dropGold(S, t.x, t.y, gold);
  }

  // С убитых падают монеты
  function dropGold(S, x, y, gold) {
    if (gold <= 0) return;
    const n = Math.min(5, Math.max(1, Math.round(gold / 3)));
    let left = gold;
    for (let i = 0; i < n; i++) {
      const amt = i === n - 1 ? left : Math.floor(gold / n);
      left -= amt;
      const a = S.rnd() * TAU, sp = 50 + S.rnd() * 80;
      S.coins.push({ id: S.nextId++, x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, amount: amt, ttl: 40, age: 0, dead: false });
    }
  }

  // Цитадель разрушена — игрок выбывает
  function eliminate(S, p) {
    p.alive = false; p.respawnT = 0;
    for (const u of S.units) if (u.owner === p.id && !u.dead) { u.dead = true; S.events.push({ t: 'die', x: u.x, y: u.y, kind: u.kind, pid: p.id }); }
    for (const b of S.buildings) if (b.owner === p.id && !b.dead) { b.dead = true; S.events.push({ t: 'crash', x: b.x, y: b.y, kind: b.kind, pid: p.id }); }
    for (const pad of S.pads) if (pad.owner === p.id) pad.dead = true;
    p.army.length = 0; p.buildings.length = 0; p.armyUsed = 0;
    S.dirty = true;
    recalc(S, p);
    S.events.push({ t: 'out', pid: p.id });
    checkWin(S);
  }

  function checkWin(S) {
    let team = -1, many = false;
    for (const p of S.players) if (p.alive) { if (team === -1) team = p.team; else if (team !== p.team) many = true; }
    if (!many) { S.over = true; S.reason = 'citadel'; S.winnerTeam = team === -1 ? -2 : team; S.events.push({ t: 'over' }); }
  }

  // Время вышло: побеждает самая целая Цитадель
  function timeUp(S) {
    let best = -1, bestP = null, tie = false;
    for (const p of S.players) {
      if (!p.alive) continue;
      const f = p.citadel.hp / p.citadel.maxHp;
      if (f > best + 1e-9) { best = f; bestP = p; tie = false; }
      else if (Math.abs(f - best) <= 1e-9 && bestP && bestP.team !== p.team) tie = true;
    }
    S.over = true; S.reason = 'time';
    S.winnerTeam = tie || !bestP ? -2 : bestP.team;      // -2 означает ничью
    S.events.push({ t: 'over' });
  }

  // =====================================================================
  //  ГЕРОЙ
  // =====================================================================
  function updateHero(S, p, h, dt) {
    let ix = p.input.x, iy = p.input.y;
    const m = Math.hypot(ix, iy);
    if (m > 1) { ix /= m; iy /= m; }
    const sp = h.speed * (S.pals.length ? slowAt(S, h) : 1);
    h.vx = ix * sp; h.vy = iy * sp;
    h.x += h.vx * dt; h.y += h.vy * dt;
    if (m > 0.15) {
      // строй плавно поворачивается вслед за героем
      let d = Math.atan2(iy, ix) - p.heading;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      p.heading += d * Math.min(1, dt * 6);
      if (Math.abs(ix) > 0.12) h.face = ix > 0 ? 1 : -1;
    }

    h.cdT -= dt; h.harvT -= dt;
    const foe = findEnemy(S, h, h.range, 0);
    if (foe) { if (h.cdT <= 0) strike(S, h, foe); }         // герой сам бьёт врагов рядом
    else if (h.spd < 40 && h.harvT <= 0) harvest(S, p, h);   // а когда стоит — сам добывает

    // лечение: быстро у своей Цитадели, медленно — вне боя
    if (h.hp < h.maxHp) {
      const home = Math.hypot(h.x - p.citadel.x, h.y - p.citadel.y) < 260;
      const calm = S.time - h.lastHurt > 5;
      h.hp = Math.min(h.maxHp, h.hp + (home ? (calm ? 30 : 6) : (calm ? 5 : 0)) * dt);
    }
  }

  function harvest(S, p, h) {
    const cs = S.gcs, gx = Math.floor(h.x / cs), gy = Math.floor(h.y / cs);
    let best = null, bd = CFG.HERO.harvestReach;
    for (let iy = gy - 1; iy <= gy + 1; iy++) {
      if (iy < 0 || iy >= S.gh) continue;
      for (let ix = gx - 1; ix <= gx + 1; ix++) {
        if (ix < 0 || ix >= S.gw) continue;
        const cell = S.grid[iy * S.gw + ix];
        if (!cell) continue;
        for (const nd of cell) {
          if (nd.left <= 0) continue;
          const d = Math.hypot(nd.x - h.x, nd.y - h.y) - nd.r - h.r;
          if (d < bd) { bd = d; best = nd; }
        }
      }
    }
    if (!best) return;
    const def = CFG.NODES[best.kind];
    const n = Math.min(def.per, best.left);
    best.left -= n; best.shake = 0.3; S.nodeDirty.push(best.i);
    if (best.left <= 0) best.regrowT = def.regrow;
    p.res[def.res] += n;
    h.harvT = CFG.HERO.harvestCd * (p.isBot ? p.bot.L.harvest : 1);   // бот добывает чуть медленнее человека
    h.atkAnim = 0.25; h.an = (h.an + 1) & 255;
    if (best.x !== h.x) h.face = best.x > h.x ? 1 : -1;
    S.events.push({ t: 'chop', pid: p.id, res: def.res, n, ni: best.i, x: best.x, y: best.y, hx: h.x, hy: h.y });
  }

  // =====================================================================
  //  ВОЙСКО, РАБОЧИЕ И НЕЙТРАЛЫ
  // =====================================================================
  function chase(S, u, t, dt) {
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d - t.r - u.r <= u.range) { u.vx = 0; u.vy = 0; if (u.cdT <= 0) strike(S, u, t); }
    else moveTo(S, u, t.x, t.y, dt, false);
  }

  function updateSoldier(S, u, dt) {
    const p = S.players[u.owner], hero = p.hero, cmd = p.cmd;
    u.cdT -= dt; u.retT -= dt;

    // «якорь» — точка, у которой держится войско, и то, как далеко от неё можно отходить
    let ax, ay, head = p.heading, leash;
    if (cmd === 'hold' && p.hold) { ax = p.hold.x; ay = p.hold.y; head = p.hold.a; leash = CFG.HOLD_LEASH; }
    else if (!hero.dead) { ax = hero.x; ay = hero.y; leash = cmd === 'attack' ? CFG.CHARGE_R : CFG.LEASH; }
    else { ax = p.base.x + p.base.fx * 150; ay = p.base.y + p.base.fy * 150; head = p.base.fa; leash = CFG.LEASH; }   // героя нет — ждём у Цитадели

    let t = u.target;
    if (t && t.dead) t = u.target = null;
    if (t && Math.hypot(t.x - ax, t.y - ay) - t.r > leash + 30) t = u.target = null;
    if (u.retT <= 0) {
      u.retT = 0.25;
      // по приказу «В атаку» бойцы сами бросаются на любого врага в большом радиусе вокруг героя
      const nt = findEnemy(S, u, cmd === 'attack' ? CFG.CHARGE_R + 220 : u.aggro, u.onlyB ? 2 : 0, ax, ay, leash);
      if (nt) t = u.target = nt;
    }
    if (t) { chase(S, u, t, dt); return; }

    // врагов рядом нет — идём на своё место в строю
    const pos = slotPos(u.slot, p.army.length, ax, ay, head);
    moveTo(S, u, pos.x, pos.y, dt, true);

    // у своей Цитадели бойцы понемногу лечатся
    if (u.hp < u.maxHp && S.time - u.lastHurt > 5 &&
        Math.hypot(u.x - p.citadel.x, u.y - p.citadel.y) < 260) {
      u.hp = Math.min(u.maxHp, u.hp + 8 * dt);
    }
  }

  // Рабочий: идёт к дереву/руде → добывает → несёт домой → и снова
  function updateWorker(S, u, dt) {
    const b = u.home, W = CFG.WORKER;
    if (!b || b.dead) { u.dead = true; S.dirty = true; return; }
    if (u.state === 'back') {
      if (Math.hypot(b.x - u.x, b.y - u.y) <= b.r + u.r + 10) {
        S.players[u.owner].res[u.res] += u.load;
        S.events.push({ t: 'deliver', pid: u.owner, res: u.res, n: u.load, x: b.x, y: b.y });
        u.load = 0; u.state = 'go';
      } else moveTo(S, u, b.x, b.y, dt, false);
      return;
    }
    let nd = u.node;
    if (!nd || nd.left <= 0) {
      u.node = nd = null; u.state = 'go'; u.vx = 0; u.vy = 0;
      u.retT -= dt;
      if (u.retT > 0) return;
      u.retT = 0.7;
      let bd = W.reach;                                   // ищем ближайший к дому источник
      for (const q of S.nodes) {
        if (q.kind !== u.nodeKind || q.left <= 0) continue;
        const d = Math.hypot(q.x - b.x, q.y - b.y) + Math.hypot(q.x - u.x, q.y - u.y) * 0.3;
        if (d < bd) { bd = d; nd = q; }
      }
      u.node = nd;
      if (!nd) return;
    }
    if (u.state === 'go') {
      if (Math.hypot(nd.x - u.x, nd.y - u.y) <= nd.r + u.r + 12) { u.state = 'work'; u.workT = W.work; u.cdT = 0; }
      else moveTo(S, u, nd.x, nd.y, dt, false);
    } else {
      u.vx = 0; u.vy = 0;
      u.workT -= dt; u.cdT -= dt;
      if (u.cdT <= 0) {
        u.cdT = 0.6; u.atkAnim = 0.25; u.an = (u.an + 1) & 255; nd.shake = 0.3; u.face = nd.x > u.x ? 1 : -1;
        S.events.push({ t: 'shake', ni: nd.i, x: nd.x, y: nd.y });
      }
      if (u.workT <= 0) {
        const n = Math.min(W.carry, nd.left);
        nd.left -= n; S.nodeDirty.push(nd.i);
        if (nd.left <= 0) nd.regrowT = CFG.NODES[nd.kind].regrow;
        u.load = n; u.state = 'back';
      }
    }
  }

  function updateNeutral(S, u, dt) {
    const def = CFG.NEUTRAL[u.kind];
    u.cdT -= dt; u.retT -= dt;
    const dh = Math.hypot(u.x - u.home.x, u.y - u.home.y);
    let t = u.target;
    if (t && t.dead) t = u.target = null;
    if (dh > def.leash) { t = u.target = null; u.back = true; }   // далеко от лагеря не гонимся
    if (u.back) {
      moveTo(S, u, u.home.x, u.home.y, dt, true);
      u.hp = Math.min(u.maxHp, u.hp + 40 * dt);
      if (dh < 24) u.back = false;
      return;
    }
    if (u.retT <= 0) {
      u.retT = 0.3;
      const nt = findEnemy(S, u, u.aggro, 1);
      if (nt && Math.hypot(nt.x - u.home.x, nt.y - u.home.y) < def.leash) t = u.target = nt;
    }
    if (t) { chase(S, u, t, dt); return; }
    if (dh > 4) moveTo(S, u, u.home.x, u.home.y, dt, true);
    if (u.hp < u.maxHp && S.time - u.lastHurt > 4) u.hp = Math.min(u.maxHp, u.hp + 15 * dt);
  }

  function updateCamps(S, dt) {
    for (const camp of S.camps) for (const sp of camp.spots) {
      if (sp.unit) continue;
      sp.respawnT -= dt;
      if (sp.respawnT > 0) continue;
      let busy = false;                                    // не появляемся прямо под носом у игроков
      for (const u of S.units) if (!u.dead && u.owner >= 0 && Math.hypot(u.x - camp.x, u.y - camp.y) < 230) { busy = true; break; }
      if (busy) { sp.respawnT = 2; continue; }
      spawnGrunt(S, camp, sp);
    }
  }

  // =====================================================================
  //  ЗДАНИЯ, СНАРЯДЫ, ПЛОЩАДКИ, РЕСУРСЫ
  // =====================================================================
  function updateBuildings(S, dt) {
    for (const b of S.buildings) {
      if (b.dead) continue;
      if (b.hurtT > 0) b.hurtT -= dt;
      const def = CFG.BUILDINGS[b.kind];

      // Лесопилка и Рудник выпускают рабочих
      if (def.workers && b.workers.length < def.workers[b.level - 1]) {
        b.spawnT -= dt;
        if (b.spawnT <= 0) { spawnWorker(S, b); b.spawnT = 2.5; }
      }

      // Цитадель и Башня стреляют по ближайшему врагу в своей зоне
      const atk = def.atk;
      if (!atk) continue;
      b.cdT -= dt;
      if (b.cdT > 0) continue;
      let best = null, bd = atk.range[b.level - 1];
      for (const u of S.units) {
        if (u.dead || u.owner < 0 || u.team === b.team) continue;
        const d = Math.hypot(u.x - b.x, u.y - b.y) - u.r;
        if (d < bd) { bd = d; best = u; }
      }
      if (best) {
        b.cdT = atk.cd;
        S.shots.push({ id: 0, x: b.x, y: b.y, px: b.x, py: b.y, sx: b.x, sy: b.y, z0: atk.z, k: 0, owner: b.owner, target: best, dmg: atk.dmg[b.level - 1], speed: atk.speed, dead: false });
        S.events.push({ t: 'shot', k: 0, owner: b.owner, x: b.x, y: b.y, z0: atk.z, speed: atk.speed, tid: best.id, tb: false });
      } else b.cdT = 0.15;
    }
  }

  function updateShots(S, dt) {
    for (const s of S.shots) {
      const t = s.target;
      if (!t || t.dead) { s.dead = true; S.dirty = true; continue; }
      const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), st = s.speed * dt;
      if (d <= st + 4 + (t.isB ? t.r * 0.6 : 0)) { s.dead = true; S.dirty = true; damage(S, t, s.dmg); }
      else { s.x += dx / d * st; s.y += dy / d * st; }
    }
  }

  function updatePads(S, dt) {
    for (let i = 0; i < S.pads.length; i++) {
      const pad = S.pads[i];
      if (pad.dead) continue;
      const p = S.players[pad.owner], h = p.hero;
      if (pad.cdT > 0) pad.cdT -= dt;
      pad.blocked = pad.kind === 'hire' && p.armyUsed + CFG.UNITS[pad.what].cap > p.armyCap ? 'cap' : '';
      pad.lack = false;
      const dx = h.x - pad.x, dy = h.y - pad.y;
      pad.on = !h.dead && dx * dx + dy * dy < pad.r * pad.r;
      if (!pad.on) { pad.dwell = 0; pad.acc = 0; continue; }
      pad.dwell += dt;
      if (pad.choice) continue;                            // здесь платят нажатием на карточку в панели
      // небольшая задержка, чтобы не купить случайно, пробегая мимо
      if (pad.dwell < 0.25 || pad.cdT > 0 || pad.blocked) continue;

      let total = 0;
      for (const r of RES) total += pad.cost[r] || 0;
      pad.acc += Math.max(30, total / 0.7) * dt;           // скорость списания: вся цена примерно за 0.7 с
      let lastRes = null;
      while (pad.acc >= 1) {
        let took = false;
        for (const r of RES) {
          if (need(pad, r) > 0 && p.res[r] > 0) { p.res[r]--; pad.paid[r]++; took = true; lastRes = r; break; }
        }
        if (!took) { pad.acc = 0; pad.lack = true; break; }
        pad.acc -= 1;
      }
      if (lastRes) S.events.push({ t: 'pay', pid: p.id, res: lastRes, x: pad.x, y: pad.y, hx: h.x, hy: h.y });
      if (need(pad, 'wood') <= 0 && need(pad, 'iron') <= 0 && need(pad, 'gold') <= 0) completePad(S, pad);
    }
  }

  function completePad(S, pad) {
    const p = S.players[pad.owner];
    if (pad.kind === 'hire') {
      const b = pad.bld;
      const u = addUnit(S, pad.what, p.id, b.x + (pad.x - b.x) * 0.7 + (S.rnd() - 0.5) * 12, b.y + (pad.y - b.y) * 0.7 + (S.rnd() - 0.5) * 12);
      applyStats(p, u);
      // ставим в строй по порядку: всадники и мечники впереди, лучники и тараны сзади
      const ord = CFG.UNITS[u.kind].order;
      let i = p.army.length;
      while (i > 0 && CFG.UNITS[p.army[i - 1].kind].order > ord) i--;
      p.army.splice(i, 0, u);
      p.armyUsed += u.capUse;
      pad.paid = ZERO(); pad.acc = 0;
      pad.cdT = CFG.BUILDINGS[b.kind].hireCd[b.level - 1];
      S.events.push({ t: 'hired', pid: p.id, x: u.x, y: u.y, kind: u.kind });
    } else if (pad.kind === 'upgrade') {
      const b = pad.bld, def = CFG.BUILDINGS[b.kind];
      b.level++;
      const newMax = maxHpOf(def, b.level);
      b.hp += newMax - b.maxHp; b.maxHp = newMax;
      recalc(S, p);
      if (b.level - 1 < def.upgrades.length) {
        pad.cost = def.upgrades[b.level - 1];
        pad.paid = ZERO(); pad.acc = 0; pad.cdT = 1;
      } else { pad.dead = true; S.dirty = true; }
      S.events.push({ t: 'upgraded', pid: p.id, x: b.x, y: b.y, kind: b.kind, level: b.level });
    }
  }

  function build(S, p, pad, what) {
    const s = p.base.slots[pad.slot];
    const b = addBuilding(S, p, what, s.x, s.y, pad.slot);
    pad.dead = true; S.dirty = true;
    addBuildingPads(S, p, b);
    recalc(S, p);
    S.events.push({ t: 'built', pid: p.id, x: b.x, y: b.y, kind: what });
    return b;
  }

  // ---------------------------------------------------------------------
  // КОМАНДЫ ИГРОКА (всё, что не джойстик). Возвращает true, если команда принята.
  //   { t: 'mode',  mode: 'follow' | 'hold' | 'attack' }   — приказ войску
  //   { t: 'build', pad, what }                            — построить здание на свободном месте
  //   { t: 'forge', pad, unit, stat }                      — улучшение в Кузнице
  //   { t: 'trade', pad, i }                               — обмен на Рынке
  // Здесь же проверяется, что игрок не жульничает: стоит на площадке и ему хватает ресурсов.
  // ---------------------------------------------------------------------
  function command(S, pid, c) {
    const p = S.players[pid];
    if (!p || !p.alive || S.over || !c || typeof c !== 'object') return false;
    const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);   // команды приходят из сети — не верим на слово

    if (c.t === 'mode') {
      if (c.mode !== 'follow' && c.mode !== 'hold' && c.mode !== 'attack') return false;
      p.cmd = c.mode;
      if (c.mode === 'hold') {
        const h = p.hero;
        p.hold = h.dead ? { x: p.base.x + p.base.fx * 150, y: p.base.y + p.base.fy * 150, a: p.base.fa } : { x: h.x, y: h.y, a: p.heading };
      }
      S.events.push({ t: 'cmd', pid, mode: c.mode });
      return true;
    }

    let pad = null;
    for (const q of S.pads) if (q.id === c.pad && q.owner === pid && !q.dead) { pad = q; break; }
    if (!pad || !pad.on) return false;                     // нужно стоять на площадке

    if (c.t === 'build' && pad.kind === 'slot') {
      if (!own(CFG.BUILDINGS, c.what) || !canBuild(p, c.what) || !pay(p, CFG.BUILDINGS[c.what].cost)) return false;
      build(S, p, pad, c.what);
      return true;
    }
    if (c.t === 'forge' && pad.kind === 'forge') {
      if (!own(p.up, c.unit) || !own(CFG.FORGE.stats, c.stat)) return false;
      const up = p.up[c.unit];
      const lv = up[c.stat];
      if (lv >= CFG.FORGE.cost.length || lv >= pad.bld.level) return false;   // уровень ограничен уровнем Кузницы
      if (!pay(p, { gold: CFG.FORGE.cost[lv] })) return false;
      up[c.stat] = lv + 1;
      for (const u of p.army) if (u.kind === c.unit) applyStats(p, u);       // улучшение сразу действует на всех
      S.events.push({ t: 'forged', pid, unit: c.unit, stat: c.stat, level: lv + 1, x: pad.bld.x, y: pad.bld.y });
      return true;
    }
    if (c.t === 'trade' && pad.kind === 'trade') {
      const tr = Number.isInteger(c.i) ? CFG.TRADES[c.i] : null;
      if (!tr || p.res[tr.give] < tr.n) return false;
      const got = tr.m[pad.bld.level - 1];
      p.res[tr.give] -= tr.n; p.res[tr.get] += got;
      S.events.push({ t: 'trade', pid, res: tr.get, n: got, x: pad.x, y: pad.y });
      return true;
    }
    return false;
  }

  function updateNodes(S, dt) {
    for (const nd of S.nodes) {
      if (nd.shake > 0) nd.shake -= dt;
      if (nd.left <= 0) {
        nd.regrowT -= dt;                                  // срубленное дерево и выбитая руда отрастают
        if (nd.regrowT <= 0) { nd.left = nd.max; S.nodeDirty.push(nd.i); }
      }
    }
  }

  function updateCoins(S, dt) {
    const fr = Math.exp(-4 * dt), pick = CFG.HERO.pickup;
    for (const c of S.coins) {
      c.age += dt; c.ttl -= dt;
      if (c.ttl <= 0) { c.dead = true; S.dirty = true; continue; }
      c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= fr; c.vy *= fr;
      if (c.age < 0.4) continue;                           // монета сначала отлетает, потом её можно подобрать
      let best = null, bd = pick;
      for (const p of S.players) {
        const h = p.hero;
        if (!p.alive || h.dead) continue;
        const d = Math.hypot(h.x - c.x, h.y - c.y);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      const h = best.hero;
      if (bd < 20) {
        best.res.gold += c.amount;
        c.dead = true; S.dirty = true;
        S.events.push({ t: 'coin', pid: best.id, n: c.amount, x: h.x, y: h.y });
      } else {                                             // монета сама летит к герою
        const sp = 430 * dt;
        c.x += (h.x - c.x) / bd * sp; c.y += (h.y - c.y) / bd * sp;
      }
    }
  }

  // =====================================================================
  //  БОТ
  //  Бот «нажимает джойстик» и отдаёт команды так же, как человек.
  // =====================================================================
  function botThink(S, p, dt) {
    const h = p.hero, B = p.bot;
    if (h.dead) {
      if (!B.wasDead) {
        B.wasDead = true;
        if (B.mode === 'attack') B.wave = Math.min(CFG.ARMY_CAP_MAX, B.wave + CFG.BOT.waveStep);
        B.mode = ''; B.goal = null; B.gt = '';
      }
      p.input.x = 0; p.input.y = 0;
      return;
    }
    B.wasDead = false;
    if (B.idleT > 0) { B.idleT -= dt; p.input.x = 0; p.input.y = 0; return; }   // бот «задумался»
    B.thinkT -= dt;
    if (B.thinkT <= 0) {
      B.thinkT = B.L.think;
      const cmd = botDecide(S, p, h, B);
      if (cmd !== p.cmd) command(S, p.id, { t: 'mode', mode: cmd });
    }

    const g = B.goal;
    if (!g) { p.input.x = 0; p.input.y = 0; return; }
    const dx = g.x - h.x, dy = g.y - h.y, d = Math.hypot(dx, dy);
    if (d <= g.stop) { p.input.x = 0; p.input.y = 0; B.stuckT = 0; return; }
    let ix = dx / d, iy = dy / d;

    // упёрлись в препятствие — немного обходим сбоку
    if (h.spd < 25) B.stuckT += dt; else B.stuckT = Math.max(0, B.stuckT - dt * 2);
    if (B.stuckT > 0.8) {
      B.stuckT = 0; B.sideT = 0.55; B.side = S.rnd() < 0.5 ? 1 : -1;
      if (B.node) { B.skip = B.node; B.node = null; }
    }
    if (B.sideT > 0) {
      B.sideT -= dt;
      const sx = -iy * B.side, sy = ix * B.side;
      ix = sx * 0.9 + ix * 0.3; iy = sy * 0.9 + iy * 0.3;
    }
    p.input.x = ix; p.input.y = iy;
  }

  function enemyCitadel(S, p, h) {
    let best = null, bd = Infinity;
    for (const q of S.players) {
      if (!q.alive || q.team === p.team) continue;
      const d = Math.hypot(q.citadel.x - h.x, q.citadel.y - h.y);
      if (d < bd) { bd = d; best = q.citadel; }
    }
    return best;
  }

  function goNode(S, p, h, B, kind) {
    let nd = B.node;
    if (!nd || nd.kind !== kind || nd.left <= 0) {
      nd = null;
      let bs = Infinity;
      for (const q of S.nodes) {
        if (q.kind !== kind || q.left <= 0 || q === B.skip) continue;
        const s = Math.hypot(q.x - h.x, q.y - h.y) + 0.5 * Math.hypot(q.x - p.base.x, q.y - p.base.y);
        if (s < bs) { bs = s; nd = q; }
      }
      B.node = nd;
    }
    B.goal = nd ? { x: nd.x, y: nd.y, stop: nd.r + h.r + CFG.HERO.harvestReach - 4 } : null;
  }

  // Свободное место под постройку (с учётом того, что где удобнее ставить)
  function freeSlot(S, p, kind) {
    const order = (BOT_SLOTS[kind] || []).concat(BOT_SLOT_ANY);
    for (const k of order) for (const pad of S.pads) if (pad.owner === p.id && pad.kind === 'slot' && pad.slot === k && !pad.dead) return pad;
    return null;
  }

  // Что бот хочет купить следующим: { pad, cost, cmd } или null
  function botInvest(S, p, B) {
    // а) улучшение в Кузнице для самого многочисленного вида войск
    const fpad = findPad(S, p, 'forge');
    if (fpad && p.army.length) {
      const cnt = {};
      for (const u of p.army) cnt[u.kind] = (cnt[u.kind] || 0) + 1;
      const kinds = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
      for (const k of kinds) {
        let pick = null;
        for (const st in CFG.FORGE.stats) {
          const lv = p.up[k][st];
          if (lv >= fpad.bld.level || lv >= CFG.FORGE.cost.length) continue;
          if (!pick || CFG.FORGE.cost[lv] < pick.cost.gold) pick = { pad: fpad, cost: { gold: CFG.FORGE.cost[lv] }, cmd: { t: 'forge', unit: k, stat: st } };
        }
        if (pick) { if (p.res.gold >= pick.cost.gold) return pick; break; }
      }
    }
    // б) улучшение здания, на которое уже есть золото
    let up = null;
    for (const pad of S.pads) {
      if (pad.owner !== p.id || pad.dead || pad.kind !== 'upgrade') continue;
      if (p.res.gold < need(pad, 'gold')) continue;
      const w = need(pad, 'wood');
      if (!up || w < up.w) up = { pad, w, cost: { wood: Math.max(0, w), iron: Math.max(0, need(pad, 'iron')), gold: Math.max(0, need(pad, 'gold')) } };
    }
    if (up && S.time > 80 && payable(p, up.cost)) return up;
    // в) следующая постройка по плану (не всё сразу — по одной раз в planTime секунд)
    for (let i = 0; i < B.plan.length; i++) {
      if (S.time < i * B.L.planTime) break;
      const k = B.plan[i];
      if (countBuildings(p, k) > 0) continue;              // такое уже стоит
      const pad = freeSlot(S, p, k);
      if (pad) return { pad, cost: CFG.BUILDINGS[k].cost, cmd: { t: 'build', what: k } };
    }
    return up && S.time > 80 ? up : null;
  }

  // Кого бот хочет нанять следующим: { pad, cap } или null
  function botHire(S, p) {
    let pads = null;
    for (const pad of S.pads) if (pad.owner === p.id && !pad.dead && pad.kind === 'hire') (pads || (pads = {}))[pad.what] = pad;
    if (!pads) return null;
    const cnt = { sword: 0, archer: 0, rider: 0, ram: 0 };
    for (const u of p.army) cnt[u.kind]++;
    let kind = null;
    if (pads.ram && cnt.ram < 2 && p.army.length >= 8 && S.time > 240) kind = 'ram';
    else {
      let sum = 0, bd = -1e9;
      for (const k in pads) sum += HIRE_W[k];
      for (const k in pads) {
        if (!HIRE_W[k]) continue;
        const d = HIRE_W[k] / sum * (p.army.length + 1) - cnt[k];
        if (d > bd) { bd = d; kind = k; }
      }
      if (!kind) kind = 'ram';
    }
    return { pad: pads[kind], cap: CFG.UNITS[kind].cap };
  }

  // Главное решение бота. Ставит цель (куда идти) и возвращает приказ войску.
  function botDecide(S, p, h, B) {
    const L = B.L, cit = p.citadel, base = p.base, army = p.armyUsed;
    const dHome = Math.hypot(h.x - cit.x, h.y - cit.y);
    let gt = '';
    const go = (x, y, stop, type) => { B.goal = { x, y, stop: stop == null ? 5 : stop }; gt = type; };
    const goHome = () => go(base.x + base.fx * 125, base.y + base.fy * 125, 16, 'home');
    const node = kind => { goNode(S, p, h, B, kind); gt = 'node'; };
    const grow = () => { B.wave = Math.min(CFG.ARMY_CAP_MAX, B.wave + CFG.BOT.waveStep); };
    // сменил занятие — немного «подумал» (так бот не действует с нечеловеческой скоростью)
    const done = cmd => {
      if (gt !== B.gt) {
        if (B.gt && L.idle && gt !== 'home' && gt !== 'foe' && gt !== 'attack' && gt !== 'coin') B.idleT = L.idle * (0.5 + S.rnd());
        B.gt = gt;
      }
      return cmd;
    };

    // 1. Нашу базу бьют — возвращаемся защищать
    if (S.time - p.underAttackT < 4) {
      if (B.mode === 'attack' || B.mode === 'camp') B.mode = '';
      let foe = null, fd = 430;
      for (const u of S.units) {
        if (u.dead || u.owner < 0 || u.team === p.team) continue;
        const d = Math.hypot(u.x - cit.x, u.y - cit.y);
        if (d < fd) { fd = d; foe = u; }
      }
      if (foe && dHome < 500 && h.hp > h.maxHp * 0.3) go(foe.x, foe.y, h.r + foe.r + 8, 'foe'); else goHome();
      return done(dHome < 560 ? 'attack' : 'follow');
    }

    // 2. Мало здоровья — отходим лечиться к Цитадели
    if (B.mode === 'retreat') {
      if (h.hp >= h.maxHp * 0.85) B.mode = ''; else { goHome(); return done('follow'); }
    } else if (h.hp < h.maxHp * 0.35) {
      if (B.mode === 'attack') grow();
      B.mode = 'retreat'; goHome();
      return done('follow');
    }

    // 3. Рядом лежит золото — подбираем
    let coin = null, cd = 230;
    for (const c of S.coins) { const d = Math.hypot(c.x - h.x, c.y - h.y); if (d < cd) { cd = d; coin = c; } }
    if (coin) { go(coin.x, coin.y, 4, 'coin'); return done(p.cmd); }

    // 4. Идёт атака на вражескую Цитадель
    if (B.mode === 'attack') {
      const tc = enemyCitadel(S, p, h);
      if (!tc) B.mode = '';
      else if (army < Math.max(2, Math.floor(B.wave * 0.3))) { B.mode = ''; grow(); }   // отряд разбит — копим новый, побольше
      else {
        // герой встаёт на подступах к вражеской базе (вне обстрела) и отдаёт приказ «В атаку»
        const eb = S.players[tc.owner].base;
        const sx = eb.x + eb.fx * 480, sy = eb.y + eb.fy * 480;
        go(sx, sy, 30, 'attack');
        return done(Math.hypot(sx - h.x, sy - h.y) < 170 ? 'attack' : 'follow');
      }
    }

    // 5. Поход в лагерь нейтралов за золотом
    if (B.mode === 'camp') {
      let g = null, gd = Infinity;
      if (B.camp && army >= 3) for (const sp of B.camp.spots) {
        const u = sp.unit;
        if (!u || u.dead) continue;
        const d = Math.hypot(u.x - h.x, u.y - h.y);
        if (d < gd) { gd = d; g = u; }
      }
      if (g) { go(g.x, g.y, h.r + g.r + 8, 'camp'); return done('follow'); }
      B.mode = ''; B.lastCamp = S.time;
    }

    // 6. Хозяйство: покупки, на которые уже хватает
    const inv = botInvest(S, p, B);
    if (inv && payable(p, inv.cost)) {
      go(inv.pad.x, inv.pad.y, 5, 'pad' + inv.pad.id);
      if (inv.cmd && inv.pad.on) command(S, p.id, Object.assign({ pad: inv.pad.id }, inv.cmd));
      return done('follow');
    }

    // ...потом войско
    const wave = Math.max(B.wave, L.firstWave + Math.floor(S.time / L.waveTime) * 2);   // со временем бот смелеет
    const want = Math.min(wave, p.armyCap);
    const hk = botHire(S, p);
    if (hk) {
      const n = Math.max(1, Math.min(3, Math.floor((want - army) / hk.cap)));
      const c = hk.pad.cost;
      let one = true, two = true, many = true, lack = 'ore';
      for (const r of RES) {
        if (p.res[r] < need(hk.pad, r)) one = false;
        if (p.res[r] < (c[r] || 0) * 2) two = false;
        if (p.res[r] < (c[r] || 0) * n) { many = false; if (r === 'wood') lack = 'tree'; }
      }
      if (army + hk.cap <= want) {                        // отряд ещё не собран — добываем и нанимаем
        if (B.task === 'hire') { if (!one) B.task = 'mine'; }
        else if (many) B.task = 'hire';
        if (B.task === 'hire') go(hk.pad.x, hk.pad.y, 5, 'pad' + hk.pad.id); else node(lack);
        return done('follow');
      }
      if (army + hk.cap <= p.armyCap) {                   // отряд собран, но ресурсы в избытке — нанимаем ещё
        if (B.task === 'hire' ? one : two) { B.task = 'hire'; go(hk.pad.x, hk.pad.y, 5, 'pad' + hk.pad.id); return done('follow'); }
        B.task = 'mine';
      }
    }

    // ...потом копим на следующую покупку (если осталось немного или в атаку ещё рано)
    const early = S.time < L.grace || !hk || army < 3;
    if (inv) {
      const mw = (inv.cost.wood || 0) - p.res.wood, mi = (inv.cost.iron || 0) - p.res.iron;
      if (mw > 0 && (early || mw <= 130)) { node('tree'); return done('follow'); }
      if (mi > 0 && (early || mi <= 80)) { node('ore'); return done('follow'); }
    }

    // 7. Войско собрано: сначала за золотом в лагерь, потом — в атаку
    if (S.time - B.lastCamp > 70 && army >= 5) {
      let camp = null, bd = Infinity;
      for (const c of S.camps) {
        if (!c.spots.some(sp => sp.unit && !sp.unit.dead)) continue;
        const d = Math.hypot(c.x - base.x, c.y - base.y) + Math.hypot(c.x - h.x, c.y - h.y) * 0.3;
        if (d < bd) { bd = d; camp = c; }
      }
      if (camp) { B.mode = 'camp'; B.camp = camp; go(camp.x, camp.y, 70, 'camp'); return done('follow'); }
    }
    if (early) { node(p.res.wood <= p.res.iron ? 'tree' : 'ore'); return done('follow'); }   // в атаку рано — запасаемся
    B.mode = 'attack';
    return done('follow');
  }

  // =====================================================================
  //  ОДИН ШАГ ИГРЫ
  // =====================================================================
  function cleanup(S) {
    const alive = o => !o.dead;
    S.units = S.units.filter(alive);
    S.buildings = S.buildings.filter(alive);
    S.pads = S.pads.filter(alive);
    S.coins = S.coins.filter(alive);
    S.shots = S.shots.filter(alive);
    S.dirty = false;
  }

  function step(S, dt) {
    if (S.over) return;
    if (S.events.length > 600) S.events.length = 0;       // защита, если события никто не забирает
    if (S.nodeDirty.length > 3000) S.nodeDirty.length = 0;
    S.tick++; S.time += dt; S.timeLeft -= dt;

    // запоминаем прошлые координаты — экран плавно рисует между шагами
    for (const u of S.units) { u.px = u.x; u.py = u.y; if (u.atkAnim > 0) u.atkAnim -= dt; if (u.hurtT > 0) u.hurtT -= dt; }
    for (const s of S.shots) { s.px = s.x; s.py = s.y; }
    for (const c of S.coins) { c.px = c.x; c.py = c.y; }

    for (const p of S.players) {
      if (!p.alive) continue;
      let used = 0;
      for (let i = 0; i < p.army.length; i++) { p.army[i].slot = i; used += p.army[i].capUse; }
      p.armyUsed = used;
      if (p.isBot) botThink(S, p, dt);
      const h = p.hero;
      if (h.dead) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) { spawnHero(S, p); S.events.push({ t: 'respawn', pid: p.id }); }
      } else updateHero(S, p, h, dt);
    }
    for (const u of S.units) {
      if (u.dead || u.kind === 'hero') continue;
      if (u.kind === 'worker') updateWorker(S, u, dt);
      else if (u.owner >= 0) updateSoldier(S, u, dt);
      else updateNeutral(S, u, dt);
    }
    separate(S);
    for (const u of S.units) {
      if (u.dead) continue;
      collideStatic(S, u, dt);
      u.spd = Math.hypot(u.x - u.px, u.y - u.py) / dt;
      u.moving = u.spd > 22;
    }

    updateBuildings(S, dt);
    updateShots(S, dt);
    updatePads(S, dt);
    updateNodes(S, dt);
    updateCoins(S, dt);
    updateCamps(S, dt);

    if (S.dirty) cleanup(S);
    if (!S.over && CFG.MATCH_TIME > 0 && S.timeLeft <= 0) { S.timeLeft = 0; timeUp(S); }   // таймер выключен, если MATCH_TIME = 0
  }

  ZB.Sim = { createGame, step, command, buildMap, buildGrid, collideStatic, slowAt, need, canPay, payable, findPad, findBuilding, canBuild, maxHpOf, RES, UNIT_KINDS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
