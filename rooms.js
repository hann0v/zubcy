/* ============================================================
   «Зубцы» — комнаты и матчи на сервере.

   Здесь живёт всё, что связано с онлайном:
     • лобби: создать комнату, войти по коду, добавить ботов, выбрать режим;
     • матч: сервер сам считает игру (тот же файл sim.js, что и в браузере)
       и 10 раз в секунду рассылает игрокам «снимки»;
     • обрыв связи: 60 секунд за игрока играет бот, потом место остаётся за ботом.
   Игроки присылают только движение джойстика и команды — сжульничать нельзя.
   ============================================================ */
'use strict';
const path = require('path');
// общие файлы логики: обычно в public/shared, но если хостинг сложил всё в одну папку — рядом с этим файлом
const shared = [path.join(__dirname, '..', 'public', 'shared'), __dirname, path.join(__dirname, 'public', 'shared')]
  .find(d => require('fs').existsSync(path.join(d, 'sim.js'))) || path.join(__dirname, '..', 'public', 'shared');
require(path.join(shared, 'config.js'));
require(path.join(shared, 'sim.js'));
require(path.join(shared, 'proto.js'));
const { CFG, Sim, Proto } = globalThis.ZB;

const MAX_PLAYERS = 6;
const AWAY_MS = 60000;            // сколько ждём игрока, у которого оборвалась связь
const SNAP_EVERY = 3;             // снимок раз в 3 шага игры (30 шагов в секунду → 10 снимков)
const TICK_MS = CFG.TICK * 1000;
// Буквы кода комнаты выглядят одинаково на русской и английской раскладке — код можно набрать любой
const LETTERS = 'ABCEHKMOPTX';
const CYR = { 'А': 'A', 'В': 'B', 'С': 'C', 'Е': 'E', 'Н': 'H', 'К': 'K', 'М': 'M', 'О': 'O', 'Р': 'P', 'Т': 'T', 'Х': 'X' };
const BOT_NAMES = ['Гром', 'Ветер', 'Клык', 'Сова', 'Булат', 'Искра', 'Камень', 'Ёж'];

const rooms = new Map();          // код → комната
const conns = new Set();          // все подключённые игроки
const writer = new Proto.Writer(32768);

// ---------- мелкие помощники ----------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function send(conn, obj) { if (conn && conn.open) conn.send(JSON.stringify(obj)); }
function err(conn, msg, fatal) { send(conn, { t: 'err', msg, fatal: !!fatal }); }
function normCode(s) {
  let out = '';
  for (const ch of String(s || '').toUpperCase()) { const c = CYR[ch] || ch; if (LETTERS.includes(c)) out += c; }
  return out.slice(0, 4);
}
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    if (!rooms.has(c)) return c;
  }
}
function cleanName(s) {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  return s || 'Игрок';
}
const humans = room => room.members.filter(m => !m.bot);
const online = room => room.members.some(m => m.conn);

// Что игрок видит в лобби: код, режим, кто в комнате
function roomInfo(room, m) {
  return {
    t: 'room', code: room.code, you: m.id, host: room.hostId, mode: room.mode, state: room.state,
    slots: room.members.map(x => ({ id: x.id, name: x.name, color: x.color, team: x.team, bot: x.bot, away: !x.bot && !x.conn })),
  };
}
function broadcastRoom(room) { for (const m of room.members) if (m.conn) send(m.conn, roomInfo(room, m)); }

function addMember(room, name, bot, conn) {
  let color = 0;
  while (room.members.some(m => m.color === color)) color++;          // первый свободный цвет
  const t0 = room.members.filter(m => m.team === 0).length, t1 = room.members.length - t0;
  const m = {
    id: room.nextId++, name, bot, conn: conn || null,
    key: bot ? '' : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),   // секрет для возврата после обрыва
    color, team: t0 <= t1 ? 0 : 1,
    pidx: -1,                      // номер игрока в матче
    away: false, gone: false, awayUntil: 0,
    view: { hw: 260, vh: 1300 },   // сколько мира видит экран игрока
    cam: { x: 0, y: 0 },           // куда смотрит зритель
    padSig: '', needB: true, nodePend: new Set(),
  };
  room.members.push(m);
  return m;
}

