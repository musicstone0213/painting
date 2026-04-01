// ================================================
// room.js — v4：5種畫筆 + 貼圖系統 + 聊天 + 表情
// ================================================

const roomCode     = sessionStorage.getItem('roomCode');
const nickname     = sessionStorage.getItem('nickname');
const initQueued   = sessionStorage.getItem('queued') === '1';
const initQueuePos = parseInt(sessionStorage.getItem('queuePos') || '0');
const initSnapshot = sessionStorage.getItem('canvasSnapshot');

if (!roomCode || !nickname) { window.location.href = 'index.html'; }
sessionStorage.removeItem('canvasSnapshot');
sessionStorage.removeItem('queued');
sessionStorage.removeItem('queuePos');

const socket = io();

// ── DOM ──────────────────────────────────────────
const canvas           = document.getElementById('mainCanvas');
const ctx              = canvas.getContext('2d');
const wrapper          = document.getElementById('canvasWrapper');
const colorPicker      = document.getElementById('colorPicker');
const swatches         = document.querySelectorAll('.swatch');
const sizeBtns         = document.querySelectorAll('.size-btn');
const brushBtns        = document.querySelectorAll('.brush-btn');
const clearBtn         = document.getElementById('clearBtn');
const leaveBtn         = document.getElementById('leaveBtn');
const copyCodeBtn      = document.getElementById('copyCodeBtn');
const roomCodeDisp     = document.getElementById('roomCodeDisplay');
const onlineCount      = document.getElementById('onlineCount');
const cursorLayer      = document.getElementById('cursorLayer');
const danmakuLayer     = document.getElementById('danmakuLayer');
const reactionLayer    = document.getElementById('reactionLayer');
const reactionBtns     = document.querySelectorAll('.reaction-btn');
const voteToast        = document.getElementById('voteToast');
const voteCountEl      = document.getElementById('voteCount');
const voteNeededEl     = document.getElementById('voteNeeded');
const notifToast       = document.getElementById('notifToast');
const queueScreen      = document.getElementById('queueScreen');
const queuePosEl       = document.getElementById('queuePos');

// 分頁
const tabBtns          = document.querySelectorAll('.ttab');
const panelPen         = document.getElementById('panelPen');
const panelSticker     = document.getElementById('panelSticker');

// 聊天
const chatSidebar      = document.getElementById('chatSidebar');
const chatMessages     = document.getElementById('chatMessages');
const chatInput        = document.getElementById('chatInput');
const chatSendBtn      = document.getElementById('chatSendBtn');
const chatCloseBtn     = document.getElementById('chatCloseBtn');
const chatToggleBtn    = document.getElementById('chatToggleBtn');
const mobileChat       = document.getElementById('mobileChat');
const mobileChatMsgs   = document.getElementById('mobileChatMessages');
const mobileChatInput  = document.getElementById('mobileChatInput');
const mobileChatSend   = document.getElementById('mobileChatSendBtn');
const mobileChatClose  = document.getElementById('mobileChatCloseBtn');

// 貼圖
const stickerSearchInput = document.getElementById('stickerSearchInput');
const stickerSearchBtn   = document.getElementById('stickerSearchBtn');
const stickerGrid        = document.getElementById('stickerGrid');
const stickerTags        = document.getElementById('stickerTags');
const stickerPreview     = document.getElementById('stickerPreview');
const stickerPreviewImg  = document.getElementById('stickerPreviewImg');
const stickerConfirmBtn  = document.getElementById('stickerConfirmBtn');
const stickerCancelBtn   = document.getElementById('stickerCancelBtn');
const stickerHandle      = document.getElementById('stickerHandle');

// ── 狀態 ─────────────────────────────────────────
let currentColor  = '#1A1A2E';
let currentSize   = 4;
let currentBrush  = 'pen';  // pen | ink | pixel | crayon | marker | eraser
let isDrawing     = false;
let lastX = 0, lastY = 0;
let lastVX = 0, lastVY = 0; // 毛筆速度追蹤
let inQueue       = initQueued;
let currentMode   = 'draw'; // draw | sticker
const remoteCursors = {};

// 貼圖預覽狀態
let stickerData = {
  img: null, x: 100, y: 100, w: 120, h: 120,
  dragging: false, resizing: false,
  dragOffX: 0, dragOffY: 0
};

// ── 初始化 ────────────────────────────────────────
roomCodeDisp.textContent = roomCode;

