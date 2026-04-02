// ================================================
// lobby.js v3 — 紅色像素風 + 公開房間限 5 間
// ================================================
const socket = io();

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
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('nickname', nicknameInput.value.trim());
  sessionStorage.setItem('queued',   queued ? '1' : '0');
  sessionStorage.setItem('queuePos', queuePos || '0');
  window.location.href = 'room.html';
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 房間列表 ──────────────────────────────────────
function renderRoomList(list) {
  if (!list || list.length === 0) {
    roomListEl.innerHTML = '<div class="room-hint">目前沒有公開房間，快來建立第一間！</div>';
    return;
  }
  roomListEl.innerHTML = list.map(r => {
    // 熱度指示
    const fillPct  = Math.round((r.userCount / r.maxUsers) * 100);
    const isHot    = fillPct >= 70;
    const isMid    = fillPct >= 40;
    const heatIcon = isHot ? '🔥' : isMid ? '👥' : '🌱';

    // 活動指示
    const activeText = r.activeDrawers > 0
      ? `・${r.activeDrawers} 人正在畫`
      : '';

    return `
    <div class="room-item ${r.isFull ? 'full' : ''} ${isHot ? 'hot' : ''}" data-code="${r.code}">
      <div class="room-item-info">
        <div class="room-name">${escapeHtml(r.name)}</div>
        <div class="room-count">
          ${heatIcon} ${r.userCount} / ${r.maxUsers} 人${activeText}${r.queueCount > 0 ? `・排隊 ${r.queueCount}` : ''}
        </div>
        <div class="room-bar-wrap">
          <div class="room-bar" style="width:${fillPct}%;background:${isHot ? '#FF6B6B' : isMid ? '#FFD93D' : '#4ECDC4'}"></div>
        </div>
      </div>
      ${r.isFull
        ? `<button class="room-full-badge">FULL</button>`
        : `<button class="room-join" data-code="${r.code}">JOIN</button>`
      }
    </div>`;
  }).join('');

  roomListEl.querySelectorAll('.room-join').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nickname = getNickname();
      if (!nickname) return;
      doJoin(btn.dataset.code, nickname);
    });
  });
  // 整列點擊（非滿房）
  roomListEl.querySelectorAll('.room-item:not(.full)').forEach(el => {
    el.addEventListener('click', () => {
      const nickname = getNickname();
      if (!nickname) return;
      doJoin(el.dataset.code, nickname);
    });
  });
}

socket.on('roomList', renderRoomList);
socket.emit('getRoomList');

refreshBtn.addEventListener('click', () => {
  refreshBtn.style.color = '#fff';
  socket.emit('getRoomList');
  setTimeout(() => refreshBtn.style.color = '', 400);
});

// ── 加入房間 ──────────────────────────────────────
function doJoin(roomCode, nickname) {
  socket.emit('joinRoom', { roomCode, nickname }, (res) => {
    if (!res.success) return showError(res.error || '加入失敗');
    if (res.canvasSnapshot) sessionStorage.setItem('canvasSnapshot', res.canvasSnapshot);
    if (res.queued) {
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

// ── 展開 / 收起 ──────────────────────────────────
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
  createBtn.textContent = '建立中…';
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
roomCodeInput.addEventListener('input', () => { roomCodeInput.value = roomCodeInput.value.toUpperCase(); });
roomCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
