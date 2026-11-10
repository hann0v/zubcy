/* ============================================================
   «Зубцы» — звуки.

   Звуковых файлов нет: каждый звук «собирается» прямо в браузере
   из простых волн и шума (Web Audio API) — так же, как графика
   рисуется кодом. Звуки, которые происходят далеко от камеры,
   тише, а совсем далёкие не звучат вовсе.

   Важно для телефонов: браузер разрешает звук только после
   первого касания экрана. На iPhone звука не будет, если включён
   беззвучный режим (переключатель сбоку).
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB;
  const Snd = ZB.Sound = {};
  const KEY = 'zubcy-sound';
  const VOLUME = 0.55;                 // общая громкость

  let ctx = null, master = null, noiseBuf = null;
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* не страшно */ }
  const lastAt = {};                   // когда каждый звук играл в последний раз (чтобы не было каши)
  let burstT = 0, burstN = 0;          // сколько звуков началось за последние 0.1 с
  const ear = { x: 0, y: 0, ok: false };   // где «уши» — центр экрана в мире

  // ---------- включение звука при первом касании ----------
  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ctx = new AC(); } catch (e) { return; }
      const comp = ctx.createDynamicsCompressor();          // «сжимает» громкие места, чтобы не хрипело
      comp.threshold.value = -16; comp.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = on ? VOLUME : 0;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);   // секунда белого шума — из неё делаются удары и шорохи
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); s.connect(ctx.destination); s.start(0);   // «разблокировка» для iPhone
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => { /* не страшно */ });
  }
  for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(ev, unlock, true);
  document.addEventListener('visibilitychange', () => {        // свернули вкладку — звук на паузу
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {}); else if (on) ctx.resume().catch(() => {});
  });

  Snd.isOn = () => on;
  Snd.state = () => ctx ? ctx.state : 'нет';             // для проверки: включился ли звук в браузере
  let played = 0;
  Snd.count = () => played;                                // для проверки: сколько звуков прозвучало
  Snd.set = function (v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* не страшно */ }
    if (master) master.gain.setTargetAtTime(on ? VOLUME : 0, ctx.currentTime, 0.03);
    if (on) { unlock(); Snd.play('click'); }
  };
  Snd.toggle = () => Snd.set(!on);

  // Где сейчас камера (вызывается каждый кадр)
  Snd.listen = function (x, y) { ear.x = x; ear.y = y; ear.ok = true; };

  // ---------- кирпичики звука ----------
  // Нота: частота f (Гц), длительность d (с). o — тип волны, громкость, скольжение частоты, фильтр, задержка.
  function tone(f, d, o) {
    o = o || {};
    const t = ctx.currentTime + (o.at || 0), v = (o.v == null ? 0.3 : o.v) * (o.k || 1);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + d);
    let node = osc;
    if (o.lp) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = o.lp; node.connect(fl); node = fl; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.a || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    node.connect(g); out(g, o.pan);
    osc.start(t); osc.stop(t + d + 0.05);
  }
  // Шум: длительность d. o — фильтр (lp/hp/bp), его частота f, скольжение to, громкость, задержка.
  function noise(d, o) {
    o = o || {};
    const t = ctx.currentTime + (o.at || 0), v = (o.v == null ? 0.3 : o.v) * (o.k || 1);
    const src = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    fl.type = o.type || 'bandpass';
    fl.frequency.setValueAtTime(o.f || 1000, t);
    if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + d);
    fl.Q.value = o.q || 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.a || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(fl); fl.connect(g); out(g, o.pan);
    src.start(t, Math.random() * 0.5); src.stop(t + d + 0.05);
  }
  function out(node, pan) {
    if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); p.connect(master); }
    else node.connect(master);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- сами звуки ----------
  // gap — не чаще, чем раз в столько секунд (иначе в большой битве всё сливается)
  const SOUNDS = {
    click:   { gap: 0.04, play: k => tone(rnd(820, 900), 0.05, { v: 0.16, to: 560, k }) },
    deny:    { gap: 0.15, play: k => { tone(170, 0.13, { type: 'square', v: 0.07, lp: 900, k }); tone(150, 0.13, { type: 'square', v: 0.06, lp: 900, at: 0.09, k }); } },
    open:    { gap: 0.2,  play: k => tone(520, 0.09, { v: 0.12, to: 780, k }) },
    chop:    { gap: 0.08, play: (k, p) => { noise(0.07, { f: rnd(1100, 1600), q: 2, v: 0.35, k, pan: p }); tone(rnd(170, 200), 0.07, { type: 'sine', v: 0.3, to: 90, k, pan: p }); } },
    mine:    { gap: 0.08, play: (k, p) => { tone(rnd(1800, 2000), 0.14, { type: 'sine', v: 0.16, k, pan: p }); tone(2840, 0.09, { type: 'sine', v: 0.08, k, pan: p }); noise(0.03, { type: 'highpass', f: 3000, v: 0.18, k, pan: p }); } },
    work:    { gap: 0.25, play: (k, p) => noise(0.05, { f: 1300, q: 2, v: 0.12, k, pan: p }) },
    coin:    { gap: 0.06, play: k => { tone(1318, 0.07, { type: 'square', v: 0.07, lp: 4000, k }); tone(1975, 0.16, { type: 'square', v: 0.07, lp: 4000, at: 0.06, k }); } },
    pay:     { gap: 0.07, play: k => tone(rnd(600, 760), 0.035, { v: 0.09, k }) },
    deliver: { gap: 0.2,  play: k => tone(1250, 0.04, { type: 'sine', v: 0.06, k }) },
    build:   { gap: 0.3,  play: (k, p) => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { v: 0.15, at: i * 0.07, k, pan: p })); noise(0.18, { type: 'lowpass', f: 400, v: 0.35, k, pan: p }); } },
    upgrade: { gap: 0.3,  play: (k, p) => { [659, 784, 988, 1318].forEach((f, i) => tone(f, 0.2, { v: 0.14, at: i * 0.06, k, pan: p })); tone(2637, 0.3, { type: 'sine', v: 0.05, at: 0.25, k, pan: p }); } },
    hire:    { gap: 0.1,  play: (k, p) => { tone(440, 0.09, { v: 0.14, to: 880, k, pan: p }); noise(0.04, { type: 'lowpass', f: 600, v: 0.2, k, pan: p }); } },
    hit:     { gap: 0.045, play: (k, p) => noise(0.05, { f: rnd(900, 2000), q: 1.5, v: 0.22, k, pan: p }) },
    hitb:    { gap: 0.09, play: (k, p) => { noise(0.08, { type: 'lowpass', f: 500, v: 0.3, k, pan: p }); tone(rnd(110, 130), 0.09, { type: 'sine', v: 0.2, k, pan: p }); } },
    arrow:   { gap: 0.06, play: (k, p) => noise(0.12, { f: 4000, to: 1500, q: 3, v: 0.08, k, pan: p }) },
    boom:    { gap: 0.1,  play: (k, p) => { tone(150, 0.22, { type: 'sine', v: 0.3, to: 55, k, pan: p }); noise(0.1, { type: 'lowpass', f: 700, v: 0.18, k, pan: p }); } },
    die:     { gap: 0.06, play: (k, p) => tone(rnd(560, 660), 0.18, { type: 'square', v: 0.07, to: 150, lp: 1600, k, pan: p }) },
    crash:   { gap: 0.4,  play: (k, p) => { noise(0.8, { type: 'lowpass', f: 1000, to: 140, v: 0.6, k, pan: p }); tone(80, 0.6, { type: 'sine', v: 0.4, to: 38, k, pan: p }); } },
    alert:   { gap: 1.5,  play: k => { for (let i = 0; i < 2; i++) { tone(587, 0.17, { type: 'sawtooth', v: 0.14, lp: 1400, at: i * 0.46, k }); tone(440, 0.24, { type: 'sawtooth', v: 0.14, lp: 1400, at: i * 0.46 + 0.2, k }); } } },
    follow:  { gap: 0.2,  play: k => { tone(660, 0.08, { v: 0.15, k }); tone(990, 0.12, { v: 0.15, at: 0.08, k }); } },
    hold:    { gap: 0.2,  play: k => { tone(392, 0.1, { v: 0.16, k }); tone(392, 0.16, { v: 0.16, at: 0.13, k }); } },
    attack:  { gap: 0.2,  play: k => { tone(392, 0.12, { type: 'sawtooth', v: 0.12, lp: 1800, k }); tone(523, 0.26, { type: 'sawtooth', v: 0.13, lp: 1800, at: 0.11, k }); noise(0.1, { type: 'lowpass', f: 300, v: 0.3, k }); } },
    respawn: { gap: 1,    play: k => { tone(523, 0.3, { type: 'sine', v: 0.18, k }); tone(784, 0.45, { type: 'sine', v: 0.16, at: 0.12, k }); } },
    out:     { gap: 1,    play: k => [196, 294, 392].forEach(f => tone(f, 1.4, { type: 'sine', v: 0.16, a: 0.01, k })) },
    tip:     { gap: 0.5,  play: k => { tone(880, 0.1, { type: 'sine', v: 0.12, k }); tone(1175, 0.18, { type: 'sine', v: 0.12, at: 0.09, k }); } },
    win:     { gap: 2,    play: k => { [523, 659, 784].forEach((f, i) => tone(f, 0.18, { v: 0.2, at: i * 0.14, k })); [523, 659, 784, 1046].forEach(f => tone(f, 0.9, { v: 0.12, at: 0.45, k })); tone(1046, 0.9, { type: 'square', v: 0.04, lp: 3000, at: 0.45, k }); } },
    lose:    { gap: 2,    play: k => [392, 349, 311, 262].forEach((f, i) => tone(f, i === 3 ? 0.9 : 0.3, { v: 0.18, at: i * 0.3, k })) },
  };

  // Сыграть звук. Если даны x, y — звук «в мире»: чем дальше от камеры, тем тише.
  Snd.play = function (name, x, y, vol) {
    if (!on || !ctx || ctx.state !== 'running') return;
    const s = SOUNDS[name];
    if (!s) return;
    let k = vol == null ? 1 : vol, pan = 0;
    if (x != null && ear.ok) {
      const dx = x - ear.x, dy = y - ear.y, d = Math.hypot(dx, dy);
      if (d > 950) return;                                         // слишком далеко — не слышно
      if (d > 320) k *= 1 - (d - 320) / 630;
      pan = Math.max(-0.7, Math.min(0.7, dx / 500));
    }
    if (k < 0.05) return;
    const now = ctx.currentTime;
    if (now - (lastAt[name] || -9) < s.gap) return;
    if (now - burstT > 0.1) { burstT = now; burstN = 0; }
    if (++burstN > 10) return;                                     // в одно мгновение — не больше 10 звуков
    lastAt[name] = now;
    try { s.play(k, pan); played++; } catch (e) { /* звук не обязателен */ }
  };

  // Что звучит на каждое событие игры
  Snd.event = function (e, me) {
    const mine = e.pid === me;
    switch (e.t) {
      case 'hit': Snd.play(e.b ? 'hitb' : 'hit', e.x, e.y); break;
      case 'chop': Snd.play(e.res === 'wood' ? 'chop' : 'mine', e.x, e.y, mine ? 1 : 0.6); break;
      case 'shake': Snd.play('work', e.x, e.y); break;
      case 'shot': Snd.play(e.k ? 'arrow' : 'boom', e.x, e.y); break;
      case 'die': Snd.play('die', e.x, e.y); break;
      case 'crash': Snd.play('crash', e.x, e.y, 1.3); break;
      case 'built': Snd.play('build', e.x, e.y); break;
      case 'upgraded': case 'forged': Snd.play('upgrade', e.x, e.y); break;
      case 'hired': Snd.play('hire', e.x, e.y, mine || e.pid == null ? 1 : 0.6); break;
      case 'coin': if (mine) Snd.play('coin'); break;
      case 'trade': if (mine) Snd.play('coin'); break;
      case 'pay': if (mine) Snd.play('pay'); break;
      case 'deliver': if (mine) Snd.play('deliver'); break;
      case 'cmd': if (mine) Snd.play(e.mode); break;
      case 'alert': if (mine) Snd.play('alert'); break;
      case 'out': Snd.play('out'); break;
    }
  };

  // Щелчок на любой кнопке интерфейса (кроме карточек — у них свои звуки)
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button');
    if (b && !b.classList.contains('card')) Snd.play('click');
  }, true);
})();