function fillWhite() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
function resizeCanvas() {
  const rect = wrapper.getBoundingClientRect();
  const snap = canvas.toDataURL();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  fillWhite();
  const img = new Image();
  img.src = snap;
  img.onload = () => ctx.drawImage(img, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

if (initSnapshot) {
  const img = new Image();
  img.src = initSnapshot;
  img.onload = () => { fillWhite(); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
} else { fillWhite(); }

if (inQueue) { queueScreen.classList.remove('hidden'); queuePosEl.textContent = initQueuePos; }

// ── 進入房間 ──────────────────────────────────────
socket.emit('joinRoom', { roomCode, nickname }, (res) => {
  if (!res.success) { alert(res.error); window.location.href='index.html'; return; }
  onlineCount.textContent = res.roomInfo.userCount;
  if (res.queued) {
    inQueue = true; queueScreen.classList.remove('hidden'); queuePosEl.textContent = res.queuePos;
  } else {
    inQueue = false; queueScreen.classList.add('hidden');
    if (res.canvasSnapshot) {
      const img = new Image();
      img.src = res.canvasSnapshot;
      img.onload = () => { fillWhite(); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    }
  }
});
socket.on('queueAdmitted', (res) => {
  inQueue = false; queueScreen.classList.add('hidden');
  onlineCount.textContent = res.roomInfo.userCount;
  if (res.canvasSnapshot) {
    const img = new Image(); img.src = res.canvasSnapshot;
    img.onload = () => { fillWhite(); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
  } else fillWhite();
  showNotif('🎉 輪到你了！');
});

// ══════════════════════════════════════════════════
// 畫筆工具
// ══════════════════════════════════════════════════
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

/** 根據筆刷類型實際畫線 */
function applyBrush(ctx2, x0, y0, x1, y1, color, size, brush, vx, vy) {
  const speed = Math.sqrt(vx*vx + vy*vy);
  ctx2.save();
  switch(brush) {
    case 'pen':
      // 鉛筆：細緻、輕微雜訊
      ctx2.globalAlpha = 0.85;
      ctx2.strokeStyle = color;
      ctx2.lineWidth   = size;
      ctx2.lineCap = ctx2.lineJoin = 'round';
      ctx2.beginPath(); ctx2.moveTo(x0,y0); ctx2.lineTo(x1,y1); ctx2.stroke();
      // 輕微噪點
      if (Math.random() > 0.6) {
        ctx2.globalAlpha = 0.15;
        ctx2.fillStyle = color;
        for (let i=0;i<3;i++) {
          ctx2.fillRect(x1 + (Math.random()-0.5)*size*1.5, y1 + (Math.random()-0.5)*size*1.5, 1, 1);
        }
      }
      break;

    case 'ink':
      // 毛筆：速度越快線越細
      const inkW = Math.max(1, size - speed * 0.3);
      ctx2.globalAlpha = 0.92;
      ctx2.strokeStyle = color;
      ctx2.lineWidth   = inkW;
      ctx2.lineCap = ctx2.lineJoin = 'round';
      ctx2.beginPath(); ctx2.moveTo(x0,y0); ctx2.lineTo(x1,y1); ctx2.stroke();
      break;

    case 'pixel':
      // 像素筆：方形筆觸、無抗鋸齒
      ctx2.imageSmoothingEnabled = false;
      ctx2.globalAlpha = 1;
      ctx2.fillStyle = color;
      // 在兩點之間插值填方塊
      const steps = Math.max(1, Math.ceil(Math.hypot(x1-x0, y1-y0) / size));
      for (let i=0; i<=steps; i++) {
        const t  = i / steps;
        const px = Math.floor(x0 + (x1-x0)*t);
        const py = Math.floor(y0 + (y1-y0)*t);
        ctx2.fillRect(px - Math.floor(size/2), py - Math.floor(size/2), size, size);
      }
      break;

    case 'crayon':
      // 蠟筆：半透明、邊緣不規則
      ctx2.globalAlpha = 0.55;
      ctx2.strokeStyle = color;
      ctx2.lineWidth   = size * 1.5;
      ctx2.lineCap = ctx2.lineJoin = 'round';
      ctx2.beginPath(); ctx2.moveTo(x0,y0); ctx2.lineTo(x1,y1); ctx2.stroke();
      // 邊緣紋路
      ctx2.globalAlpha = 0.25;
      ctx2.lineWidth = size * 0.4;
      for (let i=0; i<3; i++) {
        const ox = (Math.random()-0.5)*size;
        const oy = (Math.random()-0.5)*size;
        ctx2.beginPath(); ctx2.moveTo(x0+ox,y0+oy); ctx2.lineTo(x1+ox,y1+oy); ctx2.stroke();
      }
      break;

    case 'marker':
      // 螢光筆：粗、半透明
      ctx2.globalAlpha = 0.35;
      ctx2.strokeStyle = color;
      ctx2.lineWidth   = size * 2.5;
      ctx2.lineCap = ctx2.lineJoin = 'square';
      ctx2.beginPath(); ctx2.moveTo(x0,y0); ctx2.lineTo(x1,y1); ctx2.stroke();
      break;

    case 'eraser':
      ctx2.globalAlpha = 1;
      ctx2.strokeStyle = '#ffffff';
      ctx2.lineWidth   = size * 3;
      ctx2.lineCap = ctx2.lineJoin = 'round';
      ctx2.beginPath(); ctx2.moveTo(x0,y0); ctx2.lineTo(x1,y1); ctx2.stroke();
      break;
  }
  ctx2.restore();
  ctx2.globalAlpha = 1;
  ctx2.imageSmoothingEnabled = true;
}

function onDrawStart(e) {
  if (inQueue || currentMode !== 'draw') return;
  e.preventDefault();
  isDrawing = true;
  const {x,y} = getPos(e);
  lastX=x; lastY=y; lastVX=0; lastVY=0;
}
function onDrawMove(e) {
  if (inQueue || currentMode !== 'draw') return;
  e.preventDefault();
  const {x,y} = getPos(e);
  socket.emit('cursorMove', {x, y});
  if (!isDrawing) return;
  const vx = x - lastX, vy = y - lastY;
  const data = { x0:lastX, y0:lastY, x1:x, y1:y, color:currentColor, size:currentSize, brush:currentBrush, vx, vy };
  applyBrush(ctx, data.x0, data.y0, data.x1, data.y1, data.color, data.size, data.brush, data.vx, data.vy);
  socket.emit('draw', data);
  lastX=x; lastY=y; lastVX=vx; lastVY=vy;
}
function onDrawEnd() {
  if (!isDrawing) return;
  isDrawing = false;
  socket.emit('saveSnapshot', { snapshot: canvas.toDataURL('image/jpeg', 0.6) });
}

canvas.addEventListener('mousedown',  onDrawStart);
canvas.addEventListener('mousemove',  onDrawMove);
canvas.addEventListener('mouseup',    onDrawEnd);
canvas.addEventListener('mouseleave', onDrawEnd);
canvas.addEventListener('touchstart',  onDrawStart, {passive:false});
canvas.addEventListener('touchmove',   onDrawMove,  {passive:false});
canvas.addEventListener('touchend',    onDrawEnd);

// ══════════════════════════════════════════════════
// 圖片貼上（Ctrl+V）
// ══════════════════════════════════════════════════
document.addEventListener('paste', (e) => {
  if (inQueue) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob = item.getAsFile();
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const maxW = canvas.width*0.5, maxH = canvas.height*0.5;
        let w=img.width, h=img.height;
        if (w>maxW){h=h*maxW/w;w=maxW;}
        if (h>maxH){w=w*maxH/h;h=maxH;}
        const x=(canvas.width-w)/2, y=(canvas.height-h)/2;
        ctx.drawImage(img,x,y,w,h);
        URL.revokeObjectURL(url);
        const tmp=document.createElement('canvas'); tmp.width=canvas.width; tmp.height=canvas.height;
        tmp.getContext('2d').drawImage(img,x,y,w,h);
        socket.emit('pasteImage', {dataURL: tmp.toDataURL('image/png')});
        socket.emit('saveSnapshot', {snapshot: canvas.toDataURL('image/jpeg',0.6)});
      };
      img.src = url; break;
    }
  }
});

// ══════════════════════════════════════════════════
// 貼圖系統
// ══════════════════════════════════════════════════

/** 用 Anthropic API 搜尋迷因關鍵字，回傳圖片 URL 列表 */
async function searchStickers(query) {
  stickerGrid.innerHTML = '<div class="sticker-loading">🔍 搜尋中...</div>';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `你是迷因貼圖搜尋助手。用戶輸入關鍵字，你用 web_search 搜尋相關迷因圖片，
回傳一個 JSON 陣列，包含 5~8 張圖片的直連 URL（.png, .jpg, .gif, .webp）。
只回傳 JSON 陣列，不要加其他文字或 markdown。格式：["url1","url2",...]`,
        messages: [{ role: 'user', content: `搜尋迷因圖片：${query}，找真實可用的圖片直連 URL` }]
      })
    });
    const data = await res.json();
    const text = data.content.filter(b=>b.type==='text').map(b=>b.text).join('');
    const clean = text.replace(/```json|```/g,'').trim();
    const urls  = JSON.parse(clean);
    renderStickerResults(urls);
  } catch(err) {
    stickerGrid.innerHTML = `<div class="sticker-error">搜尋失敗，請再試一次 😢</div>`;
  }
}