// Хозяин комнаты — тот, кто может менять настройки и запускать матч. Если он ушёл — назначаем другого.
function fixHost(room) {
  if (room.members.some(m => m.id === room.hostId && !m.bot && m.conn)) return;
  const h = room.members.find(m => !m.bot && m.conn);
  if (h) room.hostId = h.id;
}

// =====================================================================
//  ЛОББИ
// =====================================================================
function createRoom(conn, name) {
  leave(conn, false);
  const room = {
    code: newCode(), state: 'lobby', mode: 'ffa', hostId: 0, members: [], nextId: 1,
    S: null, order: [], seed: 0, tick: 0, acc: 0, last: 0, evq: [], bDirty: false, emptySince: 0,
  };
  rooms.set(room.code, room);
  const m = addMember(room, cleanName(name), false, conn);
  room.hostId = m.id;
  conn.room = room; conn.member = m;
  send(conn, Object.assign(roomInfo(room, m), { key: m.key }));
  console.log('Комната ' + room.code + ' создана (' + m.name + '). Всего комнат: ' + rooms.size);
}

function joinRoom(conn, code, name) {
  const room = rooms.get(normCode(code));
  if (!room) return err(conn, 'Комната с таким кодом не найдена');
  if (conn.room === room) return;
  if (room.state !== 'lobby') return err(conn, 'В этой комнате уже идёт матч');
  if (room.members.length >= MAX_PLAYERS) return err(conn, 'В комнате нет свободных мест');
  leave(conn, false);
  const m = addMember(room, cleanName(name), false, conn);
  conn.room = room; conn.member = m;
  send(conn, Object.assign(roomInfo(room, m), { key: m.key }));
  broadcastRoom(room);
}

// Возврат после обрыва связи или обновления страницы
function resume(conn, msg) {
  const room = rooms.get(normCode(msg.code));
  if (!room) return err(conn, 'Комната уже закрыта', true);
  const m = room.members.find(x => !x.bot && x.id === msg.id && x.key && x.key === msg.key);
  if (!m) {
    if (room.state === 'lobby') return joinRoom(conn, msg.code, msg.name);   // в лобби просто заходим заново
    return err(conn, 'Матч идёт без вас — вернуться уже нельзя', true);
  }
  if (m.gone) return err(conn, 'Время на возврат вышло — за вас доиграл бот', true);
  if (conn.member === m) return;
  if (m.conn) { const old = m.conn; old.room = null; old.member = null; m.conn = null; old.close(); }   // старое соединение этого же игрока
  leave(conn, false);
  m.conn = conn; conn.room = room; conn.member = m;
  m.away = false; m.padSig = ''; m.needB = true; m.nodePend.clear();
  room.emptySince = 0;
  send(conn, Object.assign(roomInfo(room, m), { key: m.key }));
  if (room.state === 'game') {
    const p = room.S.players[m.pidx];
    p.isBot = false; p.input.x = 0; p.input.y = 0;      // бот отдаёт управление обратно
    sendStart(room, m, true);
    console.log('Комната ' + room.code + ': ' + m.name + ' вернулся в матч');
  }
  broadcastRoom(room);
}

// Игрок ушёл сам (dropped = false) или у него оборвалась связь (dropped = true)
function leave(conn, dropped) {
  const room = conn.room, m = conn.member;
  conn.room = null; conn.member = null;
  if (!room || !m) return;
  m.conn = null;
  if (room.state === 'game' && m.pidx >= 0) {
    // матч идёт: за игрока начинает играть бот
    const p = room.S.players[m.pidx];
    p.isBot = true; p.input.x = 0; p.input.y = 0;
    m.away = true;
    if (dropped) m.awayUntil = Date.now() + AWAY_MS; else m.gone = true;
    console.log('Комната ' + room.code + ': ' + m.name + (dropped ? ' отключился — 60 секунд за него играет бот' : ' вышел из матча'));
  } else {
    room.members.splice(room.members.indexOf(m), 1);
    if (!humans(room).length) { rooms.delete(room.code); return; }   // в лобби никого не осталось
  }
  fixHost(room);
  if (!online(room)) room.emptySince = Date.now();
  broadcastRoom(room);
}

