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

const socket = io();

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
const pasteImgBtn      = document.getElementById('pasteImgBtn');
const voteToast        = document.getElementById('voteToast');
const voteCountEl      = document.getElementById('voteCount');
const voteNeededEl     = document.getElementById('voteNeeded');
const notifToast       = document.getElementById('notifToast');
const queueScreen      = document.getElementById('queueScreen');
const queuePosEl       = document.getElementById('queuePos');

// FAB
const fabMain          = document.getElementById('fabMain');
const fabMenu          = document.getElementById('fabMenu');
const fabChat          = document.getElementById('fabChat');
const fabSticker       = document.getElementById('fabSticker');
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
const stickerPanel     = document.getElementById('stickerPanel');
const stickerPanelClose= document.getElementById('stickerPanelClose');
const stickerSearchInput=document.getElementById('stickerSearchInput');
const stickerSearchBtn = document.getElementById('stickerSearchBtn');
const stickerGrid      = document.getElementById('stickerGrid');
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
const CANVAS_W = 2400, CANVAS_H = 1800; // 大畫布尺寸
let currentColor = '#1A1A2E';
let currentSize  = 4;
let currentBrush = 'pen';
let isDrawing    = false;
let lastX=0, lastY=0;
let inQueue      = initQueued;
let fabOpen      = false;
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