function renderStickerResults(urls) {
  if (!urls || urls.length === 0) {
    stickerGrid.innerHTML = '<div class="sticker-error">沒有找到圖片，換個關鍵字試試</div>';
    return;
  }
  stickerGrid.innerHTML = '';
  urls.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'sticker-item';
    img.crossOrigin = 'anonymous';
    img.onerror = () => img.remove(); // 無效 URL 自動移除
    img.addEventListener('click', () => activateStickerPreview(img));
    stickerGrid.appendChild(img);
  });
}

/** 啟動貼圖預覽框 */
function activateStickerPreview(imgEl) {
  const src = imgEl.src;
  stickerPreviewImg.src = src;
  stickerData.img = imgEl;

  // 預設大小：貼在畫布正中央
  const cRect = wrapper.getBoundingClientRect();
  stickerData.w = 150;
  stickerData.h = 150;
  stickerData.x = (cRect.width  - stickerData.w) / 2;
  stickerData.y = (cRect.height - stickerData.h) / 2 - 60;

  updateStickerPreviewPos();
  stickerPreview.classList.remove('hidden');
  wrapper.classList.add('sticker-mode');
}

function updateStickerPreviewPos() {
  stickerPreview.style.left   = stickerData.x + 'px';
  stickerPreview.style.top    = stickerData.y + 'px';
  stickerPreview.style.width  = stickerData.w + 'px';
  stickerPreview.style.height = stickerData.h + 'px';
}

