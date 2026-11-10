/* ============================================================
   «Зубцы» — интерфейс поверх игры:
   ресурсы, войско, таймер, прочность Цитаделей, подсказка,
   три кнопки приказов и выезжающая снизу панель выбора.
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG, D = ZB.Draw, Sim = ZB.Sim;
  const HUD = ZB.HUD = {};
  const $ = id => document.getElementById(id);
  const el = {};
  let pills = [];
  let padBottom = 0;
  let send = null;                    // функция, которой интерфейс отдаёт команды игре

  const RES_GEN = { wood: 'дерева', iron: 'железа', gold: 'золота' };

  // Рисуем иконку кодом на маленьком холсте
  function paintIcon(cv, col) {
    const s = parseInt(cv.dataset.size || '28', 10), d = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = cv.height = Math.round(s * d);
    cv.style.width = cv.style.height = s + 'px';
    const c = cv.getContext('2d');
    c.setTransform(d, 0, 0, d, s * d / 2, s * d / 2);
    D.icon(c, cv.dataset.icon, s * 0.94, col);
  }
  function iconEl(name, size, col) {
    const cv = document.createElement('canvas');
    cv.dataset.icon = name; cv.dataset.size = size;
    paintIcon(cv, col);
    return cv;
  }
  function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  HUD.paintIcon = paintIcon;

  // onCommand(c) — вызывается, когда игрок нажал кнопку приказа или карточку в панели
  HUD.init = function (onCommand) {
    send = onCommand;
    ['wood', 'iron', 'gold', 'army'].forEach(k => { el[k] = $('r-' + k); });
    el.timer = $('timer'); el.cits = $('cits'); el.hint = $('hint'); el.respawn = $('respawn'); el.flash = $('flash');
    el.toast = $('toast'); el.spec = $('spec');
    document.querySelectorAll('#topbar canvas[data-icon]').forEach(cv => paintIcon(cv, null));
    el.flash.addEventListener('animationend', () => el.flash.classList.remove('on'));

    // три кнопки приказов
    el.cmds = Array.from(document.querySelectorAll('.cmd'));
    for (const b of el.cmds) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.classList.add('press'); setTimeout(() => b.classList.remove('press'), 140);
        send({ t: 'mode', mode: b.dataset.mode });
      });
    }

    // панель выбора
    panel.el = $('panel'); panel.title = $('p-title'); panel.tabs = $('p-tabs'); panel.list = $('p-list');
    $('p-close').addEventListener('click', () => { panel.closed = panel.padId; closePanel(); });
  };

  // Новый матч: создаём индикаторы Цитаделей всех игроков, красим кнопки в цвет игрока
  HUD.reset = function (S, me) {
    const myCol = CFG.COLORS[S.players[me].color];
    el.cits.innerHTML = '';
    el.cits.classList.toggle('many', S.players.length > 3);          // когда игроков много — индикаторы компактнее
    el.timer.classList.toggle('hidden', !(CFG.MATCH_TIME > 0));        // таймера нет, если матч без ограничения времени
    const teams = S.mode === 'teams', myTeam = S.players[me].team;
    pills = S.players.map(p => {
      const col = CFG.COLORS[p.color];
      const pill = make('div', 'pill' + (p.id === me ? ' me' : '') + (teams && p.team === myTeam && p.id !== me ? ' ally' : ''));
      pill.title = p.name;
      pill.style.setProperty('--c', col.main);
      const bar = make('div', 'pbar'), fill = make('i'), num = make('b', 'ol');
      bar.appendChild(fill);
      pill.appendChild(iconEl('citadel', 22, col)); pill.appendChild(bar); pill.appendChild(num);
      el.cits.appendChild(pill);
      return { pill, fill, num, hp: -1, dead: false };
    });
    for (const b of el.cmds) paintIcon(b.querySelector('canvas'), myCol);
    for (const k in el) if (el[k]) el[k]._v = undefined;
    el.hint.classList.add('hidden'); el.respawn.classList.add('hidden'); el.toast.classList.add('hidden'); el.spec.classList.add('hidden');
    panel.closed = 0; panel.col = myCol; closePanel();
  };

  // Меняем текст только когда значение изменилось (бережём батарею)
  function set(node, v, bump) {
    if (node._v === v) return;
    const grew = bump && typeof node._v === 'number' && v > node._v;
    node._v = v; node.textContent = v;
    if (grew) { node.classList.remove('bump'); void node.offsetWidth; node.classList.add('bump'); }
  }

  HUD.update = function (S, me) {
    const p = S.players[me];
    set(el.wood, p.res.wood, true); set(el.iron, p.res.iron, true); set(el.gold, p.res.gold, true);
    set(el.army, p.armyUsed + '/' + p.armyCap);

    if (CFG.MATCH_TIME > 0) {
      const tl = Math.max(0, Math.ceil(S.timeLeft)), mm = Math.floor(tl / 60), ss = tl % 60;
      set(el.timer, mm + ':' + (ss < 10 ? '0' : '') + ss);
      el.timer.classList.toggle('late', tl <= 60);
    }

    for (let i = 0; i < pills.length; i++) {
      const q = pills[i], pl = S.players[i], hp = pl.alive ? Math.ceil(pl.citadel.hp) : 0;
      if (q.hp !== hp) {
        q.hp = hp; q.num.textContent = hp;
        q.fill.style.width = Math.round(100 * hp / pl.citadel.maxHp) + '%';
      }
      if (!pl.alive && !q.dead) { q.dead = true; q.pill.classList.add('dead'); }
    }

    // какая кнопка приказа сейчас активна
    if (el.cmds._v !== p.cmd) { el.cmds._v = p.cmd; for (const b of el.cmds) b.classList.toggle('on', b.dataset.mode === p.cmd); }

    // герой погиб — показываем отсчёт до возвращения
    const dead = p.alive && p.hero.dead && !S.over;
    el.respawn.classList.toggle('hidden', !dead);
    if (dead) set(el.respawn, 'Герой пал!\nВернётся через ' + Math.max(1, Math.ceil(p.respawnT)) + '…');
  };

  HUD.setHint = function (text) {
    if (el.hint._v === text) return;
    el.hint._v = text;
    el.hint.textContent = text || '';
    el.hint.classList.toggle('hidden', !text);
  };

  // Короткое сообщение посреди экрана: «Вася отключился», «Петя выбывает»
  let toastTimer = 0;
  HUD.toast = function (text) {
    el.toast.textContent = text;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3500);
  };

  // Наш игрок выбыл и смотрит матч как зритель
  HUD.spectator = function (on) {
    if (el.spec._v === on) return;
    el.spec._v = on;
    el.spec.classList.toggle('hidden', !on);
    $('cmds').classList.toggle('gone', on);                           // зрителю кнопки приказов не нужны
  };

  // Базу атакуют: красная вспышка и вибрация (вибрация работает на Android)
  HUD.alarm = function () {
    el.flash.classList.remove('on'); void el.flash.offsetWidth; el.flash.classList.add('on');
    try { if (navigator.vibrate) navigator.vibrate([120, 70, 120]); } catch (e) { /* не страшно */ }
  };

  // Где кончается верхняя панель — чтобы стрелки-указатели не залезали под неё
  HUD.insets = function () {
    const low = el.hint && !el.hint.classList.contains('hidden') ? el.hint : $('row2');
    if (!padBottom) padBottom = parseFloat(getComputedStyle($('hud')).paddingBottom) || 8;
    return { top: low.getBoundingClientRect().bottom || 96, bottom: padBottom };
  };

  // =====================================================================
  //  ПАНЕЛЬ ВЫБОРА (выезжает снизу, когда герой стоит на площадке с выбором)
  // =====================================================================
  const panel = { el: null, title: null, tabs: null, list: null, key: '', padId: 0, closed: 0, rows: [], col: null, tab: { slot: 2, forge: 0 } };

  function closePanel() {
    if (!panel.el) return;
    panel.el.classList.remove('open');
    panel.key = ''; panel.padId = 0;
  }
  HUD.panelOpen = function () { return !!panel.key; };
  HUD.color = function () { return panel.col; };          // цвет нашего игрока (для иконок)
  HUD.closePanel = closePanel;

  // Собираем описание панели: заголовок, вкладки и строки-карточки
  function model(S, p, pad) {
    const m = { title: '', tabs: null, tab: 0, rows: [] };
    if (pad.kind === 'slot') {
      m.title = 'Что построить?';
      m.tabs = CFG.PATHS.map(q => q.name); m.tab = panel.tab.slot;
      for (const k of CFG.PATHS[m.tab].list) {
        const def = CFG.BUILDINGS[k], max = def.max || 1;
        let have = 0;
        for (const b of p.buildings) if (b.kind === k) have++;
        m.rows.push({
          icon: k, name: def.name, desc: def.desc, cost: def.cost,
          off: have >= max ? (max > 1 ? 'Построено ' + have + ' из ' + max : 'Уже построено') : '',
          cmd: { t: 'build', pad: pad.id, what: k },
        });
      }
    } else if (pad.kind === 'forge') {
      m.title = 'Кузница: улучшения войск';
      m.tabs = Sim.UNIT_KINDS.map(k => CFG.UNITS[k].name); m.tab = panel.tab.forge;
      const unit = Sim.UNIT_KINDS[m.tab], IC = { dmg: 'attack', hp: 'hp', spd: 'spd' };
      for (const st in CFG.FORGE.stats) {
        const sd = CFG.FORGE.stats[st], lv = p.up[unit][st], maxLv = CFG.FORGE.cost.length;
        m.rows.push({
          icon: IC[st], name: sd.name + '  ' + '★'.repeat(lv) + '☆'.repeat(maxLv - lv), desc: sd.desc,
          cost: lv < maxLv ? { gold: CFG.FORGE.cost[lv] } : {},
          off: lv >= maxLv ? 'Максимальный уровень' : lv >= pad.bld.level ? 'Сначала улучши Кузницу до ' + (lv + 1) + ' уровня' : '',
          cmd: { t: 'forge', pad: pad.id, unit, stat: st },
        });
      }
    } else if (pad.kind === 'trade') {
      m.title = 'Рынок: обмен ресурсов';
      CFG.TRADES.forEach((tr, i) => {
        const got = tr.m[pad.bld.level - 1], cost = {};
        cost[tr.give] = tr.n;
        m.rows.push({ icon: tr.get, name: '+' + got + ' ' + RES_GEN[tr.get], desc: 'в обмен на ' + tr.n + ' ' + RES_GEN[tr.give], cost, off: '', cmd: { t: 'trade', pad: pad.id, i } });
      });
    }
    return m;
  }

  // Строим панель заново (только когда изменился её состав)
  function buildPanel(m, pad) {
    panel.title.textContent = m.title;
    panel.tabs.innerHTML = ''; panel.list.innerHTML = '';
    panel.tabs.classList.toggle('hidden', !m.tabs);
    if (m.tabs) m.tabs.forEach((name, i) => {
      const b = make('button', 'p-tab' + (i === m.tab ? ' on' : ''), name);
      b.addEventListener('click', () => { panel.tab[pad.kind] = i; panel.key = ''; if (HUD._last) HUD.panelUpdate(HUD._last.S, HUD._last.me); });
      panel.tabs.appendChild(b);
    });
    panel.rows = m.rows.map(r => {
      const card = make('button', 'card');
      const main = make('span', 'c-main');
      const desc = make('span', 'c-desc', r.desc), lack = make('span', 'c-lack hidden');
      main.appendChild(make('b', null, r.name)); main.appendChild(desc); main.appendChild(lack);
      const cost = make('span', 'c-cost'), chips = {};
      for (const res of Sim.RES) {
        if (!r.cost[res]) continue;
        const ch = make('span', 'cost');
        ch.appendChild(iconEl(res, 20, null)); ch.appendChild(document.createTextNode(r.cost[res]));
        cost.appendChild(ch); chips[res] = ch;
      }
      card.appendChild(iconEl(r.icon, 46, panel.col)); card.appendChild(main); card.appendChild(cost);
      card.addEventListener('click', () => {
        if (card.classList.contains('off')) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); if (ZB.Sound) ZB.Sound.play('deny'); return; }
        if (send(r.cmd)) { card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); }
        if (HUD._last) HUD.panelUpdate(HUD._last.S, HUD._last.me);
      });
      panel.list.appendChild(card);
      return { r, card, desc, lack, chips, state: '' };
    });
  }

  // Вызывается несколько раз в секунду: открыть/закрыть панель и обновить, на что хватает ресурсов
  HUD.panelUpdate = function (S, me) {
    HUD._last = { S, me };
    const p = S.players[me];
    let pad = null;
    if (p.alive && !S.over) for (const q of S.pads) if (q.owner === me && q.choice && q.on && !q.dead && q.dwell > 0.12) { pad = q; break; }
    if (!pad) { panel.closed = 0; if (panel.key) closePanel(); return; }
    if (panel.closed === pad.id) return;                  // игрок сам закрыл панель крестиком

    const m = model(S, p, pad);
    const key = pad.id + '|' + m.tab + '|' + m.rows.map(r => r.name + ':' + r.off + ':' + JSON.stringify(r.cost)).join(';');
    if (key !== panel.key) {
      if (!panel.key && ZB.Sound) ZB.Sound.play('open');      // панель только что выехала
      panel.key = key; panel.padId = pad.id; buildPanel(m, pad); panel.el.classList.add('open');
    }

    // серые карточки и «чего не хватает»
    for (const row of panel.rows) {
      const r = row.r;
      let st = r.off ? 'off:' + r.off : 'ok', miss = '';
      if (!r.off) for (const res of Sim.RES) {
        const lackN = (r.cost[res] || 0) - p.res[res];
        if (lackN > 0) { miss += res + lackN + ','; }
      }
      if (miss) st = 'lack:' + miss;
      if (st === row.state) continue;
      row.state = st;
      row.card.classList.toggle('off', st !== 'ok');
      for (const res in row.chips) row.chips[res].classList.toggle('lack', !r.off && p.res[res] < r.cost[res]);
      row.lack.innerHTML = '';
      const showLack = st !== 'ok';
      row.desc.classList.toggle('hidden', showLack);
      row.lack.classList.toggle('hidden', !showLack);
      if (r.off) row.lack.textContent = r.off;
      else if (miss) {
        row.lack.appendChild(document.createTextNode('Не хватает: '));
        for (const res of Sim.RES) {
          const lackN = (r.cost[res] || 0) - p.res[res];
          if (lackN <= 0) continue;
          row.lack.appendChild(iconEl(res, 16, null));
          row.lack.appendChild(document.createTextNode(lackN + ' '));
        }
      }
    }
  };
})();
