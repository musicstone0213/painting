// ================================================
// room.js v6 — 左側工具列 + 三FAB + 移動預設模式
// ================================================
const roomCode     = sessionStorage.getItem('roomCode');
const nickname     = sessionStorage.getItem('nickname');
const initQueued   = sessionStorage.getItem('queued') === '1';
const initQueuePos = parseInt(sessionStorage.getItem('queuePos') || '0');
const initSnapshot = sessionStorage.getItem('canvasSnapshot');
if (!roomCode) { window.location.href = 'index.html'; }
// 暱稱允許隨機生成（lobby 已處理），保底用匿名
const displayNickname = nickname || '匿名畫家';
sessionStorage.removeItem('canvasSnapshot');
sessionStorage.removeItem('queued');
sessionStorage.removeItem('queuePos');

// ── Socket ────────────────────────────────────────
const socket = io({
  reconnection:true, reconnectionDelay:1000,
  reconnectionAttempts:20, timeout:20000
});

// ── DOM ──────────────────────────────────────────
const viewport          = document.getElementById('canvasViewport');
const canvas            = document.getElementById('mainCanvas');
const ctx               = canvas.getContext('2d');
const cursorLayer       = document.getElementById('cursorLayer');
const reactionLayer     = document.getElementById('reactionLayer');
const danmakuLayer      = document.getElementById('danmakuLayer');
const roomCodeDisp      = document.getElementById('roomCodeDisplay');
const onlineCount       = document.getElementById('onlineCount');
const leaveBtn          = document.getElementById('leaveBtn');
const copyCodeBtn       = document.getElementById('copyCodeBtn');
const musicBtn          = document.getElementById('musicBtn');
const colorPicker       = document.getElementById('colorPicker');
const colorPickerBtn    = document.getElementById('colorPickerBtn');
const colorPickerPreview= document.getElementById('colorPickerPreview');
const swatches          = document.querySelectorAll('.swatch');
const brushBtns         = document.querySelectorAll('.brush-btn');
const sizeBtns          = document.querySelectorAll('.size-btn');
const notifToast        = document.getElementById('notifToast');
const queueScreen       = document.getElementById('queueScreen');
const queuePosEl        = document.getElementById('queuePos');

// 左側工具列
const sideToolbar       = document.getElementById('sideToolbar');
const sideCloseBtn      = document.getElementById('sideCloseBtn');

// 三個 FAB
const fabTools          = document.getElementById('fabTools');
const fabMode           = document.getElementById('fabMode');
const fabMain           = document.getElementById('fabMain');
const fabMenu           = document.getElementById('fabMenu');
const fabChat           = document.getElementById('fabChat');
const fabReaction       = document.getElementById('fabReaction');
const fabUploadImg      = document.getElementById('fabUploadImg');

// 浮動面板
const chatPanel         = document.getElementById('chatPanel');
const chatMessages      = document.getElementById('chatMessages');
const chatInput         = document.getElementById('chatInput');
const chatSendBtn       = document.getElementById('chatSendBtn');
const chatClose         = document.getElementById('chatClose');
const reactionPanel     = document.getElementById('reactionPanel');
const reactionPanelClose= document.getElementById('reactionPanelClose');
const reactionBigBtns   = document.querySelectorAll('.reaction-big-btn');

// 貼圖
const stickerPreview    = document.getElementById('stickerPreview');
const stickerPreviewImg = document.getElementById('stickerPreviewImg');
const stickerConfirmBtn = document.getElementById('stickerConfirmBtn');
const stickerCancelBtn  = document.getElementById('stickerCancelBtn');
const stickerHandle     = document.getElementById('stickerHandle');

// ── 狀態 ─────────────────────────────────────────
const CANVAS_W = 4000, CANVAS_H = 4000;
const EXPAND_MARGIN = 400, EXPAND_SIZE = 800;
let CANVAS_W_cur = CANVAS_W, CANVAS_H_cur = CANVAS_H;

let currentColor  = '#1A1A2E';
let currentSize   = 4;
let currentBrush  = 'pen';
let isDrawing     = false;
let lastX=0, lastY=0;
let inQueue       = initQueued;
let fabOpen       = false;
let canvasMode    = 'pan'; // 預設移動模式
let isPanning     = false;
let panStartX=0, panStartY=0, panScrollX=0, panScrollY=0;
let canvasScale   = 1;
const SCALE_MIN=0.2, SCALE_MAX=5;
let pinchStartDist=0, pinchStartScale=1;
let placingImg=null, placingEl=null;
const remoteCursors = {};

