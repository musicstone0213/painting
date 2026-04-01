// ================================================
// lobby.js — 大廳邏輯 v2
// 開放房間列表 + 快速加入 + 建立/私人加入
// ================================================

const socket = io();

// ── DOM ──────────────────────────────────────────
const nicknameInput   = document.getElementById('nicknameInput');
const quickJoinBtn    = document.getElementById('quickJoinBtn');
const refreshBtn      = document.getElementById('refreshBtn');
const roomListEl      = document.getElementById('roomList');
const toggleCreateBtn = document.getElementById('toggleCreateBtn');
const toggleJoinBtn   = document.getElementById('toggleJoinBtn');
const createPanel     = document.getElementById('createPanel');
const joinPanel       = document.getElementById('joinPanel');
const roomNameInput   = document.getElementById('roomNameInput');
const isPublicCheck   = document.getElementById('isPublicCheck');
const createBtn       = document.getElementById('createBtn');
const roomCodeInput   = document.getElementById('roomCodeInput');
const joinBtn         = document.getElementById('joinBtn');
const errorMsg        = document.getElementById('errorMsg');

// ── 工具 ──────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  setTimeout(() => errorMsg.classList.add('hidden'), 4000);
}

function getNickname() {
  const n = nicknameInput.value.trim();
  if (!n) { showError('請先輸入暱稱！'); nicknameInput.focus(); return null; }
  return n;
}

function enterRoom({ roomCode, queued, queuePos }) {
  sessionStorage.setItem('roomCode',  roomCode);
  sessionStorage.setItem('nickname',  nicknameInput.value.trim());
  sessionStorage.setItem('queued',    queued ? '1' : '0');
  sessionStorage.setItem('queuePos',  queuePos || '0');
  window.location.href = 'room.html';
}

// ── 房間列表 ──────────────────────────────────────
function renderRoomList(list) {
  if (!list || list.length === 0) {
    roomListEl.innerHTML = '<div class="room-list-empty">目前沒有公開房間，快來建立第一間！</div>';
    return;
  }
  roomListEl.innerHTML = list.map(r => `
    <div class="room-item ${r.isFull ? 'full' : ''}"
         data-code="${r.code}"
         title="${r.isFull ? `房間已滿，排隊中有 ${r.queueCount} 人` : '點擊加入'}">
      <span class="room-item-name">${escapeHtml(r.name)}</span>
      <span class="room-item-meta">
        <span class="room-item-count">👥 ${r.userCount}/${r.maxUsers}</span>
        <span class="room-item-badge ${r.isFull ? 'full-badge' : ''}">
          ${r.isFull ? (r.queueCount > 0 ? `排隊 ${r.queueCount}` : '已滿') : '加入'}
        </span>
      </span>
    </div>
  `).join('');

  // 綁定點擊
  roomListEl.querySelectorAll('.room-item').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.dataset.code;
      const nickname = getNickname();
      if (!nickname) return;
      doJoin(code, nickname);
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 伺服器推播更新列表
socket.on('roomList', renderRoomList);

// 初始拉取
socket.emit('getRoomList');

refreshBtn.addEventListener('click', () => {
  refreshBtn.style.transform = 'rotate(360deg)';
  setTimeout(() => refreshBtn.style.transform = '', 400);
  socket.emit('getRoomList');
});

// ── 加入房間邏輯 ──────────────────────────────────
function doJoin(roomCode, nickname) {
  socket.emit('joinRoom', { roomCode, nickname }, (res) => {
    if (!res.success) return showError(res.error || '加入失敗');

    if (res.canvasSnapshot) sessionStorage.setItem('canvasSnapshot', res.canvasSnapshot);

    if (res.queued) {
      // 排隊中 → 進入房間頁面顯示等待畫面
      enterRoom({ roomCode: res.roomCode, queued: true, queuePos: res.queuePos });
    } else {
      enterRoom({ roomCode: res.roomCode });
    }
  });
}

// ── 快速加入 ──────────────────────────────────────
quickJoinBtn.addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;

  quickJoinBtn.disabled = true;
  socket.emit('quickJoin', { nickname }, (res) => {
    quickJoinBtn.disabled = false;
    if (!res.success) return showError(res.error || '配對失敗，請再試');
    if (res.canvasSnapshot) sessionStorage.setItem('canvasSnapshot', res.canvasSnapshot);
    enterRoom({ roomCode: res.roomCode });
  });
});

// ── 展開/收起面板 ────────────────────────────────
toggleCreateBtn.addEventListener('click', () => {
  createPanel.classList.toggle('hidden');
  joinPanel.classList.add('hidden');
});
toggleJoinBtn.addEventListener('click', () => {
  joinPanel.classList.toggle('hidden');
  createPanel.classList.add('hidden');
});

// ── 建立房間 ──────────────────────────────────────
createBtn.addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;
  const roomName = roomNameInput.value.trim() || `${nickname} 的房間`;
  const isPublic = isPublicCheck.checked;

  createBtn.disabled = true;
  createBtn.textContent = '建立中...';

  socket.emit('createRoom', { nickname, roomName, isPublic }, (res) => {
    createBtn.disabled = false;
    createBtn.textContent = '建立房間';
    if (!res.success) return showError(res.error || '建立失敗');
    enterRoom({ roomCode: res.roomCode });
  });
});

// ── 代碼加入 ──────────────────────────────────────
joinBtn.addEventListener('click', () => {
  const nickname = getNickname();
  if (!nickname) return;
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 6) { showError('房間代碼需為 6 碼'); roomCodeInput.focus(); return; }
  doJoin(code, nickname);
});

roomCodeInput.addEventListener('input',  () => { roomCodeInput.value = roomCodeInput.value.toUpperCase(); });
roomCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
