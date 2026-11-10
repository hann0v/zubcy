/* ============================================================
   «Зубцы» — запуск игры: игровой цикл, подсказки, конец матча.

   Игра бывает двух видов:
     • local — одиночная против бота: всё считается прямо в браузере;
     • net   — онлайн: игру считает сервер, а браузер получает «снимки»
               и плавно их показывает (см. net.js).
   Рисование и интерфейс в обоих случаях одни и те же.
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG, Sim = ZB.Sim, R = ZB.Render, HUD = ZB.HUD, Input = ZB.Input, D = ZB.Draw, Mini = ZB.Mini, Net = ZB.Net, Lobby = ZB.Lobby;
  const Snd = ZB.Sound, Tips = ZB.Tips;
  const $ = id => document.getElementById(id);
  const hide = id => $(id).classList.add('hidden'), show = id => $(id).classList.remove('hidden');

  let S = null;            // состояние идущего (или только что законченного) матча
  let demo = null;         // карта, которая видна за меню
  let me = 0;              // номер нашего игрока
  let mode = 'menu';       // menu | local | net
  let running = false;     // идёт ли матч
  let last = 0, acc = 0;   // время прошлого кадра и «накопленное» время для шагов игры
  let uiT = 0;             // таймер обновления подсказки и панели
  let hirePhase = false;   // подсказка: сейчас копим железо или уже нанимаем
  let endT = -1;           // задержка перед экраном конца матча
  let awayNow = {};        // кто из игроков сейчас без связи (чтобы сообщать об этом один раз)
  let matchT = 0;          // сколько секунд мы в этом матче (для подсказок)
  let wasDead = false;     // был ли наш герой мёртв в прошлом кадре (чтобы сыграть звук возвращения)
  const auto = /[?&]auto=1/.test(location.search);   // для проверки: ?auto=1 — за нас играет бот

  ZB.dbg = { speed: 1, get S() { return S; }, get mode() { return mode; } };   // для отладки из консоли браузера

  // Все команды игрока идут через эту функцию: в одиночной игре — сразу в расчёт, в онлайне — на сервер
  function sendCommand(c) {
    if (!running || !S || S.over) return false;
    return mode === 'net' ? Net.command(c) : Sim.command(S, me, c);
  }

  // ---------- вход в матч ----------
  function enterGame(newS, newMe) {
    S = newS; me = newMe;
    running = true; acc = 0; uiT = 0; hirePhase = false; endT = -1; awayNow = {}; matchT = 0; wasDead = false;
    Tips.reset();
    Input.reset();
    R.reset(S, me); HUD.reset(S, me); Mini.reset(S);
    R.setObjective(null); R.setPanel(false); R.setSpec(null); HUD.setHint('');
    Lobby.hide();
    ['end', 'confirm', 'netlost'].forEach(hide);
    show('hud'); show('cmds');
    const ins = HUD.insets(); R.setInsets(ins.top, ins.bottom);
  }

  function startLocal() {
    mode = 'local';
    enterGame(Sim.createGame({
      seed: (Math.random() * 2147483647) | 0,
      players: [
        { name: 'Ты', color: 1, isBot: auto },       // синий — мы, внизу карты
        { name: 'Бот', color: 0, isBot: true },      // красный — бот, вверху карты
      ],
    }), 0);
  }

  // Выход из матча: в меню или обратно в комнату
  function leaveGame() {
    running = false; S = null; mode = 'menu';
    Input.reset(); Mini.toggle(false);
    R.reset(demo, 0); R.setObjective(null); R.setPanel(false); R.setSpec(null);
    ['hud', 'cmds', 'end', 'confirm', 'netlost'].forEach(hide);
    HUD.closePanel(); Tips.reset();
  }
  function toMenu(msg) { if (mode === 'net') Net.leave(); leaveGame(); Lobby.showMenu(msg); }
  function toRoom() { Net.backToRoom(); leaveGame(); Lobby.showRoom(); }

  // ---------- подсказка «что делать сейчас» ----------
  function nearest(list, h, ok) {
    let best = null, bd = Infinity;
    for (const o of list) {
      if (!ok(o)) continue;
      const d = Math.hypot(o.x - h.x, o.y - h.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  const nearestNode = (kind, h) => nearest(S.nodes, h, nd => nd.kind === kind && nd.left > 0);

  function calcObjective() {
    const p = S.players[me], h = p.hero;
    if (S.over || !p.alive || h.dead) return null;

    // 1) пока нет ни одного здания армии — учим строить
    const hire = nearest(S.pads, h, q => q.owner === me && q.kind === 'hire' && !q.dead);
    if (!hire) {
      const pad = nearest(S.pads, h, q => q.owner === me && q.kind === 'slot' && !q.dead);
      if (!pad) return null;
      if (pad.on) return { text: 'Выбери внизу вкладку «Армия» и построй Казарму', icon: 'barracks', x: pad.x, y: pad.y, h: 84, hide: true };
      if (p.res.wood >= CFG.BUILDINGS.barracks.cost.wood)
        return { text: 'Встань на круг с плюсом — там строят здания', icon: 'plus', x: pad.x, y: pad.y, h: 84 };
      const nd = nearestNode('tree', h);
      return nd && { text: 'Подойди к ёлке и постой рядом — герой сам нарубит дерева', icon: 'wood', x: nd.x, y: nd.y, h: 84 };
    }
    // 2) потом — нанимать первых бойцов
    if (p.army.length < 6) {
      const one = Math.max(1, Sim.need(hire, 'iron'));
      if (hirePhase) { if (p.res.iron < one) hirePhase = false; }
      else if (p.res.iron >= (hire.cost.iron || 0) * 3) hirePhase = true;
      if (hirePhase) return { text: 'Встань на площадку у здания — нанимай бойцов за железо', icon: hire.what, x: hire.x, y: hire.y, h: 84, hide: hire.on };
      const nd = nearestNode('ore', h);
      return nd && { text: 'Постой у рудного камня — герой добудет железо', icon: 'iron', x: nd.x, y: nd.y, h: 52 };
    }
    // 3) дальше — в бой
    const tc = nearest(S.buildings, h, b => b.kind === 'citadel' && !b.dead && S.players[b.owner].team !== p.team);
    return tc && { text: 'Веди войско к вражеской Цитадели. Кнопка «В атаку» бросает бойцов в бой', icon: 'attack', x: tc.x, y: tc.y, h: 150 };
  }

  // ---------- конец матча ----------
  function showEnd() {
    const p = S.players[me], t = $('end-title'), sub = $('end-sub');
    const win = S.winnerTeam === p.team, draw = S.winnerTeam === -2;
    t.textContent = draw ? 'Ничья' : win ? 'Победа!' : 'Поражение';
    t.classList.toggle('lose', !win && !draw);
    const winners = S.players.filter(q => q.team === S.winnerTeam).map(q => q.name).join(', ');
    if (S.reason === 'error') sub.textContent = 'На сервере случилась ошибка — матч остановлен';
    else if (S.reason === 'nohumans') sub.textContent = 'Все игроки выбыли — матч завершён' + (winners ? '. Дольше всех продержался: ' + winners : '');
    else if (S.reason === 'time') sub.textContent = draw ? 'Время вышло — Цитадели одинаково целы' : win ? 'Время вышло — твоя Цитадель целее' : 'Время вышло — Цитадель врага целее';
    else if (win) sub.textContent = S.players.length > 2 ? 'Все вражеские Цитадели разрушены' : 'Вражеская Цитадель разрушена';
    else sub.textContent = S.players.length > 2 && winners ? 'Победа за: ' + winners : 'Твоя Цитадель разрушена';
    $('btn-again').textContent = mode === 'net' ? 'В комнату' : 'Сыграть ещё';
    $('btn-menu').textContent = mode === 'net' ? 'Выйти из комнаты' : 'В меню';
    show('end'); hide('cmds'); hide('confirm');
    Snd.play(draw ? 'out' : win ? 'win' : 'lose'); Tips.reset();
    running = false;
    Input.reset(); Mini.toggle(false);
    R.setObjective(null); R.setPanel(false); HUD.setHint(''); HUD.closePanel(); HUD.spectator(false);
  }

  // ---------- события игры → эффекты ----------
  function onGameEvent(e) {
    Snd.event(e, me);
    if (e.t === 'alert') { if (e.pid === me) HUD.alarm(); return; }
    if (e.t === 'out') {
      const pl = S.players[e.pid];
      if (pl && S.players.length > 2) HUD.toast(e.pid === me ? 'Твоя Цитадель разрушена' : pl.name + ' выбывает из игры');
      return;
    }
    R.onEvent(e, S, me);
  }

  // ---------- игровой цикл ----------
  function loop(ts) { requestAnimationFrame(loop); frame(ts); }

  // Один кадр: продвинуть игру и нарисовать её
  function frame(ts) {
    const now = ts / 1000;
    const dt = Math.min(0.1, Math.max(0, now - last));   // после сворачивания вкладки не «прыгаем» вперёд
    last = now;
    let alpha = 1;

    if (running) {
      const inp = Input.get();
      const P = S.players[me];
      if (mode === 'local') {
        if (!S.over) {
          if (!auto) { P.input.x = inp.x; P.input.y = inp.y; }
          // игра считается ровными шагами по 1/30 секунды, а рисуется так часто, как может экран
          acc += dt * ZB.dbg.speed;
          let n = 0;
          while (acc >= CFG.TICK && n < 8) {
            Sim.step(S, CFG.TICK);
            acc -= CFG.TICK; n++;
            for (const e of S.events) onGameEvent(e);
            S.events.length = 0;
            if (S.over) break;
          }
          if (acc > CFG.TICK) acc = 0;
          alpha = S.over ? 1 : acc / CFG.TICK;
        }
      } else {
        alpha = Net.update(ts, dt, inp);                  // онлайн: берём состояние из снимков сервера
        R.setSpec(P.alive ? null : Net.spec);             // выбывший игрок — зритель: камера свободна
      }

      matchT += dt;
      if (P.alive && wasDead && !P.hero.dead) Snd.play('respawn');    // герой вернулся
      wasDead = P.alive && !!P.hero.dead;
      uiT -= dt;
      if (uiT <= 0 && !S.over) {
        uiT = 0.2;
        const o = Tips.enabled() ? calcObjective() : null;             // подсказки выключены — без стрелки и строки «что делать»
        R.setObjective(o || null); HUD.setHint(o ? o.text : '');
        HUD.panelUpdate(S, me);
        const onPad = HUD.panelOpen() ? S.pads.find(q => q.on && q.choice) : null;
        Tips.update({ S, me, p: P, h: P.hero, t: matchT, panel: onPad ? onPad.kind : '', mode }, 0.2);
        R.setPanel(HUD.panelOpen());                                  // панель открыта — камера поднимает героя повыше
        HUD.spectator(mode === 'net' && !P.alive);
        const ins = HUD.insets(); R.setInsets(ins.top, ins.bottom);   // стрелки не должны залезать под панель и подсказку
      }
      if (mode === 'net' && Net.status === 'lost') $('netlost-text').textContent = 'Пробуем вернуться в матч… ' + Math.max(0, Math.ceil(60 - Net.lostFor())) + ' с. Пока за тебя играет бот.';

      if (S.over) {                                       // даём секунду посмотреть на развалины и показываем итог
        if (endT < 0) endT = 1.3;
        endT -= dt;
        if (endT <= 0) showEnd();
      }
    }

    const view = S || demo;
    R.draw(view, S ? me : 0, alpha, dt, now);
    const vw = R.view(); Snd.listen((vw.x0 + vw.x1) / 2, (vw.y0 + vw.y1) / 2);
    if (running) { HUD.update(S, me); Mini.draw(S, me, R.view()); }
  }

  // Картинка в меню — тоже нарисована кодом
  function paintLogo() {
    const cv = $('logo'), w = 236, h = 172, d = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = w * d; cv.height = h * d; cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const c = cv.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0); c.lineJoin = 'round';
    const blue = CFG.COLORS[1], red = CFG.COLORS[0];
    const at = (x, y, s, fn) => { c.save(); c.translate(x, y); c.scale(s, s); fn(); c.restore(); };
    const unit = (id, face) => ({ id, face, moving: false, atkAnim: 0, hurtT: 0 });
    at(36, 150, 1, () => D.tree(c, { v: 0.7, left: 10, max: 10, shake: 0 }, 25));
    at(204, 152, 1, () => D.tree(c, { v: 0.2, left: 10, max: 10, shake: 0 }, 25));
    at(118, 150, 1.1, () => D.citadel(c, { id: 1, hurtT: 0, level: 1 }, blue, 0.4));
    at(60, 164, 1.15, () => D.hero(c, unit(1, 1), blue, 0, ['wood', 'wood', 'iron']));
    at(168, 166, 1.1, () => D.rider(c, unit(2, -1), red, 0));
    at(202, 168, 1.1, () => D.archer(c, unit(3, -1), red, 0));
  }

  // ---------- связь с сетью ----------
  function wireNet() {
    Net.onStart = (netS, netMe) => { mode = 'net'; enterGame(netS, netMe); const v = R.viewSize(); Net.sendView(v.hw, v.vh); };
    Net.onEvent = onGameEvent;
    Net.onRoom = room => {
      if (!running) { if (mode !== 'net') Lobby.showRoom(); return; }
      // идёт матч: сообщаем, если кто-то потерял связь или вернулся
      for (const s of room.slots) {
        if (s.bot || s.id === room.you) continue;
        if (s.away && !awayNow[s.id]) HUD.toast(s.name + ' отключился — за него играет бот');
        else if (!s.away && awayNow[s.id]) HUD.toast(s.name + ' снова в игре');
        awayNow[s.id] = s.away;
      }
    };
    Net.onError = (msg, fatal) => {
      if (fatal) { leaveGame(); Lobby.showMenu(msg); }
      else if (running) HUD.toast(msg);
      else Lobby.error(msg);
    };
    Net.onStatus = st => { $('netlost').classList.toggle('hidden', !(st === 'lost' && running && mode === 'net')); };
  }

  function init() {
    const canvas = $('game');
    R.init(canvas); HUD.init(sendCommand); Input.init(canvas); Mini.init($('mini'));
    paintLogo();
    demo = Sim.createGame({ seed: (Math.random() * 2147483647) | 0, players: [{ name: '', color: 1 }, { name: '', color: 0, isBot: true }] });
    R.reset(demo, 0);                             // карта за меню — просто для красоты
    wireNet();
    Lobby.init({ startLocal });

    // настройки: звук, подсказки, правила
    Tips.init();
    const refreshOpts = () => {
      const sOn = Snd.isOn(), tOn = Tips.enabled();
      $('opt-sound').classList.toggle('off', !sOn); $('opt-sound').querySelector('b').textContent = sOn ? 'вкл' : 'выкл';
      $('opt-tips').classList.toggle('off', !tOn); $('opt-tips').querySelector('b').textContent = tOn ? 'вкл' : 'выкл';
      for (const cv of [$('opt-sound').querySelector('canvas'), $('btn-sound').querySelector('canvas')]) { cv.dataset.icon = sOn ? 'sound' : 'mute'; HUD.paintIcon(cv, null); }
    };
    document.querySelectorAll('.opts canvas').forEach(cv => HUD.paintIcon(cv, CFG.COLORS[1]));
    $('opt-sound').addEventListener('click', () => { Snd.toggle(); refreshOpts(); });
    $('btn-sound').addEventListener('click', () => { Snd.toggle(); refreshOpts(); });
    $('opt-tips').addEventListener('click', () => { Tips.set(!Tips.enabled()); refreshOpts(); });
    $('opt-help').addEventListener('click', () => show('help'));
    $('help-close').addEventListener('click', () => hide('help'));
    refreshOpts();

    // конец матча
    $('btn-again').addEventListener('click', () => { if (mode === 'net') toRoom(); else startLocal(); });
    $('btn-menu').addEventListener('click', () => toMenu());
    // выход из матча с вопросом «точно?»
    $('btn-exit').addEventListener('click', () => {
      $('confirm-text').textContent = mode === 'net' ? 'За тебя доиграет бот, вернуться в этот матч будет нельзя.' : 'Матч против бота не сохранится.';
      show('confirm');
    });
    $('btn-stay').addEventListener('click', () => hide('confirm'));
    $('btn-quit').addEventListener('click', () => toMenu());

    const onResize = () => { R.resize(); Mini.resize(); if (running && mode === 'net') { const v = R.viewSize(); Net.sendView(v.hw, v.vh); } };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
    // на компьютере приказы войску — клавиши 1, 2, 3; карта — M
    window.addEventListener('keydown', e => {
      if (e.repeat || !running || (e.target && e.target.tagName === 'INPUT')) return;
      if (e.code === 'Digit1') sendCommand({ t: 'mode', mode: 'follow' });
      else if (e.code === 'Digit2') sendCommand({ t: 'mode', mode: 'hold' });
      else if (e.code === 'Digit3') sendCommand({ t: 'mode', mode: 'attack' });
      else if (e.code === 'KeyM') Mini.toggle();
    });

    if (auto) startLocal();
    else Net.tryResume();                         // если только что были в комнате (например, обновили страницу) — возвращаемся
    ZB.dbg.frame = frame;
    requestAnimationFrame(ts => { last = ts / 1000; requestAnimationFrame(loop); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