// offscreen canvas（純筆跡）
const offscreenCanvas = document.createElement('canvas');
let offscreenCtx = offscreenCanvas.getContext('2d');

// 模式按鈕隱藏計時器
let modeHideTimer = null;

// ── 初始化 ────────────────────────────────────────
roomCodeDisp.textContent = roomCode;

function applyScale() {
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `scale(${canvasScale})`;
  cursorLayer.style.transform = `scale(${canvasScale})`;
  cursorLayer.style.transformOrigin = '0 0';
}
function screenToCanvas(clientX, clientY) {
  return {
    x: (clientX + viewport.scrollLeft) / canvasScale,
    y: (clientY + viewport.scrollTop)  / canvasScale
  };
}
function fillWhite(x=0,y=0,w=CANVAS_W_cur,h=CANVAS_H_cur) {
  ctx.fillStyle='#ffffff'; ctx.fillRect(x,y,w,h);
  offscreenCtx.fillStyle='#ffffff'; offscreenCtx.fillRect(x,y,w,h);
}

canvas.width = CANVAS_W; canvas.height = CANVAS_H;
offscreenCanvas.width = CANVAS_W; offscreenCanvas.height = CANVAS_H;
cursorLayer.style.width = CANVAS_W+'px'; cursorLayer.style.height = CANVAS_H+'px';
reactionLayer.style.width = CANVAS_W+'px'; reactionLayer.style.height = CANVAS_H+'px';
danmakuLayer.style.width = CANVAS_W+'px'; danmakuLayer.style.height = CANVAS_H+'px';

applyScale();
fillWhite();
viewport.scrollLeft = (CANVAS_W - window.innerWidth)  / 2;
viewport.scrollTop  = (CANVAS_H - window.innerHeight) / 2;

if (initSnapshot) {
  const img=new Image(); img.src=initSnapshot;
  img.onload=()=>{ fillWhite(); ctx.drawImage(img,0,0,CANVAS_W,CANVAS_H); offscreenCtx.drawImage(img,0,0,CANVAS_W,CANVAS_H); };
}
if (inQueue) { queueScreen.classList.remove('hidden'); queuePosEl.textContent=initQueuePos; }

// 預設移動模式 UI
updateModeUI();

// ── 音樂 ──────────────────────────────────────────
if (musicBtn) {
  musicBtn.addEventListener('click', ()=>{
    SFX.click();
    const on = Music.toggle();
    musicBtn.textContent = on ? '♪' : '♩';
    musicBtn.style.opacity = on ? '1' : '0.4';
  });
}

// ── 連線 ──────────────────────────────────────────
function setConnectionStatus(s) {
  const dot = document.querySelector('.hud-dot');
  if (!dot) return;
  dot.style.background = s==='connected'?'#4cff91':s==='disconnected'?'#FF6B6B':'#FFD93D';
}
setInterval(()=>{ if(socket.connected) socket.emit('ping'); }, 20000);
socket.on('connect', ()=>setConnectionStatus('connected'));
socket.on('disconnect', r=>{ setConnectionStatus('disconnected'); showNotif('⚠️ 已斷線：'+r); });
socket.on('reconnecting', ()=>{ setConnectionStatus('reconnecting'); showNotif('🔄 重新連線中…'); });
socket.on('reconnect_failed', ()=>{ setConnectionStatus('disconnected'); showNotif('❌ 無法連線，請重新整理'); });
socket.on('reconnect', ()=>{
  setConnectionStatus('connected');
  socket.emit('joinRoom',{roomCode,nickname:displayNickname},(res)=>{
    if(!res.success) return;
    onlineCount.textContent=res.roomInfo.userCount;
    showNotif('✅ 已重新連線');
    if(res.canvasSnapshot){
      const img=new Image(); img.src=res.canvasSnapshot;
      img.onload=()=>{ fillWhite(); ctx.drawImage(img,0,0,CANVAS_W,CANVAS_H); offscreenCtx.drawImage(img,0,0,CANVAS_W,CANVAS_H); };
    }
  });
});

