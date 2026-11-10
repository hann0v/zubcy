/* ============================================================
   «Зубцы» — меню и комната (лобби).

   Меню: имя, «Создать комнату», «Войти по коду», «Играть с ботом».
   Комната: код и ссылка для друзей, список участников, цвета,
   режим (каждый сам за себя / команды), боты, кнопка «Начать матч».
   ============================================================ */
(function () {
  'use strict';
  const ZB = window.ZB, CFG = ZB.CFG, Net = ZB.Net;
  const L = ZB.Lobby = {};
  const $ = id => document.getElementById(id);
  const NAME_KEY = 'zubcy-name';
  let app = null;            // функции главного файла: { startLocal }
  let lanHost = '';          // адрес компьютера в домашней сети (нужен для ссылки, если игра открыта как localhost)
  let publicUrl = '';        // адрес игры в интернете, если её выложили через туннель (start-online.bat)
  let msgTimer = 0;

  function make(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function show(id) { for (const s of ['menu', 'room']) $(s).classList.toggle('hidden', s !== id); }
  function setMsg(id, text, keep) {
    const e = $(id);
    e.textContent = text || '';
    e.classList.toggle('hidden', !text);
    clearTimeout(msgTimer);
    if (text && !keep) msgTimer = setTimeout(() => e.classList.add('hidden'), 5000);
  }

  L.showMenu = function (msg) { show('menu'); setMsg('menu-msg', msg || '', true); };
  L.showRoom = function () { if (!Net.room) { L.showMenu(); return; } show('room'); setMsg('room-msg', ''); renderRoom(Net.room); };
  L.hide = function () { show(''); };
  L.error = function (msg) { setMsg($('room').classList.contains('hidden') ? 'menu-msg' : 'room-msg', msg); };

  // Имя игрока запоминается в браузере
  function myName() {
    const v = $('in-name').value.trim().slice(0, 12) || 'Игрок';
    try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* не страшно */ }
    return v;
  }

  function online() {
    if (Net.available()) return true;
    setMsg('menu-msg', 'Онлайн работает, когда игра запущена через start.bat или открыта по ссылке с сервера. А пока можно сыграть одному с ботом.', true);
    return false;
  }

  // Ссылка для друзей. Если игра выложена в интернет через туннель — даём интернет-адрес;
  // если открыли игру как localhost — подставляем адрес компьютера в домашней сети.
  function roomLink() {
    if (publicUrl) return publicUrl + '/?room=' + Net.room.code;
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const host = local && lanHost ? lanHost : location.host;
    return location.protocol + '//' + host + location.pathname + '?room=' + Net.room.code;
  }
  function copyLink() {
    if (!Net.room) return;
    const url = roomLink();
    const done = () => setMsg('room-msg', 'Ссылка скопирована — отправь её друзьям');
    const manual = () => { window.prompt('Скопируй ссылку и отправь друзьям:', url); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, manual);
    else manual();
  }

  L.init = function (callbacks) {
    app = callbacks;
    try { $('in-name').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* не страшно */ }
    const q = new URLSearchParams(location.search).get('room');
    if (q) { $('in-code').value = q.toUpperCase().slice(0, 4); setMsg('menu-msg', 'Тебя позвали в комнату ' + $('in-code').value + '. Введи имя и нажми «Войти по коду»', true); }

    $('btn-create').addEventListener('click', () => {
      if (!online()) return;
      setMsg('menu-msg', 'Создаём комнату…', true);
      Net.create(myName());
    });
    const join = () => {
      const code = $('in-code').value.trim();
      if (code.length < 4) { setMsg('menu-msg', 'Введи код комнаты — 4 буквы'); return; }
      if (!online()) return;
      setMsg('menu-msg', 'Заходим в комнату…', true);
      Net.join(code, myName());
    };
    $('btn-join').addEventListener('click', join);
    $('in-code').addEventListener('input', () => { const el = $('in-code'); el.value = el.value.toUpperCase(); });
    $('in-code').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('in-code').blur(); join(); } });
    $('in-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('in-name').blur(); });
    $('btn-play').addEventListener('click', () => { myName(); app.startLocal(); });

    $('btn-leave').addEventListener('click', () => { Net.leave(); L.showMenu(); });
    $('btn-start').addEventListener('click', () => Net.send({ t: 'start' }));
    $('btn-link').addEventListener('click', copyLink);
    $('room-code').addEventListener('click', copyLink);
    $('mode-row').querySelectorAll('button').forEach(b => b.addEventListener('click', () => Net.send({ t: 'set', mode: b.dataset.mode })));

    // узнаём у сервера адрес компьютера в домашней сети
    if (Net.available()) fetch('info').then(r => r.json()).then(j => {
      if (j && j.ips && j.ips.length) lanHost = j.ips[0] + ':' + j.port;
      if (j && j.public) publicUrl = j.public;
    }).catch(() => { /* не страшно */ });
  };

  // Рисуем комнату заново при каждом изменении
  function renderRoom(r) {
    const host = r.host === r.you, teams = r.mode === 'teams';
    $('room-code').textContent = r.code;
    $('mode-row').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.mode === r.mode); b.disabled = !host; });

    const box = $('slots');
    box.innerHTML = '';
    const used = r.slots.map(s => s.color);
    for (const s of r.slots) {
      const row = make('div', 'slot' + (s.id === r.you ? ' me' : ''));
      row.style.setProperty('--c', CFG.COLORS[s.color].main);

      const sw = make('button', 'sw');                    // цветной кружок; свой можно менять нажатием
      if (s.id === r.you) {
        sw.title = 'Сменить цвет';
        sw.addEventListener('click', () => {
          for (let k = 1; k < CFG.COLORS.length; k++) {
            const c = (s.color + k) % CFG.COLORS.length;
            if (!used.includes(c)) { Net.send({ t: 'color', c }); break; }
          }
        });
      } else sw.disabled = true;
      row.appendChild(sw);

      row.appendChild(make('span', 'nm ol', s.name));
      const tag = s.id === r.you ? 'это ты' : s.bot ? 'бот' : s.away ? 'нет связи' : s.id === r.host ? 'хозяин' : '';
      if (tag) row.appendChild(make('span', 'tag', tag));

      if (teams) {                                         // кнопка команды: А или Б
        const tb = make('button', 'team t' + s.team, s.team ? 'Б' : 'А');
        const can = s.id === r.you || (host && s.bot);
        tb.disabled = !can;
        if (can) tb.addEventListener('click', () => Net.send({ t: 'team', id: s.id, team: s.team ? 0 : 1 }));
        row.appendChild(tb);
      }
      if (host && s.bot) {
        const x = make('button', 'rm', '✕');
        x.addEventListener('click', () => Net.send({ t: 'kick', id: s.id }));
        row.appendChild(x);
      }
      box.appendChild(row);
    }
    const free = 6 - r.slots.length;
    if (free > 0) {
      const row = make('div', 'slot empty');
      if (host) {
        const b = make('button', 'addbot', '+ Добавить бота');
        b.addEventListener('click', () => Net.send({ t: 'bot' }));
        row.appendChild(b);
      }
      row.appendChild(make('span', 'free', 'свободно мест: ' + free));
      box.appendChild(row);
    }

    $('btn-start').classList.toggle('hidden', !host);
    $('btn-start').disabled = r.slots.length < 2;
    $('room-wait').classList.toggle('hidden', host);
    $('room-wait').textContent = teams ? 'Выбери команду (А или Б) и жди, когда хозяин комнаты начнёт матч…' : 'Ждём, когда хозяин комнаты начнёт матч…';
  }
})();
