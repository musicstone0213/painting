// ================================================
// music.js — Web Audio API 合成背景音樂
// 首頁：活潑像素風 chiptune
// 遊戲室：奇怪電子混沌風
// ================================================

const Music = (() => {
  let ctx = null;
  let masterGain = null;
  let currentTrack = null;
  let isPlaying = false;
  let volume = 0.35;
  let scheduleAhead = 0.1;
  let timerInterval = null;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume, ctx.currentTime);
    masterGain.connect(ctx.destination);
  }

  // ── 音符頻率表 ──────────────────────────────────
  const NOTE = {
    C3:130.8, D3:146.8, E3:164.8, F3:174.6, G3:196, A3:220, B3:246.9,
    C4:261.6, D4:293.7, E4:329.6, F4:349.2, G4:392, A4:440, B4:493.9,
    C5:523.3, D5:587.3, E5:659.3, F5:698.5, G5:784, A5:880, B5:987.8,
    C6:1046.5, D6:1174.7, E6:1318.5,
    REST: 0
  };

  // ── 合成音色 ────────────────────────────────────
  function playNote(freq, startTime, duration, type='square', gainVal=0.3, detune=0) {
    if (!freq || freq === 0) return;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(masterGain);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (detune) osc.detune.setValueAtTime(detune, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(gainVal, startTime + 0.01);
    gain.gain.setValueAtTime(gainVal, startTime + duration * 0.7);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  function playDrum(type, startTime, gainVal=0.4) {
    const bufSize = ctx.sampleRate * 0.1;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    if (type === 'kick') {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.connect(g); g.connect(masterGain);
      osc.frequency.setValueAtTime(150, startTime);
      osc.frequency.exponentialRampToValueAtTime(0.01, startTime + 0.3);
      g.gain.setValueAtTime(gainVal, startTime);
      g.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
      osc.start(startTime); osc.stop(startTime + 0.3);
    } else if (type === 'snare' || type === 'hihat') {
      for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
      const src  = ctx.createBufferSource();
      const g    = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      src.buffer = buf;
      src.connect(filt); filt.connect(g); g.connect(masterGain);
      filt.type = type === 'hihat' ? 'highpass' : 'bandpass';
      filt.frequency.value = type === 'hihat' ? 8000 : 1500;
      const dur = type === 'hihat' ? 0.05 : 0.15;
      g.gain.setValueAtTime(type === 'hihat' ? gainVal * 0.5 : gainVal * 0.7, startTime);
      g.gain.exponentialRampToValueAtTime(0.01, startTime + dur);
      src.start(startTime); src.stop(startTime + dur);
    }
  }

  // ══════════════════════════════════════════════
  // 首頁音樂：活潑 Chiptune（C major 快節奏）
  // ══════════════════════════════════════════════
  const LOBBY_BPM = 140;
  const LOBBY_BEAT = 60 / LOBBY_BPM;

  // 主旋律（8 小節循環）
  const LOBBY_MELODY = [
    NOTE.E5, NOTE.E5, NOTE.G5, NOTE.E5, NOTE.C5, NOTE.D5, NOTE.E5, NOTE.REST,
    NOTE.G5, NOTE.G5, NOTE.A5, NOTE.G5, NOTE.E5, NOTE.F5, NOTE.G5, NOTE.REST,
    NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.B5, NOTE.A5, NOTE.G5, NOTE.REST,
    NOTE.E5, NOTE.G5, NOTE.A5, NOTE.G5, NOTE.E5, NOTE.D5, NOTE.C5, NOTE.REST,
  ];

  // 副旋律（和聲）
  const LOBBY_HARMONY = [
    NOTE.C4, NOTE.REST, NOTE.E4, NOTE.REST, NOTE.G4, NOTE.REST, NOTE.E4, NOTE.REST,
    NOTE.D4, NOTE.REST, NOTE.F4, NOTE.REST, NOTE.A4, NOTE.REST, NOTE.F4, NOTE.REST,
    NOTE.E4, NOTE.REST, NOTE.G4, NOTE.REST, NOTE.C5, NOTE.REST, NOTE.G4, NOTE.REST,
    NOTE.C4, NOTE.REST, NOTE.E4, NOTE.REST, NOTE.G4, NOTE.REST, NOTE.E4, NOTE.REST,
  ];

  // 低音線
  const LOBBY_BASS = [
    NOTE.C3, NOTE.REST, NOTE.C3, NOTE.REST, NOTE.G3, NOTE.REST, NOTE.G3, NOTE.REST,
    NOTE.D3, NOTE.REST, NOTE.D3, NOTE.REST, NOTE.A3, NOTE.REST, NOTE.A3, NOTE.REST,
    NOTE.E3, NOTE.REST, NOTE.E3, NOTE.REST, NOTE.C3, NOTE.REST, NOTE.E3, NOTE.REST,
    NOTE.C3, NOTE.REST, NOTE.G3, NOTE.REST, NOTE.E3, NOTE.REST, NOTE.C3, NOTE.REST,
  ];

  // ══════════════════════════════════════════════
  // 遊戲室音樂：活潑跳躍電子風（D major BPM 160）
  // ══════════════════════════════════════════════
  const ROOM_BPM = 160;
  const ROOM_BEAT = 60 / ROOM_BPM;

  const ROOM_LEAD = [
    NOTE.D5, NOTE.REST, NOTE.F5, NOTE.D5, NOTE.A4, NOTE.REST, NOTE.B4, NOTE.REST,
    NOTE.G4, NOTE.REST, NOTE.A4, NOTE.G4, NOTE.D4, NOTE.REST, NOTE.E4, NOTE.REST,
    NOTE.F4, NOTE.REST, NOTE.A4, NOTE.F4, NOTE.C5, NOTE.REST, NOTE.D5, NOTE.REST,
    NOTE.A4, NOTE.B4, NOTE.REST, NOTE.A4, NOTE.G4, NOTE.F4, NOTE.D4, NOTE.REST,
  ];

  const ROOM_ARP = [
    NOTE.D3, NOTE.A3, NOTE.D4, NOTE.F4, NOTE.D3, NOTE.A3, NOTE.D4, NOTE.F4,
    NOTE.G3, NOTE.D4, NOTE.G4, NOTE.B4, NOTE.G3, NOTE.D4, NOTE.G4, NOTE.B4,
    NOTE.A3, NOTE.E4, NOTE.A4, NOTE.C5, NOTE.A3, NOTE.E4, NOTE.A4, NOTE.C5,
    NOTE.D3, NOTE.F3, NOTE.A3, NOTE.D4, NOTE.F4, NOTE.A4, NOTE.D5, NOTE.REST,
  ];

  // ── 排程器 ──────────────────────────────────────
  let nextNoteTime = 0;
  let noteIndex    = 0;
  let trackType    = 'lobby';
  const NOTE_LEN   = 32; // 一個循環的音符數

  function scheduleNotes() {
    while (nextNoteTime < ctx.currentTime + scheduleAhead) {
      const i    = noteIndex % NOTE_LEN;
      const beat = trackType === 'lobby' ? LOBBY_BEAT : ROOM_BEAT;
      const dur  = beat * 0.45;

      if (trackType === 'lobby') {
        playNote(LOBBY_MELODY[i],  nextNoteTime, dur, 'square',   0.18);
        playNote(LOBBY_HARMONY[i], nextNoteTime, dur, 'triangle', 0.10);
        playNote(LOBBY_BASS[i],    nextNoteTime, dur, 'sawtooth', 0.12);
        // 鼓組
        if (i % 8 === 0)             playDrum('kick',  nextNoteTime, 0.35);
        if (i % 8 === 4)             playDrum('snare', nextNoteTime, 0.25);
        if (i % 2 === 0)             playDrum('hihat', nextNoteTime, 0.2);
      } else {
        playNote(ROOM_LEAD[i], nextNoteTime, dur, 'square',   0.16);
        playNote(ROOM_ARP[i],  nextNoteTime, dur * 0.6, 'triangle', 0.10);
        // 輕快鼓組
        if (i % 8 === 0)  playDrum('kick',  nextNoteTime, 0.35);
        if (i % 8 === 2)  playDrum('hihat', nextNoteTime, 0.18);
        if (i % 8 === 4)  playDrum('snare', nextNoteTime, 0.28);
        if (i % 8 === 6)  playDrum('hihat', nextNoteTime, 0.18);
        if (i % 4 === 1)  playDrum('hihat', nextNoteTime, 0.10);
        if (i % 4 === 3)  playDrum('hihat', nextNoteTime, 0.10);
      }

      nextNoteTime += beat;
      noteIndex++;
    }
  }

  // ── 公開 API ─────────────────────────────────────
  return {
    play(track = 'lobby') {
      init();
      if (ctx.state === 'suspended') ctx.resume();
      if (isPlaying && currentTrack === track) return;
      this.stop();
      trackType    = track;
      nextNoteTime = ctx.currentTime + 0.1;
      noteIndex    = 0;
      isPlaying    = true;
      currentTrack = track;
      timerInterval = setInterval(scheduleNotes, 50);
    },

    stop() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
      isPlaying    = false;
      currentTrack = null;
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (masterGain) masterGain.gain.setValueAtTime(volume, ctx.currentTime);
    },

    toggle() {
      if (isPlaying) this.stop();
      else this.play(currentTrack || 'lobby');
      return isPlaying;
    },

    isPlaying() { return isPlaying; },

    // 瀏覽器需要用戶互動才能播放，用第一次點擊啟動
    autoplay(track) {
      init();
      // 先嘗試直接播放
      const attemptPlay = () => {
        if (ctx.state === 'suspended') ctx.resume();
        this.play(track);
      };
      // 直接嘗試
      attemptPlay();
      // 若被瀏覽器擋（suspended），等第一次任何互動
      if (!isPlaying) {
        const onInteract = () => {
          attemptPlay();
          document.removeEventListener('click',     onInteract, true);
          document.removeEventListener('touchstart', onInteract, true);
          document.removeEventListener('keydown',    onInteract, true);
          document.removeEventListener('scroll',     onInteract, true);
        };
        document.addEventListener('click',     onInteract, { once:true, capture:true });
        document.addEventListener('touchstart', onInteract, { once:true, capture:true });
        document.addEventListener('keydown',    onInteract, { once:true, capture:true });
        document.addEventListener('scroll',     onInteract, { once:true, capture:true });
      }
    }
  };
})();