socket.emit('joinRoom',{roomCode,nickname:displayNickname},(res)=>{
  if(!res.success){alert(res.error);window.location.href='index.html';return;}
  onlineCount.textContent=res.roomInfo.userCount;
  // GA4：記錄進入房間
  if(typeof gtag!=='undefined') {
    gtag('event','join_room',{room_code:roomCode,user_count:res.roomInfo.userCount});
  }
  window._roomEnterTime = Date.now(); // 記錄進入時間
  if(res.queued){inQueue=true;queueScreen.classList.remove('hidden');queuePosEl.textContent=res.queuePos;}
  else{
    inQueue=false;queueScreen.classList.add('hidden');
    if(res.canvasSnapshot){
      const img=new Image(); img.src=res.canvasSnapshot;
      img.onload=()=>{ fillWhite(); ctx.drawImage(img,0,0,CANVAS_W,CANVAS_H); offscreenCtx.drawImage(img,0,0,CANVAS_W,CANVAS_H); };
    }
  }
});
socket.on('queueAdmitted',(res)=>{
  inQueue=false;queueScreen.classList.add('hidden');
  onlineCount.textContent=res.roomInfo.userCount;
  if(res.canvasSnapshot){const img=new Image();img.src=res.canvasSnapshot;img.onload=()=>{fillWhite();ctx.drawImage(img,0,0,CANVAS_W,CANVAS_H);offscreenCtx.drawImage(img,0,0,CANVAS_W,CANVAS_H);};}
  else fillWhite();
  showNotif('🎉 輪到你了！');
});

// ══════════════════════════════════════════════════
// 模式管理
// ══════════════════════════════════════════════════
function updateModeUI() {
  if (canvasMode==='pan') {
    fabMode.textContent='✋ 移動';
    fabMode.className='fab-mode pan';
    viewport.classList.add('pan-mode');
    viewport.classList.remove('eraser-mode');
    fabTools.classList.remove('active');
  } else {
    const isPen = currentBrush!=='eraser';
    fabMode.textContent = isPen ? '✏️ 繪圖' : '🔲 橡皮擦';
    fabMode.className='fab-mode draw';
    viewport.classList.remove('pan-mode','eraser-mode');
    if (currentBrush==='eraser') viewport.classList.add('eraser-mode');
    fabTools.classList.add('active');
  }
}

function showModeBtn() {
  clearTimeout(modeHideTimer);
  fabMode.classList.remove('hidden-draw');
}
function scheduleModeHide() {
  clearTimeout(modeHideTimer);
  if (canvasMode==='draw') {
    modeHideTimer = setTimeout(()=>fabMode.classList.add('hidden-draw'), 500);
  }
}

// ══════════════════════════════════════════════════
// 畫筆
// ══════════════════════════════════════════════════
function getPos(e) {
  const src=e.touches?e.touches[0]:e;
  return screenToCanvas(src.clientX,src.clientY);
}

function applyBrush(c,x0,y0,x1,y1,color,size,brush,vx,vy) {
  const speed=Math.sqrt((vx||0)**2+(vy||0)**2);
  c.save();
  switch(brush){
    case 'pen':
      c.globalAlpha=.85;c.strokeStyle=color;c.lineWidth=size;c.lineCap=c.lineJoin='round';
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();
      if(Math.random()>.6){c.globalAlpha=.15;c.fillStyle=color;for(let i=0;i<3;i++)c.fillRect(x1+(Math.random()-.5)*size*1.5,y1+(Math.random()-.5)*size*1.5,1,1);}
      break;
    case 'ink':
      c.globalAlpha=.92;c.strokeStyle=color;c.lineWidth=Math.max(1,size-speed*.3);c.lineCap=c.lineJoin='round';
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();break;
    case 'pixel':
      c.imageSmoothingEnabled=false;c.globalAlpha=1;c.fillStyle=color;
      const steps=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/size));
      for(let i=0;i<=steps;i++){const t=i/steps;c.fillRect(Math.floor(x0+(x1-x0)*t)-Math.floor(size/2),Math.floor(y0+(y1-y0)*t)-Math.floor(size/2),size,size);}break;
    case 'crayon':
      c.globalAlpha=.55;c.strokeStyle=color;c.lineWidth=size*1.5;c.lineCap=c.lineJoin='round';
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();
      c.globalAlpha=.25;c.lineWidth=size*.4;
      for(let i=0;i<3;i++){const ox=(Math.random()-.5)*size,oy=(Math.random()-.5)*size;c.beginPath();c.moveTo(x0+ox,y0+oy);c.lineTo(x1+ox,y1+oy);c.stroke();}break;
    case 'marker':
      c.globalAlpha=.35;c.strokeStyle=color;c.lineWidth=size*2.5;c.lineCap=c.lineJoin='square';
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();break;
    case 'mosaic': {
      // 馬賽克：沿路徑取樣畫布像素，放大成色塊貼回去
      const blockSize = Math.max(8, size * 3);
      const steps = Math.max(1, Math.ceil(Math.hypot(x1-x0, y1-y0) / blockSize));
      for (let i = 0; i <= steps; i++) {
        const t  = i / steps;
        const px = Math.floor(x0 + (x1 - x0) * t);
        const py = Math.floor(y0 + (y1 - y0) * t);
        const bx = Math.floor(px / blockSize) * blockSize;
        const by = Math.floor(py / blockSize) * blockSize;
        // 取樣中心像素顏色
        try {
          const sample = c.getImageData(bx + blockSize/2, by + blockSize/2, 1, 1).data;
          c.fillStyle = `rgba(${sample[0]},${sample[1]},${sample[2]},${sample[3]/255})`;
        } catch(e) {
          c.fillStyle = '#cccccc';
        }
        c.globalAlpha = 1;
        c.fillRect(bx, by, blockSize, blockSize);
      }
      break;
    }
    case 'eraser':
      c.globalAlpha=1;c.strokeStyle='#ffffff';c.lineWidth=size*3;c.lineCap=c.lineJoin='round';
      c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();break;
  }
  c.restore();c.globalAlpha=1;c.imageSmoothingEnabled=true;
}

