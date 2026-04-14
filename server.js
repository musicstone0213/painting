// ================================================
// server.js — 後端主程式（v2：開放房間 + 排隊系統）
// ================================================

require('dotenv').config();
const express = require('express');

// ── Upstash Redis（用 REST API，不需安裝套件） ────
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisSet(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    // Upstash REST API 正確格式：POST body 為 ["SET", key, value]
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['SET', key, value])
    });
    const data = await res.json();
    if (data.error) console.error('[Redis SET error]', data.error);
    else console.log(`[Redis SET OK] ${key} (${Math.round(value.length/1024)}KB)`);
  } catch(e) { console.error('[Redis SET 失敗]', e.message); }
}

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    // Upstash REST API 正確格式：POST body 為 ["GET", key]
    const res = await fetch(REDIS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(['GET', key])
    });
    const data = await res.json();
    if (data.error) { console.error('[Redis GET error]', data.error); return null; }
    console.log(`[Redis GET] ${key}: ${data.result ? '有資料(' + Math.round((data.result.length||0)/1024) + 'KB)' : '無資料'}`);
    return data.result || null;
  } catch(e) { console.error('[Redis GET 失敗]', e.message); return null; }
}
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024  // 10MB，支援大圖片 base64
});
const PORT   = process.env.PORT || 3000;

app.use(express.json());

// 根路徑：直接服務 index.html（loading.html 是備用）
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── 後台資料 API（密碼保護） ──────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'painting2026';

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/stats', (req, res) => {
  const pwd = req.query.pwd;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密碼錯誤' });

  const totalOnline = Object.values(rooms).reduce((s,r) => s + r.users.size, 0);

  const roomList = Object.values(rooms).map(r => ({
    code:      r.code,
    name:      r.name,
    online:    r.users.size,
    queued:    r.queue.length,
    maxUsers:  r.maxUsers,
    isPermanent: !!r.isPermanent,
    isPublic:  r.isPublic,
    users:     Array.from(r.users.values())
  }));

  // 最近 24 小時逐小時資料
  const now   = new Date();
  const hours = [];
  for (let i = 23; i >= 0; i--) {
    const d    = new Date(now - i * 3600000);
    const key  = d.toISOString().slice(0, 13);
    const label= `${d.getUTCHours().toString().padStart(2,'0')}:00`;
    hours.push({ label, count: stats.hourlyJoins[key] || 0 });
  }

  // 最近 7 天資料
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d   = new Date(now - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    days.push({ label: key.slice(5), count: stats.dailyJoins[key] || 0 });
  }

  res.json({
    totalOnline,
    totalJoins:  stats.totalJoins,
    peakOnline:  stats.peakOnline,
    startedAt:   stats.startedAt,
    rooms:       roomList,
    hourly:      hours,
    daily:       days
  });
});

// ── 房間管理 API ────────────────────────────────────

// 更改房間名稱
app.post('/api/admin/room/rename', (req, res) => {
  const { pwd, roomCode, newName } = req.body;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密碼錯誤' });
  if (!roomCode || !newName || !newName.trim()) return res.status(400).json({ error: '缺少參數' });
  const room = rooms[roomCode];
  if (!room) return res.status(404).json({ error: '房間不存在' });
  room.name = newName.trim();
  broadcastRoomList();
  res.json({ success: true, name: room.name });
});

// 刪除房間（永久房間不可刪）
app.post('/api/admin/room/delete', (req, res) => {
  const { pwd, roomCode } = req.body;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密碼錯誤' });
  const room = rooms[roomCode];
  if (!room) return res.status(404).json({ error: '房間不存在' });
  if (room.isPermanent) return res.status(400).json({ error: '永久房間不可刪除' });
  // 踢出所有在線用戶
  io.to(roomCode).emit('roomDeleted', { message: '房間已被管理員關閉' });
  delete rooms[roomCode];
  broadcastRoomList();
  res.json({ success: true });
});

