// ================================================
// room.js v5 — 大畫布可滑動 + 抽屜工具列 + FAB
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

const socket = io({
  reconnection:        true,
  reconnectionDelay:   1000,
  reconnectionAttempts:20,
  timeout:             20000
});

// ── 連線狀態 HUD ──────────────────────────────────
function setConnectionStatus(status) {
  // status: 'connected' | 'disconnected' | 'reconnecting'
  const dot = document.querySelector('.hud-dot');
  const onlineEl = document.getElementById('onlineCount');
  if (!dot) return;
  if (status === 'connected') {
    dot.style.background = '#4cff91';
    dot.style.animation  = 'pulse 2s infinite';
    if (onlineEl) onlineEl.style.opacity = '1';
  } else if (status === 'disconnected') {
    dot.style.background = '#FF6B6B';
    dot.style.animation  = 'none';
    if (onlineEl) onlineEl.style.opacity = '0.4';
  } else {
    dot.style.background = '#FFD93D';
    dot.style.animation  = 'pulse .5s infinite';
  }
}

// 心跳：每 20 秒 ping 伺服器，防止 Render 閒置切斷
setInterval(() => { if (socket.connected) socket.emit('ping'); }, 20000);

socket.on('connect', () => {
  setConnectionStatus('connected');
});

socket.on('disconnect', (reason) => {
  setConnectionStatus('disconnected');
  showNotif('⚠️ 已斷線：' + reason);
});

socket.on('reconnecting', () => {
  setConnectionStatus('reconnecting');
  showNotif('🔄 重新連線中…');
});

// 重連後自動重新加入房間並載入畫布
socket.on('reconnect', () => {
  setConnectionStatus('connected');
  socket.emit('joinRoom', { roomCode, nickname }, (res) => {
    if (!res.success) return;
    onlineCount.textContent = res.roomInfo.userCount;
    showNotif('✅ 已重新連線');
    if (res.canvasSnapshot) {
      const img = new Image();
      img.src = res.canvasSnapshot;
      img.onload = () => { fillWhite(); ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); };
    }
  });
});

socket.on('reconnect_failed', () => {
  setConnectionStatus('disconnected');
  showNotif('❌ 無法連線，請重新整理頁面');
});

// ── DOM ──────────────────────────────────────────
const viewport         = document.getElementById('canvasViewport');
const canvas           = document.getElementById('mainCanvas');
const ctx              = canvas.getContext('2d');
const cursorLayer      = document.getElementById('cursorLayer');
const reactionLayer    = document.getElementById('reactionLayer');
const danmakuLayer     = document.getElementById('danmakuLayer');
const roomCodeDisp     = document.getElementById('roomCodeDisplay');
const onlineCount      = document.getElementById('onlineCount');
const leaveBtn         = document.getElementById('leaveBtn');
const copyCodeBtn      = document.getElementById('copyCodeBtn');
const colorPicker      = document.getElementById('colorPicker');
const swatches         = document.querySelectorAll('.swatch');
const brushBtns        = document.querySelectorAll('.brush-btn');
const sizeBtns         = document.querySelectorAll('.size-btn');
const voteToast        = document.getElementById('voteToast');
const voteCountEl      = document.getElementById('voteCount');
const voteNeededEl     = document.getElementById('voteNeeded');
const notifToast       = document.getElementById('notifToast');
const queueScreen      = document.getElementById('queueScreen');
const queuePosEl       = document.getElementById('queuePos');

// FAB
const fabMain          = document.getElementById('fabMain');
const fabModeToggle    = document.getElementById('fabModeToggle');
const fabUploadImg     = document.getElementById('fabUploadImg');
const fabModeIcon      = document.getElementById('fabModeIcon');
const fabModeLabel     = document.getElementById('fabModeLabel');
const fabMenu          = document.getElementById('fabMenu');
const fabChat          = document.getElementById('fabChat');
const fabReaction      = document.getElementById('fabReaction');
const fabClear         = document.getElementById('fabClear');

// Drawer
const drawer           = document.getElementById('drawer');
const drawerHandle     = document.getElementById('drawerHandle');

// Panels
const chatPanel        = document.getElementById('chatPanel');
const chatMessages     = document.getElementById('chatMessages');
const chatInput        = document.getElementById('chatInput');
const chatSendBtn      = document.getElementById('chatSendBtn');
const chatClose        = document.getElementById('chatClose');
const reactionPanel    = document.getElementById('reactionPanel');
const reactionPanelClose=document.getElementById('reactionPanelClose');
const reactionBigBtns  = document.querySelectorAll('.reaction-big-btn');