function onLobby(conn, msg) {
  const room = conn.room, me = conn.member;
  if (!room || !me || room.state !== 'lobby') return;
  const host = room.hostId === me.id;
  switch (msg.t) {
    case 'set':
      if (host && (msg.mode === 'ffa' || msg.mode === 'teams')) room.mode = msg.mode;
      break;
    case 'bot':
      if (host && room.members.length < MAX_PLAYERS) {
        const used = room.members.map(m => m.name);
        const nm = BOT_NAMES.find(n => !used.includes('Бот ' + n)) || BOT_NAMES[0];
        addMember(room, 'Бот ' + nm, true, null);
      }
      break;
    case 'kick': {
      const i = room.members.findIndex(m => m.id === msg.id && m.bot);
      if (host && i >= 0) room.members.splice(i, 1);
      break;
    }
    case 'color': {
      const c = msg.c | 0;
      if (c >= 0 && c < CFG.COLORS.length && !room.members.some(m => m.color === c)) me.color = c;
      break;
    }
    case 'team': {
      const m = room.members.find(x => x.id === msg.id);
      if (m && (m === me || (host && m.bot)) && (msg.team === 0 || msg.team === 1)) m.team = msg.team;
      break;
    }
    case 'start': {
      if (!host) return;
      if (room.members.length < 2) return err(conn, 'Нужно хотя бы двое: позови друга или добавь бота');
      if (room.mode === 'teams' && (!room.members.some(m => m.team === 0) || !room.members.some(m => m.team === 1)))
        return err(conn, 'В каждой команде должен быть хотя бы один участник');
      startGame(room);
      return;
    }
    default: return;
  }
  broadcastRoom(room);
}

// =====================================================================
//  МАТЧ
// =====================================================================
function startGame(room) {
  const ms = room.members.slice();
  if (room.mode === 'teams') ms.sort((a, b) => a.team - b.team);      // союзники становятся соседями по карте
  room.seed = ((Math.random() * 2147483646) | 0) + 1;
  room.S = Sim.createGame({
    seed: room.seed,
    players: ms.map((m, i) => ({ name: m.name, color: m.color, team: room.mode === 'teams' ? m.team : i, isBot: m.bot })),
  });
  room.order = ms; room.state = 'game';
  room.tick = 0; room.acc = 0; room.last = performance.now(); room.evq = []; room.bDirty = true; room.emptySince = 0;
  ms.forEach((m, i) => {
    const b = room.S.map.bases[i];
    m.pidx = i; m.padSig = ''; m.needB = true; m.away = false; m.gone = false; m.nodePend = new Set();
    m.cam = { x: b.x, y: b.y };
  });
  for (const m of ms) if (m.conn) sendStart(room, m, false);
  broadcastRoom(room);
  console.log('Комната ' + room.code + ': матч начался, участников: ' + ms.length + ' (людей: ' + humans(room).length + ')');
}

// Сообщение «матч начался»: по зерну и числу игроков браузер сам строит ту же карту
function sendStart(room, m, resumed) {
  const S = room.S;
  const msg = {
    t: 'start', seed: room.seed, n: S.players.length, me: m.pidx, time: S.time, mode: room.mode,
    players: S.players.map((p, i) => ({ name: p.name, color: p.color, team: p.team, bot: room.order[i].bot })),
  };
  if (resumed) {                                        // вернувшемуся игроку — что уже срублено и выбито
    msg.resume = true; msg.nodes = [];
    for (const nd of S.nodes) if (nd.left < nd.max) msg.nodes.push([nd.i, Math.max(0, nd.left)]);
  }
  send(m.conn, msg);
}