/** 拖曳移動貼圖預覽 */
stickerPreview.addEventListener('mousedown', (e) => {
  if (e.target === stickerHandle) return;
  stickerData.dragging = true;
  stickerData.dragOffX = e.clientX - stickerData.x;
  stickerData.dragOffY = e.clientY - stickerData.y;
  e.preventDefault();
});
stickerHandle.addEventListener('mousedown', (e) => {
  stickerData.resizing = true;
  e.preventDefault(); e.stopPropagation();
});
document.addEventListener('mousemove', (e) => {
  if (stickerData.dragging) {
    const cRect = wrapper.getBoundingClientRect();
    stickerData.x = e.clientX - stickerData.dragOffX;
    stickerData.y = e.clientY - stickerData.dragOffY;
    updateStickerPreviewPos();
  }
  if (stickerData.resizing) {
    const cRect = wrapper.getBoundingClientRect();
    const newW = Math.max(40, e.clientX - cRect.left - stickerData.x);
    const newH = Math.max(40, e.clientY - cRect.top  - stickerData.y);
    stickerData.w = newW;
    stickerData.h = newH;
    updateStickerPreviewPos();
  }
});
document.addEventListener('mouseup', () => {
  stickerData.dragging = false;
  stickerData.resizing = false;
});

// 觸控支援
stickerPreview.addEventListener('touchstart', (e) => {
  if (e.target === stickerHandle) { stickerData.resizing = true; return; }
  const t = e.touches[0];
  stickerData.dragging = true;
  stickerData.dragOffX = t.clientX - stickerData.x;
  stickerData.dragOffY = t.clientY - stickerData.y;
  e.preventDefault();
}, {passive:false});
document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (stickerData.dragging) {
    stickerData.x = t.clientX - stickerData.dragOffX;
    stickerData.y = t.clientY - stickerData.dragOffY;
    updateStickerPreviewPos();
  }
  if (stickerData.resizing) {
    const cRect = wrapper.getBoundingClientRect();
    stickerData.w = Math.max(40, t.clientX - cRect.left - stickerData.x);
    stickerData.h = Math.max(40, t.clientY - cRect.top  - stickerData.y);
    updateStickerPreviewPos();
  }
}, {passive:false});
document.addEventListener('touchend', () => { stickerData.dragging=false; stickerData.resizing=false; });