// Sticker preview
const stickerPreview   = document.getElementById('stickerPreview');
const stickerPreviewImg= document.getElementById('stickerPreviewImg');
const stickerConfirmBtn= document.getElementById('stickerConfirmBtn');
const stickerCancelBtn = document.getElementById('stickerCancelBtn');
const stickerHandle    = document.getElementById('stickerHandle');

// ── 狀態 ─────────────────────────────────────────
// 無邊界畫布：初始大小，畫到邊緣自動擴展
let CANVAS_W = 4000, CANVAS_H = 4000;
const EXPAND_MARGIN = 400; // 距離邊緣多少 px 時擴展
const EXPAND_SIZE   = 800; // 每次擴展多少 px
let currentColor = '#1A1A2E';
let currentSize  = 4;
let currentBrush = 'pen';
let isDrawing    = false;
let lastX=0, lastY=0;
let inQueue      = initQueued;
let fabOpen      = false;
let canvasMode   = 'draw'; // 'draw' | 'pan'

// 移動模式拖曳
let isPanning  = false;
let panStartX  = 0, panStartY  = 0;
let panScrollX = 0, panScrollY = 0;

// 縮放狀態（CSS transform scale）
let canvasScale    = 1;
const SCALE_MIN    = 0.2;
const SCALE_MAX    = 5;
let pinchStartDist = 0;
let pinchStartScale= 1;

// 圖片物件系統（已放置的圖片）
// imageObjects = [{ id, src, x, y, w, h, img }]
let imageObjects   = [];
let selectedImgId  = null; // 目前選中的圖片 id
let imgDragOffX    = 0, imgDragOffY = 0;
let isDraggingImg  = false;

// 圖片放置預覽模式
let placingImg     = null; // { src, w, h } 待放置的圖片
let placingEl      = null; // DOM 預覽元素
const remoteCursors = {};
let stickerData  = { x:200, y:200, w:150, h:150, dragging:false, resizing:false, dragOffX:0, dragOffY:0 };

// ── 初始化畫布 ────────────────────────────────────
roomCodeDisp.textContent = roomCode;
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;
cursorLayer.style.width  = CANVAS_W + 'px';
cursorLayer.style.height = CANVAS_H + 'px';
reactionLayer.style.width  = CANVAS_W + 'px';
reactionLayer.style.height = CANVAS_H + 'px';
danmakuLayer.style.width  = CANVAS_W + 'px';
danmakuLayer.style.height = CANVAS_H + 'px';

/** 套用縮放到 canvas（CSS transform，不影響實際解析度） */
function applyScale() {
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `scale(${canvasScale})`;
  cursorLayer.style.transform = `scale(${canvasScale})`;
  cursorLayer.style.transformOrigin = '0 0';
}

/** 螢幕座標 → 畫布實際座標（考慮縮放與捲動） */
function screenToCanvas(clientX, clientY) {
  return {
    x: (clientX + viewport.scrollLeft) / canvasScale,
    y: (clientY + viewport.scrollTop)  / canvasScale
  };
}

function fillWhite(x=0, y=0, w=CANVAS_W, h=CANVAS_H) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
}
fillWhite();

/** 畫到邊緣時擴展畫布（保留現有內容） */
function expandCanvasIfNeeded(x, y) {
  let expanded = false;
  let newW = CANVAS_W, newH = CANVAS_H;

  if (x > CANVAS_W - EXPAND_MARGIN) { newW = CANVAS_W + EXPAND_SIZE; expanded = true; }
  if (y > CANVAS_H - EXPAND_MARGIN) { newH = CANVAS_H + EXPAND_SIZE; expanded = true; }
  if (x < EXPAND_MARGIN && viewport.scrollLeft < EXPAND_MARGIN) {
    // 左側擴展（較少見，忽略以保持簡單）
  }

  if (!expanded) return;

  // 儲存現有內容
  const tmp = document.createElement('canvas');
  tmp.width = CANVAS_W; tmp.height = CANVAS_H;
  tmp.getContext('2d').drawImage(canvas, 0, 0);

  CANVAS_W = newW; CANVAS_H = newH;
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;
  cursorLayer.style.width    = CANVAS_W + 'px';
  cursorLayer.style.height   = CANVAS_H + 'px';
  reactionLayer.style.width  = CANVAS_W + 'px';
  reactionLayer.style.height = CANVAS_H + 'px';
  danmakuLayer.style.width   = CANVAS_W + 'px';
  danmakuLayer.style.height  = CANVAS_H + 'px';

  fillWhite();
  ctx.drawImage(tmp, 0, 0);
}

