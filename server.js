/* ══════════════════════════════════════════════════════════════
   VELOX — Real-Time Multiplayer Gaming Server
   Express + Socket.io + sql.js + JWT + Crypto Wallet
   Enhanced Security + USDT-native balances
══════════════════════════════════════════════════════════════ */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'velox_secret_' + crypto.randomBytes(32).toString('hex');
const PLATFORM_FEE = 0.05;
const DB_PATH = path.join(__dirname, 'velox.db');
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'], credentials: true } });
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ── Rate Limiting ── */
const authLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,               // 5 attempts per minute
  message: { error: 'Too many attempts. Please try again in a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

/* ── Input Sanitization ── */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c])).trim();
}
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isValidUsername(u) { return /^[a-zA-Z0-9_]{3,20}$/.test(u); }

/* ── Cookie helpers ── */
function setTokenCookie(res, token) {
  res.cookie('velox_token', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  });
}
function clearTokenCookie(res) {
  res.clearCookie('velox_token', { httpOnly: true, path: '/' });
}

/* ── Cookie parser (lightweight) ── */
function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach(c => {
    const [k, ...v] = c.split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return cookies;
}

/* ── Database (sql.js) ── */
let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, last_name TEXT DEFAULT '',
    password_hash TEXT NOT NULL, balance REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL,
    coin TEXT, amount REAL NOT NULL, wallet_address TEXT, tx_hash TEXT,
    status TEXT DEFAULT 'completed', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, room_id TEXT NOT NULL,
    stake REAL NOT NULL, players_count INTEGER NOT NULL, won INTEGER DEFAULT 0,
    prize REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function dbGet(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free(); return null;
}
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}
function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDB();
}

/* ── Crypto config (USDT-native) ── */
const CRYPTO_CONFIG = {
  BTC: { name:'Bitcoin', symbol:'BTC', icon:'₿',
    addresses:['bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh','bc1q9h5yjqka3mz2f3hp2cjlassz0z6qlrgwyfxm5'],
    usdRate:67000, minDeposit:0.0001, minWithdraw:0.0005 },
  ETH: { name:'Ethereum', symbol:'ETH', icon:'Ξ',
    addresses:['0x742d35Cc6634C0532925a3b8D4C9E5E0A1b2c3d4','0x1234567890AbCdEf1234567890aBcDeF12345678'],
    usdRate:3400, minDeposit:0.001, minWithdraw:0.005 },
  USDT: { name:'Tether', symbol:'USDT', icon:'₮',
    addresses:['TYDzsYUEpvnYmQk4zGP9sWXB3mN8rL2qF5','TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G'],
    usdRate:1, minDeposit:1, minWithdraw:5 },
  SOL: { name:'Solana', symbol:'SOL', icon:'◎',
    addresses:['7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV','9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'],
    usdRate:185, minDeposit:0.01, minWithdraw:0.05 }
};

function generateTxHash() { return '0x' + crypto.randomBytes(32).toString('hex'); }
function getDepositAddress(coin) {
  const c = CRYPTO_CONFIG[coin];
  return c ? c.addresses[Math.floor(Math.random() * c.addresses.length)] : null;
}

/* ── Auth middleware (cookie-based + legacy header fallback) ── */
function authMW(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies.velox_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.userId = jwt.verify(token, JWT_SECRET).userId; next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET).userId; } catch { return null; }
}

/* ── CSRF token generation ── */
const csrfTokens = new Map(); // userId -> token (simple in-memory)
function generateCSRF(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(userId, token);
  return token;
}