function onDrawStart(e) {
  if(inQueue||canvasMode!=='draw') return;
  if(e.target!==canvas) return;
  isDrawing=true;
  showModeBtn();
  const {x,y}=getPos(e); lastX=x; lastY=y;
}
function onDrawMove(e) {
  if(inQueue||!isDrawing||canvasMode!=='draw') return;
  const {x,y}=getPos(e);
  const vx=x-lastX,vy=y-lastY;
  scheduleModeHide(); // 繪圖中隱藏模式按鈕
  applyBrush(ctx,lastX,lastY,x,y,currentColor,currentSize,currentBrush,vx,vy);
  applyBrush(offscreenCtx,lastX,lastY,x,y,currentColor,currentSize,currentBrush,vx,vy);
  socket.emit('draw',{x0:lastX,y0:lastY,x1:x,y1:y,color:currentColor,size:currentSize,brush:currentBrush,vx,vy});
  socket.emit('cursorMove',{x,y});
  lastX=x; lastY=y;
}
function onDrawEnd() {
  if(!isDrawing) return;
  isDrawing=false;
  showModeBtn();
  socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
}

function getTouchDist(t1,t2){return Math.sqrt((t1.clientX-t2.clientX)**2+(t1.clientY-t2.clientY)**2);}
function getTouchCenter(t1,t2){return{x:(t1.clientX+t2.clientX)/2,y:(t1.clientY+t2.clientY)/2};}

canvas.addEventListener('mousedown',(e)=>{
  if(canvasMode==='pan'){isPanning=true;panStartX=e.clientX;panStartY=e.clientY;panScrollX=viewport.scrollLeft;panScrollY=viewport.scrollTop;canvas.style.cursor='grabbing';return;}
  if(placingImg){commitPlacingImg(getPos(e));return;}
  onDrawStart(e);
});
canvas.addEventListener('mousemove',(e)=>{
  if(canvasMode==='pan'&&isPanning){viewport.scrollLeft=panScrollX-(e.clientX-panStartX);viewport.scrollTop=panScrollY-(e.clientY-panStartY);return;}
  if(placingImg){movePlacingPreview(e.clientX,e.clientY);return;}
  onDrawMove(e);
});
canvas.addEventListener('mouseup',(e)=>{
  if(canvasMode==='pan'){isPanning=false;canvas.style.cursor='grab';return;}
  onDrawEnd();
});
canvas.addEventListener('mouseleave',(e)=>{
  if(canvasMode==='pan'){isPanning=false;return;}
  onDrawEnd();
});
viewport.addEventListener('wheel',(e)=>{
  if(!e.ctrlKey&&!e.metaKey) return;
  e.preventDefault();
  const delta=e.deltaY>0?.9:1.1;
  const newScale=Math.min(SCALE_MAX,Math.max(SCALE_MIN,canvasScale*delta));
  if(newScale===canvasScale) return;
  const cx=(e.clientX+viewport.scrollLeft)/canvasScale;
  const cy=(e.clientY+viewport.scrollTop)/canvasScale;
  canvasScale=newScale; applyScale();
  viewport.scrollLeft=cx*canvasScale-e.clientX;
  viewport.scrollTop=cy*canvasScale-e.clientY;
},{passive:false});