// 初始化縮放
applyScale();

// 捲動到畫布中央
viewport.scrollLeft = (CANVAS_W - window.innerWidth)  / 2;
viewport.scrollTop  = (CANVAS_H - window.innerHeight) / 2;

if (initSnapshot) {
  const img = new Image();
  img.src = initSnapshot;
  img.onload = () => { fillWhite(); ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H); };
}

if (inQueue) { queueScreen.classList.remove('hidden'); queuePosEl.textContent = initQueuePos; }

// ── 進入房間 ──────────────────────────────────────
socket.emit('joinRoom', { roomCode, nickname }, (res) => {
  if (!res.success) { alert(res.error); window.location.href='index.html'; return; }
  onlineCount.textContent = res.roomInfo.userCount;
  if (res.queued) {
    inQueue=true; queueScreen.classList.remove('hidden'); queuePosEl.textContent=res.queuePos;
  } else {
    inQueue=false; queueScreen.classList.add('hidden');
    if (res.canvasSnapshot) {
      const img=new Image(); img.src=res.canvasSnapshot;
      img.onload=()=>{ fillWhite(); ctx.drawImage(img,0,0,CANVAS_W,CANVAS_H); };
    }
  }
});
socket.on('queueAdmitted', (res) => {
  inQueue=false; queueScreen.classList.add('hidden');
  onlineCount.textContent=res.roomInfo.userCount;
  if (res.canvasSnapshot) {
    const img=new Image(); img.src=res.canvasSnapshot;
    img.onload=()=>{ fillWhite(); ctx.drawImage(img,0,0,CANVAS_W,CANVAS_H); };
  } else fillWhite();
  showNotif('🎉 輪到你了！');
});

// ══════════════════════════════════════════════════
// 繪圖（座標換算要加上捲動偏移）
// ══════════════════════════════════════════════════
function getPos(e) {
  const src = e.touches ? e.touches[0] : e;
  return screenToCanvas(src.clientX, src.clientY);
}

function applyBrush(c, x0, y0, x1, y1, color, size, brush, vx, vy) {
  const speed = Math.sqrt((vx||0)**2+(vy||0)**2);
  c.save();
  switch(brush) {
    case 'pen':
      c.globalAlpha=.85; c.strokeStyle=color; c.lineWidth=size;
      c.lineCap=c.lineJoin='round';
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
      if (Math.random()>.6) {
        c.globalAlpha=.15; c.fillStyle=color;
        for(let i=0;i<3;i++) c.fillRect(x1+(Math.random()-.5)*size*1.5,y1+(Math.random()-.5)*size*1.5,1,1);
      }
      break;
    case 'ink':
      c.globalAlpha=.92; c.strokeStyle=color; c.lineWidth=Math.max(1,size-speed*.3);
      c.lineCap=c.lineJoin='round';
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
      break;
    case 'pixel':
      c.imageSmoothingEnabled=false; c.globalAlpha=1; c.fillStyle=color;
      const steps=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/size));
      for(let i=0;i<=steps;i++){
        const t=i/steps;
        c.fillRect(Math.floor(x0+(x1-x0)*t)-Math.floor(size/2),Math.floor(y0+(y1-y0)*t)-Math.floor(size/2),size,size);
      }
      break;
    case 'crayon':
      c.globalAlpha=.55; c.strokeStyle=color; c.lineWidth=size*1.5;
      c.lineCap=c.lineJoin='round';
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
      c.globalAlpha=.25; c.lineWidth=size*.4;
      for(let i=0;i<3;i++){const ox=(Math.random()-.5)*size,oy=(Math.random()-.5)*size;c.beginPath();c.moveTo(x0+ox,y0+oy);c.lineTo(x1+ox,y1+oy);c.stroke();}
      break;
    case 'marker':
      c.globalAlpha=.35; c.strokeStyle=color; c.lineWidth=size*2.5;
      c.lineCap=c.lineJoin='square';
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
      break;
    case 'eraser':
      c.globalAlpha=1; c.strokeStyle='#ffffff'; c.lineWidth=size*3;
      c.lineCap=c.lineJoin='round';
      c.beginPath(); c.moveTo(x0,y0); c.lineTo(x1,y1); c.stroke();
      break;
  }
  c.restore();
  c.globalAlpha=1; c.imageSmoothingEnabled=true;
}