function fillWhite() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
}
fillWhite();

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
  return {
    x: src.clientX + viewport.scrollLeft,
    y: src.clientY + viewport.scrollTop
  };
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
  if (inQueue) return;
  // 如果點到 UI 元件就不畫
  if (e.target !== canvas) return;
  isDrawing=true;
  const {x,y}=getPos(e);
  lastX=x; lastY=y;
}
function onDrawMove(e) {
  if (inQueue||!isDrawing) return;
  if (e.target !== canvas && !isDrawing) return;
  const {x,y}=getPos(e);
  const vx=x-lastX, vy=y-lastY;
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

canvas.addEventListener('mousedown',  onDrawStart);
canvas.addEventListener('mousemove',  onDrawMove);
canvas.addEventListener('mouseup',    onDrawEnd);
canvas.addEventListener('mouseleave', onDrawEnd);
canvas.addEventListener('touchstart',  onDrawStart, {passive:false});
canvas.addEventListener('touchmove',   onDrawMove,  {passive:false});
canvas.addEventListener('touchend',    onDrawEnd);

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
pasteImgBtn.addEventListener('click', async ()=>{
  if (inQueue) return;
  try {
    const items=await navigator.clipboard.read();
    for (const item of items) {
      const t=item.types.find(t=>t.startsWith('image/'));
      if (t) {
        const blob=await item.getType(t); const url=URL.createObjectURL(blob);
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
        img.src=url; return;
      }
    }
    showNotif('剪貼簿中沒有圖片');
  } catch(err){ showNotif('請先複製圖片再點此'); }
});

// ══════════════════════════════════════════════════
// Socket 接收
// ══════════════════════════════════════════════════
socket.on('draw',(data)=>applyBrush(ctx,data.x0,data.y0,data.x1,data.y1,data.color,data.size,data.brush,data.vx||0,data.vy||0));
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
  spawnReactionFloat(emoji); appendSystemMsg(`${n} ${emoji}`);
  if (window.innerWidth<768) spawnDanmaku(`${n} ${emoji}`);
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

fabChat.addEventListener('click',()=>{ togglePanel(chatPanel); closeFab(); });
fabSticker.addEventListener('click',()=>{ togglePanel(stickerPanel); closeFab(); });
fabReaction.addEventListener('click',()=>{ togglePanel(reactionPanel); closeFab(); });
fabClear.addEventListener('click',()=>{ if(inQueue)return; socket.emit('requestClear'); showNotif('🗳️ 已投票清除'); closeFab(); });

function togglePanel(panel) {
  const isHidden = panel.classList.contains('hidden');
  [chatPanel,stickerPanel,reactionPanel].forEach(p=>p.classList.add('hidden'));
  if (isHidden) panel.classList.remove('hidden');
}
chatClose.addEventListener('click',()=>chatPanel.classList.add('hidden'));
stickerPanelClose.addEventListener('click',()=>stickerPanel.classList.add('hidden'));
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
// 貼圖
// ══════════════════════════════════════════════════
async function searchStickers(query){
  stickerGrid.innerHTML='<div class="sticker-loading">🔍 搜尋中...</div>';
  try {
    const res=await fetch('/api/search-stickers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query})});
    const data=await res.json();
    if (data.urls&&data.urls.length>0) renderStickerResults(data.urls);
    else stickerGrid.innerHTML='<div class="sticker-error">沒有找到圖片 🤔</div>';
  } catch(err){ stickerGrid.innerHTML='<div class="sticker-error">搜尋失敗 😢</div>'; }
}
function renderStickerResults(urls){
  stickerGrid.innerHTML='';
  urls.forEach(url=>{
    const img=document.createElement('img'); img.src=url; img.className='sticker-item'; img.crossOrigin='anonymous';
    img.onerror=()=>img.remove();
    img.addEventListener('click',()=>activateStickerPreview(img));
    stickerGrid.appendChild(img);
  });
}
function activateStickerPreview(imgEl){
  stickerPreviewImg.src=imgEl.src;
  stickerData.w=160; stickerData.h=160;
  stickerData.x=viewport.scrollLeft+(window.innerWidth-160)/2;
  stickerData.y=viewport.scrollTop+(window.innerHeight-160)/2;
  updateStickerPos();
  stickerPreview.classList.remove('hidden');
  stickerPanel.classList.add('hidden');
}
function updateStickerPos(){
  stickerPreview.style.left=stickerData.x+'px'; stickerPreview.style.top=stickerData.y+'px';
  stickerPreview.style.width=stickerData.w+'px'; stickerPreview.style.height=stickerData.h+'px';
}
stickerPreview.addEventListener('mousedown',(e)=>{ if(e.target===stickerHandle)return; stickerData.dragging=true; stickerData.dragOffX=e.clientX+viewport.scrollLeft-stickerData.x; stickerData.dragOffY=e.clientY+viewport.scrollTop-stickerData.y; e.preventDefault(); });
stickerHandle.addEventListener('mousedown',(e)=>{ stickerData.resizing=true; e.preventDefault(); e.stopPropagation(); });
document.addEventListener('mousemove',(e)=>{
  if (stickerData.dragging){ stickerData.x=e.clientX+viewport.scrollLeft-stickerData.dragOffX; stickerData.y=e.clientY+viewport.scrollTop-stickerData.dragOffY; updateStickerPos(); }
  if (stickerData.resizing){ stickerData.w=Math.max(40,e.clientX+viewport.scrollLeft-stickerData.x); stickerData.h=Math.max(40,e.clientY+viewport.scrollTop-stickerData.y); updateStickerPos(); }
});
document.addEventListener('mouseup',()=>{ stickerData.dragging=false; stickerData.resizing=false; });

stickerConfirmBtn.addEventListener('click',()=>{
  const img=new Image(); img.crossOrigin='anonymous'; img.src=stickerPreviewImg.src;
  img.onload=()=>{
    ctx.drawImage(img,stickerData.x,stickerData.y,stickerData.w,stickerData.h);
    const tmp=document.createElement('canvas'); tmp.width=CANVAS_W; tmp.height=CANVAS_H;
    tmp.getContext('2d').drawImage(img,stickerData.x,stickerData.y,stickerData.w,stickerData.h);
    socket.emit('placeSticker',{dataURL:tmp.toDataURL('image/png'),x:stickerData.x,y:stickerData.y,w:stickerData.w,h:stickerData.h});
    socket.emit('saveSnapshot',{snapshot:canvas.toDataURL('image/jpeg',.6)});
  };
  stickerPreview.classList.add('hidden');
});
stickerCancelBtn.addEventListener('click',()=>stickerPreview.classList.add('hidden'));
stickerSearchBtn.addEventListener('click',()=>{ const q=stickerSearchInput.value.trim(); if(q)searchStickers(q); });
stickerSearchInput.addEventListener('keydown',e=>{ if(e.key==='Enter')stickerSearchBtn.click(); });
document.querySelectorAll('.sticker-tag').forEach(tag=>{ tag.addEventListener('click',()=>{ stickerSearchInput.value=tag.dataset.q; searchStickers(tag.dataset.q); }); });

// ══════════════════════════════════════════════════
// 工具函式
// ══════════════════════════════════════════════════
function appendChatMsg(name,message,time){
  const html=`<div class="chat-msg"><div><span class="chat-msg-name" style="color:${nameToColor(name)}">${escapeHtml(name)}</span><span class="chat-msg-time">${time}</span></div><div class="chat-msg-text">${escapeHtml(message)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function appendSystemMsg(text){
  const html=`<div class="chat-msg system"><div class="chat-msg-text">${escapeHtml(text)}</div></div>`;
  chatMessages.insertAdjacentHTML('beforeend',html); chatMessages.scrollTop=chatMessages.scrollHeight;
}
function spawnReactionFloat(emoji){
  const el=document.createElement('div'); el.className='reaction-float'; el.textContent=emoji;
  el.style.left=(viewport.scrollLeft+10+Math.random()*60)+'%';
  el.style.top=(viewport.scrollTop+window.innerHeight*.6)+'px';
  reactionLayer.appendChild(el); setTimeout(()=>el.remove(),2600);
}
function spawnDanmaku(text){
  const el=document.createElement('div'); el.className='danmaku-item'; el.textContent=text;
  el.style.top=(viewport.scrollTop+10+Math.random()*60)+'%'; el.style.right='-200px';
  danmakuLayer.appendChild(el); setTimeout(()=>el.remove(),6200);
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
