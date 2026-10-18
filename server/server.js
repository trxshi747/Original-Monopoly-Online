// Monopoly online relay + static file server (no dependencies, Node 14+).
//
// Every client runs the full game; this server only hands out seats, a shared
// random seed, and relays each player's moves to the others in a fixed order.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const WEB = path.join(__dirname, '..', 'web');
const MAX_PLAYERS = 6;
const TOKEN_COUNT = 8; // wheelbarrow, shoe, car, dog, top hat, iron, ship, thimble
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.swf': 'application/x-shockwave-flash',
  '.xml': 'text/xml',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
};

const rooms = new Map();

function getRoom(code) {
  return rooms.get(code);
}

function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function cleanName(s) {
  const n = String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return n || 'Player';
}

function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, cb) {
  let body = '';
  let tooBig = false;
  req.on('data', (d) => {
    body += d;
    if (body.length > MAX_BODY) {
      tooBig = true;
      req.destroy();
    }
  });
  req.on('end', () => !tooBig && cb(body));
}

function lobbyView(room, forSeat) {
  return {
    started: room.started,
    n: room.players.length,
    seat: forSeat,
    host: forSeat === 0,
    players: room.players.map((p) => ({ name: p.name, token: p.token })),
    seed: room.started ? room.seed : null,
  };
}

function api(req, res, url) {
  const q = url.searchParams;
  const code = cleanCode(q.get('room'));
  const route = url.pathname;

  if (route === '/api/join' && req.method === 'POST') {
    if (!code) return json(res, 400, { error: 'room code required' });
    let room = getRoom(code);
    if (!room) {
      room = { code, players: [], started: false, seed: 0, msgs: [], last: Date.now() };
      rooms.set(code, room);
    }
    if (room.started) return json(res, 409, { error: 'game already started' });
    if (room.players.length >= MAX_PLAYERS) return json(res, 409, { error: 'room is full' });
    const used = new Set(room.players.map((p) => p.token));
    let token = parseInt(q.get('token'), 10);
    if (!(token >= 0 && token < TOKEN_COUNT) || used.has(token)) {
      token = 0;
      while (used.has(token)) token++;
    }
    const seat = room.players.length;
    let name = cleanName(q.get('name'));
    const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = cleanName(q.get('name')).slice(0, 13) + ' ' + i;
    room.players.push({ name, token });
    room.last = Date.now();
    return json(res, 200, lobbyView(room, seat));
  }

  if (route === '/api/lobby') {
    const room = getRoom(code);
    if (!room) return json(res, 404, { error: 'no such room' });
    room.last = Date.now();
    return json(res, 200, lobbyView(room, parseInt(q.get('seat'), 10)));
  }

  if (route === '/api/start' && req.method === 'POST') {
    const room = getRoom(code);
    if (!room) return json(res, 404, { error: 'no such room' });
    if (parseInt(q.get('seat'), 10) !== 0) return json(res, 403, { error: 'only the host can start' });
    if (room.players.length < 2) return json(res, 400, { error: 'need at least 2 players' });
    if (!room.started) {
      room.started = true;
      room.seed = 1 + Math.floor(Math.random() * 0x7ffffffe);
    }
    room.last = Date.now();
    return json(res, 200, lobbyView(room, 0));
  }

  if (route === '/api/send' && req.method === 'POST') {
    const room = getRoom(code);
    if (!room) return json(res, 404, { error: 'no such room' });
    const seat = parseInt(q.get('seat'), 10);
    if (!(seat >= 0 && seat < room.players.length)) return json(res, 400, { error: 'bad seat' });
    return readBody(req, (body) => {
      let m;
      try {
        m = JSON.parse(body);
      } catch (e) {
        return json(res, 400, { error: 'bad json' });
      }
      room.msgs.push({ n: room.msgs.length + 1, seat, m });
      room.last = Date.now();
      json(res, 200, { ok: true, n: room.msgs.length });
    });
  }

  if (route === '/api/poll') {
    const room = getRoom(code);
    if (!room) return json(res, 404, { error: 'no such room' });
    const since = parseInt(q.get('since'), 10) || 0;
    room.last = Date.now();
    return json(res, 200, { total: room.msgs.length, msgs: room.msgs.slice(since) });
  }

  json(res, 404, { error: 'unknown api' });
}

function serveStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (e, data) => {
    if (e) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return api(req, res, url);
    serveStatic(req, res, url);
  })
  .listen(PORT, () => console.log('Monopoly server listening on port ' + PORT));

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.last > ROOM_TTL_MS) rooms.delete(code);
}, 10 * 60 * 1000).unref();