function onDrawStart(e) {
  if (inQueue || canvasMode !== 'draw') return;
  if (e.target !== canvas) return;
  isDrawing=true;
  const {x,y}=getPos(e);
  lastX=x; lastY=y;
}
function onDrawMove(e) {
  if (inQueue||!isDrawing||canvasMode !== 'draw') return;
  if (e.target !== canvas && !isDrawing) return;
  const {x,y}=getPos(e);
  const vx=x-lastX, vy=y-lastY;
  expandCanvasIfNeeded(x, y); // 靠近邊緣時自動擴展
  const data={x0:lastX,y0:lastY,x1:x,y1:y,color:currentColor,size:currentSize,brush:currentBrush,vx,vy};
  applyBrush(ctx,data.x0,data.y0,data.x1,data.y1,data.color,data.size,data.brush,data.vx,data.vy);
  socket.emit('draw',data);
  socket.emit('cursorMove',{x,y});
  lastX=x; lastY=y;
}
function onDrawEnd() {
  if (!isDrawing) return;
  isDrawing=false;
  socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
}

canvas.addEventListener('mousedown', (e) => {
  if (canvasMode === 'pan') {
    isPanning  = true;
    panStartX  = e.clientX; panStartY  = e.clientY;
    panScrollX = viewport.scrollLeft; panScrollY = viewport.scrollTop;
    canvas.style.cursor = 'grabbing';
    return;
  }
  // 圖片放置模式：點畫布確定位置
  if (placingImg) { commitPlacingImg(getPos(e)); return; }
  // 點到已放置圖片：開始拖曳
  const pos = getPos(e);
  const hit = hitTestImage(pos.x, pos.y);
  if (hit) { startImageDrag(hit, e.clientX, e.clientY); return; }
  onDrawStart(e);
});
canvas.addEventListener('mousemove', (e) => {
  if (canvasMode === 'pan' && isPanning) {
    viewport.scrollLeft = panScrollX - (e.clientX - panStartX);
    viewport.scrollTop  = panScrollY - (e.clientY - panStartY);
    return;
  }
  if (placingImg) { movePlacingPreview(e.clientX, e.clientY); return; }
  if (isDraggingImg) { moveImageDrag(e.clientX, e.clientY); return; }
  onDrawMove(e);
});
canvas.addEventListener('mouseup', (e) => {
  if (canvasMode === 'pan') { isPanning=false; canvas.style.cursor='grab'; return; }
  if (isDraggingImg) { endImageDrag(); return; }
  onDrawEnd();
});
canvas.addEventListener('mouseleave', (e) => {
  if (canvasMode === 'pan') { isPanning=false; return; }
  if (isDraggingImg) { endImageDrag(); return; }
  onDrawEnd();
});

// 桌機滾輪縮放
viewport.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return; // 只有 Ctrl+滾輪 才縮放
  e.preventDefault();
  const delta   = e.deltaY > 0 ? 0.9 : 1.1;
  const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, canvasScale * delta));
  const cx = (e.clientX + viewport.scrollLeft) / canvasScale;
  const cy = (e.clientY + viewport.scrollTop)  / canvasScale;
  canvasScale = newScale;
  applyScale();
  viewport.scrollLeft = cx * canvasScale - e.clientX;
  viewport.scrollTop  = cy * canvasScale - e.clientY;
}, {passive:false});
// 雙指距離計算
function getTouchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx*dx + dy*dy);
}
// 雙指中心點
function getTouchCenter(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
}

canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    // 雙指：縮放準備（任何模式都可以縮放）
    onDrawEnd();
    isPanning = false;
    pinchStartDist  = getTouchDist(e.touches[0], e.touches[1]);
    pinchStartScale = canvasScale;
    e.preventDefault();
    return;
  }
  if (canvasMode === 'pan') {
    isPanning = true;
    const t = e.touches[0];
    panStartX  = t.clientX; panStartY  = t.clientY;
    panScrollX = viewport.scrollLeft; panScrollY = viewport.scrollTop;
    e.preventDefault();
  } else {
    if (e.touches.length === 1) {
      // 圖片放置模式
      if (placingImg) { handlePlacingTap(e); return; }
      // 點到已放置圖片
      const pos = getPos(e);
      const hit = hitTestImage(pos.x, pos.y);
      if (hit) { startImageDrag(hit, e.touches[0].clientX, e.touches[0].clientY); return; }
      onDrawStart(e);
    }
  }
}, {passive:false});

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2) {
    // 雙指縮放
    const dist   = getTouchDist(e.touches[0], e.touches[1]);
    const center = getTouchCenter(e.touches[0], e.touches[1]);
    const ratio  = dist / pinchStartDist;
    const newScale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, pinchStartScale * ratio));

    // 以雙指中心為縮放基準點
    const cx = (center.x + viewport.scrollLeft) / canvasScale;
    const cy = (center.y + viewport.scrollTop)  / canvasScale;
    canvasScale = newScale;
    applyScale();
    viewport.scrollLeft = cx * canvasScale - center.x;
    viewport.scrollTop  = cy * canvasScale - center.y;
    e.preventDefault();
    return;
  }
  if (canvasMode === 'pan' && isPanning) {
    const t = e.touches[0];
    viewport.scrollLeft = panScrollX - (t.clientX - panStartX);
    viewport.scrollTop  = panScrollY - (t.clientY - panStartY);
    e.preventDefault();
  } else if (canvasMode === 'draw') {
    if (e.touches.length === 1) {
      if (isDraggingImg) { moveImageDrag(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); return; }
      if (placingImg) { movePlacingPreview(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); return; }
      onDrawMove(e);
    }
    e.preventDefault();
  }
}, {passive:false});