canvas.addEventListener('touchstart',(e)=>{
  if(e.touches.length===2){
    onDrawEnd(); isPanning=false;
    pinchStartDist=getTouchDist(e.touches[0],e.touches[1]);
    pinchStartScale=canvasScale; e.preventDefault(); return;
  }
  if(canvasMode==='pan'){
    isPanning=true;const t=e.touches[0];
    panStartX=t.clientX;panStartY=t.clientY;panScrollX=viewport.scrollLeft;panScrollY=viewport.scrollTop;
    e.preventDefault(); return;
  }
  if(placingImg){movePlacingPreview(e.touches[0].clientX,e.touches[0].clientY);e.preventDefault();return;}
  onDrawStart(e);
},{passive:false});

canvas.addEventListener('touchmove',(e)=>{
  if(e.touches.length===2){
    const dist=getTouchDist(e.touches[0],e.touches[1]);
    const center=getTouchCenter(e.touches[0],e.touches[1]);
    const newScale=Math.min(SCALE_MAX,Math.max(SCALE_MIN,pinchStartScale*(dist/pinchStartDist)));
    if(Math.abs(newScale-canvasScale)<canvasScale*.01){e.preventDefault();return;}
    const cx=(center.x+viewport.scrollLeft)/canvasScale;
    const cy=(center.y+viewport.scrollTop)/canvasScale;
    canvasScale=newScale; applyScale();
    viewport.scrollLeft=cx*canvasScale-center.x;
    viewport.scrollTop=cy*canvasScale-center.y;
    e.preventDefault(); return;
  }
  if(canvasMode==='pan'&&isPanning){
    const t=e.touches[0];
    viewport.scrollLeft=panScrollX-(t.clientX-panStartX);
    viewport.scrollTop=panScrollY-(t.clientY-panStartY);
    e.preventDefault(); return;
  }
  if(placingImg){movePlacingPreview(e.touches[0].clientX,e.touches[0].clientY);e.preventDefault();return;}
  onDrawMove(e); e.preventDefault();
},{passive:false});

canvas.addEventListener('touchend',(e)=>{
  if(canvasMode==='pan'){isPanning=false;return;}
  if(placingImg&&e.changedTouches.length>0){
    const t=e.changedTouches[0];commitPlacingImg(screenToCanvas(t.clientX,t.clientY));return;
  }
  if(e.touches.length===0) onDrawEnd();
});

// ── 貼上圖片 ──────────────────────────────────────
document.addEventListener('paste',(e)=>{
  if(inQueue) return;
  const items=e.clipboardData?.items;
  if(!items) return;
  for(const item of items){
    if(item.type.startsWith('image/')){
      e.preventDefault();
      const reader=new FileReader();
      reader.onload=(ev)=>{
        const img=new Image();
        img.onload=()=>{
          const maxSize=800;let w=img.naturalWidth,h=img.naturalHeight;
          if(w>maxSize||h>maxSize){const r=Math.min(maxSize/w,maxSize/h);w=Math.round(w*r);h=Math.round(h*r);}
          const tmpC=document.createElement('canvas');tmpC.width=w;tmpC.height=h;
          tmpC.getContext('2d').drawImage(img,0,0,w,h);
          enterPlacingMode(tmpC.toDataURL('image/jpeg',.75),w,h);
        };
        img.src=ev.target.result;
      };
      reader.readAsDataURL(item.getAsFile()); return;
    }
  }
});

