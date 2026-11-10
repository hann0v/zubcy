/* ============================================================
   «Зубцы» — мини-карта в углу экрана.
   Нажатие увеличивает её на пол-экрана, второе — уменьшает обратно.
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG, TAU = Math.PI * 2;
  const M = ZB.Mini = {};
  let cv, c, bg = null, map = null;
  let big = false, w = 60, h = 100, sc = 0.03, dpr = 1, frame = 0;

  M.init = function (canvas) {
    cv = canvas;
    c = cv.getContext('2d');
    // pointerdown, а не click: срабатывает сразу, без задержки на телефоне
    cv.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); M.toggle(); });
  };

  M.toggle = function (v) {
    if (v == null && ZB.Sound) ZB.Sound.play('click');
    big = v == null ? !big : !!v;
    cv.classList.toggle('big', big);
    layout();
  };

  M.reset = function (S) { map = S.map; big = false; cv.classList.remove('big'); layout(); };
  M.resize = function () { layout(); };

  // Размер карты и её неподвижный фон (трава, дороги, базы) — рисуем один раз
  function layout() {
    if (!map) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxW = big ? Math.min(window.innerWidth * 0.86, 420) : 72;
    const maxH = big ? window.innerHeight * 0.6 : 116;
    sc = Math.min(maxW / map.w, maxH / map.h);
    w = Math.round(map.w * sc); h = Math.round(map.h * sc);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';

    bg = document.createElement('canvas');
    bg.width = cv.width; bg.height = cv.height;
    const g = bg.getContext('2d');
    g.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
    g.fillStyle = '#7fc24b'; g.fillRect(0, 0, map.w, map.h);
    g.lineCap = 'round'; g.strokeStyle = g.fillStyle = '#ead49a';
    g.lineWidth = Math.max(90, 2 / sc);
    for (const rd of map.roads) { g.beginPath(); g.moveTo(rd.x0, rd.y0); g.quadraticCurveTo(rd.cx, rd.cy, rd.x1, rd.y1); g.stroke(); }
    g.beginPath(); g.arc(map.cx, map.cy, 205, 0, TAU); g.fill();
    for (const b of map.bases) { g.beginPath(); g.arc(b.x, b.y, 328, 0, TAU); g.fill(); }
    if (big) {                                  // на большой карте видны лес и руда
      for (const nd of map.nodes) {
        g.fillStyle = nd.kind === 'tree' ? '#2f8a57' : '#7b8794';
        g.beginPath(); g.arc(nd.x, nd.y, nd.kind === 'tree' ? 17 : 22, 0, TAU); g.fill();
      }
    }
    frame = 0;
  }

  // view — прямоугольник мира, который сейчас виден на экране
  M.draw = function (S, me, view) {
    if (!map || !bg) return;
    if (frame++ % (big ? 3 : 6)) return;        // перерисовываем не каждый кадр — бережём батарею
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(bg, 0, 0);
    c.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
    const px = 1 / sc;                           // один пиксель мини-карты в единицах мира
    const col = pid => CFG.COLORS[S.players[pid].color].main;

    // лагеря, где ещё есть Ворчуны (там золото)
    for (const cp of S.camps) {
      if (!(cp.alive != null ? cp.alive : cp.spots.some(sp => sp.unit && !sp.unit.dead))) continue;
      c.fillStyle = '#2e2218'; c.beginPath(); c.arc(cp.x, cp.y, 3.4 * px, 0, TAU); c.fill();
      c.fillStyle = '#ffb02e'; c.beginPath(); c.arc(cp.x, cp.y, 2.3 * px, 0, TAU); c.fill();
    }
    // здания
    for (const b of S.buildings) {
      if (b.dead) continue;
      const s = (b.kind === 'citadel' ? (big ? 7 : 4.2) : (big ? 3.4 : 2)) * px;
      c.fillStyle = '#2e2218'; c.fillRect(b.x - s - px, b.y - s - px, s * 2 + px * 2, s * 2 + px * 2);
      c.fillStyle = col(b.owner); c.fillRect(b.x - s, b.y - s, s * 2, s * 2);
    }
    // бойцы — точками, герои — крупнее и с белой обводкой
    const s = (big ? 2 : 1.2) * px;
    if (S.mini) {                                // онлайн: сервер присылает точки всего войска на карте
      const m = S.mini;
      for (let i = 0; i + 2 < m.length; i += 3) {
        if (!S.players[m[i + 2]]) continue;
        c.fillStyle = col(m[i + 2]);
        c.fillRect(m[i] / 255 * map.w - s, m[i + 1] / 255 * map.h - s, s * 2, s * 2);
      }
    } else for (const u of S.units) {
      if (u.dead || u.owner < 0 || u.kind === 'hero') continue;
      c.fillStyle = col(u.owner);
      c.fillRect(u.x - s, u.y - s, s * 2, s * 2);
    }
    for (const p of S.players) {
      const u = p.hero;
      if (!p.alive || u.dead) continue;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(u.x, u.y, (big ? 5.5 : 3.8) * px, 0, TAU); c.fill();
      c.fillStyle = col(p.id); c.beginPath(); c.arc(u.x, u.y, (big ? 4 : 2.6) * px, 0, TAU); c.fill();
    }
    // базу бьют — мигает красным
    for (const p of S.players) {
      if (!p.alive || S.time - p.underAttackT > 3 || Math.floor(S.time * 4) % 2) continue;
      c.strokeStyle = '#ff3b2f'; c.lineWidth = 2.5 * px;
      c.beginPath(); c.arc(p.base.x, p.base.y, 360, 0, TAU); c.stroke();
    }
    // рамка: что сейчас видно на экране
    c.strokeStyle = '#fff'; c.lineWidth = 1.5 * px;
    c.strokeRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    void me;
  };
})();