/** 確認貼圖：畫到 canvas 並廣播 */
stickerConfirmBtn.addEventListener('click', () => {
  const cRect  = canvas.getBoundingClientRect();
  // 換算成 canvas 內座標（考慮 padding-bottom 造成的偏移）
  const wRect  = wrapper.getBoundingClientRect();
  const cx = stickerData.x;
  const cy = stickerData.y;
  const cw = stickerData.w;
  const ch = stickerData.h;

  // 畫到 canvas
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = stickerPreviewImg.src;
  img.onload = () => {
    ctx.drawImage(img, cx, cy, cw, ch);
    // 廣播
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(img, cx, cy, cw, ch);
    socket.emit('placeSticker', { dataURL: tmp.toDataURL('image/png'), x:cx, y:cy, w:cw, h:ch });
    socket.emit('saveSnapshot', { snapshot: canvas.toDataURL('image/jpeg',0.6) });
  };

  stickerPreview.classList.add('hidden');
  wrapper.classList.remove('sticker-mode');
});

stickerCancelBtn.addEventListener('click', () => {
  stickerPreview.classList.add('hidden');
  wrapper.classList.remove('sticker-mode');
});

// 搜尋事件
stickerSearchBtn.addEventListener('click', () => {
  const q = stickerSearchInput.value.trim();
  if (q) searchStickers(q);
});
stickerSearchInput.addEventListener('keydown', e => { if (e.key==='Enter') stickerSearchBtn.click(); });
document.querySelectorAll('.sticker-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    stickerSearchInput.value = tag.dataset.q;
    searchStickers(tag.dataset.q);
  });
});

// ══════════════════════════════════════════════════
// Socket 接收
// ══════════════════════════════════════════════════
socket.on('draw', (data) => {
  applyBrush(ctx, data.x0, data.y0, data.x1, data.y1, data.color, data.size, data.brush, data.vx||0, data.vy||0);
});
socket.on('pasteImage', ({dataURL}) => {
  const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0); img.src=dataURL;
});
socket.on('placeSticker', ({dataURL, x, y, w, h}) => {
  const img=new Image(); img.onload=()=>ctx.drawImage(img,x,y,w,h); img.src=dataURL;
});
socket.on('clearCanvas', () => { fillWhite(); voteToast.classList.add('hidden'); showNotif('🗑️ 畫布已清除'); });
socket.on('clearVoteUpdate', ({current,needed}) => {
  voteCountEl.textContent=current; voteNeededEl.textContent=needed;
  voteToast.classList.remove('hidden');
  clearTimeout(window._voteTimer);
  window._voteTimer=setTimeout(()=>voteToast.classList.add('hidden'),6000);
});
socket.on('userJoined', ({nickname:n,roomInfo}) => { onlineCount.textContent=roomInfo.userCount; appendSystemMsg(`🎨 ${n} 加入了`); showNotif(`🎨 ${n} 加入了`); });
socket.on('userLeft',   ({nickname:n,roomInfo}) => { onlineCount.textContent=roomInfo.userCount; appendSystemMsg(`👋 ${n} 離開了`); showNotif(`👋 ${n} 離開了`); });
socket.on('cursorMove', ({socketId,x,y,name}) => {
  if (!remoteCursors[socketId]) {
    const el=document.createElement('div'); el.className='remote-cursor'; el.textContent=name;
    cursorLayer.appendChild(el); remoteCursors[socketId]=el;
  }
  remoteCursors[socketId].style.left=x+'px'; remoteCursors[socketId].style.top=y+'px';
});
socket.on('chatMessage', ({nickname:n,message,time}) => appendChatMsg(n,message,time));
socket.on('reaction',    ({nickname:n,emoji}) => {
  spawnReactionFloat(emoji);
  appendSystemMsg(`${n} ${emoji}`);
  if (window.innerWidth<768) spawnDanmaku(`${n} ${emoji}`);
});

// ══════════════════════════════════════════════════
// 工具列
// ══════════════════════════════════════════════════

// 分頁切換
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    panelPen.classList.toggle('hidden', tab!=='pen');
    panelSticker.classList.toggle('hidden', tab!=='sticker');
    currentMode = tab === 'sticker' ? 'sticker' : 'draw';
    if (tab !== 'sticker') { stickerPreview.classList.add('hidden'); wrapper.classList.remove('sticker-mode'); }
  });
});