/* ── REST: Auth ── */
app.post('/api/register', authLimiter, (req, res) => {
  try {
    let { firstName, lastName, email, username, password } = req.body;
    firstName = sanitize(firstName);
    lastName = sanitize(lastName || '');
    email = sanitize(email);
    username = sanitize(username);

    if (!firstName || !email || !username || !password) return res.status(400).json({ error: 'All fields required' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email format' });
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Username: 3-20 chars, letters/numbers/underscore only' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ chars' });
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) return res.status(400).json({ error: 'Password needs uppercase, lowercase, and number' });

    const existing = dbGet('SELECT id FROM users WHERE email=? OR username=?', [email, username]);
    if (existing) return res.status(409).json({ error: 'Email or username taken' });
    const hash = bcrypt.hashSync(password, 12);
    dbRun('INSERT INTO users (username,email,first_name,last_name,password_hash,balance) VALUES (?,?,?,?,?,?)',
      [username, email, firstName, lastName, hash, 0]);
    const user = dbGet('SELECT id,username,email,first_name,last_name,balance FROM users WHERE username=?', [username]);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    setTokenCookie(res, token);
    const csrf = generateCSRF(user.id);
    res.json({ user, csrfToken: csrf });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/login', authLimiter, (req, res) => {
  try {
    const identifier = sanitize(req.body.identifier || '');
    const password = req.body.password;
    if (!identifier || !password) return res.status(400).json({ error: 'Credentials required' });
    const user = dbGet('SELECT * FROM users WHERE email=? OR username=?', [identifier, identifier]);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    setTokenCookie(res, token);
    const profile = dbGet('SELECT id,username,email,first_name,last_name,balance FROM users WHERE id=?', [user.id]);
    const csrf = generateCSRF(user.id);
    res.json({ user: profile, csrfToken: csrf });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/logout', (req, res) => {
  clearTokenCookie(res);
  res.json({ success: true });
});

app.get('/api/me', authMW, (req, res) => {
  const user = dbGet('SELECT id,username,email,first_name,last_name,balance FROM users WHERE id=?', [req.userId]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const csrf = generateCSRF(user.id);
  res.json({ user, csrfToken: csrf });
});

/* ── REST: Wallet (USDT-native) ── */
app.get('/api/balance', authMW, (req, res) => {
  const r = dbGet('SELECT balance FROM users WHERE id=?', [req.userId]);
  res.json({ balance: r ? r.balance : 0 });
});

app.post('/api/deposit', authMW, (req, res) => {
  try {
    const { coin, amountUSDT } = req.body;
    const cfg = CRYPTO_CONFIG[coin];
    if (!cfg) return res.status(400).json({ error: 'Unsupported coin' });
    if (!amountUSDT || amountUSDT < 1) return res.status(400).json({ error: 'Min deposit $1 USDT' });
    const addr = getDepositAddress(coin);
    const txHash = generateTxHash();
    const cur = dbGet('SELECT balance FROM users WHERE id=?', [req.userId]);
    dbRun('UPDATE users SET balance=? WHERE id=?', [cur.balance + amountUSDT, req.userId]);
    dbRun('INSERT INTO transactions (user_id,type,coin,amount,wallet_address,tx_hash,status) VALUES (?,?,?,?,?,?,?)',
      [req.userId, 'deposit', coin, amountUSDT, addr, txHash, 'completed']);
    const newBal = dbGet('SELECT balance FROM users WHERE id=?', [req.userId]).balance;
    notifyBalanceUpdate(req.userId, newBal);
    res.json({ success:true, depositAddress:addr, amountCrypto:(amountUSDT/cfg.usdRate).toFixed(8),
      amountUSDT:amountUSDT.toFixed(2), txHash, newBalance:newBal,
      message:`${cfg.icon} $${amountUSDT} USDT deposited successfully` });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Deposit failed' }); }
});

app.post('/api/withdraw', authMW, (req, res) => {
  try {
    const { coin, amountUSDT, walletAddress } = req.body;
    const cfg = CRYPTO_CONFIG[coin];
    if (!cfg) return res.status(400).json({ error: 'Unsupported coin' });
    if (!walletAddress) return res.status(400).json({ error: 'Wallet address required' });
    if (!amountUSDT || amountUSDT < 5) return res.status(400).json({ error: 'Min withdrawal $5 USDT' });
    const cur = dbGet('SELECT balance FROM users WHERE id=?', [req.userId]);
    if (amountUSDT > cur.balance) return res.status(400).json({ error: 'Insufficient balance' });
    const txHash = generateTxHash();
    const cryptoAmt = amountUSDT / cfg.usdRate;
    dbRun('UPDATE users SET balance=? WHERE id=?', [cur.balance - amountUSDT, req.userId]);
    dbRun('INSERT INTO transactions (user_id,type,coin,amount,wallet_address,tx_hash,status) VALUES (?,?,?,?,?,?,?)',
      [req.userId, 'withdraw', coin, amountUSDT, walletAddress, txHash, 'processing']);
    const newBal = dbGet('SELECT balance FROM users WHERE id=?', [req.userId]).balance;
    notifyBalanceUpdate(req.userId, newBal);
    res.json({ success:true, amountCrypto:cryptoAmt.toFixed(8), amountUSDT:amountUSDT.toFixed(2),
      txHash, newBalance:newBal, message:`🚀 $${amountUSDT} USDT → ${cryptoAmt.toFixed(6)} ${coin} withdrawal initiated` });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Withdrawal failed' }); }
});

app.get('/api/transactions', authMW, (req, res) => {
  res.json({ transactions: dbAll('SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 50', [req.userId]) });
});

app.get('/api/crypto-config', (req, res) => {
  const config = {};
  for (const [k, v] of Object.entries(CRYPTO_CONFIG)) {
    config[k] = { name:v.name, symbol:v.symbol, icon:v.icon, usdRate:v.usdRate,
      minDeposit:v.minDeposit, minWithdraw:v.minWithdraw, depositAddress:getDepositAddress(k) };
  }
  res.json({ coins: config });
});

/* ══════════════════════════════════════
   MATCHMAKING ENGINE
══════════════════════════════════════ */
const queues = new Map();
const activeGames = new Map();
const socketToUser = new Map();

const BOT_NAMES = [
  'Arjun S','Priya K','Rohan M','Ananya R','Vikram P','Neha T','Karan B','Divya N',
  'Aditya V','Shreya J','Rahul D','Kavya S','Dev A','Riya C','Akash G','Pooja M',
  'Sanjay L','Meera P','Harsh K','Tanya B','Nikhil R','Simran W','Ayaan X','Ishaan Z',
  'Aarav G','Diya M','Vivaan C','Sara P','Reyansh K','Kiara L','Kabir J','Mira T',
  'Arnav S','Anvi R','Shaurya D','Pari N','Aayan B','Myra V','Vihaan A','Anika W'
];
const BOT_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c',
  '#e67e22','#e91e63','#00bcd4','#8bc34a','#ff5722','#607d8b',
  '#6366f1','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4',
  '#84cc16','#f97316','#a855f7','#14b8a6','#fb923c','#818cf8'];
const EMOJIS = ['🎲','🃏','💫','🌟','🔥','⚡','🎯','🚀','💎','✨','🎪','🎭'];

function generateRoomId() { return 'room_'+crypto.randomBytes(8).toString('hex'); }
function getQueueKey(s,m) { return `${s}_${m}`; }
function getNextBot(used) {
  const avail = BOT_NAMES.filter(n => !used.has(n));
  const name = avail.length ? avail[Math.floor(Math.random()*avail.length)] : 'Player_'+Math.floor(Math.random()*999);
  return { name, color: BOT_COLORS[Math.floor(Math.random()*BOT_COLORS.length)], emoji: EMOJIS[Math.floor(Math.random()*EMOJIS.length)] };
}

function notifyBalanceUpdate(userId, newBal) {
  for (const [sid, data] of socketToUser.entries()) {
    if (data.userId === userId) io.to(sid).emit('balance_update', { balance: newBal });
  }
}

function getAllPlayers(q) {
  const all = [];
  for (const p of q.players) all.push({ name:p.firstName+' '+(p.lastName||'').charAt(0)+'.', color:p.color||'#6366f1', isMe:false, isBot:false, emoji:'⭐', userId:p.userId });
  for (const b of q.bots) all.push({ name:b.name, color:b.color, isMe:false, isBot:true, emoji:b.emoji });
  return all;
}

function broadcastQueue(q) {
  const all = getAllPlayers(q);
  for (const p of q.players) {
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('queue_update', { players: all.map(pl => ({...pl, isMe:pl.userId===p.userId})), joined:all.length, needed:q.maxPlayers, roomId:q.roomId });
  }
}

function startBotFill(key) {
  const q = queues.get(key);
  if (!q || q.botTimer) return;
  const usedNames = new Set([...q.players.map(p=>p.firstName),...q.bots.map(b=>b.name)]);

  for (const p of q.players) {
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('matchmaking_status', { phase: 'waiting_real', message: 'Searching for real players...' });
  }

  function addBot() {
    const qq = queues.get(key);
    if (!qq) return;
    const total = qq.players.length + qq.bots.length;
    if (total >= qq.maxPlayers) { qq.botTimer=null; startGame(key); return; }
    const bot = getNextBot(usedNames);
    usedNames.add(bot.name);
    qq.bots.push({...bot, isBot:true, isMe:false});
    broadcastQueue(qq);
    qq.botTimer = setTimeout(addBot, 500 + Math.random() * 400);
  }

  q.botTimer = setTimeout(() => {
    const qq = queues.get(key);
    if (!qq) return;
    for (const p of qq.players) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.emit('matchmaking_status', { phase: 'filling', message: 'Filling remaining spots...' });
    }
    addBot();
  }, 5000);
}

function startGame(key) {
  const q = queues.get(key);
  if (!q) return;
  const roomId = q.roomId;
  const all = getAllPlayers(q);
  const gross = q.stake * q.maxPlayers, fee = gross*PLATFORM_FEE, prize = gross-fee;
  const seed = crypto.randomBytes(32).toString('hex');
  const winIdx = parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0,8),16) % all.length;
  const game = { roomId, key, stake:q.stake, maxPlayers:q.maxPlayers, players:all, realPlayers:[...q.players], winnerIdx:winIdx, seed, gross, fee, prize };
  activeGames.set(roomId, game);

  for (const p of q.players) {
    const s = io.sockets.sockets.get(p.socketId);
    if (s) s.emit('game_starting', { roomId, players:all.map(pl=>({...pl,isMe:pl.userId===p.userId})), countdown:5 });
  }

  setTimeout(() => {
    const g = activeGames.get(roomId);
    if (!g) return;
    for (const p of g.realPlayers) {
      const s = io.sockets.sockets.get(p.socketId);
      if (s) s.emit('spin_result', { roomId, winnerIdx:g.winnerIdx, winnerName:g.players[g.winnerIdx].name,
        winnerIsBot:g.players[g.winnerIdx].isBot, prize:g.prize, fee:g.fee, seed:g.seed,
        players:g.players.map(pl=>({...pl,isMe:pl.userId===p.userId})) });
    }
    setTimeout(() => resolveGame(roomId), 6500);
  }, 5500);

  queues.delete(key);
  console.log(`[Game] Started: ${roomId} | ${q.maxPlayers}p | $${q.stake} USDT | Prize $${prize}`);
}