// Площадки игрока: отправляем списком, только когда он изменился
function padSig(S, pi) {
  let s = '';
  for (const q of S.pads) if (q.owner === pi && !q.dead) s += q.id + ':' + (q.cost ? (q.cost.wood | 0) + ',' + (q.cost.iron | 0) + ',' + (q.cost.gold | 0) : '-') + ':' + (q.bld ? q.bld.level : 0) + '|';
  return s;
}
function padList(S, pi) {
  const list = [];
  for (const q of S.pads) {
    if (q.owner !== pi || q.dead) continue;
    list.push({ id: q.id & 65535, kind: q.kind, what: q.what, slot: q.slot, x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, r: q.r, cost: q.cost, paid: q.paid, lvl: q.bld ? q.bld.level : 0, bk: q.bld ? q.bld.kind : '' });
  }
  return list;
}

// Рассылка снимков: каждому — только то, что рядом с его героем
function snapshot(room) {
  const S = room.S, map = S.map;
  const withMini = room.tick % 15 === 0, allB = room.bDirty || withMini;
  room.bDirty = false;
  for (const m of room.order) {
    const c = m.conn;
    if (!c || !c.open) continue;
    for (const i of S.nodeDirty) m.nodePend.add(i);
    if (c.backlog > 512 * 1024) continue;               // у игрока «затор» в сети — этот снимок пропускаем

    const p = S.players[m.pidx];
    let cx, cy;                                         // центр зоны видимости
    if (!p.alive) { cx = m.cam.x; cy = m.cam.y; }                             // зритель смотрит, куда хочет
    else if (p.hero.dead) { cx = p.citadel.x; cy = p.citadel.y - 60; }         // герой возрождается — камера у Цитадели
    else { cx = p.hero.x; cy = p.hero.y; }
    const aoi = { x: cx, y: cy, hw: m.view.hw + 170, hh: m.view.vh * 0.75 + 260 };
    const x0 = aoi.x - aoi.hw, x1 = aoi.x + aoi.hw, y0 = aoi.y - aoi.hh, y1 = aoi.y + aoi.hh;
    const evs = [];
    for (const e of room.evq) {
      if (e.who === -2 || e.who === m.pidx) evs.push(e);
      else if (e.who === -1 && e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1) evs.push(e);
    }

    const sig = padSig(S, m.pidx);
    if (sig !== m.padSig) { m.padSig = sig; send(c, { t: 'pads', list: padList(S, m.pidx) }); }

    Proto.encodeSnap(writer, S, m.pidx, aoi, evs, Array.from(m.nodePend), allB || m.needB, withMini);
    c.send(Buffer.from(writer.bytes()));                // Buffer.from копирует байты — упаковщик можно использовать снова
    m.nodePend.clear(); m.needB = false;
  }
  room.evq.length = 0;
  S.nodeDirty.length = 0;
}

function endGame(room, crashed) {
  const S = room.S;
  const msg = { t: 'over', winnerTeam: crashed ? -2 : S.winnerTeam, reason: crashed ? 'error' : S.reason };
  for (const m of room.members) if (m.conn) send(m.conn, msg);
  console.log('Комната ' + room.code + ': матч окончен за ' + Math.round(S.time) + ' с');
  room.state = 'lobby'; room.S = null; room.order = [];
  room.members = room.members.filter(m => m.bot || m.conn);           // кто ушёл и не вернулся — покидает комнату
  for (const m of room.members) { m.pidx = -1; m.away = false; m.gone = false; }
  if (!humans(room).length) { rooms.delete(room.code); return; }
  fixHost(room);
  broadcastRoom(room);
}