canvas.addEventListener('touchend', (e) => {
  if (canvasMode === 'pan') { isPanning = false; return; }
  if (isDraggingImg && e.touches.length === 0) { endImageDrag(); return; }
  if (e.touches.length === 0) onDrawEnd();
});

// ── 貼上圖片 Ctrl+V ──────────────────────────────
document.addEventListener('paste', (e)=>{
  if (inQueue) return;
  const items=e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const blob=item.getAsFile(); const url=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{
        const maxW=CANVAS_W*.4,maxH=CANVAS_H*.4;
        let w=img.width,h=img.height;
        if(w>maxW){h=h*maxW/w;w=maxW;} if(h>maxH){w=w*maxH/h;h=maxH;}
        const x=(CANVAS_W-w)/2,y=(CANVAS_H-h)/2;
        ctx.drawImage(img,x,y,w,h); URL.revokeObjectURL(url);
        const tmp=document.createElement('canvas'); tmp.width=CANVAS_W; tmp.height=CANVAS_H;
        tmp.getContext('2d').drawImage(img,x,y,w,h);
        socket.emit('pasteImage',{dataURL:tmp.toDataURL('image/png')});
        socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
      };
      img.src=url; break;
    }
  }
});

// ── 手機貼上按鈕 ──────────────────────────────────
// FAB 插入圖片按鈕
fabUploadImg.addEventListener('click', ()=>{
  if (inQueue) return;
  closeFab();
  openFilePicker();
});

function openFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) { document.body.removeChild(input); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      enterPlacingMode(url, img.naturalWidth, img.naturalHeight);
      document.body.removeChild(input);
    };
    img.src = url;
  });
  input.click();
}

// 長按摳圖貼上（iOS Ctrl+V / 系統貼上選單）
// iOS Safari 在用戶主動觸發時（長按後點「貼上」）會觸發 paste 事件
document.addEventListener('paste', (e) => {
  if (inQueue) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => enterPlacingMode(url, img.naturalWidth, img.naturalHeight);
      img.src = url;
      return;
    }
  }
});

function pasteImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const cx = viewport.scrollLeft + window.innerWidth/2;
    const cy = viewport.scrollTop  + window.innerHeight/2;
    const maxW = window.innerWidth*.6, maxH = window.innerHeight*.6;
    let w=img.width, h=img.height;
    if(w>maxW){h=h*maxW/w;w=maxW;} if(h>maxH){w=w*maxH/h;h=maxH;}
    const x=cx-w/2, y=cy-h/2;
    ctx.drawImage(img,x,y,w,h);
    URL.revokeObjectURL(url);
    const tmp=document.createElement('canvas'); tmp.width=CANVAS_W; tmp.height=CANVAS_H;
    tmp.getContext('2d').drawImage(img,x,y,w,h);
    socket.emit('pasteImage',{dataURL:tmp.toDataURL('image/png')});
    socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
    showNotif('✅ 圖片已貼上');
  };
  img.onerror = () => showNotif('無法讀取圖片');
  img.src = url;
}

// ══════════════════════════════════════════════════
// Socket 接收
// ══════════════════════════════════════════════════
socket.on('draw',(data)=>applyBrush(ctx,data.x0,data.y0,data.x1,data.y1,data.color,data.size,data.brush,data.vx||0,data.vy||0));