// 新增自定義房間
app.post('/api/admin/room/create', (req, res) => {
  const { pwd, roomName, isPublic, maxUsers } = req.body;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密碼錯誤' });
  if (!roomName || !roomName.trim()) return res.status(400).json({ error: '請輸入房間名稱' });
  const code = generateCode();
  rooms[code] = {
    code,
    name:          roomName.trim(),
    isPublic:      !!isPublic,
    isPermanent:   false,
    maxUsers:      maxUsers || MAX_USERS,
    users:         new Map(),
    queue:         [],
    canvasSnapshot: null,
    clearVotes:    new Set(),
    createdAt:     new Date(),
    recentDrawers: new Set(),
  };
  broadcastRoomList();
  res.json({ success: true, roomCode: code });
});

// 強制清空指定房間畫布
app.post('/api/admin/room/clear', (req, res) => {
  const { pwd, roomCode } = req.body;
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: '密碼錯誤' });
  const room = rooms[roomCode];
  if (!room) return res.status(404).json({ error: '房間不存在' });
  room.canvasSnapshot = null;
  redisSet(`canvas:${roomCode}`, '').catch(()=>{});
  io.to(roomCode).emit('clearCanvas');
  res.json({ success: true });
});

app.use(express.static(path.join(__dirname, 'public')));


// ── 資料結構 ──────────────────────────────────────
// rooms[code] = {
//   code, name, isPublic, maxUsers,
//   users: Map<socketId, nickname>,
//   queue: [ {socketId, nickname} ],   ← 排隊
//   canvasSnapshot: string|null,
//   clearVotes: Set<socketId>,
//   createdAt: Date
// }
const rooms = {};

// ── 統計資料 ────────────────────────────────────
const stats = {
  totalJoins:   0,   // 累積加入次數
  peakOnline:   0,   // 歷史最高在線人數
  dailyJoins:   {},  // { 'YYYY-MM-DD': count }
  hourlyJoins:  {},  // { 'YYYY-MM-DD HH': count }
  startedAt:    new Date().toISOString()
};

function recordJoin() {
  stats.totalJoins++;
  const now   = new Date();
  const day   = now.toISOString().slice(0, 10);
  const hour  = now.toISOString().slice(0, 13);
  stats.dailyJoins[day]  = (stats.dailyJoins[day]  || 0) + 1;
  stats.hourlyJoins[hour]= (stats.hourlyJoins[hour] || 0) + 1;
  // 更新峰值
  const total = Object.values(rooms).reduce((s,r) => s + r.users.size, 0);
  if (total > stats.peakOnline) stats.peakOnline = total;
  // 節流寫入 Redis
  saveStatsToRedis();
}
const MAX_USERS = 30;
const PERMANENT_ROOMS = ['PAINT1','PAINT2','PAINT3'];

/** 建立永久預設公開房間 */
function initPermanentRooms() {
  const names = ['1.皮炎派對', '2.幫我顧一下便當', '3.自行車手'];
  PERMANENT_ROOMS.forEach((code, i) => {
    if (!rooms[code]) {
      rooms[code] = {
        code,
        name: names[i],
        isPublic: true,
        isPermanent: true,
        maxUsers: MAX_USERS,
        users: new Map(),
        queue: [],
        canvasSnapshot: null,
        clearVotes: new Set(),
        createdAt: new Date(),
        recentDrawers: new Set(),
      };
    }
  });
}
initPermanentRooms();

/** 伺服器啟動時從 Redis 載入各房間畫布快照 */
async function loadSnapshotsFromRedis() {
  for (const code of Object.keys(rooms)) {
    const snapshot = await redisGet(`canvas:${code}`);
    if (snapshot) {
      rooms[code].canvasSnapshot = snapshot;
      console.log(`[Redis] 載入畫布快照：${code}`);
    }
  }
}
loadSnapshotsFromRedis();

/** 從 Redis 載入統計資料 */
async function loadStatsFromRedis() {
  try {
    const data = await redisGet('stats:global');
    if (data) {
      const saved = JSON.parse(data);
      stats.totalJoins  = saved.totalJoins  || 0;
      stats.peakOnline  = saved.peakOnline  || 0;
      stats.dailyJoins  = saved.dailyJoins  || {};
      stats.hourlyJoins = saved.hourlyJoins || {};
      console.log(`[Redis] 載入統計：累積加入 ${stats.totalJoins} 次，峰值 ${stats.peakOnline} 人`);
    }
  } catch(e) { console.error('[Redis] 統計載入失敗', e.message); }
}
loadStatsFromRedis();

