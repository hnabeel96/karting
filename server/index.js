// The game server: serves the game files and runs the race room.
//   npm start                 -> http://<this-computer's-ip>:3000  (phones on the same wifi)
//   PORT=8080 npm start       -> another port
// No dependencies: Node 20+ only.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';
import { Room } from './room.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

// only these top-level folders are served
const PUBLIC = ['client', 'shared'];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') {
      res.writeHead(302, { Location: '/client/' });
      return res.end();
    }
    if (rel === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, players: room.players.size, phase: room.race.phase }));
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + rel);
    const top = path.relative(ROOT, file).split(path.sep)[0];
    if (!file.startsWith(ROOT + path.sep) || !PUBLIC.includes(top)) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

const room = new Room({ log: (m) => console.log(new Date().toLocaleTimeString(), m) });
room.run();

attachWebSocket(server, '/ws', (ws) => {
  let player = null;
  ws.on('message', (raw) => {
    if (!player) {
      // the first message must say hello
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.t === 'hello') player = room.join(ws, m);
      return;
    }
    room.onMessage(player, raw);
  });
  ws.on('close', () => player && room.removePlayer(player.id));
});

server.listen(PORT, HOST, () => {
  console.log('\n  Karting server is running. Open one of these on each phone (same wifi):\n');
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`    http://${a.address}:${PORT}`);
    }
  }
  console.log(`    http://localhost:${PORT}   (this computer)\n`);
});