// ── Socket 事件 ───────────────────────────────────
socket.on('draw',(data)=>{
  applyBrush(ctx,data.x0,data.y0,data.x1,data.y1,data.color,data.size,data.brush,data.vx||0,data.vy||0);
  applyBrush(offscreenCtx,data.x0,data.y0,data.x1,data.y1,data.color,data.size,data.brush,data.vx||0,data.vy||0);
});
socket.on('pasteImage',({dataURL})=>{
  const img=new Image();img.onload=()=>{ctx.drawImage(img,0,0);offscreenCtx.drawImage(img,0,0);};img.src=dataURL;
});
socket.on('placeSticker',({dataURL,x,y,w,h})=>{
  const img=new Image();img.onload=()=>{ctx.drawImage(img,x,y,w,h);offscreenCtx.drawImage(img,x,y,w,h);};img.src=dataURL;
});
socket.on('clearCanvas',()=>{ fillWhite(); showNotif('🗑️ 畫布已清除'); });
socket.on('userJoined',({nickname:n,roomInfo})=>{onlineCount.textContent=roomInfo.userCount;appendSystemMsg(`🎨 ${n} 加入了`);showNotif(`🎨 ${n} 加入了`);});
socket.on('userLeft',({nickname:n,roomInfo})=>{onlineCount.textContent=roomInfo.userCount;appendSystemMsg(`👋 ${n} 離開了`);showNotif(`👋 ${n} 離開了`);});
socket.on('cursorMove',({socketId,x,y,name})=>{
  if(!remoteCursors[socketId]){const el=document.createElement('div');el.className='remote-cursor';el.textContent=name;cursorLayer.appendChild(el);remoteCursors[socketId]=el;}
  remoteCursors[socketId].style.left=x+'px';remoteCursors[socketId].style.top=y+'px';
});
socket.on('chatMessage',({nickname:n,message,time})=>appendChatMsg(n,message,time));
socket.on('reaction',({nickname:n,emoji})=>{spawnReactionFloat(emoji);spawnDanmaku(`${n} ${emoji}`);appendSystemMsg(`${n} ${emoji}`);});

// ══════════════════════════════════════════════════
// UI 事件
// ══════════════════════════════════════════════════

// 左側工具列
fabTools.addEventListener('click',()=>{
  SFX.click();
  sideToolbar.classList.toggle('open');
  fabTools.classList.toggle('hidden', sideToolbar.classList.contains('open'));
});
sideCloseBtn.addEventListener('click',()=>{
  SFX.click();
  sideToolbar.classList.remove('open');
  fabTools.classList.remove('hidden');
});

// 模式切換
fabMode.addEventListener('click',()=>{
  SFX.swoosh();
  canvasMode = canvasMode==='pan' ? 'draw' : 'pan';
  updateModeUI();
  showModeBtn();
});

// 主 FAB
fabMain.addEventListener('click',()=>{
  SFX.click();
  fabOpen=!fabOpen;
  fabMenu.classList.toggle('hidden',!fabOpen);
  fabMain.textContent=fabOpen?'✕':'☰';
});
function closeFab(){fabOpen=false;fabMenu.classList.add('hidden');fabMain.textContent='☰';}

fabChat.addEventListener('click',()=>{SFX.click();togglePanel(chatPanel);closeFab();});
fabReaction.addEventListener('click',()=>{SFX.click();togglePanel(reactionPanel);closeFab();});
fabUploadImg.addEventListener('click',()=>{SFX.click();closeFab();openFilePicker();});

function togglePanel(panel){
  const hidden=panel.classList.contains('hidden');
  [chatPanel,reactionPanel].forEach(p=>p.classList.add('hidden'));
  if(hidden) panel.classList.remove('hidden');
}
chatClose.addEventListener('click',()=>chatPanel.classList.add('hidden'));
reactionPanelClose.addEventListener('click',()=>reactionPanel.classList.add('hidden'));

// 顏色
colorPicker.addEventListener('input',e=>{
  currentColor=e.target.value;
  if(colorPickerPreview) colorPickerPreview.style.background=currentColor;
  swatches.forEach(s=>s.classList.remove('active'));
  SFX.tick();
  if(canvasMode==='pan'){canvasMode='draw';updateModeUI();}
});
if(colorPickerBtn) {
  // 初始化預覽色塊
  if(colorPickerPreview) colorPickerPreview.style.background=currentColor;
  colorPickerBtn.addEventListener('click',()=>{
    colorPicker.click(); // 觸發原生調色盤
  });
}
swatches.forEach(sw=>{
  sw.addEventListener('click',()=>{
    SFX.tick();
    currentColor=sw.dataset.color;colorPicker.value=currentColor;
    swatches.forEach(s=>s.classList.remove('active'));sw.classList.add('active');
    if(currentBrush==='eraser'){currentBrush='pen';updateBrushUI('pen');}
    if(canvasMode==='pan'){canvasMode='draw';updateModeUI();}
  });
});

// 畫筆
sizeBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    SFX.tick();
    currentSize=parseInt(btn.dataset.size);
    sizeBtns.forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  });
});
brushBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    SFX.tick();
    currentBrush=btn.dataset.brush;
    if(typeof gtag!=='undefined') gtag('event','use_brush',{brush_type:currentBrush});
    updateBrushUI(currentBrush);
    if(canvasMode==='pan'){canvasMode='draw';updateModeUI();}
  });
});
function updateBrushUI(brush){
  brushBtns.forEach(b=>b.classList.toggle('active',b.dataset.brush===brush));
  updateModeUI();
}