function resolveGame(roomId) {
  const g = activeGames.get(roomId);
  if (!g) return;
  const winner = g.players[g.winnerIdx];
  if (!winner.isBot && winner.userId) {
    const r = dbGet('SELECT balance FROM users WHERE id=?', [winner.userId]);
    if (r) { dbRun('UPDATE users SET balance=? WHERE id=?', [r.balance+g.prize, winner.userId]); notifyBalanceUpdate(winner.userId, r.balance+g.prize); }
  }
  for (const p of g.realPlayers) {
    const won = !winner.isBot && winner.userId===p.userId;
    dbRun('INSERT INTO game_history (user_id,room_id,stake,players_count,won,prize) VALUES (?,?,?,?,?,?)',
      [p.userId, roomId, g.stake, g.maxPlayers, won?1:0, won?g.prize:0]);
    const s = io.sockets.sockets.get(p.socketId);
    if (s) {
      const bal = dbGet('SELECT balance FROM users WHERE id=?', [p.userId]);
      s.emit('game_ended', { roomId, won, prize:won?g.prize:0, balance:bal?bal.balance:0 });
      s.leave(roomId);
    }
  }
  activeGames.delete(roomId);
  console.log(`[Game] Resolved: ${roomId} | Winner: ${winner.name}`);
}