// Главный цикл сервера: двигает все идущие матчи
function tick() {
  const now = performance.now(), wall = Date.now();
  for (const room of rooms.values()) {
    if (!online(room) && room.emptySince && wall - room.emptySince > AWAY_MS + 5000) {
      rooms.delete(room.code);                          // все ушли и не вернулись — комната закрывается
      console.log('Комната ' + room.code + ' закрыта: в ней никого не осталось');
      continue;
    }
    if (room.state !== 'game') continue;
    const S = room.S;
    room.acc += now - room.last; room.last = now;
    if (room.acc > 250) room.acc = 250;                 // сервер ненадолго «подвис» — не пытаемся догнать всё разом
    while (room.acc >= TICK_MS && room.state === 'game') {
      room.acc -= TICK_MS;
      try { Sim.step(S, CFG.TICK); }
      catch (e) { console.log('Ошибка в расчёте игры (комната ' + room.code + '):', e); endGame(room, true); break; }
      room.tick++;
      for (const e of S.events) {
        if (e.t === 'built' || e.t === 'upgraded' || e.t === 'crash') room.bDirty = true;
        const ne = Proto.netEvent(e);
        if (ne) room.evq.push(ne);
      }
      S.events.length = 0;
      // Все люди выбыли или ушли насовсем — ботам доигрывать незачем: побеждает самая целая Цитадель
      if (!S.over && room.tick % 30 === 0 && !room.order.some(m => !m.bot && !m.gone && S.players[m.pidx].alive)) {
        let best = null;
        for (const p of S.players) if (p.alive && (!best || p.citadel.hp / p.citadel.maxHp > best.citadel.hp / best.citadel.maxHp)) best = p;
        S.over = true; S.reason = 'nohumans'; S.winnerTeam = best ? best.team : -2;
      }
      if (room.tick % SNAP_EVERY === 0 || S.over) snapshot(room);
      if (S.over) endGame(room, false);
    }
    if (room.state !== 'game') continue;
    for (const m of room.order) {                       // у кого вышло время на возврат
      if (m.away && !m.gone && wall > m.awayUntil) { m.gone = true; broadcastRoom(room); }
    }
  }
}

// =====================================================================
//  СООБЩЕНИЯ ОТ ИГРОКОВ
// =====================================================================
function onJson(conn, text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  switch (msg.t) {
    case 'create': createRoom(conn, msg.name); break;
    case 'join': joinRoom(conn, msg.code, msg.name); break;
    case 'resume': resume(conn, msg); break;
    case 'leave': leave(conn, false); break;
    case 'p': send(conn, { t: 'p', n: msg.n }); break;             // замер задержки сети
    case 'view': {                                                 // размер экрана игрока в единицах мира
      const m = conn.member;
      if (m && isFinite(msg.hw) && isFinite(msg.vh)) { m.view.hw = clamp(+msg.hw, 150, 1200); m.view.vh = clamp(+msg.vh, 300, 2400); }
      break;
    }
    case 'c': {                                                    // команда в матче: приказ, постройка, Кузница, Рынок
      const room = conn.room, m = conn.member;
      if (room && m && room.state === 'game' && m.pidx >= 0 && !room.S.players[m.pidx].isBot) Sim.command(room.S, m.pidx, msg.c);
      break;
    }
    default: onLobby(conn, msg);
  }
}

// Джойстик приходит байтами — так короче
function onBinary(conn, buf) {
  const room = conn.room, m = conn.member;
  if (!room || !m || room.state !== 'game' || m.pidx < 0) return;
  const inp = Proto.decodeInput(buf);
  if (!inp) return;
  const p = room.S.players[m.pidx];
  if (p.alive && !p.isBot) { p.input.x = inp.x; p.input.y = inp.y; }
  if (inp.cam) { m.cam.x = clamp(inp.cam.x, 0, room.S.map.w); m.cam.y = clamp(inp.cam.y, 0, room.S.map.h); }
}

function onConn(conn) {
  conn.room = null; conn.member = null;
  conns.add(conn);
  conn.onmessage = (data, isBinary) => { if (isBinary) onBinary(conn, data); else onJson(conn, data); };
  conn.onclose = () => { conns.delete(conn); leave(conn, true); };
}

function start() {
  setInterval(tick, 1000 / 60);
  // раз в 15 секунд проверяем, что игроки ещё на связи (заодно это не даёт хостингу закрыть «молчащее» соединение)
  setInterval(() => {
    for (const c of conns) { if (!c.alive) c.close(1001); else { c.alive = false; c.ping(); } }
  }, 15000);
}

module.exports = { onConn, start, rooms, conns };