leaveBtn.addEventListener('click',()=>{
  if(confirm('確定要離開房間嗎？')){
    // GA4：記錄停留時長
    if(typeof gtag!=='undefined' && window._roomEnterTime) {
      const sec = Math.round((Date.now() - window._roomEnterTime) / 1000);
      gtag('event','leave_room',{room_code:roomCode,duration_seconds:sec});
    }
    Music.stop();socket.disconnect();sessionStorage.clear();window.location.href='index.html';
  }
});
copyCodeBtn.addEventListener('click',()=>{SFX.click();navigator.clipboard.writeText(roomCode).then(()=>showNotif('✅ 代碼已複製'));});

// 聊天
function sendChat(inputEl){const msg=inputEl.value.trim();if(!msg||inQueue)return;SFX.send();socket.emit('chatMessage',{message:msg});inputEl.value='';if(typeof gtag!=='undefined')gtag('event','send_chat',{room_code:roomCode});}
chatSendBtn.addEventListener('click',()=>sendChat(chatInput));
chatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendChat(chatInput);});

// 表情
reactionBigBtns.forEach(btn=>{btn.addEventListener('click',()=>{SFX.pop();if(inQueue)return;socket.emit('reaction',{emoji:btn.dataset.emoji});});});

// 圖片上傳
function openFilePicker(){
  const input=document.createElement('input');
  input.type='file';input.accept='image/*';input.style.display='none';
  document.body.appendChild(input);
  input.addEventListener('change',()=>{
    const file=input.files[0];if(!file){document.body.removeChild(input);return;}
    const reader=new FileReader();
    reader.onload=(e)=>{
      const img=new Image();
      img.onload=()=>{
        const maxSize=800;let w=img.naturalWidth,h=img.naturalHeight;
        if(w>maxSize||h>maxSize){const r=Math.min(maxSize/w,maxSize/h);w=Math.round(w*r);h=Math.round(h*r);}
        const tmpC=document.createElement('canvas');tmpC.width=w;tmpC.height=h;
        tmpC.getContext('2d').drawImage(img,0,0,w,h);
        enterPlacingMode(tmpC.toDataURL('image/jpeg',.75),w,h);
        document.body.removeChild(input);
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

// 貼圖放置
function enterPlacingMode(src,naturalW,naturalH){
  const maxW=window.innerWidth*.35/canvasScale;
  const ratio=naturalH/naturalW;
  const w=Math.min(maxW,naturalW);
  const h=w*ratio;
  placingImg={src,w,h};
  const initX=window.innerWidth/2,initY=window.innerHeight/2;
  placingEl=document.createElement('div');
  placingEl.style.cssText=`position:fixed;pointer-events:none;z-index:500;border:3px dashed #FFD93D;opacity:.85;width:${w*canvasScale}px;height:${h*canvasScale}px;transform:translate(-50%,-50%);left:${initX}px;top:${initY}px;`;
  const pi=document.createElement('img');pi.src=src;pi.style.cssText='width:100%;height:100%;object-fit:contain;display:block;';
  placingEl.appendChild(pi);document.body.appendChild(placingEl);
  showNotif(window.innerWidth<768?'👆 拖曳到位置，放手放置':'📍 點畫布放置，ESC 取消');
  viewport.style.cursor='copy';
}
function movePlacingPreview(cx,cy){if(!placingEl)return;placingEl.style.left=cx+'px';placingEl.style.top=cy+'px';}
function cancelPlacingImg(){if(placingEl){placingEl.remove();placingEl=null;}placingImg=null;viewport.style.cursor='crosshair';}
function commitPlacingImg(pos){
  if(!placingImg) return;
  if(placingEl){placingEl.remove();placingEl=null;}
  const{src,w,h}=placingImg;placingImg=null;
  viewport.style.cursor=canvasMode==='pan'?'grab':'crosshair';
  const img=new Image();img.src=src;
  img.onload=()=>{
    const x=pos.x-w/2,y=pos.y-h/2;
    ctx.drawImage(img,x,y,w,h);offscreenCtx.drawImage(img,x,y,w,h);
    const tmp=document.createElement('canvas');tmp.width=CANVAS_W;tmp.height=CANVAS_H;
    tmp.getContext('2d').drawImage(img,x,y,w,h);
    socket.emit('pasteImage',{dataURL:tmp.toDataURL('image/png')});
    socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
    if(typeof gtag!=='undefined') gtag('event','place_image',{room_code:roomCode});
    showNotif('✅ 圖片已放置');
  };
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelPlacingImg();});

stickerConfirmBtn.addEventListener('click',()=>{
  const img=new Image();img.src=stickerPreviewImg.src;
  img.onload=()=>{
    ctx.drawImage(img,0,0);offscreenCtx.drawImage(img,0,0);
    socket.emit('pasteImage',{dataURL:img.src});
    socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
  };
  stickerPreview.classList.add('hidden');
});
stickerCancelBtn.addEventListener('click',()=>stickerPreview.classList.add('hidden'));

// ══════════════════════════════════════════════════
// 音效
// ══════════════════════════════════════════════════
const SFX = (() => {
  let ac=null;
  function init(){if(!ac)ac=new(window.AudioContext||window.webkitAudioContext)();}
  function beep(freq,dur,type='square',vol=.18,detune=0){
    init();if(ac.state==='suspended')ac.resume();
    const o=ac.createOscillator(),g=ac.createGain();
    o.connect(g);g.connect(ac.destination);
    o.type=type;o.frequency.setValueAtTime(freq,ac.currentTime);
    if(detune)o.detune.setValueAtTime(detune,ac.currentTime);
    g.gain.setValueAtTime(0,ac.currentTime);
    g.gain.linearRampToValueAtTime(vol,ac.currentTime+.01);
    g.gain.exponentialRampToValueAtTime(.001,ac.currentTime+dur);
    o.start(ac.currentTime);o.stop(ac.currentTime+dur+.05);
  }
  return {
    click(){ beep(800,.06,'square',.12); },
    tick(){  beep(600,.04,'triangle',.10); },
    send(){  beep(880,.05,'square',.12); setTimeout(()=>beep(1100,.05,'square',.10),60); },
    pop(){   beep(400,.03,'square',.15); setTimeout(()=>beep(600,.08,'sine',.12),30); },
    swoosh(){ beep(300,.12,'sawtooth',.10,0); setTimeout(()=>beep(500,.08,'square',.08),80); },
    warn(){  beep(220,.15,'sawtooth',.15); setTimeout(()=>beep(180,.2,'sawtooth',.12),100); },
    enter(){ [0,60,120].forEach((d,i)=>setTimeout(()=>beep(400+i*150,.1,'square',.1),d)); }
  };
})();

// ══════════════════════════════════════════════════
// 工具函式
// ══════════════════════════════════════════════════
function appendChatMsg(name,message,time){
  const html=`<div class="chat-msg"><div><span class="chat-msg-name" style="color:${nameToColor(name)}">${escapeHtml(name)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${escapeHtml(message)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html);chatMessages.scrollTop=chatMessages.scrollHeight;
}
function appendSystemMsg(text){
  const html=`<div class="chat-msg system"><div class="chat-msg-text">${escapeHtml(text)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html);chatMessages.scrollTop=chatMessages.scrollHeight;
}
function spawnReactionFloat(emoji){
  const el=document.createElement('div');el.className='reaction-float-fixed';el.textContent=emoji;
  el.style.left=(10+Math.random()*75)+'vw';el.style.bottom=(60+Math.random()*20)+'px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),2600);
}
function spawnDanmaku(text){
  const el=document.createElement('div');el.className='danmaku-fixed';el.textContent=text;
  el.style.top=(10+Math.random()*60)+'vh';el.style.right='-300px';
  document.body.appendChild(el);setTimeout(()=>el.remove(),6200);
}
let _nt;
function showNotif(msg){
  notifToast.textContent=msg;notifToast.classList.remove('hidden');
  clearTimeout(_nt);_nt=setTimeout(()=>notifToast.classList.add('hidden'),3000);
}
function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function nameToColor(name){
  const c=['#4ECDC4','#FF6B6B','#FFD93D','#C77DFF','#45B7D1','#F7B731','#26de81','#fd9644'];
  let h=0;for(let i=0;i<name.length;i++)h=name.charCodeAt(i)+((h<<5)-h);
  return c[Math.abs(h)%c.length];
}

// 遊戲室音樂 + 入場音效
Music.autoplay('room');
SFX.enter();

// visualViewport 鍵盤偵測
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{
    const kbH=window.innerHeight-window.visualViewport.height;
    document.querySelectorAll('.float-panel').forEach(p=>{
      p.style.bottom=kbH>100?(kbH+8)+'px':'';
    });
  });
}