// 接收其他人的圖片物件同步
socket.on('syncImageObjects', ({ objects }) => {
  // 清空舊的，重建
  imageObjects = [];
  objects.forEach(o => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = o.src;
    img.onload = () => {
      imageObjects.push({ ...o, img });
      ctx.drawImage(img, o.x, o.y, o.w, o.h);
    };
  });
});
socket.on('pasteImage',({dataURL})=>{ const img=new Image(); img.onload=()=>ctx.drawImage(img,0,0); img.src=dataURL; });
socket.on('placeSticker',({dataURL,x,y,w,h})=>{ const img=new Image(); img.onload=()=>ctx.drawImage(img,x,y,w,h); img.src=dataURL; });
socket.on('clearCanvas',()=>{ fillWhite(); voteToast.classList.add('hidden'); showNotif('🗑️ 畫布已清除'); });
socket.on('clearVoteUpdate',({current,needed})=>{
  voteCountEl.textContent=current; voteNeededEl.textContent=needed;
  voteToast.classList.remove('hidden');
  clearTimeout(window._vt); window._vt=setTimeout(()=>voteToast.classList.add('hidden'),6000);
});
socket.on('userJoined',({nickname:n,roomInfo})=>{ onlineCount.textContent=roomInfo.userCount; appendSystemMsg(`🎨 ${n} 加入了`); showNotif(`🎨 ${n} 加入了`); });
socket.on('userLeft',({nickname:n,roomInfo})=>{ onlineCount.textContent=roomInfo.userCount; appendSystemMsg(`👋 ${n} 離開了`); showNotif(`👋 ${n} 離開了`); });
socket.on('cursorMove',({socketId,x,y,name})=>{
  if (!remoteCursors[socketId]) {
    const el=document.createElement('div'); el.className='remote-cursor'; el.textContent=name;
    cursorLayer.appendChild(el); remoteCursors[socketId]=el;
  }
  remoteCursors[socketId].style.left=x+'px'; remoteCursors[socketId].style.top=y+'px';
});
socket.on('chatMessage',({nickname:n,message,time})=>appendChatMsg(n,message,time));
socket.on('reaction',({nickname:n,emoji})=>{
  spawnReactionFloat(emoji);          // 所有裝置都顯示飄動表情
  spawnDanmaku(`${n} ${emoji}`);      // 所有裝置都顯示彈幕
  appendSystemMsg(`${n} ${emoji}`);
});

// ══════════════════════════════════════════════════
// FAB
// ══════════════════════════════════════════════════
fabMain.addEventListener('click',()=>{
  fabOpen=!fabOpen;
  fabMenu.classList.toggle('hidden',!fabOpen);
  fabMain.textContent = fabOpen ? '✕' : '✏️';
});
function closeFab(){ fabOpen=false; fabMenu.classList.add('hidden'); fabMain.textContent='✏️'; }

// 模式切換
fabModeToggle.addEventListener('click', () => {
  canvasMode = canvasMode === 'draw' ? 'pan' : 'draw';
  const isPan = canvasMode === 'pan';

  // 更新按鈕顯示
  fabModeIcon.textContent  = isPan ? '✏️' : '✋';
  fabModeLabel.textContent = isPan ? '切換：繪圖模式' : '切換：移動模式';
  fabModeToggle.style.borderColor = isPan ? '#4ECDC4' : 'rgba(255,221,61,.3)';
  fabModeToggle.style.color       = isPan ? '#4ECDC4' : '';

  // 更新主按鈕 icon 和游標
  fabMain.textContent = isPan ? '✋' : '✏️';
  viewport.style.cursor = isPan ? 'grab' : 'crosshair';
  canvas.style.cursor   = isPan ? 'grab' : 'crosshair';

  showNotif(isPan ? '✋ 移動模式：拖動畫布' : '✏️ 繪圖模式');
  closeFab();
});

fabChat.addEventListener('click',()=>{ togglePanel(chatPanel); closeFab(); });
fabReaction.addEventListener('click',()=>{ togglePanel(reactionPanel); closeFab(); });
fabClear.addEventListener('click',()=>{ if(inQueue)return; socket.emit('requestClear'); showNotif('🗳️ 已投票清除'); closeFab(); });

function togglePanel(panel) {
  const isHidden = panel.classList.contains('hidden');
  [chatPanel,reactionPanel].forEach(p=>p.classList.add('hidden'));
  if (isHidden) panel.classList.remove('hidden');
}
chatClose.addEventListener('click',()=>chatPanel.classList.add('hidden'));
reactionPanelClose.addEventListener('click',()=>reactionPanel.classList.add('hidden'));

// ══════════════════════════════════════════════════
// Drawer 抽屜
// ══════════════════════════════════════════════════
drawerHandle.addEventListener('click',()=>drawer.classList.toggle('open'));

