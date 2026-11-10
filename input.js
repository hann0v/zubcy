/* ============================================================
   «Зубцы» — управление.
   Телефон: плавающий джойстик — появляется там, куда лёг палец.
   Компьютер: клавиши WASD / стрелки или мышь (зажать и тянуть).
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB;
  const Input = ZB.Input = {};
  const RADIUS = 56;                  // насколько далеко отклоняется ручка джойстика (в пикселях)
  const keys = {};
  const joy = { on: false, id: -1, bx: 0, by: 0, x: 0, y: 0 };
  const out = { x: 0, y: 0 };
  let base, knob, area;

  Input.init = function (canvas) {
    area = canvas;
    base = document.getElementById('joy');
    knob = document.getElementById('joy-knob');

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);

    const typing = e => e.target && e.target.tagName === 'INPUT';       // пока игрок печатает имя или код — клавиши не трогаем
    window.addEventListener('keydown', e => { if (typing(e)) return; keys[e.code] = true; if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault(); });
    window.addEventListener('keyup', e => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; release(); });

    // Запрещаем браузеру всё, что мешает игре: прокрутку, зум, меню по долгому нажатию, выделение
    const stop = e => e.preventDefault();
    // в меню и в комнате список можно прокручивать пальцем (класс scroll), всё остальное — нет
    document.addEventListener('touchmove', e => { if (!(e.target.closest && e.target.closest('.scroll'))) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    document.addEventListener('contextmenu', stop);
    document.addEventListener('selectstart', e => { if (!typing(e)) e.preventDefault(); });
    document.addEventListener('dblclick', stop);
    // Страница не должна «уезжать» (на телефоне такое бывает после ввода с клавиатуры) — возвращаем на место
    const unscroll = () => {
      if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
      if (document.body.scrollTop || document.body.scrollLeft) { document.body.scrollTop = 0; document.body.scrollLeft = 0; }
      const de = document.documentElement;
      if (de.scrollTop || de.scrollLeft) { de.scrollTop = 0; de.scrollLeft = 0; }
    };
    window.addEventListener('scroll', unscroll, { passive: true });
    document.body.addEventListener('scroll', unscroll, { passive: true });
    document.addEventListener('focusout', () => setTimeout(unscroll, 60));
    Input.unscroll = unscroll;
    let lastTouch = 0;                // двойной тап не должен увеличивать страницу
    document.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTouch < 320 && !(e.target.closest && e.target.closest('button, a, input'))) e.preventDefault();
      lastTouch = now;
    }, { passive: false });
  };

  function down(e) {
    if (joy.on || (e.pointerType === 'mouse' && e.button !== 0)) return;
    joy.on = true; joy.id = e.pointerId;
    joy.bx = joy.x = e.clientX; joy.by = joy.y = e.clientY;
    try { area.setPointerCapture(e.pointerId); } catch (err) { /* не страшно */ }
    base.classList.remove('hidden');
    show();
    e.preventDefault();
  }
  function move(e) {
    if (!joy.on || e.pointerId !== joy.id) return;
    joy.x = e.clientX; joy.y = e.clientY;
    // если палец ушёл далеко — основание джойстика «догоняет» его
    const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy);
    if (d > RADIUS * 1.25) { const k = (d - RADIUS * 1.25) / d; joy.bx += dx * k; joy.by += dy * k; }
    show();
  }
  function up(e) { if (joy.on && e.pointerId === joy.id) release(); }
  function release() { joy.on = false; joy.id = -1; if (base) base.classList.add('hidden'); }

  function show() {
    const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy), k = d > RADIUS ? RADIUS / d : 1;
    base.style.transform = 'translate(' + (joy.bx - 62) + 'px,' + (joy.by - 62) + 'px)';
    knob.style.transform = 'translate(' + (dx * k) + 'px,' + (dy * k) + 'px)';
  }

  // Куда игрок хочет идти: x и y от -1 до 1
  Input.get = function () {
    if (joy.on) {
      const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy);
      const dead = RADIUS * 0.16;                             // маленькая «мёртвая зона» в центре
      if (d < dead) { out.x = 0; out.y = 0; }
      else { const m = Math.min(1, (d - dead) / (RADIUS - dead)); out.x = dx / d * m; out.y = dy / d * m; }
      return out;
    }
    let x = 0, y = 0;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyW || keys.ArrowUp) y -= 1;
    if (keys.KeyS || keys.ArrowDown) y += 1;
    const d = Math.hypot(x, y);
    out.x = d ? x / d : 0; out.y = d ? y / d : 0;
    return out;
  };

  Input.reset = function () { release(); for (const k in keys) keys[k] = false; };
})();