/* ── Socket.io ── */
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('authenticate', (data) => {
    // Support both cookie-based and token-based auth for socket
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = data.token || cookies.velox_token;
    const userId = verifyToken(token);
    if (!userId) { socket.emit('auth_error',{error:'Invalid token'}); return; }
    const user = dbGet('SELECT id,username,email,first_name,last_name,balance FROM users WHERE id=?', [userId]);
    if (!user) { socket.emit('auth_error',{error:'User not found'}); return; }
    socketToUser.set(socket.id, { userId:user.id, username:user.username, firstName:user.first_name, lastName:user.last_name, socketId:socket.id, color:'#6366f1' });
    socket.emit('authenticated', { user });
  });

  socket.on('join_queue', (data) => {
    const ud = socketToUser.get(socket.id);
    if (!ud) { socket.emit('queue_error',{error:'Not authenticated'}); return; }
    const { stake, maxPlayers } = data;
    if (!stake || !maxPlayers) { socket.emit('queue_error',{error:'Invalid params'}); return; }
    if (maxPlayers < 2 || maxPlayers > 20) { socket.emit('queue_error',{error:'Players must be 2-20'}); return; }
    const validStakes = [1,5,10,20,50,70,100,200,500,1000];
    if (!validStakes.includes(stake)) { socket.emit('queue_error',{error:'Invalid stake amount'}); return; }
    const bal = dbGet('SELECT balance FROM users WHERE id=?', [ud.userId]);
    if (!bal || bal.balance < stake) { socket.emit('queue_error',{error:'Insufficient balance'}); return; }
    dbRun('UPDATE users SET balance=? WHERE id=?', [bal.balance-stake, ud.userId]);
    socket.emit('balance_update', { balance: bal.balance-stake });
    const key = getQueueKey(stake, maxPlayers);
    if (!queues.has(key)) queues.set(key, { players:[], bots:[], roomId:generateRoomId(), stake, maxPlayers, botTimer:null });
    const q = queues.get(key);
    if (q.players.some(p => p.userId===ud.userId)) {
      socket.emit('queue_error',{error:'Already in queue'});
      dbRun('UPDATE users SET balance=? WHERE id=?', [bal.balance, ud.userId]);
      socket.emit('balance_update',{balance:bal.balance}); return;
    }
    q.players.push(ud);
    socket.join(q.roomId);
    broadcastQueue(q);
    startBotFill(key);
  });

  socket.on('leave_queue', (data) => {
    const ud = socketToUser.get(socket.id);
    if (!ud) return;
    const key = getQueueKey(data.stake, data.maxPlayers);
    const q = queues.get(key);
    if (!q) return;
    const idx = q.players.findIndex(p => p.userId===ud.userId);
    if (idx===-1) return;
    q.players.splice(idx,1);
    socket.leave(q.roomId);
    const bal = dbGet('SELECT balance FROM users WHERE id=?', [ud.userId]);
    dbRun('UPDATE users SET balance=? WHERE id=?', [bal.balance+data.stake, ud.userId]);
    socket.emit('balance_update',{balance:bal.balance+data.stake});
    socket.emit('left_queue',{refunded:data.stake});
    if (!q.players.length && !q.bots.length) { if(q.botTimer)clearTimeout(q.botTimer); queues.delete(key); }
    else broadcastQueue(q);
  });

  socket.on('disconnect', () => {
    const ud = socketToUser.get(socket.id);
    socketToUser.delete(socket.id);
    if (ud) {
      for (const [key, q] of queues.entries()) {
        const idx = q.players.findIndex(p => p.userId===ud.userId);
        if (idx!==-1) {
          q.players.splice(idx,1);
          const bal = dbGet('SELECT balance FROM users WHERE id=?', [ud.userId]);
          if (bal) dbRun('UPDATE users SET balance=? WHERE id=?', [bal.balance+q.stake, ud.userId]);
          if (!q.players.length && !q.bots.length) { if(q.botTimer)clearTimeout(q.botTimer); queues.delete(key); }
          else broadcastQueue(q);
          break;
        }
      }
    }
  });
});

/* ── Start ── */
(async () => {
  await initDB();
  server.listen(PORT, () => {
    console.log(`\n  VELOX Server → http://localhost:${PORT}\n  Matchmaking ✅ | Crypto Wallet ✅ | Socket.io ✅ | Security ✅\n`);
  });
})();
