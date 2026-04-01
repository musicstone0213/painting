// ================================================
// server.js — 後端主程式（v2：開放房間 + 排隊系統）
// ================================================

require('dotenv').config();
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

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
const MAX_USERS = 100;

// ── 工具 ──────────────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

function getRoomSummary(room) {
  return {
    code:      room.code,
    name:      room.name,
    userCount: room.users.size,
    queueCount:room.queue.length,
    maxUsers:  room.maxUsers,
    isFull:    room.users.size >= room.maxUsers
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

      socket.to(roomCode).emit('userJoined', {
        nickname, roomInfo: getRoomSummary(room)
      });

      broadcastRoomList();
      return callback({
        success: true, roomCode,
        canvasSnapshot: room.canvasSnapshot,
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

    // 全滿 → 自動建立新公開房
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

  // ── 繪圖廣播 ────────────────────────────────────
  socket.on('draw', (data) => {
    const rc = socket.roomCode;
    if (rc) socket.to(rc).emit('draw', data);
  });

  // ── 圖片貼上廣播 ────────────────────────────────
  socket.on('pasteImage', ({ dataURL }) => {
    const rc = socket.roomCode;
    if (rc) socket.to(rc).emit('pasteImage', { dataURL });
  });

  // ── 貼圖放置廣播（確認後同步給所有人） ─────────
  socket.on('placeSticker', ({ dataURL, x, y, w, h }) => {
    const rc = socket.roomCode;
    if (rc) socket.to(rc).emit('placeSticker', { dataURL, x, y, w, h });
  });

  // ── 游標移動 ────────────────────────────────────
  socket.on('cursorMove', ({ x, y }) => {
    const rc   = socket.roomCode;
    const room = rooms[rc];
    if (!room) return;
    const name = room.users.get(socket.id) || '?';
    socket.to(rc).emit('cursorMove', { socketId: socket.id, x, y, name });
  });

  // ── 儲存快照 ────────────────────────────────────
  socket.on('saveSnapshot', ({ snapshot }) => {
    const rc = socket.roomCode;
    if (rc && rooms[rc]) rooms[rc].canvasSnapshot = snapshot;
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