/** 把統計資料存回 Redis（節流：最多每 30 秒存一次） */
let _statsSaveTimer = null;
function saveStatsToRedis() {
  if (_statsSaveTimer) return;
  _statsSaveTimer = setTimeout(async () => {
    _statsSaveTimer = null;
    // 只保留最近 30 天的日資料、最近 72 小時的時資料，避免資料無限膨脹
    const now = new Date();
    const keepDays  = new Set(Array.from({length:30}, (_,i) => new Date(now - i*86400000).toISOString().slice(0,10)));
    const keepHours = new Set(Array.from({length:72}, (_,i) => new Date(now - i*3600000).toISOString().slice(0,13)));
    Object.keys(stats.dailyJoins).forEach(k  => { if (!keepDays.has(k))  delete stats.dailyJoins[k];  });
    Object.keys(stats.hourlyJoins).forEach(k => { if (!keepHours.has(k)) delete stats.hourlyJoins[k]; });
    try {
      await redisSet('stats:global', JSON.stringify({
        totalJoins:  stats.totalJoins,
        peakOnline:  stats.peakOnline,
        dailyJoins:  stats.dailyJoins,
        hourlyJoins: stats.hourlyJoins
      }));
      console.log(`[Redis] 統計已儲存：累積 ${stats.totalJoins} 次`);
    } catch(e) { console.error('[Redis] 統計儲存失敗', e.message); }
  }, 30000); // 30 秒後才真的寫入
}

// ── 工具 ──────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

function getRoomSummary(room) {
  return {
    code:         room.code,
    name:         room.name,
    userCount:    room.users.size,
    queueCount:   room.queue.length,
    maxUsers:     room.maxUsers,
    isFull:       room.users.size >= room.maxUsers,
    activeDrawers: room.recentDrawers ? room.recentDrawers.size : 0
  };
}

/** 廣播最新房間列表給所有在大廳的人 */
function broadcastRoomList() {
  const list = Object.values(rooms)
    .filter(r => r.isPublic)
    .map(getRoomSummary)
    .sort((a, b) => b.userCount - a.userCount); // 人多的排前面
  io.emit('roomList', list);
}

/** 把排隊第一位移入房間 */
function dequeueNext(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.queue.length === 0) return;
  if (room.users.size >= room.maxUsers) return;

  const { socketId, nickname } = room.queue.shift();
  const sock = io.sockets.sockets.get(socketId);
  if (!sock) { dequeueNext(roomCode); return; } // 已斷線，跳過

  room.users.set(socketId, nickname);
  sock.join(roomCode);
  sock.roomCode = roomCode;

  // 通知該玩家：你進房了
  sock.emit('queueAdmitted', {
    roomCode,
    canvasSnapshot: room.canvasSnapshot,
    roomInfo: getRoomSummary(room)
  });

  // 通知房間其他人
  sock.to(roomCode).emit('userJoined', {
    nickname,
    roomInfo: getRoomSummary(room)
  });

  broadcastRoomList();
}