// ══════════════════════════════════════════════════
// 工具
// ══════════════════════════════════════════════════
colorPicker.addEventListener('input',e=>{ currentColor=e.target.value; });
swatches.forEach(sw=>{
  sw.addEventListener('click',()=>{
    currentColor=sw.dataset.color; colorPicker.value=currentColor;
    swatches.forEach(s=>s.classList.remove('active')); sw.classList.add('active');
    if (currentBrush==='eraser') { currentBrush='pen'; updateBrushUI('pen'); }
  });
});
sizeBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    currentSize=parseInt(btn.dataset.size);
    sizeBtns.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
  });
});
brushBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    currentBrush=btn.dataset.brush; updateBrushUI(currentBrush);
  });
});
function updateBrushUI(brush){
  brushBtns.forEach(b=>b.classList.toggle('active',b.dataset.brush===brush));
  viewport.classList.toggle('eraser-mode',brush==='eraser');
}

leaveBtn.addEventListener('click',()=>{
  if(confirm('確定要離開房間嗎？')){ socket.disconnect(); sessionStorage.clear(); window.location.href='index.html'; }
});
copyCodeBtn.addEventListener('click',()=>{ navigator.clipboard.writeText(roomCode).then(()=>showNotif('✅ 代碼已複製')); });

// ══════════════════════════════════════════════════
// 聊天
// ══════════════════════════════════════════════════
function sendChat(inputEl){
  const msg=inputEl.value.trim(); if(!msg||inQueue)return;
  socket.emit('chatMessage',{message:msg}); inputEl.value='';
}
chatSendBtn.addEventListener('click',()=>sendChat(chatInput));
chatInput.addEventListener('keydown',e=>{ if(e.key==='Enter')sendChat(chatInput); });

// ══════════════════════════════════════════════════
// 表情
// ══════════════════════════════════════════════════
reactionBigBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{ if(inQueue)return; socket.emit('reaction',{emoji:btn.dataset.emoji}); });
});

// ══════════════════════════════════════════════════
// 工具函式
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// 圖片物件系統
// ══════════════════════════════════════════════════

/** 碰撞測試：點 (x,y) 是否在某個圖片物件上 */
function hitTestImage(x, y) {
  // 從最後一個（最上層）往前找
  for (let i = imageObjects.length - 1; i >= 0; i--) {
    const obj = imageObjects[i];
    if (x >= obj.x && x <= obj.x + obj.w &&
        y >= obj.y && y <= obj.y + obj.h) {
      return obj;
    }
  }
  return null;
}

/** 開始拖曳已放置圖片 */
function startImageDrag(obj, clientX, clientY) {
  selectedImgId = obj.id;
  isDraggingImg = true;
  const pos = screenToCanvas(clientX, clientY);
  imgDragOffX = pos.x - obj.x;
  imgDragOffY = pos.y - obj.y;
  viewport.style.cursor = 'move';
}

/** 拖曳中移動圖片 */
function moveImageDrag(clientX, clientY) {
  if (!isDraggingImg || !selectedImgId) return;
  const obj = imageObjects.find(o => o.id === selectedImgId);
  if (!obj) return;
  const pos = screenToCanvas(clientX, clientY);
  obj.x = pos.x - imgDragOffX;
  obj.y = pos.y - imgDragOffY;
  redrawAllImages();
}

/** 放開圖片 */
function endImageDrag() {
  if (!isDraggingImg) return;
  isDraggingImg = false;
  viewport.style.cursor = canvasMode === 'pan' ? 'grab' : 'crosshair';
  // 廣播最新位置
  const obj = imageObjects.find(o => o.id === selectedImgId);
  if (obj) {
    broadcastImageObjects();
    socket.emit('saveSnapshot', { snapshot: canvas.toDataURL('image/jpeg', .6) });
  }
  selectedImgId = null;
}

/** 重繪所有圖片（先清空再重畫） */
function redrawAllImages() {
  // 重繪：先把畫布內容存起來，清空，重畫筆跡快照，再畫所有圖片
  // 簡化做法：直接在目前畫布上重畫圖片（畫在最上層）
  // 實際場景：圖片會覆蓋在最新的畫布狀態上
  imageObjects.forEach(obj => {
    ctx.drawImage(obj.img, obj.x, obj.y, obj.w, obj.h);
  });
}

/** 廣播所有圖片物件位置給其他人 */
function broadcastImageObjects() {
  const data = imageObjects.map(o => ({
    id: o.id, src: o.src, x: o.x, y: o.y, w: o.w, h: o.h
  }));
  socket.emit('syncImageObjects', { objects: data });
}

