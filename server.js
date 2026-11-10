/* ============================================================
   «Зубцы» — сервер игры.

   Делает две вещи:
     1) раздаёт файлы игры из папки public (страница, скрипты, стили);
     2) держит онлайн: комнаты, матчи и связь с игроками по WebSocket
        (вся эта часть — в папке server).

   Запуск:  node server.js     (или двойной щелчок по start.bat)
   Сторонние пакеты не нужны — хватает самого Node.js.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const wsock = require('./server/wsock.js');
const rooms = require('./server/rooms.js');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, 'public');
// Адрес игры в интернете (его передаёт start-online.bat через --public=…): по нему строится ссылка для друзей
const PUBLIC = (() => {
  const a = process.argv.find(x => x.startsWith('--public='));
  const v = a ? a.slice(9).trim() : (process.env.PUBLIC_URL || '');
  return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v) ? v : '';
})();
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { urlPath = '/'; }
  if (urlPath === '/health') {                    // по этому адресу хостинг проверяет, что сервер жив
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('ok, комнат: ' + rooms.rooms.size + ', игроков на связи: ' + rooms.conns.size);
    return;
  }
  if (urlPath === '/info') {                      // адреса этого компьютера в домашней сети — для ссылки-приглашения
    const ips = [];
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    ips.sort((a, b) => (b.startsWith('192.168.') ? 1 : 0) - (a.startsWith('192.168.') ? 1 : 0));   // обычный домашний Wi-Fi — первым
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ips, port: PORT, public: PUBLIC }));
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  // не даём выйти за пределы папки public
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Нельзя'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Не найдено'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',     // чтобы после правок сразу видеть новую версию
    });
    res.end(data);
  });
});

// онлайн: каждое новое WebSocket-соединение — это игрок
wsock.attach(server, rooms.onConn);
rooms.start();

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.log('\nПорт ' + PORT + ' уже занят. Возможно, игра уже запущена в другом окне — закройте его и попробуйте снова.');
  else console.log('\nОшибка сервера: ' + err.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ЗУБЦЫ — игра запущена!');
  console.log('');
  console.log('  На этом компьютере откройте в браузере:');
  console.log('      http://localhost:' + PORT);
  console.log('');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) for (const n of nets[name]) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  if (ips.length) {
    console.log('  На телефонах и других компьютерах в той же сети Wi-Fi:');
    for (const ip of ips) console.log('      http://' + ip + ':' + PORT);
    console.log('');
  }
  if (PUBLIC) {
    console.log('  ССЫЛКА ДЛЯ ДРУЗЕЙ (через интернет):');
    console.log('      ' + PUBLIC);
    console.log('');
  }
  console.log('  Чтобы остановить игру, закройте это окно.');
  console.log('');

  // start.bat запускает сервер с ключом --open: сами открываем игру в браузере.
  // Если игра выложена в интернет через туннель — открываем интернет-адрес (чуть позже, когда туннель поднимется).
  if (process.argv.includes('--open')) {
    const url = PUBLIC || 'http://localhost:' + PORT;
    const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
    setTimeout(() => require('child_process').exec(cmd, () => {}), PUBLIC ? 7000 : 0);
  }
});