// ── Socket 事件 ────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[連線] ${socket.id}`);

  // ── 取得公開房間列表 ────────────────────────────
  socket.on('getRoomList', () => {
    const list = Object.values(rooms)
      .filter(r => r.isPublic)
      .map(getRoomSummary)
      .sort((a, b) => b.userCount - a.userCount);
    socket.emit('roomList', list);
  });

  // ── 建立房間 ────────────────────────────────────
  socket.on('createRoom', ({ nickname, roomName, isPublic }, callback) => {
    // 公開房間最多 5 間
    if (isPublic) {
      const publicCount = Object.values(rooms).filter(r => r.isPublic && !r.isPermanent).length;
      if (publicCount >= 3) {
        return callback({ success: false, error: '公開房間已達上限（3 間），請等待現有房間關閉' });
      }
    }
    const code = generateCode();
    rooms[code] = {
      code,
      name:           roomName || `${nickname} 的房間`,
      isPublic:       !!isPublic,
      maxUsers:       MAX_USERS,
      users:          new Map([[socket.id, nickname]]),
      queue:          [],
      canvasSnapshot: null,
      clearVotes:     new Set(),
      createdAt:      new Date()
    };
    socket.join(code);
    socket.roomCode = code;

    console.log(`[建立] ${code} "${rooms[code].name}" by ${nickname}`);
    broadcastRoomList();

    callback({ success: true, roomCode: code, roomInfo: getRoomSummary(rooms[code]) });
  });

  // ── 加入房間 ────────────────────────────────────
  socket.on('joinRoom', ({ roomCode, nickname }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ success: false, error: '房間不存在' });

    // 已在房間內（重連）
    if (room.users.has(socket.id)) {
      socket.join(roomCode);
      socket.roomCode = roomCode;
      return callback({
        success: true, roomCode,
        canvasSnapshot: room.canvasSnapshot,
        roomInfo: getRoomSummary(room)
      });
    }

    // 房間有空位
    if (room.users.size < room.maxUsers) {
      // 取消待刪計時器（建立者跳頁後重新連進來）
      if (room._deleteTimer) {
        clearTimeout(room._deleteTimer);
        room._deleteTimer = null;
      }
      room.users.set(socket.id, nickname);
      socket.join(roomCode);
      socket.roomCode = roomCode;
      recordJoin(); // 記錄統計

      socket.to(roomCode).emit('userJoined', {
        nickname, roomInfo: getRoomSummary(room)
      });

      broadcastRoomList();
      return callback({
        success: true, roomCode,
        canvasSnapshot:  room.canvasSnapshot,
        roomInfo: getRoomSummary(room)
      });
    }

    // 房間滿了 → 排隊
    room.queue.push({ socketId: socket.id, nickname });
    const pos = room.queue.length;
    socket.roomCode = roomCode; // 記住，斷線時要從隊列移除

    console.log(`[排隊] ${nickname} 在 ${roomCode} 第 ${pos} 位`);
    callback({
      success: true,
      queued: true,
      queuePos: pos,
      roomCode
    });
  });

  // ── 快速加入（隨機找一間有空位的公開房） ─────────
  socket.on('quickJoin', ({ nickname }, callback) => {
    // 找有空位且為公開的房間
    const available = Object.values(rooms).find(
      r => r.isPublic && r.users.size < r.maxUsers
    );

    if (available) {
      // 直接呼叫 joinRoom 邏輯
      available.users.set(socket.id, nickname);
      socket.join(available.code);
      socket.roomCode = available.code;

      socket.to(available.code).emit('userJoined', {
        nickname, roomInfo: getRoomSummary(available)
      });
      broadcastRoomList();

      return callback({
        success: true,
        roomCode: available.code,
        canvasSnapshot: available.canvasSnapshot,
        roomInfo: getRoomSummary(available)
      });
    }

    // 全滿 → 嘗試自動建立新公開房（檢查上限）
    const publicCount = Object.values(rooms).filter(r => r.isPublic && !r.isPermanent).length;
    if (publicCount >= 3) {
      return callback({ success: false, error: '目前公開房間已滿 3 間，請稍後再試或等待有空位的房間' });
    }
    const code = generateCode();
    rooms[code] = {
      code,
      name:           '公開塗鴉房',
      isPublic:       true,
      maxUsers:       MAX_USERS,
      users:          new Map([[socket.id, nickname]]),
      queue:          [],
      canvasSnapshot: null,
      clearVotes:     new Set(),
      createdAt:      new Date()
    };
    socket.join(code);
    socket.roomCode = code;
    broadcastRoomList();

    callback({ success: true, roomCode: code, roomInfo: getRoomSummary(rooms[code]) });
  });

  // ── 心跳 ping ──────────────────────────────────────
  socket.on('ping', () => {
    socket.emit('pong'); // 回應保持連線
  });

  // ── 繪圖廣播 + 活動追蹤 ────────────────────────
  socket.on('draw', (data) => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!rc || !room) return;
    socket.to(rc).emit('draw', data);

    // 記錄最近畫圖的人，1 分鐘後移除
    if (!room.recentDrawers) room.recentDrawers = new Set();
    room.recentDrawers.add(socket.id);
    clearTimeout(socket._drawTimer);
    socket._drawTimer = setTimeout(() => {
      if (room.recentDrawers) room.recentDrawers.delete(socket.id);
    }, 60000); // 60 秒
  });

  // ── 圖片貼上廣播 ────────────────────────────────
  socket.on('pasteImage', ({ dataURL }) => {
    const rc = socket.roomCode;
    if (rc) socket.to(rc).emit('pasteImage', { dataURL });
  });



  // ── 游標移動 ────────────────────────────────────
  socket.on('cursorMove', ({ x, y }) => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!room) return;
    const name = room.users.get(socket.id) || '?';
    socket.to(rc).emit('cursorMove', { socketId: socket.id, x, y, name });
  });

  // ── 儲存快照（同步寫入 Redis 永久保存） ─────────
  socket.on('saveSnapshot', ({ snapshot }) => {
    const rc = socket.roomCode;
    if (!rc || !rooms[rc]) return;
    if (!snapshot || snapshot.length < 100) return; // 過濾空快照

    rooms[rc].canvasSnapshot = snapshot;
    // 非同步寫入 Redis
    redisSet(`canvas:${rc}`, snapshot)
      .then(() => {}) // 成功不需要 log（太頻繁）
      .catch(e => console.error(`[Redis 寫入失敗] ${rc}:`, e.message));
  });

  // ── 清除畫布（純投票制，無房主） ───────────────
  socket.on('requestClear', () => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!room) return;

    room.clearVotes.add(socket.id);
    const needed  = Math.max(2, Math.ceil(room.users.size / 2)); // 至少 2 票
    const current = room.clearVotes.size;

    io.to(rc).emit('clearVoteUpdate', { current, needed });

    if (current >= needed) {
      room.canvasSnapshot = null;
      room.clearVotes.clear();
      redisSet(`canvas:${rc}`, '').catch(()=>{});
      io.to(rc).emit('clearCanvas');
    }
  });

  // ── 聊天訊息 ────────────────────────────────────
  socket.on('chatMessage', ({ message }) => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!room) return;
    const nickname = room.users.get(socket.id) || '?';
    const msg = String(message).trim().slice(0, 200); // 限制長度
    if (!msg) return;
    // 廣播給房間所有人（包含自己）
    io.to(rc).emit('chatMessage', {
      nickname,
      message: msg,
      time: new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' })
    });
  });

  // ── 表情反應 ────────────────────────────────────
  socket.on('reaction', ({ emoji }) => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!room) return;
    const nickname = room.users.get(socket.id) || '?';
    // 廣播給所有人（含自己），讓每個人都看到飄動表情
    io.to(rc).emit('reaction', { nickname, emoji });
  });

    // ── 斷線 ────────────────────────────────────────
  socket.on('disconnect', () => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!room) return;

    const nickname = room.users.get(socket.id) || '?';
    room.users.delete(socket.id);
    room.clearVotes.delete(socket.id);

    // 也從排隊移除（如果斷線前在排隊）
    room.queue = room.queue.filter(q => q.socketId !== socket.id);

    console.log(`[離線] ${nickname} from ${rc}`);

    if (room.users.size === 0 && room.queue.length === 0) {
      if (room.isPermanent) {
        // 永久房間不刪除，直接廣播更新
        broadcastRoomList();
        return;
      }
      // 等待 10 秒再刪房，給建立者跳頁後重新連線的時間
      room._deleteTimer = setTimeout(() => {
        if (rooms[rc] && rooms[rc].users.size === 0 && rooms[rc].queue.length === 0) {
          delete rooms[rc];
          broadcastRoomList();
          console.log(`[刪除房間] ${rc} 空房間超時刪除`);
        }
      }, 10000);
      return;
    }
    // 有新人加入時，取消待刪計時器
    if (room._deleteTimer) {
      clearTimeout(room._deleteTimer);
      room._deleteTimer = null;
    }

    io.to(rc).emit('userLeft', {
      nickname,
      roomInfo: getRoomSummary(room)
    });

    // 有人離開 → 讓排隊者進來
    dequeueNext(rc);
    broadcastRoomList();
  });
});

server.listen(PORT, () => console.log(`✅ 伺服器：http://localhost:${PORT}`));