// 顏色
colorPicker.addEventListener('input', e => { currentColor=e.target.value; });
swatches.forEach(sw => {
  sw.addEventListener('click', () => {
    currentColor=sw.dataset.color; colorPicker.value=currentColor;
    swatches.forEach(s=>s.classList.remove('active')); sw.classList.add('active');
    if (currentBrush==='eraser') { currentBrush='pen'; updateBrushUI('pen'); }
  });
});

// 線寬
sizeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentSize=parseInt(btn.dataset.size);
    sizeBtns.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  });
});

// 畫筆類型
function updateBrushUI(brush) {
  brushBtns.forEach(b=>b.classList.toggle('active', b.dataset.brush===brush));
  wrapper.classList.toggle('eraser-mode', brush==='eraser');
}
brushBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentBrush = btn.dataset.brush;
    updateBrushUI(currentBrush);
  });
});

// 清除
clearBtn.addEventListener('click', () => { if (inQueue) return; socket.emit('requestClear'); showNotif('🗳️ 已投票清除畫布'); });

// 離開
leaveBtn.addEventListener('click', () => {
  if (confirm('確定要離開房間嗎？')) { socket.disconnect(); sessionStorage.clear(); window.location.href='index.html'; }
});
copyCodeBtn.addEventListener('click', () => { navigator.clipboard.writeText(roomCode).then(()=>showNotif('✅ 代碼已複製')); });

// 表情
reactionBtns.forEach(btn => {
  btn.addEventListener('click', () => { if (inQueue) return; socket.emit('reaction', {emoji:btn.dataset.emoji}); });
});

// 聊天
function sendChat(inputEl) {
  const msg=inputEl.value.trim(); if (!msg||inQueue) return;
  socket.emit('chatMessage', {message:msg}); inputEl.value='';
}
chatSendBtn.addEventListener('click', ()=>sendChat(chatInput));
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(chatInput); });
mobileChatSend.addEventListener('click', ()=>sendChat(mobileChatInput));
mobileChatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(mobileChatInput); });
chatToggleBtn.addEventListener('click', ()=>mobileChat.classList.toggle('open'));
mobileChatClose.addEventListener('click', ()=>mobileChat.classList.remove('open'));
chatCloseBtn.addEventListener('click', ()=>{ chatSidebar.style.display='none'; });

// ══════════════════════════════════════════════════
// 工具函式
// ══════════════════════════════════════════════════
function appendChatMsg(name, message, time) {
  const html=`<div class="chat-msg"><div class="chat-msg-header"><span class="chat-msg-name" style="color:${nameToColor(name)}">${escapeHtml(name)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${escapeHtml(message)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html); chatMessages.scrollTop=chatMessages.scrollHeight;
  mobileChatMsgs.insertAdjacentHTML('beforeend',html); mobileChatMsgs.scrollTop=mobileChatMsgs.scrollHeight;
}
function appendSystemMsg(text) {
  const html=`<div class="chat-msg system"><div class="chat-msg-text">${escapeHtml(text)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html); chatMessages.scrollTop=chatMessages.scrollHeight;
  mobileChatMsgs.insertAdjacentHTML('beforeend',html); mobileChatMsgs.scrollTop=mobileChatMsgs.scrollHeight;
}
function spawnReactionFloat(emoji) {
  const el=document.createElement('div'); el.className='reaction-float'; el.textContent=emoji;
  el.style.left=(10+Math.random()*80)+'%'; reactionLayer.appendChild(el);
  setTimeout(()=>el.remove(),2600);
}
function spawnDanmaku(text) {
  const el=document.createElement('div'); el.className='danmaku-item'; el.textContent=text;
  el.style.top=(10+Math.random()*70)+'%'; danmakuLayer.appendChild(el);
  setTimeout(()=>el.remove(),6200);
}
let _notifTimer;
function showNotif(msg) {
  notifToast.textContent=msg; notifToast.classList.remove('hidden');
  clearTimeout(_notifTimer); _notifTimer=setTimeout(()=>notifToast.classList.add('hidden'),3000);
}
function escapeHtml(str){ return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nameToColor(name){
  const colors=['#4ECDC4','#FF6B6B','#FFD93D','#C77DFF','#45B7D1','#F7B731','#26de81','#fd9644'];
  let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  return colors[Math.abs(h)%colors.length];
}
