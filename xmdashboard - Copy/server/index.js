const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../web/dist')));

const DB_PATH = path.join(__dirname, 'db.json');

// Helper to read DB
const readDB = () => {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return { miners: {}, history: [] };
  }
};

// Helper to write DB
const writeDB = (data) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
};

// API for miner bash scripts to send updates
app.post('/api/miner/update', (req, res) => {
  const { id, hashrate, worker, uptime, status, pool, tls } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });

  const db = readDB();
  
  if (!db.miners[id]) {
    db.miners[id] = { id, hashrate: 0, worker: '', uptime: 0, status: 'offline', pool: '', tls: false, targetConfig: null, lastSeen: 0 };
  }
  
  const miner = db.miners[id];
  miner.hashrate = hashrate !== undefined ? hashrate : miner.hashrate;
  miner.worker = worker !== undefined ? worker : miner.worker;
  miner.uptime = uptime !== undefined ? uptime : miner.uptime;
  miner.status = status || 'online';
  miner.pool = pool !== undefined ? pool : miner.pool;
  miner.tls = tls !== undefined ? tls : miner.tls;
  miner.lastSeen = Date.now();
  
  // Save history snapshot every 5 minutes
  if (!db.history) db.history = [];
  const lastHistory = db.history.length > 0 ? db.history[db.history.length - 1] : { timestamp: 0 };
  if (Date.now() - lastHistory.timestamp > 300000) {
    const totalHashrate = Object.values(db.miners).reduce((acc, m) => acc + (m.status === 'online' ? m.hashrate : 0), 0);
    db.history.push({ timestamp: Date.now(), totalHashrate });
    // Keep last 24 hours of history (288 points)
    if (db.history.length > 288) db.history.shift();
  }

  writeDB(db);
  
  // Broadcast to UI
  io.emit('miners_update', db.miners);
  io.emit('history_update', db.history);

  // Return the target config if it exists
  res.json({ targetConfig: miner.targetConfig });
});

// API for miner bash script to clear targetConfig after applying
app.post('/api/miner/config-applied', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });

  const db = readDB();
  if (db.miners[id]) {
    db.miners[id].targetConfig = null;
    writeDB(db);
    io.emit('miners_update', db.miners);
  }
  res.json({ success: true });
});

// Check offline status loop
setInterval(() => {
  const db = readDB();
  let changed = false;
  const now = Date.now();
  for (const id in db.miners) {
    // If not seen for 30 seconds, mark as offline
    if (db.miners[id].status === 'online' && now - db.miners[id].lastSeen > 30000) {
      db.miners[id].status = 'offline';
      db.miners[id].hashrate = 0;
      changed = true;
    }
  }
  if (changed) {
    writeDB(db);
    io.emit('miners_update', db.miners);
  }
}, 15000);

// Socket.io for Web UI
io.on('connection', (socket) => {
  console.log('UI connected:', socket.id);
  const db = readDB();
  socket.emit('miners_update', db.miners);
  socket.emit('history_update', db.history);

  // Receive config change from UI
  socket.on('update_config', (data) => {
    const { id, pool, worker, pass, tls } = data;
    const db = readDB();
    if (db.miners[id]) {
      db.miners[id].targetConfig = { pool, worker, pass, tls };
      writeDB(db);
      io.emit('miners_update', db.miners);
    }
  });

  // Remove miner
  socket.on('remove_miner', (id) => {
    const db = readDB();
    if (db.miners[id]) {
      delete db.miners[id];
      writeDB(db);
      io.emit('miners_update', db.miners);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
