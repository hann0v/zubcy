/* ============================================================
   «Зубцы» — рисование. Вся графика игры рисуется кодом:
   герои, бойцы, здания, деревья, иконки. Картинок-файлов нет.
   Каждая функция рисует объект так, будто он стоит в точке (0, 0).
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, TAU = Math.PI * 2;
  const D = ZB.Draw = {};
  const OUT = '#2e2218';     // цвет тёмной обводки — общий для всего
  const SKIN = '#ffd9b0';
  const WOOD = '#cf9a62', STONE = '#ddd6c6', STEEL = '#c3cfdb';
  D.OUT = OUT;
  D.FONT = '"Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  // ---------- маленькие помощники ----------
  function rr(c, x, y, w, h, r) {           // прямоугольник со скруглёнными углами
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function fs(c, fill, stroke, lw) {         // залить и обвести
    c.fillStyle = fill; c.fill();
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 2; c.stroke(); }
  }
  function poly(c, pts) {                    // многоугольник по списку координат [x1, y1, x2, y2, ...]
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath();
  }
  function shadow(c, rx, ry) {
    c.fillStyle = 'rgba(25,45,10,0.26)';
    c.beginPath(); c.ellipse(0, 1, rx, ry, 0, 0, TAU); c.fill();
  }
  function dot(c, x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }
  function star(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.45 : r;
      c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
    }
    c.closePath(); fs(c, '#ffd23f', OUT, 1.5);
  }
  function tint(c, alpha, fn) {              // полупрозрачная заливка, не ломающая общую прозрачность
    const ga = c.globalAlpha; c.globalAlpha = ga * alpha; fn(); c.globalAlpha = ga;
  }
  D.rr = rr; D.fs = fs; D.shadow = shadow;

  // Белый текст с тёмной обводкой — читается на любом фоне
  D.text = function (c, s, x, y, size, color, align) {
    c.font = '900 ' + size + 'px ' + D.FONT;
    c.textAlign = align || 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = Math.max(3, size * 0.28);
    c.strokeStyle = OUT; c.strokeText(s, x, y);
    c.fillStyle = color || '#fff'; c.fillText(s, x, y);
  };

  D.hpBar = function (c, y, w, frac, color) {
    rr(c, -w / 2 - 1.5, y - 1.5, w + 3, 7, 3.5); c.fillStyle = OUT; c.fill();
    if (frac > 0) { rr(c, -w / 2, y, Math.max(4, w * Math.min(1, frac)), 4, 2); c.fillStyle = color; c.fill(); }
  };

  // =====================================================================
  //  ИКОНКИ (рисуются в условном квадрате 32×32 с центром в нуле)
  // =====================================================================
  function iconBlade(c) {
    poly(c, [0, -17, 3, -13, 3, 5, -3, 5, -3, -13]); fs(c, '#f2f6fa', OUT, 2);
    rr(c, -7.5, 4, 15, 4.5, 2); fs(c, '#ffcf33', OUT, 2);
    rr(c, -2.2, 8, 4.4, 8, 2); fs(c, '#8a5a33', OUT, 2);
  }

  D.icon = function (c, name, size, col) {
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    const k = size / 32; c.scale(k, k);
    const main = col ? col.main : '#e8413c';
    switch (name) {
      // ---- ресурсы ----
      case 'wood':
        c.rotate(-0.3);
        rr(c, -13, -6, 26, 12, 5); fs(c, '#b0703a', OUT, 2.2);
        c.strokeStyle = '#7d4b22'; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(-9, -1.5); c.lineTo(1, -1.5); c.moveTo(-6, 2.5); c.lineTo(3, 2.5); c.stroke();
        c.beginPath(); c.ellipse(9.5, 0, 4, 6, 0, 0, TAU); fs(c, '#efc48a', OUT, 2);
        c.beginPath(); c.ellipse(9.5, 0, 1.5, 2.6, 0, 0, TAU); c.strokeStyle = '#b0703a'; c.lineWidth = 1.3; c.stroke();
        break;
      case 'iron':
        poly(c, [-14, 8, -9, -2, 8, -2, 11, 8]); fs(c, '#8fa0b3', OUT, 2.2);
        poly(c, [-9, -2, -4, -9, 12, -9, 8, -2]); fs(c, '#dbe4ed', OUT, 2.2);
        poly(c, [8, -2, 12, -9, 15, 1, 11, 8]); fs(c, '#6f8196', OUT, 2.2);
        break;
      case 'gold':
        c.beginPath(); c.arc(0, 0, 12, 0, TAU); fs(c, '#ffd23f', '#6b4700', 2.4);
        c.beginPath(); c.arc(0, 0, 7.5, 0, TAU); c.strokeStyle = '#c98f0a'; c.lineWidth = 2; c.stroke();
        dot(c, -3.5, -4, 2.2, '#fff8d2');
        break;
      case 'army':    // шлем
        c.beginPath(); c.moveTo(-2, -9); c.quadraticCurveTo(7, -19, 13, -8); c.quadraticCurveTo(6, -11, 2, -8); c.closePath(); fs(c, main, OUT, 2);
        c.beginPath(); c.arc(0, 1, 11, Math.PI, 0);
        c.lineTo(11, 10); c.lineTo(4, 10); c.lineTo(4, 3); c.lineTo(-4, 3); c.lineTo(-4, 10); c.lineTo(-11, 10); c.closePath();
        fs(c, '#d5dce6', OUT, 2.2);
        break;

      // ---- войска ----
      case 'sword':
        c.rotate(Math.PI / 4); iconBlade(c);
        break;
      case 'archer':  // лук со стрелой
        c.strokeStyle = OUT; c.lineWidth = 6; c.beginPath(); c.arc(-4, 0, 12.5, -1.15, 1.15); c.stroke();
        c.strokeStyle = '#c98b4f'; c.lineWidth = 2.8; c.beginPath(); c.arc(-4, 0, 12.5, -1.15, 1.15); c.stroke();
        c.strokeStyle = OUT; c.lineWidth = 1.5; c.beginPath(); c.moveTo(1.1, -11.4); c.lineTo(1.1, 11.4); c.stroke();
        c.lineWidth = 2.6; c.beginPath(); c.moveTo(-13, 0); c.lineTo(9, 0); c.stroke();
        poly(c, [15, 0, 8, -4.6, 8, 4.6]); fs(c, '#dbe4ed', OUT, 1.6);
        break;
      case 'rider':   // голова коня
        c.beginPath(); c.moveTo(-9, 13); c.lineTo(-8, 0); c.quadraticCurveTo(-7, -11, 1, -14); c.lineTo(3, -9);
        c.quadraticCurveTo(11, -4, 13, 3); c.lineTo(9, 7); c.quadraticCurveTo(4, 2, 2, 4); c.lineTo(5, 13); c.closePath();
        fs(c, '#a9713d', OUT, 2.2);
        c.beginPath(); c.moveTo(-8, 1); c.quadraticCurveTo(-13, -9, -2, -15); c.lineTo(1, -14); c.quadraticCurveTo(-6, -10, -5, 1); c.closePath(); fs(c, '#5c3d26', OUT, 1.6);
        dot(c, 4.5, -5, 1.7, OUT);
        break;
      case 'ram':     // бревно с железным наконечником на колёсах
        rr(c, -14, -8, 23, 10, 4); fs(c, '#b0703a', OUT, 2.2);
        poly(c, [8, -10, 15, -3, 8, 4]); fs(c, '#8fa0b3', OUT, 2.2);
        c.beginPath(); c.arc(-7, 8, 4.6, 0, TAU); fs(c, '#7d4b22', OUT, 2);
        c.beginPath(); c.arc(4, 8, 4.6, 0, TAU); fs(c, '#7d4b22', OUT, 2);
        break;

      // ---- здания ----
      case 'barracks':
        rr(c, -10, -3, 20, 15, 2.5); fs(c, WOOD, OUT, 2.2);
        rr(c, -3.5, 3, 7, 9, 2); fs(c, '#5c3d26', OUT, 1.6);
        poly(c, [-14, -2, -7, -14, 7, -14, 14, -2]); fs(c, main, OUT, 2.2);
        break;
      case 'range':   // мишень
        c.beginPath(); c.arc(0, 0, 13, 0, TAU); fs(c, '#fff', OUT, 2.2);
        c.beginPath(); c.arc(0, 0, 8.6, 0, TAU); fs(c, '#e8413c', OUT, 1.4);
        dot(c, 0, 0, 4.4, '#fff'); dot(c, 0, 0, 1.8, '#e8413c');
        break;
      case 'stable':  // подкова
        c.strokeStyle = OUT; c.lineWidth = 9; c.beginPath(); c.arc(0, -1, 9, Math.PI * 0.72, Math.PI * 0.28); c.stroke();
        c.strokeStyle = STEEL; c.lineWidth = 5; c.beginPath(); c.arc(0, -1, 9, Math.PI * 0.72, Math.PI * 0.28); c.stroke();
        dot(c, -8, -4, 1.2, OUT); dot(c, 8, -4, 1.2, OUT); dot(c, 0, -10, 1.2, OUT);
        break;
      case 'workshop': // шестерёнка
        for (let i = 0; i < 8; i++) { c.save(); c.rotate(i * TAU / 8); rr(c, -3, -14, 6, 7, 1.5); fs(c, STEEL, OUT, 2); c.restore(); }
        c.beginPath(); c.arc(0, 0, 9.5, 0, TAU); fs(c, STEEL, OUT, 2);
        dot(c, 0, 0, 3.6, OUT);
        break;
      case 'forge':   // наковальня
        poly(c, [-12, -8, 10, -8, 14, -4, 5, -1, 4, 4, 9, 10, -9, 10, -4, 4, -5, -1, -13, -3]); fs(c, '#7f8b98', OUT, 2.2);
        c.strokeStyle = '#dbe4ed'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-9, -5.5); c.lineTo(8, -5.5); c.stroke();
        break;
      case 'sawmill': // пила
        c.beginPath();
        for (let i = 0; i < 20; i++) { const a = i * TAU / 20, q = i % 2 ? 9.5 : 13.5; c.lineTo(Math.cos(a) * q, Math.sin(a) * q); }
        c.closePath(); fs(c, STEEL, OUT, 2);
        dot(c, 0, 0, 3.4, '#7d4b22');
        break;
      case 'mine':    // кирка
        c.rotate(-0.6);
        rr(c, -1.9, -9, 3.8, 23, 1.6); fs(c, '#b0703a', OUT, 2);
        c.beginPath(); c.moveTo(-13, -5); c.quadraticCurveTo(0, -16, 13, -5); c.quadraticCurveTo(0, -9.5, -13, -5); c.closePath(); fs(c, STEEL, OUT, 2);
        break;
      case 'market':  // прилавок с полосатым навесом
        rr(c, -11, 1, 22, 12, 2); fs(c, WOOD, OUT, 2.2);
        poly(c, [-14, -2, -10, -13, 10, -13, 14, -2]); fs(c, main, OUT, 2.2);
        c.fillStyle = '#fff'; poly(c, [-6.5, -11.8, -2, -11.8, -2.8, -3.2, -9.2, -3.2]); c.fill(); poly(c, [2, -11.8, 6.5, -11.8, 9.2, -3.2, 2.8, -3.2]); c.fill();
        dot(c, 0, 7, 3, '#ffd23f');
        break;
      case 'tower':
        rr(c, -6, -5, 12, 19, 1.5); fs(c, STONE, OUT, 2.2);
        rr(c, -9.5, -10, 19, 6, 1.5); fs(c, '#ece6d8', OUT, 2.2);
        poly(c, [-10.5, -10, 0, -18, 10.5, -10]); fs(c, main, OUT, 2.2);
        rr(c, -1.5, 0, 3, 7, 1.2); c.fillStyle = OUT; c.fill();
        break;
      case 'palisade': // три заострённых бревна
        for (let i = -1; i <= 1; i++) { const x = i * 8.5; poly(c, [x - 4, 13, x - 4, -6, x, -13 - (i ? 0 : 2), x + 4, -6, x + 4, 13]); fs(c, '#b98852', OUT, 2); }
        c.fillStyle = main; c.fillRect(-12.5, 2, 25, 4); c.strokeStyle = OUT; c.lineWidth = 1.6; c.strokeRect(-12.5, 2, 25, 4);
        break;
      case 'citadel':
        rr(c, -8, -6, 16, 20, 2); fs(c, STONE, OUT, 2.2);
        c.fillStyle = main; c.fillRect(-7, -4, 14, 4);
        rr(c, -11.5, -11, 23, 6, 1.5); fs(c, '#ece6d8', OUT, 2.2);
        for (let i = 0; i < 3; i++) { rr(c, -11.5 + i * 8.5, -16, 6, 6, 1.2); fs(c, '#ece6d8', OUT, 2); }
        c.beginPath(); c.moveTo(-3, 14); c.lineTo(-3, 7); c.arc(0, 7, 3, Math.PI, 0); c.lineTo(3, 14); c.closePath(); fs(c, '#5c3d26', OUT, 1.5);
        break;

      // ---- действия ----
      case 'up':
        c.beginPath(); c.arc(0, 0, 13, 0, TAU); fs(c, '#42c95b', OUT, 2.4);
        poly(c, [0, -9, 8, 0, 3.5, 0, 3.5, 8, -3.5, 8, -3.5, 0, -8, 0]); fs(c, '#fff', OUT, 1.8);
        break;
      case 'plus':
        c.beginPath(); c.arc(0, 0, 13, 0, TAU); fs(c, '#42c95b', OUT, 2.4);
        poly(c, [-2.8, -8, 2.8, -8, 2.8, -2.8, 8, -2.8, 8, 2.8, 2.8, 2.8, 2.8, 8, -2.8, 8, -2.8, 2.8, -8, 2.8, -8, -2.8, -2.8, -2.8]); fs(c, '#fff', OUT, 1.8);
        break;
      case 'trade':   // две встречные стрелки
        poly(c, [-12, -7, 4, -7, 4, -12, 13, -5, 4, 2, 4, -3, -12, -3]); fs(c, '#fff', OUT, 2);
        poly(c, [12, 7, -4, 7, -4, 12, -13, 5, -4, -2, -4, 3, 12, 3]); fs(c, '#ffd23f', OUT, 2);
        break;
      case 'follow':  // флажок — «за мной»
        c.strokeStyle = OUT; c.lineWidth = 3.6; c.beginPath(); c.moveTo(-8, 14); c.lineTo(-8, -14); c.stroke();
        c.beginPath(); c.moveTo(-7, -14); c.quadraticCurveTo(2, -16, 12, -9); c.quadraticCurveTo(3, -6, -7, -1); c.closePath(); fs(c, main, OUT, 2.2);
        break;
      case 'hold':    // щит — «держать позицию»
        c.beginPath(); c.moveTo(0, -14); c.lineTo(11.5, -9.5); c.lineTo(11.5, 1); c.quadraticCurveTo(10, 10, 0, 14.5); c.quadraticCurveTo(-10, 10, -11.5, 1); c.lineTo(-11.5, -9.5); c.closePath();
        fs(c, main, OUT, 2.4);
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(-2, -10, 4, 20); c.fillRect(-8, -3.5, 16, 4);
        break;
      case 'attack':  // скрещённые мечи — «в атаку»
        c.save(); c.rotate(-Math.PI / 4); c.scale(0.9, 0.9); iconBlade(c); c.restore();
        c.save(); c.rotate(Math.PI / 4); c.scale(0.9, 0.9); iconBlade(c); c.restore();
        break;
      case 'hp':      // сердце
        c.beginPath(); c.moveTo(0, 12); c.bezierCurveTo(-17, -1, -9, -15, 0, -5.5); c.bezierCurveTo(9, -15, 17, -1, 0, 12); c.closePath(); fs(c, '#ff5d6c', OUT, 2.3);
        dot(c, -5, -5, 2, '#ffc2c8');
        break;
      case 'spd':     // молния
        poly(c, [4, -14, -8, 2, -1, 2, -4, 14, 9, -3, 1, -3]); fs(c, '#ffd23f', OUT, 2.2);
        break;

      // ---- кнопки меню: звук, подсказки, правила ----
      case 'sound': case 'mute':     // динамик (с волнами или перечёркнутый)
        poly(c, [-13, -5, -6, -5, 3, -12, 3, 12, -6, 5, -13, 5]); fs(c, '#fff6de', OUT, 2.2);
        c.strokeStyle = OUT; c.lineWidth = 2.6;
        if (name === 'sound') {
          c.beginPath(); c.arc(4, 0, 6.5, -0.9, 0.9); c.stroke();
          c.beginPath(); c.arc(4, 0, 11.5, -0.9, 0.9); c.stroke();
        } else {
          c.strokeStyle = '#e8413c'; c.lineWidth = 3.4;
          c.beginPath(); c.moveTo(7, -6); c.lineTo(15, 6); c.moveTo(15, -6); c.lineTo(7, 6); c.stroke();
        }
        break;
      case 'tip':     // лампочка
        c.beginPath(); c.arc(0, -3, 10, Math.PI * 0.8, Math.PI * 0.2); c.lineTo(4, 8); c.lineTo(-4, 8); c.closePath(); fs(c, '#ffe14a', OUT, 2.2);
        rr(c, -5, 8, 10, 6, 2); fs(c, '#c3cfdb', OUT, 1.8);
        c.strokeStyle = '#fff8d2'; c.lineWidth = 2.2; c.beginPath(); c.arc(0, -3, 5.5, Math.PI * 1.1, Math.PI * 1.5); c.stroke();
        break;
      case 'help':    // вопросительный знак в круге
        c.beginPath(); c.arc(0, 0, 13, 0, TAU); fs(c, '#2f7df6', OUT, 2.4);
        c.strokeStyle = '#fff'; c.lineWidth = 3.6;
        c.beginPath(); c.arc(0, -4, 5, Math.PI * 1.05, Math.PI * 0.45); c.lineTo(0, 4); c.stroke();
        dot(c, 0, 8.6, 2.2, '#fff');
        break;
    }
    c.restore();
  };

  // =====================================================================
  //  ГЕРОЙ И БОЙЦЫ
  // =====================================================================
  function blade(c, ang, len) {              // меч; угол 0 — остриём вверх
    c.save(); c.rotate(ang);
    poly(c, [0, -len - 3, 2, -len, 2, 0, -2, 0, -2, -len]); fs(c, '#f2f6fa', OUT, 1.6);
    rr(c, -5, -2.5, 10, 3.6, 1.6); fs(c, '#ffcf33', OUT, 1.5);
    c.restore();
  }
  function swingAngle(atk) {                 // взмах во время удара
    if (atk <= 0) return 0.45;
    const s = 1 - atk / 0.25;
    return -1.1 + 3.0 * (1 - (1 - s) * (1 - s));
  }
  function thrust(atk, len) { return atk > 0 ? Math.sin((1 - atk / 0.25) * Math.PI) * len : 0; }   // выпад вперёд
  function feet(c, mv, ph, dx, rx) {
    const lg = mv ? Math.sin(ph) * dx * 0.7 : 0;
    c.fillStyle = OUT;
    c.beginPath(); c.ellipse(-dx + lg, -2, rx, rx * 0.7, 0, 0, TAU); c.fill();
    c.beginPath(); c.ellipse(dx - lg, -2, rx, rx * 0.7, 0, 0, TAU); c.fill();
  }
  function hurtFlash(c, u, x, y, w, h) {
    if (u.hurtT > 0) tint(c, 0.42, () => { c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU); c.fillStyle = '#fff'; c.fill(); });
  }
  function stackItem(c, kind, x, y) {        // одна «плашка» в стопке за спиной героя
    if (kind === 'wood') { rr(c, x - 7, y - 2.4, 14, 4.8, 2.3); fs(c, '#b0703a', OUT, 1.3); dot(c, x + 4.6, y, 1.4, '#efc48a'); }
    else if (kind === 'iron') { rr(c, x - 6, y - 2.4, 12, 4.8, 1.2); fs(c, STEEL, OUT, 1.3); }
    else { rr(c, x - 5, y - 2.4, 10, 4.8, 2.4); fs(c, '#ffd23f', '#6b4700', 1.3); }
  }

  // stack — список добытого («wood», «iron», «gold»), рисуется стопкой за спиной
  D.hero = function (c, u, col, t, stack) {
    const mv = u.moving, ph = t * 12 + u.id * 1.7;
    const bob = mv ? Math.abs(Math.sin(ph)) * 2.6 : Math.sin(t * 2.4 + u.id) * 0.7;
    shadow(c, 15, 6.5);
    c.save();
    c.scale(u.face, 1);
    feet(c, mv, ph, 5, 4.6);
    c.translate(0, -bob);
    if (stack) for (let i = 0; i < stack.length; i++) {
      stackItem(c, stack[i], -17 - (mv ? Math.sin(ph * 0.5 + i * 0.5) * i * 0.22 : 0), -8 - i * 4.7);
    }
    c.beginPath(); c.moveTo(-8, -23); c.quadraticCurveTo(-18 - (mv ? 3 : 0), -12, -13, -3); c.lineTo(-2, -4); c.closePath(); fs(c, col.dark, OUT, 2);   // плащ
    rr(c, -10, -24, 20, 21, 8); fs(c, col.main, OUT, 2.2);                                   // тело
    c.fillStyle = col.dark; c.fillRect(-9, -11.5, 18, 3.6);                                  // пояс
    c.fillStyle = '#ffcf33'; c.fillRect(-2.5, -12, 5, 4.6);
    c.beginPath(); c.arc(1, -31, 9.5, 0, TAU); fs(c, SKIN, OUT, 2.2);                         // голова
    dot(c, 3.5, -29.5, 1.5, OUT); dot(c, 8, -29.5, 1.5, OUT);
    rr(c, -2.5, -48, 7, 8, 3); fs(c, col.main, OUT, 1.8);                                    // гребень шлема
    c.beginPath(); c.arc(1, -33, 10.3, Math.PI, 0); c.closePath(); fs(c, '#e3e9f1', OUT, 2.2);
    c.save(); c.translate(10, -15); blade(c, swingAngle(u.atkAnim), 17);                      // рука с мечом
    c.beginPath(); c.arc(0, 0, 3.3, 0, TAU); fs(c, SKIN, OUT, 1.6); c.restore();
    hurtFlash(c, u, -12, -45, 26, 45);
    c.restore();
  };

  D.sword = function (c, u, col, t) {
    const mv = u.moving, ph = t * 13 + u.id * 2.1;
    const bob = mv ? Math.abs(Math.sin(ph)) * 2 : 0;
    shadow(c, 11, 5);
    c.save();
    c.scale(u.face, 1);
    feet(c, mv, ph, 4, 3.8);
    c.translate(0, -bob);
    rr(c, -7.5, -18, 15, 16, 6); fs(c, col.main, OUT, 2);
    c.beginPath(); c.arc(0.5, -23, 7.5, 0, TAU); fs(c, SKIN, OUT, 2);
    dot(c, 4.5, -22, 1.3, OUT);
    c.beginPath(); c.arc(0.5, -24.5, 8.2, Math.PI, 0); c.closePath(); fs(c, '#c9d2dd', OUT, 2);   // шлем
    c.save(); c.translate(8, -11); blade(c, swingAngle(u.atkAnim), 12); c.restore();
    c.beginPath(); c.arc(3.5, -9.5, 6, 0, TAU); fs(c, col.light, OUT, 2);                          // щит
    dot(c, 3.5, -9.5, 2, col.dark);
    hurtFlash(c, u, -9, -34, 19, 34);
    c.restore();
  };

  D.archer = function (c, u, col, t) {
    const mv = u.moving, ph = t * 13 + u.id * 2.1;
    const bob = mv ? Math.abs(Math.sin(ph)) * 2 : 0;
    shadow(c, 10, 4.6);
    c.save();
    c.scale(u.face, 1);
    feet(c, mv, ph, 3.8, 3.6);
    c.translate(0, -bob);
    c.save(); c.translate(-7, -14); c.rotate(-0.35); rr(c, -2.6, -8, 5.2, 14, 2); fs(c, '#8a5a33', OUT, 1.6); c.restore();   // колчан
    rr(c, -7, -17.5, 14, 15.5, 6); fs(c, col.main, OUT, 2);
    c.beginPath(); c.arc(0.5, -22.5, 7.2, 0, TAU); fs(c, SKIN, OUT, 2);
    dot(c, 4.3, -21.5, 1.3, OUT);
    c.beginPath(); c.moveTo(-7.5, -20); c.quadraticCurveTo(-8, -33, 2, -31.5); c.quadraticCurveTo(7, -30.5, 8, -26); c.quadraticCurveTo(0, -28, -3.5, -19.5); c.closePath();
    fs(c, col.dark, OUT, 1.8);                                                                     // капюшон
    const pull = thrust(u.atkAnim, 4);                                                             // тетива натягивается при выстреле
    c.save(); c.translate(10, -12);
    c.strokeStyle = OUT; c.lineWidth = 4.4; c.beginPath(); c.arc(-4, 0, 10, -1.1, 1.1); c.stroke();
    c.strokeStyle = '#d9a066'; c.lineWidth = 2; c.beginPath(); c.arc(-4, 0, 10, -1.1, 1.1); c.stroke();
    c.strokeStyle = '#fff'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(0.5, -8.9); c.lineTo(0.5 - pull, 0); c.lineTo(0.5, 8.9); c.stroke();
    c.restore();
    hurtFlash(c, u, -9, -33, 19, 33);
    c.restore();
  };

  D.rider = function (c, u, col, t) {
    const mv = u.moving, ph = t * 15 + u.id * 1.3;
    const bob = mv ? Math.abs(Math.sin(ph)) * 2.4 : Math.sin(t * 2.2 + u.id) * 0.5;
    shadow(c, 18, 6.5);
    c.save();
    c.scale(u.face, 1);
    const lg = mv ? Math.sin(ph) * 4 : 0;                                                          // ноги коня
    c.strokeStyle = OUT; c.lineWidth = 4.6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-9, -9); c.lineTo(-10 - lg, -1); c.moveTo(-4, -9); c.lineTo(-4 + lg, -1);
    c.moveTo(7, -9); c.lineTo(7 - lg, -1); c.moveTo(11, -9); c.lineTo(12 + lg, -1); c.stroke();
    c.translate(0, -bob);
    c.beginPath(); c.moveTo(-13, -18); c.quadraticCurveTo(-23, -16, -19, -6); c.quadraticCurveTo(-16, -11, -12, -12); c.closePath(); fs(c, '#5c3d26', OUT, 1.6);   // хвост
    c.beginPath(); c.ellipse(0, -14, 15, 8.5, 0, 0, TAU); fs(c, '#a9713d', OUT, 2);                // тело коня
    poly(c, [-8, -21.5, 6, -21.5, 7, -9.5, -9, -9.5]); fs(c, col.main, OUT, 1.8);                 // попона цвета игрока
    poly(c, [8, -20, 14, -31, 18, -34, 21, -29, 26, -25, 24, -20.5, 17, -22, 14, -11]); fs(c, '#a9713d', OUT, 2);   // шея и голова
    dot(c, 19.5, -28, 1.3, OUT);
    poly(c, [9, -22, 14, -32, 11, -31.5, 6, -21]); c.fillStyle = '#5c3d26'; c.fill();              // грива
    rr(c, -6, -34, 12, 14, 5); fs(c, col.main, OUT, 2);                                            // всадник
    c.beginPath(); c.arc(0.5, -39, 6.6, 0, TAU); fs(c, SKIN, OUT, 2);
    dot(c, 4, -38.5, 1.2, OUT);
    c.beginPath(); c.arc(0.5, -40.5, 7.2, Math.PI, 0); c.closePath(); fs(c, '#c9d2dd', OUT, 1.8);
    const th = thrust(u.atkAnim, 8);                                                               // копьё
    c.strokeStyle = OUT; c.lineWidth = 3.8; c.beginPath(); c.moveTo(-6 + th, -24); c.lineTo(22 + th, -33); c.stroke();
    c.strokeStyle = '#d9a066'; c.lineWidth = 1.7; c.beginPath(); c.moveTo(-6 + th, -24); c.lineTo(20 + th, -32.4); c.stroke();
    poly(c, [28 + th, -35, 20 + th, -36, 21.5 + th, -30]); fs(c, '#f2f6fa', OUT, 1.4);
    hurtFlash(c, u, -17, -47, 42, 47);
    c.restore();
  };

  D.ram = function (c, u, col, t) {
    const mv = u.moving, ph = t * 6 + u.id;
    shadow(c, 23, 8);
    c.save();
    c.scale(u.face, 1);
    const hit = thrust(u.atkAnim, 10);
    c.strokeStyle = OUT; c.lineWidth = 4; c.lineCap = 'round';                                     // рама
    c.beginPath(); c.moveTo(-13, -5); c.lineTo(-10, -27); c.moveTo(10, -5); c.lineTo(7, -27); c.stroke();
    c.strokeStyle = '#8a5a33'; c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(-13, -5); c.lineTo(-10, -27); c.moveTo(10, -5); c.lineTo(7, -27); c.stroke();
    rr(c, -17 + hit, -19, 31, 10, 4.5); fs(c, '#b0703a', OUT, 2);                                  // бревно
    poly(c, [13 + hit, -21.5, 23 + hit, -14, 13 + hit, -6.5]); fs(c, '#8fa0b3', OUT, 2);           // железный наконечник
    poly(c, [-18, -25, -10, -36, 8, -36, 15, -25]); fs(c, col.main, OUT, 2);                       // крыша цвета игрока
    for (const wx of [-10, 8]) {                                                                   // колёса
      c.beginPath(); c.arc(wx, -5, 6, 0, TAU); fs(c, '#7d4b22', OUT, 2);
      c.save(); c.translate(wx, -5); c.rotate(mv ? ph : 0);
      c.strokeStyle = OUT; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-5, 0); c.lineTo(5, 0); c.moveTo(0, -5); c.lineTo(0, 5); c.stroke();
      c.restore();
    }
    hurtFlash(c, u, -19, -37, 42, 39);
    c.restore();
  };

  // Рабочий Лесопилки или Рудника: несёт добытое на плече
  D.worker = function (c, u, col, t) {
    const mv = u.moving, ph = t * 14 + u.id * 2.3;
    const bob = mv ? Math.abs(Math.sin(ph)) * 1.6 : 0;
    shadow(c, 8, 3.6);
    c.save();
    c.scale(u.face, 1);
    feet(c, mv, ph, 3, 3);
    c.translate(0, -bob);
    if (u.load > 0) {
      if (u.res === 'wood') { c.save(); c.translate(-2, -20); c.rotate(-0.25); rr(c, -9, -2.7, 18, 5.4, 2.5); fs(c, '#b0703a', OUT, 1.4); dot(c, 6.5, 0, 1.4, '#efc48a'); c.restore(); }
      else { rr(c, -9, -23, 11, 6.5, 1.5); fs(c, STEEL, OUT, 1.4); }
    }
    rr(c, -5.5, -14, 11, 12.5, 4.5); fs(c, '#e2c79b', OUT, 1.8);                                   // рубаха
    c.fillStyle = col.main; c.fillRect(-4.8, -7, 9.6, 3);                                          // пояс цвета игрока
    c.beginPath(); c.arc(0.5, -18, 5.6, 0, TAU); fs(c, SKIN, OUT, 1.8);
    dot(c, 3.4, -17.5, 1.1, OUT);
    c.beginPath(); c.arc(0.5, -19.5, 6.1, Math.PI, 0); c.closePath(); fs(c, col.main, OUT, 1.6);   // шапка
    if (u.state === 'work') {                                                                       // инструмент
      c.save(); c.translate(6, -10); c.rotate(swingAngle(u.atkAnim) * 0.8);
      c.strokeStyle = OUT; c.lineWidth = 2.8; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -11); c.stroke();
      rr(c, -1.5, -14.5, 8, 5, 1.5); fs(c, STEEL, OUT, 1.3);
      c.restore();
    }
    hurtFlash(c, u, -7, -26, 15, 26);
    c.restore();
  };

  // Ворчун — нейтральный каменный житель лагеря
  D.grunt = function (c, u, t) {
    const mv = u.moving, ph = t * 9 + u.id;
    const bob = mv ? Math.abs(Math.sin(ph)) * 2.5 : Math.sin(t * 2 + u.id) * 0.8;
    shadow(c, 16, 6.5);
    c.save();
    c.scale(u.face, 1); c.translate(0, -bob);
    c.beginPath(); c.moveTo(-14, -1); c.quadraticCurveTo(-18, -22, -6, -28); c.quadraticCurveTo(4, -33, 12, -24); c.quadraticCurveTo(18, -12, 13, -1); c.closePath();
    fs(c, '#a69a8c', OUT, 2.2);
    c.beginPath(); c.moveTo(-13, -19); c.quadraticCurveTo(-7, -31, 4, -31.5); c.quadraticCurveTo(10, -30, 14, -21); c.quadraticCurveTo(6, -25, 1, -20); c.quadraticCurveTo(-6, -25, -13, -19); c.closePath();
    fs(c, '#6aa84a', OUT, 1.8);                                                      // мох на макушке
    c.beginPath(); c.arc(2, -14, 2.8, 0, TAU); fs(c, '#ffe14a', OUT, 1.3);
    c.beginPath(); c.arc(9.5, -14, 2.8, 0, TAU); fs(c, '#ffe14a', OUT, 1.3);
    c.strokeStyle = OUT; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-1.5, -19.5); c.lineTo(4.5, -17.5); c.moveTo(13, -19.5); c.lineTo(7.5, -17.5); c.stroke();
    c.beginPath(); c.moveTo(2, -7); c.lineTo(9, -7); c.stroke();
    c.beginPath(); c.arc(15 + thrust(u.atkAnim, 8), -8, 5, 0, TAU); fs(c, '#8c8176', OUT, 2);   // кулак
    hurtFlash(c, u, -16, -32, 34, 32);
    c.restore();
  };

  // =====================================================================
  //  ЗДАНИЯ
  // =====================================================================
  D.citadel = function (c, b, col, t) {
    shadow(c, 68, 27);
    c.beginPath(); c.ellipse(0, 0, 55, 20, 0, 0, TAU); fs(c, '#a8a092', OUT, 2.5);    // фундамент
    c.beginPath(); c.moveTo(-40, -4); c.lineTo(-40, -66); c.lineTo(40, -66); c.lineTo(40, -4); c.quadraticCurveTo(0, 14, -40, -4); c.closePath();
    fs(c, STONE, OUT, 2.5);                                                           // стена
    c.fillStyle = 'rgba(70,45,20,0.14)';
    c.beginPath(); c.moveTo(13, -66); c.lineTo(40, -66); c.lineTo(40, -4); c.quadraticCurveTo(27, 3, 13, 4.5); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(90,70,50,0.33)'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-33, -24); c.lineTo(-21, -24); c.moveTo(21, -28); c.lineTo(33, -28); c.moveTo(19, -11); c.lineTo(31, -11); c.moveTo(-32, -10); c.lineTo(-22, -10); c.stroke();
    c.fillStyle = col.main; c.fillRect(-40, -64, 80, 9);                              // цветная полоса
    c.strokeStyle = OUT; c.lineWidth = 2; c.strokeRect(-40, -64, 80, 9);
    c.beginPath(); c.moveTo(-11, 3.5); c.lineTo(-11, -13); c.arc(0, -13, 11, Math.PI, 0); c.lineTo(11, 3.5); c.closePath(); fs(c, '#5c3d26', OUT, 2.2);   // ворота
    c.strokeStyle = '#3d2716'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, -23); c.lineTo(0, 3); c.stroke();
    rr(c, -47, -79, 94, 15, 3); fs(c, '#ece6d8', OUT, 2.5);                           // площадка
    for (let i = 0; i < 4; i++) { rr(c, -47 + i * 25.67, -92, 17, 15, 2.5); fs(c, '#ece6d8', OUT, 2.5); }    // зубцы!
    if (b.level >= 2) {                                                               // укреплённая Цитадель: деревянный пояс и щиты
      c.fillStyle = '#8a5a33'; c.fillRect(-47, -66, 94, 5); c.strokeStyle = OUT; c.lineWidth = 1.8; c.strokeRect(-47, -66, 94, 5);
      for (const sx of [-28, 28]) { c.beginPath(); c.arc(sx, -72, 6, 0, TAU); fs(c, col.light, OUT, 1.8); dot(c, sx, -72, 2, col.dark); }
    }
    if (b.level >= 3) for (let i = 0; i < 4; i++) { c.fillStyle = '#ffd23f'; c.fillRect(-45 + i * 25.67, -93, 13, 4); c.strokeStyle = OUT; c.lineWidth = 1.5; c.strokeRect(-45 + i * 25.67, -93, 13, 4); }
    c.strokeStyle = OUT; c.lineWidth = 3; c.beginPath(); c.moveTo(0, -91); c.lineTo(0, -125); c.stroke();     // флагшток
    const wv = Math.sin(t * 4 + b.id) * 3;
    c.beginPath(); c.moveTo(1, -124); c.quadraticCurveTo(14, -128 + wv, 28, -121 - wv); c.lineTo(28, -107 - wv); c.quadraticCurveTo(14, -112 + wv, 1, -108); c.closePath();
    fs(c, col.main, OUT, 2);
    for (let i = 0; i < b.level; i++) star(c, (i - (b.level - 1) / 2) * 15, 12.5, 6);  // уровень — звёзды у подножия
    if (b.hurtT > 0) tint(c, 0.4, () => { c.fillStyle = '#fff'; c.fillRect(-47, -92, 94, 97); });
  };

  // ---- общие детали домиков ----
  function walls(c, w, h, fill) { rr(c, -w, -h, w * 2, h + 4, 4); fs(c, fill, OUT, 2.4); }
  function planks(c, w, h) {
    c.strokeStyle = 'rgba(110,70,30,0.4)'; c.lineWidth = 1.6;
    c.beginPath(); for (let y = -h + 10; y < 2; y += 9) { c.moveTo(-w + 3, y); c.lineTo(w - 3, y); } c.stroke();
  }
  function roof(c, w, y0, top, h, col) {     // крыша цвета игрока с тенью на правом скате
    poly(c, [-w - 8, y0, -top, y0 - h, top, y0 - h, w + 8, y0]); fs(c, col.main, OUT, 2.4);
    c.fillStyle = 'rgba(0,0,0,0.17)'; poly(c, [top * 0.35, y0 - h, top, y0 - h, w + 8, y0, w * 0.6, y0]); c.fill();
  }
  function door(c, w, h) { rr(c, -w, -h, w * 2, h + 4, 4); fs(c, '#5c3d26', OUT, 2); }
  function plate(c, x, y, icon, col) {       // круглая вывеска с иконкой
    c.beginPath(); c.arc(x, y, 10.5, 0, TAU); fs(c, '#fff7e3', OUT, 2);
    c.save(); c.translate(x, y); D.icon(c, icon, 16, col); c.restore();
  }
  function logs(c, x, y) {                   // штабель брёвен
    for (const q of [[0, 0], [9, 0], [4.5, -7]]) { c.beginPath(); c.arc(x + q[0], y + q[1], 4.6, 0, TAU); fs(c, '#efc48a', OUT, 1.8); dot(c, x + q[0], y + q[1], 1.5, '#b0703a'); }
  }

  // Каждое здание: h — высота (где рисовать звёзды уровня), draw — как рисовать
  D.BLD = {
    barracks: { h: 71, draw(c, b, col) {
      walls(c, 30, 34, WOOD); planks(c, 30, 34); door(c, 9, 21);
      roof(c, 30, -30, 23, 31, col); plate(c, 0, -45, 'sword', col);
    } },

    range: { h: 71, draw(c, b, col) {
      walls(c, 30, 32, '#dcb07a'); planks(c, 30, 32);
      rr(c, -20, -22, 40, 26, 5); fs(c, '#6b4a2e', OUT, 2);                          // открытый навес
      roof(c, 30, -28, 23, 32, col); plate(c, 0, -44, 'archer', col);
      c.strokeStyle = OUT; c.lineWidth = 3; c.beginPath(); c.moveTo(-38, 2); c.lineTo(-35, -12); c.moveTo(-30, 2); c.lineTo(-33, -12); c.stroke();
      c.save(); c.translate(-34, -16); D.icon(c, 'range', 19); c.restore();           // мишень у входа
    } },

    stable: { h: 71, draw(c, b, col) {
      walls(c, 32, 33, '#c98f58'); planks(c, 32, 33);
      rr(c, -15, -23, 30, 27, 4); fs(c, '#5c3d26', OUT, 2);                          // широкие ворота
      c.strokeStyle = '#3d2716'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(0, -23); c.lineTo(0, 3); c.moveTo(-13, -21); c.lineTo(-2, 1); c.moveTo(13, -21); c.lineTo(2, 1); c.stroke();
      roof(c, 32, -29, 24, 32, col); plate(c, 0, -45, 'rider', col);
      c.beginPath(); c.arc(33, -3, 8, Math.PI, 0); c.arc(40, -1, 6, Math.PI, 0); c.closePath(); fs(c, '#f0d264', '#8a6a12', 1.8);   // сено
    } },

    workshop: { h: 71, draw(c, b, col) {
      walls(c, 31, 34, '#b8926b'); planks(c, 31, 34); door(c, 10, 22);
      roof(c, 31, -30, 23, 31, col); plate(c, 0, -45, 'workshop', col);
      logs(c, 30, -3);
      c.save(); c.translate(-36, -6); c.rotate(-0.5); rr(c, -1.5, -10, 3, 16, 1); fs(c, '#b0703a', OUT, 1.6); rr(c, -5, -14, 10, 6, 1.5); fs(c, STEEL, OUT, 1.6); c.restore();   // молот
    } },

    forge: { h: 79, draw(c, b, col, t) {
      rr(c, -27, -66, 12, 30, 2); fs(c, '#9a9488', OUT, 2.2);                        // труба
      for (let i = 0; i < 3; i++) {                                                  // дым
        const k = (t * 0.5 + i / 3 + b.id * 0.1) % 1;
        tint(c, 0.55 * (1 - k), () => dot(c, -21 + Math.sin(k * 5 + i) * 4, -68 - k * 26, 4 + k * 5, '#f2efe9'));
      }
      walls(c, 30, 34, '#bdb6a8');
      c.strokeStyle = 'rgba(80,70,60,0.35)'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(-24, -22); c.lineTo(-12, -22); c.moveTo(12, -14); c.lineTo(25, -14); c.moveTo(-26, -8); c.lineTo(-16, -8); c.stroke();
      c.beginPath(); c.moveTo(-11, 4); c.lineTo(-11, -12); c.arc(0, -12, 11, Math.PI, 0); c.lineTo(11, 4); c.closePath(); fs(c, '#3b2a20', OUT, 2);   // горн
      const gl = 0.75 + Math.sin(t * 9 + b.id) * 0.25;
      tint(c, gl, () => { c.beginPath(); c.arc(0, -3, 7, Math.PI, 0); c.lineTo(7, 3); c.lineTo(-7, 3); c.closePath(); c.fillStyle = '#ff9d3c'; c.fill(); dot(c, 0, -3, 3.5, '#ffe27a'); });
      roof(c, 30, -30, 22, 30, col); plate(c, 6, -45, 'forge', col);
    } },

    sawmill: { h: 71, draw(c, b, col, t) {
      c.save(); c.translate(31, -16); c.rotate(t * 2.5);                               // пила крутится
      c.beginPath(); for (let i = 0; i < 20; i++) { const a = i * TAU / 20, q = i % 2 ? 11.5 : 15.5; c.lineTo(Math.cos(a) * q, Math.sin(a) * q); } c.closePath(); fs(c, STEEL, OUT, 2);
      dot(c, 0, 0, 3.4, '#7d4b22'); c.restore();
      walls(c, 28, 33, '#d9a868'); planks(c, 28, 33); door(c, 9, 21);
      roof(c, 28, -29, 21, 31, col); plate(c, 0, -44, 'wood', col);
      logs(c, -41, -3);
    } },

    mine: { h: 66, draw(c, b, col) {
      c.beginPath(); c.moveTo(-40, 3); c.lineTo(-36, -22); c.lineTo(-20, -44); c.lineTo(4, -52); c.lineTo(26, -40); c.lineTo(38, -18); c.lineTo(40, 3); c.quadraticCurveTo(0, 12, -40, 3); c.closePath();
      fs(c, '#98a1ab', '#444b52', 2.4);                                              // скала
      poly(c, [-20, -44, 4, -52, 10, -34, -12, -28, -36, -22]); fs(c, '#c3cad1', '#444b52', 1.6);
      c.beginPath(); c.moveTo(-14, 5); c.lineTo(-14, -14); c.arc(0, -14, 14, Math.PI, 0); c.lineTo(14, 5); c.closePath(); fs(c, '#2a2330', OUT, 2.2);   // вход в шахту
      c.strokeStyle = OUT; c.lineWidth = 6.5; c.lineCap = 'butt'; c.beginPath(); c.moveTo(-17, 5); c.lineTo(-17, -26); c.lineTo(17, -26); c.lineTo(17, 5); c.stroke();
      c.strokeStyle = '#b0703a'; c.lineWidth = 3.4; c.beginPath(); c.moveTo(-17, 4); c.lineTo(-17, -26); c.lineTo(17, -26); c.lineTo(17, 4); c.stroke();
      poly(c, [26, -4, 28, 4, 44, 4, 46, -4]); fs(c, '#8a5a33', OUT, 1.8);           // вагонетка с рудой
      poly(c, [30, -4, 34, -10, 38, -6, 41, -9, 43, -4]); fs(c, '#6ec1f2', '#1f5d87', 1.5);
      dot(c, 31, 6, 2.6, OUT); dot(c, 41, 6, 2.6, OUT);
      c.strokeStyle = OUT; c.lineWidth = 2.4; c.beginPath(); c.moveTo(6, -51); c.lineTo(6, -70); c.stroke();
      poly(c, [7, -70, 22, -66, 7, -60]); fs(c, col.main, OUT, 1.8);                 // флажок игрока
    } },

    market: { h: 68, draw(c, b, col) {
      c.strokeStyle = OUT; c.lineWidth = 4.6; c.lineCap = 'round'; c.beginPath(); c.moveTo(-29, 2); c.lineTo(-29, -38); c.moveTo(29, 2); c.lineTo(29, -38); c.stroke();
      c.strokeStyle = '#b0703a'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(-29, 2); c.lineTo(-29, -38); c.moveTo(29, 2); c.lineTo(29, -38); c.stroke();
      rr(c, -32, -20, 64, 24, 3); fs(c, WOOD, OUT, 2.4);                             // прилавок
      c.strokeStyle = 'rgba(110,70,30,0.4)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-29, -9); c.lineTo(29, -9); c.stroke();
      rr(c, -24, -30, 13, 11, 2); fs(c, '#b0703a', OUT, 1.8);                         // товары
      c.beginPath(); c.arc(0, -24, 5, 0, TAU); fs(c, '#ffd23f', '#6b4700', 1.6); c.beginPath(); c.arc(8, -23, 4, 0, TAU); fs(c, '#ffd23f', '#6b4700', 1.6);
      poly(c, [14, -20, 16, -30, 24, -30, 26, -20]); fs(c, STEEL, OUT, 1.8);
      poly(c, [-40, -34, -32, -56, 32, -56, 40, -34]); fs(c, col.main, OUT, 2.4);    // полосатый навес
      c.fillStyle = '#fff';
      for (const s of [-1, 1]) { poly(c, [s * 6, -54.8, s * 18, -54.8, s * 22.5, -35.2, s * 7.5, -35.2]); c.fill(); }
      c.strokeStyle = OUT; c.lineWidth = 2.4; poly(c, [-40, -34, -32, -56, 32, -56, 40, -34]); c.stroke();
    } },

    tower: { h: 104, draw(c, b, col) {
      poly(c, [-17, 3, -14, -60, 14, -60, 17, 3]); fs(c, STONE, OUT, 2.4);           // ствол башни
      c.fillStyle = 'rgba(70,45,20,0.14)'; poly(c, [5, -60, 14, -60, 17, 3, 6, 3]); c.fill();
      c.strokeStyle = 'rgba(90,70,50,0.33)'; c.lineWidth = 2; c.beginPath(); c.moveTo(-11, -40); c.lineTo(-3, -40); c.moveTo(4, -22); c.lineTo(12, -22); c.moveTo(-12, -10); c.lineTo(-5, -10); c.stroke();
      rr(c, -2.5, -36, 5, 13, 2); c.fillStyle = '#3b3145'; c.fill();                  // бойница
      rr(c, -22, -72, 44, 13, 3); fs(c, '#ece6d8', OUT, 2.4);                         // площадка
      for (let i = 0; i < 3; i++) { rr(c, -22 + i * 16.5, -82, 11, 11, 2); fs(c, '#ece6d8', OUT, 2.2); }
      poly(c, [-23, -80, 0, -100, 23, -80]); fs(c, col.main, OUT, 2.4);              // крыша цвета игрока
      c.fillStyle = 'rgba(0,0,0,0.17)'; poly(c, [4, -96.5, 23, -80, 10, -80]); c.fill();
    } },

    palisade: { h: 66, draw(c, b, col, t) {
      for (let i = -2; i <= 2; i++) {                                                // ряд заострённых брёвен
        const x = i * 13, hh = 44 - Math.abs(i) * 5;
        poly(c, [x - 6.5, 4, x - 6.5, -hh, x, -hh - 10, x + 6.5, -hh, x + 6.5, 4]); fs(c, i % 2 ? '#b98852' : '#c99a62', OUT, 2.2);
      }
      c.fillStyle = '#8a5a33'; c.fillRect(-33, -18, 66, 6); c.strokeStyle = OUT; c.lineWidth = 1.8; c.strokeRect(-33, -18, 66, 6);
      c.beginPath(); c.moveTo(0, -36); c.lineTo(11, -32); c.lineTo(11, -22); c.quadraticCurveTo(9, -14, 0, -10); c.quadraticCurveTo(-9, -14, -11, -22); c.lineTo(-11, -32); c.closePath();
      fs(c, col.main, OUT, 2.2);                                                     // щит цвета игрока
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(-1.8, -32, 3.6, 18);
    } },
  };

  // Нарисовать обычное здание (не Цитадель). age — сколько секунд назад построено.
  D.building = function (c, b, col, t, age) {
    const def = D.BLD[b.kind];
    if (!def) return;
    c.save();
    if (age < 0.45) {                          // здание «выпрыгивает» при постройке
      const k = age / 0.45, s = 0.45 + 0.55 * k + Math.sin(k * Math.PI) * 0.2;
      c.scale(s, s);
    }
    shadow(c, b.r + 4, (b.r + 4) * 0.4);
    c.lineJoin = 'round';
    def.draw(c, b, col, t);
    for (let i = 0; i < b.level; i++) star(c, (i - (b.level - 1) / 2) * 14, -def.h, 6);    // звёзды уровня
    if (b.hurtT > 0) tint(c, 0.4, () => { c.fillStyle = '#fff'; c.fillRect(-b.r - 4, -def.h + 10, b.r * 2 + 8, def.h - 6); });
    c.restore();
  };

  // =====================================================================
  //  ПРИРОДА И МЕЛОЧИ
  // =====================================================================
  D.tree = function (c, nd, regrow) {
    const s = 0.92 + nd.v * 0.34;
    c.save(); c.scale(s, s);
    if (nd.left <= 0) {                        // пенёк, на котором подрастает новая ёлочка
      shadow(c, 10, 4);
      c.fillStyle = '#8a5a33'; c.fillRect(-6, -7, 12, 7);
      c.strokeStyle = OUT; c.lineWidth = 1.8; c.strokeRect(-6, -7, 12, 7);
      c.beginPath(); c.ellipse(0, -7, 6, 2.8, 0, 0, TAU); fs(c, '#e2b17a', OUT, 1.8);
      const g = 1 - Math.max(0, nd.regrowT) / regrow;
      if (g > 0.25) { const q = g * 0.7; poly(c, [0, -8 - 26 * q, 11 * q, -8, -11 * q, -8]); fs(c, '#45b774', '#1f5c3a', 1.6); }
      c.restore(); return;
    }
    shadow(c, 17, 6.5);
    const sh = nd.shake > 0 ? Math.sin(nd.shake * 55) * 3 * (nd.shake / 0.3) : 0;
    c.fillStyle = '#8a5a33'; c.fillRect(-3.5, -11, 7, 11);
    c.strokeStyle = OUT; c.lineWidth = 1.8; c.strokeRect(-3.5, -11, 7, 11);
    const layers = Math.max(1, Math.ceil(nd.left / nd.max * 3));     // чем больше срубили, тем «худее» ёлка
    const W = [21, 17, 12], Y = [-8, -25, -41], Hh = [27, 25, 23], F = ['#2f8a57', '#37a064', '#45b774'];
    c.lineJoin = 'round';
    for (let i = 0; i < layers; i++) {
      const o = sh * (i + 1) / 3;
      poly(c, [o * 1.3, Y[i] - Hh[i], W[i] + o * 0.4, Y[i], -W[i] + o * 0.4, Y[i]]); fs(c, F[i], '#1f5c3a', 2);
    }
    c.restore();
  };

  D.ore = function (c, nd, regrow, t) {
    const s = 0.95 + nd.v * 0.2;
    c.save(); c.scale(s, s);
    if (nd.left <= 0) {                        // руда выбита — остались обломки
      shadow(c, 16, 5);
      poly(c, [-14, 0, -10, -8, -1, -6, 2, 0]); fs(c, '#8a929b', '#444b52', 1.8);
      poly(c, [4, 1, 7, -6, 14, -4, 15, 1]); fs(c, '#9aa3ad', '#444b52', 1.8);
      c.restore(); return;
    }
    shadow(c, 25, 9);
    c.translate(nd.shake > 0 ? Math.sin(nd.shake * 60) * 1.6 : 0, 0);
    c.lineJoin = 'round';
    c.beginPath(); c.moveTo(-23, 2); c.lineTo(-20, -15); c.lineTo(-8, -27); c.lineTo(8, -29); c.lineTo(21, -16); c.lineTo(24, 2); c.quadraticCurveTo(0, 9, -23, 2); c.closePath();
    fs(c, '#98a1ab', '#444b52', 2.2);
    poly(c, [-8, -27, 8, -29, 11, -16, -4, -13, -20, -15]); fs(c, '#c3cad1', '#444b52', 1.6);
    const n = Math.max(1, Math.ceil(nd.left / nd.max * 3));          // блестящие жилы железа
    const P = [[-10, -6], [9, -8], [1, -21]];
    for (let i = 0; i < n; i++) {
      const x = P[i][0], y = P[i][1];
      poly(c, [x, y - 6.5, x + 5, y, x, y + 5, x - 5, y]); fs(c, '#6ec1f2', '#1f5d87', 1.6);
      dot(c, x - 1.2, y - 1.8, 1.3, '#e6f6ff');
    }
    if (Math.sin(t * 2.3 + nd.id) > 0.93) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-14, -15); c.lineTo(-6, -15); c.moveTo(-10, -19); c.lineTo(-10, -11); c.stroke(); }
    c.restore();
  };

  D.coin = function (c, co, t) {
    const hop = Math.abs(Math.sin(t * 6 + co.id)) * 5;
    shadow(c, 5, 2.4);
    c.beginPath(); c.arc(0, -6 - hop, 5.2, 0, TAU); fs(c, '#ffd23f', '#6b4700', 1.7);
    dot(c, -1.6, -7.8 - hop, 1.3, '#fff8d2');
  };

  // Секция забора от (0,0) до (dx,dy). pal — у хозяина базы построен Частокол.
  D.fence = function (c, dx, dy, pal) {
    if (pal) {                                 // высокие заострённые брёвна
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const x = dx * i / n, y = dy * i / n, hh = i % 2 ? 19 : 22;   // невысокий, чтобы не закрывать площадки за ним
        poly(c, [x - 5.5, y + 1, x - 5.5, y - hh, x, y - hh - 7, x + 5.5, y - hh, x + 5.5, y + 1]); fs(c, i % 2 ? '#b98852' : '#c99a62', OUT, 1.8);
      }
      return;
    }
    c.strokeStyle = OUT; c.lineWidth = 5.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, -7); c.lineTo(dx, dy - 7); c.moveTo(0, -14); c.lineTo(dx, dy - 14); c.stroke();
    c.strokeStyle = '#c99a62'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -7); c.lineTo(dx, dy - 7); c.moveTo(0, -14); c.lineTo(dx, dy - 14); c.stroke();
    rr(c, -3, -19, 6, 20, 2); fs(c, '#b98852', OUT, 1.8);
    rr(c, dx - 3, dy - 19, 6, 20, 2); fs(c, '#b98852', OUT, 1.8);
  };

  // Сундук в лагере нейтралов — намёк, что здесь добывают золото
  D.chest = function (c) {
    shadow(c, 17, 6);
    rr(c, -13, -15, 26, 15, 3); fs(c, '#9a6234', OUT, 2);
    c.beginPath(); c.moveTo(-13, -14); c.quadraticCurveTo(-13, -25, 0, -25); c.quadraticCurveTo(13, -25, 13, -14); c.closePath(); fs(c, '#b97a44', OUT, 2);
    c.fillStyle = '#ffd23f'; c.fillRect(-13, -15.5, 26, 3);
    rr(c, -3, -17.5, 6, 7, 1.5); fs(c, '#ffd23f', OUT, 1.5);
  };

  // Флажок на месте, где войску приказано «Держать позицию»
  D.holdFlag = function (c, col, t) {
    c.strokeStyle = OUT; c.lineWidth = 3.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -38); c.stroke();
    const wv = Math.sin(t * 5) * 2.5;
    c.beginPath(); c.moveTo(1, -38); c.quadraticCurveTo(11, -41 + wv, 21, -34 - wv); c.quadraticCurveTo(11, -30 + wv, 1, -25); c.closePath(); fs(c, col.main, OUT, 2);
  };

  // Мелкие украшения на земле: трава, цветы, камешки
  D.decor = function (c, d) {
    if (d.k <= 1) {
      c.strokeStyle = '#5fae3c'; c.lineWidth = 2; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-4, 0); c.lineTo(-6, -7); c.moveTo(0, 0); c.lineTo(0, -9); c.moveTo(4, 0); c.lineTo(6, -7); c.stroke();
    } else if (d.k <= 3) {
      c.strokeStyle = '#4f9a36'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -7); c.stroke();
      dot(c, 0, -8, 3.2, d.v < 0.34 ? '#fff' : d.v < 0.67 ? '#ffe45c' : '#ff9ecb'); dot(c, 0, -8, 1.2, '#f5a623');
    } else if (d.k === 4) {
      // кустик: сначала общая обводка, потом заливка — так внутри нет лишних линий
      const B = [[-5, -5, 6], [4, -6, 7], [0, -10, 6]];
      c.fillStyle = '#2f7a33'; for (const q of B) { c.beginPath(); c.arc(q[0], q[1], q[2] + 1.6, 0, TAU); c.fill(); }
      c.fillStyle = '#57b04a'; for (const q of B) { c.beginPath(); c.arc(q[0], q[1], q[2], 0, TAU); c.fill(); }
    } else {
      c.beginPath(); c.ellipse(0, -2, 5 + d.v * 3, 3.2 + d.v * 1.5, 0, 0, TAU); fs(c, '#b9b3a6', '#6f6a60', 1.5);
    }
  };
})();