// ── 圖片放置預覽模式 ──────────────────────────────

/** 進入放置預覽模式：圖片跟著游標走 */
function enterPlacingMode(src, naturalW, naturalH) {
  // 預設大小：畫面寬度的 30%，保持比例
  const maxW = window.innerWidth * 0.3 / canvasScale;
  const ratio = naturalH / naturalW;
  const w = Math.min(maxW, naturalW);
  const h = w * ratio;

  placingImg = { src, w, h };

  // 建立跟隨游標的預覽 DOM
  placingEl = document.createElement('div');
  placingEl.style.cssText = `
    position:fixed; pointer-events:none; z-index:500;
    border: 2px dashed #FFD93D; opacity:0.8;
    width:${w * canvasScale}px; height:${h * canvasScale}px;
    transform:translate(-50%,-50%);
  `;
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
  placingEl.appendChild(img);
  document.body.appendChild(placingEl);

  showNotif('📍 點畫布任意位置放置圖片');
  viewport.style.cursor = 'copy';
}

/** 移動放置預覽 */
function movePlacingPreview(clientX, clientY) {
  if (!placingEl) return;
  placingEl.style.left = clientX + 'px';
  placingEl.style.top  = clientY + 'px';
}

/** 手機點擊放置 */
function handlePlacingTap(e) {
  const t = e.touches[0];
  const pos = screenToCanvas(t.clientX, t.clientY);
  commitPlacingImg(pos);
}

/** 確認放置圖片到畫布上 */
function commitPlacingImg(pos) {
  if (!placingImg) return;

  // 移除預覽
  if (placingEl) { placingEl.remove(); placingEl = null; }

  const { src, w, h } = placingImg;
  placingImg = null;
  viewport.style.cursor = 'crosshair';

  // 建立圖片物件
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  img.onload = () => {
    const x = pos.x - w / 2;
    const y = pos.y - h / 2;
    const obj = { id: Date.now() + Math.random(), src, x, y, w, h, img };
    imageObjects.push(obj);
    ctx.drawImage(img, x, y, w, h);
    broadcastImageObjects();
    socket.emit('saveSnapshot', { snapshot: canvas.toDataURL('image/jpeg', .6) });
    showNotif('✅ 圖片已放置，可拖曳移動');
  };
}

/** 取消放置 */
function cancelPlacingImg() {
  if (placingEl) { placingEl.remove(); placingEl = null; }
  placingImg = null;
  viewport.style.cursor = 'crosshair';
}

// ESC 取消放置
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelPlacingImg();
});

function appendChatMsg(name,message,time){
  const html=`<div class="chat-msg"><div><span class="chat-msg-name" style="color:${nameToColor(name)}">${escapeHtml(name)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${escapeHtml(message)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function appendSystemMsg(text){
  const html=`<div class="chat-msg system"><div class="chat-msg-text">${escapeHtml(text)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function spawnReactionFloat(emoji){
  // 用 fixed 定位浮在螢幕上，不受畫布捲動影響
  const el = document.createElement('div');
  el.className = 'reaction-float-fixed';
  el.textContent = emoji;
  el.style.left  = (10 + Math.random() * 75) + 'vw';
  el.style.bottom = (60 + Math.random() * 20) + 'px'; // 從底部往上飄
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function spawnDanmaku(text){
  // 彈幕也用 fixed 定位，從右側飛入
  const el = document.createElement('div');
  el.className = 'danmaku-fixed';
  el.textContent = text;
  el.style.top  = (10 + Math.random() * 60) + 'vh';
  el.style.right = '-300px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6200);
}
// ── 手機鍵盤彈出時動態調整聊天面板位置 ──────────
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const keyboardH = window.innerHeight - window.visualViewport.height;
    const panels = document.querySelectorAll('.float-panel');
    panels.forEach(p => {
      if (keyboardH > 100) {
        // 鍵盤彈出：面板往上移
        p.style.bottom = (keyboardH + 8) + 'px';
      } else {
        // 鍵盤收起：恢復原位
        p.style.bottom = '';
      }
    });
  });
}

let _nt;
function showNotif(msg){
  notifToast.textContent=msg; notifToast.classList.remove('hidden');
  clearTimeout(_nt); _nt=setTimeout(()=>notifToast.classList.add('hidden'),3000);
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function nameToColor(name){
  const c=['#4ECDC4','#FF6B6B','#FFD93D','#C77DFF','#45B7D1','#F7B731','#26de81','#fd9644'];
  let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h);
  return c[Math.abs(h)%c.length];
}
