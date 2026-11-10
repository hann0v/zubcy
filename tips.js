/* ============================================================
   «Зубцы» — подсказки для новичка.

   Короткие карточки: появляются, когда игрок впервые с чем-то
   сталкивается (первое дерево, первый боец, первая атака на базу…).
   Каждая показывается один раз — браузер запоминает, какие уже
   были. Подсказки можно выключить в меню; если включить снова,
   они начнутся сначала.
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG;
  const T = ZB.Tips = {};
  const SEEN = 'zubcy-tips-seen', OFF = 'zubcy-tips-off';
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  let seen = new Set(), off = false;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')); off = localStorage.getItem(OFF) === '1'; } catch (e) { /* не страшно */ }
  const save = () => { try { localStorage.setItem(SEEN, JSON.stringify(Array.from(seen))); localStorage.setItem(OFF, off ? '1' : '0'); } catch (e) { /* не страшно */ } };

  let el = null, queue = [], cur = null, curT = 0, gapT = 0;

  // ---------- все подсказки: когда показать и что сказать ----------
  // when(ctx) → true, когда пора показать. ctx = { S, me, p, h, t, panel, mode }
  const enemyCit = c => c.S.buildings.find(b => b.kind === 'citadel' && !b.dead && c.S.players[b.owner].team !== c.p.team &&
    Math.hypot(b.x - c.h.x, b.y - c.h.y) < CFG.BUILDINGS.citadel.atk.range[0] + 40);
  const has = (c, kind) => c.p.buildings.some(b => b.kind === kind && !b.dead);
  const LIST = [
    { id: 'alert', icon: 'citadel', title: 'Базу атакуют!', urgent: true,
      text: 'Красная стрелка у края экрана ведёт домой. Цитадель и башни отстреливаются, но лучше вернуться с войском.',
      when: c => c.S.time - c.p.underAttackT < 2 && c.S.time > 5 },
    { id: 'dead', icon: 'hp', title: 'Герой пал', urgent: true,
      text: 'Он вернётся у Цитадели через несколько секунд. Добытые ресурсы не пропадают.',
      when: c => c.p.alive && c.h.dead },
    { id: 'range', icon: 'attack', title: 'Осторожно, обстрел!', urgent: true,
      text: 'Цитадель стреляет по всем внутри своего круга. Иди туда с войском — а тараны быстро ломают стены.',
      when: c => !c.h.dead && !!enemyCit(c) },
    { id: 'move', icon: 'follow', title: 'Управление',
      text: touch ? 'Веди пальцем по экрану — появится джойстик, и герой пойдёт за пальцем. Отпусти — герой остановится.'
                  : 'Ходи клавишами WASD или стрелками (или зажми мышь и тяни). Приказы войску — клавиши 1, 2, 3.',
      when: c => c.t > 1.2 },
    { id: 'harvest', icon: 'wood', title: 'Добыча',
      text: 'Стоя рядом с ёлкой или рудой, герой добывает сам. Добытое копится стопкой за спиной и тратится на площадках.',
      when: c => c.p.res.wood + c.p.res.iron >= 6 },
    { id: 'slot', icon: 'plus', title: 'Постройки',
      text: 'Вокруг Цитадели 8 мест — на всё не хватит. Выбери путь: Добыча, Защита, Армия или Прокачка.',
      when: c => c.panel === 'slot' },
    { id: 'army', icon: 'army', title: 'Войско',
      text: 'Бойцы идут за героем строем и сами вступают в бой. Кнопки справа внизу — приказы войску.',
      when: c => c.p.army.length >= 1 },
    { id: 'upgrade', icon: 'up', title: 'Улучшения',
      text: 'Площадка со стрелкой вверх улучшает здание. У каждого здания 3 уровня, цена — в дереве и золоте.',
      when: c => c.p.buildings.some(b => b.kind !== 'citadel' && !b.dead) && c.t > 20 },
    { id: 'gold', icon: 'gold', title: 'Золото',
      text: 'Золото падает с врагов и с Ворчунов у сундуков в центре карты. Оно нужно для улучшений и Кузницы.',
      when: c => c.p.res.gold > 0 },
    { id: 'orders', icon: 'hold', title: 'Приказы',
      text: '«Держать позицию» — войско стоит у флажка, а герой свободен. «В атаку» — бойцы сами бросаются на всех врагов рядом с героем.',
      when: c => c.p.army.length >= 4 },
    { id: 'workers', icon: 'sawmill', title: 'Рабочие',
      text: 'Лесопилка и Рудник выпускают рабочих — они сами носят ресурсы. Враги могут их перебить, береги их.',
      when: c => has(c, 'sawmill') || has(c, 'mine') },
    { id: 'counter', icon: 'sword', title: 'Кто кого бьёт',
      text: 'Мечник сильнее всадника, лучник — мечника, всадник — лучника. Таран бьёт только здания.',
      when: c => ['barracks', 'range', 'stable', 'workshop'].filter(k => has(c, k)).length >= 2 },
    { id: 'forge', icon: 'forge', title: 'Кузница',
      text: 'Встань на площадку у Кузницы: там улучшают урон, здоровье и скорость каждого вида войск.',
      when: c => has(c, 'forge') },
    { id: 'cap', icon: 'army', title: 'Лимит войска',
      text: 'Каждое здание армии добавляет места в войске, а его улучшения — ещё. Больше 40 нельзя.',
      when: c => c.S.pads.some(q => q.on && q.blocked === 'cap') },
    { id: 'minimap', icon: 'tip', title: 'Мини-карта',
      text: 'Нажми на карту в углу' + (touch ? '' : ' (или клавишу M)') + ', чтобы увеличить её. Квадраты — здания, точки — войска, кружки — герои.',
      when: c => c.t > 80 },
  ];

  T.init = function () {
    el = document.getElementById('tip');
    el.addEventListener('click', () => close());              // нажал — подсказка убирается
  };
  T.enabled = () => !off;
  T.set = function (v) {
    off = !v;
    if (v) seen.clear();                                       // включили снова — показываем все подсказки заново
    save();
    if (off) close();
  };

  T.reset = function () {
    queue = []; cur = null; gapT = 2;
    if (el) el.classList.add('hidden');
    const hud = document.getElementById('hud'); if (hud) hud.classList.remove('tipping');
  };

  function close() {
    if (!cur) return;
    cur = null; gapT = 3;                                      // между подсказками — небольшая пауза
    el.classList.add('hidden');
    document.getElementById('hud').classList.remove('tipping');
  }

  function show(tip) {
    cur = tip;
    seen.add(tip.id); save();                                  // «показана» — только когда игрок её действительно увидел
    curT = Math.max(6, 2.5 + tip.text.length * 0.055);         // сколько секунд висит: длиннее текст — дольше
    el.innerHTML = '';
    const cv = document.createElement('canvas');
    cv.dataset.icon = tip.icon; cv.dataset.size = '40';
    const box = document.createElement('div');
    const b = document.createElement('b'); b.textContent = tip.title;
    const p = document.createElement('span'); p.textContent = tip.text;
    const x = document.createElement('i'); x.textContent = 'нажми, чтобы закрыть';
    box.appendChild(b); box.appendChild(p); box.appendChild(x);
    el.appendChild(cv); el.appendChild(box);
    ZB.HUD.paintIcon(cv, ZB.HUD.color());
    const row = document.getElementById('row3').getBoundingClientRect();   // ставим карточку на место строки «что делать»
    el.style.top = Math.round(row.top) + 'px';
    document.getElementById('hud').classList.add('tipping');
    el.classList.remove('hidden');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    if (ZB.Sound) ZB.Sound.play('tip');
  }

  // Вызывается несколько раз в секунду во время матча
  T.update = function (ctx, dt) {
    if (off || !el) return;
    if (cur) { curT -= dt; if (curT <= 0) close(); }
    else if (gapT > 0) gapT -= dt;
    if (ctx.S.over) return;
    for (const tip of LIST) {
      if (seen.has(tip.id) || queue.includes(tip)) continue;
      let ok = false;
      try { ok = tip.when(ctx); } catch (e) { ok = false; }
      if (!ok) continue;
      if (tip.urgent) queue.unshift(tip); else queue.push(tip);
    }
    if (!queue.length) return;
    // срочная подсказка вытесняет обычную
    if (cur && queue[0].urgent && !cur.urgent) { close(); gapT = 0; }
    if (!cur && gapT <= 0) show(queue.shift());
  };
})();
