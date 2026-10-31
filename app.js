'use strict';

/* =========================================================
   Songwriter – Notiz-App fürs Songschreiben
   Alles bleibt lokal auf dem Gerät (IndexedDB).
   ========================================================= */

const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

function fmtTime(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Heute ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-CH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

/* ---------------- Einstellungen (pro Gerät) ---------------- */
const Settings = {
  get(key, def) {
    try { const v = localStorage.getItem('sw.' + key); return v == null ? def : JSON.parse(v); } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('sw.' + key, JSON.stringify(val)); } catch {}
  },
};

/* ---------------- Datenbank ---------------- */
const DB = {
  _db: null,
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res, rej) => {
      const req = indexedDB.open('songwriter', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tombs')) db.createObjectStore('tombs', { keyPath: 'id' });
      };
      req.onsuccess = () => { this._db = req.result; res(this._db); };
      req.onerror = () => rej(req.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((r) => { out = r; });
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  allSongs() { return this.tx('songs', 'readonly', (s) => s.getAll()); },
  getSong(id) { return this.tx('songs', 'readonly', (s) => s.get(id)); },
  putSong(song) { return this.tx('songs', 'readwrite', (s) => s.put(song)); },
  deleteSong(id) { return this.tx('songs', 'readwrite', (s) => s.delete(id)); },
  getAudio(id) { return this.tx('audio', 'readonly', (s) => s.get(id)); },
  putAudio(rec) { return this.tx('audio', 'readwrite', (s) => s.put(rec)); },
  deleteAudio(id) { return this.tx('audio', 'readwrite', (s) => s.delete(id)); },
  allTombs() { return this.tx('tombs', 'readonly', (s) => s.getAll()); },
  putTomb(t) { return this.tx('tombs', 'readwrite', (s) => s.put(t)); },
  deleteTomb(id) { return this.tx('tombs', 'readwrite', (s) => s.delete(id)); },
  allAudioIds() { return this.tx('audio', 'readonly', (s) => s.getAllKeys()); },
};

/* ---------------- Song-Modell ---------------- */
const SECTION_TYPES = ['Intro', 'Vers', 'Pre-Chorus', 'Refrain', 'Bridge', 'Solo', 'Outro'];
const COMMON_CHORDS = ['C', 'D', 'E', 'F', 'G', 'A', 'Am', 'Dm', 'Em', 'Bm', 'C7', 'D7', 'E7', 'G7', 'A7', 'Fmaj7', 'Cadd9', 'Dsus4', 'Asus2', 'B7', 'F#m', 'Bb', 'H7'];
const STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'];

function newSong(isIdea = false) {
  const now = Date.now();
  return { id: uid(), title: '', isIdea, capo: 0, createdAt: now, updatedAt: now, blocks: [{ id: uid(), type: 'text', text: '' }] };
}

function makeBlock(type, song, sectionName) {
  const b = { id: uid(), type };
  if (type === 'text') b.text = '';
  if (type === 'section') {
    const n = song.blocks.filter((x) => x.type === 'section' && x.kind === sectionName).length;
    b.kind = sectionName;
    b.label = ['Vers'].includes(sectionName) ? `${sectionName} ${n + 1}` : (n ? `${sectionName} ${n + 1}` : sectionName);
    b.text = '';
  }
  if (type === 'tab') { b.label = 'Tab'; b.text = STRINGS.map((s) => s + '|-').join('\n'); }
  if (type === 'chords') { b.label = 'Akkordfolge'; b.chords = []; }
  if (type === 'audio') { b.label = 'Aufnahme'; b.tracks = []; }
  return b;
}

function chordsInSong(song) {
  const set = new Set();
  for (const b of song.blocks) {
    if (b.type === 'chords') b.chords.forEach((c) => c !== '|' && set.add(c));
    if (b.type === 'section') for (const m of (b.text || '').matchAll(/\[([^\]]+)\]/g)) set.add(m[1]);
  }
  return [...set];
}

function songSnippet(song) {
  for (const b of song.blocks) {
    const t = (b.text || '').replace(/\[[^\]]*\]/g, '').trim();
    if (b.type !== 'tab' && t) return t.split('\n')[0];
    if (b.type === 'chords' && b.chords.length) return b.chords.join(' ');
  }
  return '';
}

function songToText(song) {
  const out = [song.title || 'Ohne Titel', ...(song.capo ? [`Capo ${song.capo}`] : []), ''];
  for (const b of song.blocks) {
    if (b.type === 'text' && b.text.trim()) out.push(b.text.trim(), '');
    if (b.type === 'section') out.push(`[${b.label}]`, chordProToTwoLine(b.text), '');
    if (b.type === 'chords') out.push(`${b.label}: ${b.chords.join(' ')}`, '');
    if (b.type === 'tab') out.push(b.label, b.text, '');
    if (b.type === 'audio') out.push(`${b.label}: ${b.tracks.length} Spur(en)`, '');
  }
  return out.join('\n').trim() + '\n';
}

// "[Am]Hallo [G]Welt" -> zwei Zeilen: Akkorde über dem Text
function chordProToTwoLine(text) {
  return (text || '').split('\n').map((line) => {
    if (!/\[[^\]]+\]/.test(line)) return line;
    let chords = '', lyric = '';
    const parts = line.split(/\[([^\]]+)\]/);
    lyric = parts[0]; chords = ' '.repeat(parts[0].length);
    for (let i = 1; i < parts.length; i += 2) {
      const ch = parts[i], ly = parts[i + 1] || '';
      if (chords.length > lyric.length) lyric = lyric.padEnd(chords.length);
      chords = chords.padEnd(lyric.length) + ch + ' ';
      lyric += ly;
    }
    return chords.trimEnd() + '\n' + lyric;
  }).join('\n');
}

/* ---------------- Audio-Engine ---------------- */
const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; }; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && this.on) this.port.postMessage({ t: currentTime, d: ch.slice(0) });
    return this.on;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

const Engine = {
  ctx: null,
  buffers: new Map(), // audioId -> AudioBuffer
  sources: [],
  playing: false,
  recording: false,
  t0: 0,
  ownerId: null, // Block-ID, die gerade spielt/aufnimmt
  onTick: null,
  _workletReady: null,

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  async buffer(audioId) {
    if (this.buffers.has(audioId)) return this.buffers.get(audioId);
    const rec = await DB.getAudio(audioId);
    if (!rec) return null;
    const ab = await rec.blob.arrayBuffer();
    const buf = await new Promise((res, rej) => this.ensure().decodeAudioData(ab, res, rej));
    this.buffers.set(audioId, buf);
    return buf;
  },

  async loadTracks(tracks) {
    const out = [];
    for (const t of tracks) {
      const buf = await this.buffer(t.audioId).catch(() => null);
      if (buf) out.push({ track: t, buf });
    }
    return out;
  },

  // Spielt alle (nicht stummen) Spuren gleichzeitig. Gibt den Startzeitpunkt zurück.
  async play(tracks, ownerId, startDelay = 0.08) {
    this.stopPlayback();
    const ctx = this.ensure();
    const loaded = await this.loadTracks(tracks.filter((t) => !t.muted));
    const t0 = ctx.currentTime + startDelay;
    let end = t0;
    for (const { track, buf } of loaded) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = track.volume ?? 1;
      src.connect(g).connect(ctx.destination);
      const off = (track.offset || 0) / 1000;
      const when = t0 + Math.max(0, off);
      const skip = Math.max(0, -off);
      if (skip < buf.duration) {
        src.start(when, skip);
        end = Math.max(end, when + buf.duration - skip);
        this.sources.push(src);
      }
    }
    this.t0 = t0;
    this.endAt = end;
    this.playing = true;
    this.ownerId = ownerId;
    this._loop();
    return t0;
  },

  stopPlayback() {
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources = [];
    this.playing = false;
  },

  _loop() {
    cancelAnimationFrame(this._raf);
    const step = () => {
      if (!this.playing && !this.recording) { this.onTick && this.onTick(); return; }
      const now = this.ctx.currentTime;
      if (this.playing && !this.recording && now > this.endAt + 0.05) {
        this.stopPlayback();
        this.ownerId = null;
        this.onTick && this.onTick();
        return;
      }
      this.onTick && this.onTick();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  },

  elapsed() {
    if (!this.ctx || (!this.playing && !this.recording)) return 0;
    return Math.max(0, this.ctx.currentTime - this.t0);
  },

  async _initWorklet() {
    const ctx = this.ensure();
    if (!ctx.audioWorklet) return false;
    if (!this._workletReady) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      this._workletReady = ctx.audioWorklet.addModule(url).then(() => true, () => false);
    }
    return this._workletReady;
  },

  // Aufnahme starten. Vorhandene Spuren werden dabei abgespielt (Overdub).
  async startRecording(tracks, ownerId) {
    const ctx = this.ensure();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    this.chunks = [];
    this.firstT = null;
    this.level = 0;
    const onData = (t, d) => {
      if (this.firstT == null) this.firstT = t;
      this.chunks.push(d);
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i];
      this.level = Math.min(1, Math.sqrt(sum / (d.length / 4)) * 4);
    };

    if (await this._initWorklet()) {
      const node = new AudioWorkletNode(ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
      node.port.onmessage = (e) => onData(e.data.t, e.data.d);
      src.connect(node).connect(silent).connect(ctx.destination);
      this.capture = { node, src, silent };
    } else {
      // Fallback für ältere Browser
      const node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => onData(e.playbackTime ?? ctx.currentTime, new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(node).connect(silent).connect(ctx.destination);
      this.capture = { node, src, silent };
    }

    this.recording = true;
    this.ownerId = ownerId;
    const hasPlayback = tracks.some((t) => !t.muted);
    if (hasPlayback) {
      await this.play(tracks, ownerId, 0.15);
      this.recording = true;
    } else {
      this.t0 = ctx.currentTime;
      this._loop();
    }
    this.hadPlayback = hasPlayback;
    const settings = stream.getAudioTracks()[0]?.getSettings?.() || {};
    this.inputLatency = typeof settings.latency === 'number' ? settings.latency : 0.01;
  },

  async stopRecording() {
    const ctx = this.ctx;
    const { node, src, silent } = this.capture || {};
    try { node.port && node.port.postMessage('stop'); } catch {}
    try { src.disconnect(); node.disconnect(); silent.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stopPlayback();
    this.recording = false;
    this.ownerId = null;

    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const data = new Float32Array(total);
    let p = 0;
    for (const c of this.chunks) { data.set(c, p); p += c.length; }
    this.chunks = [];
    if (!total) return null;

    // Versatz berechnen, damit die neue Spur synchron zur alten liegt.
    let offsetMs = 0;
    if (this.hadPlayback && this.firstT != null) {
      const outLat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
      const lat = outLat + this.inputLatency + Settings.get('latencyMs', 0) / 1000;
      offsetMs = Math.round(((this.firstT - this.t0) - lat) * 1000);
    }
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    const { blob, format } = await encodeAudio([data], ctx.sampleRate, 64);
    return { blob, format, buf, offsetMs, duration: data.length / ctx.sampleRate };
  },

  async mixdown(tracks) {
    const loaded = await this.loadTracks(tracks.filter((t) => !t.muted));
    if (!loaded.length) return null;
    const sr = loaded[0].buf.sampleRate;
    let len = 0;
    for (const { track, buf } of loaded) {
      const off = (track.offset || 0) / 1000;
      len = Math.max(len, Math.max(0, off) + buf.duration - Math.max(0, -off));
    }
    const off = new OfflineAudioContext(2, Math.ceil(len * sr) + 1, sr);
    for (const { track, buf } of loaded) {
      const s = off.createBufferSource();
      s.buffer = buf;
      const g = off.createGain();
      g.gain.value = track.volume ?? 1;
      s.connect(g).connect(off.destination);
      const o = (track.offset || 0) / 1000;
      s.start(Math.max(0, o), Math.max(0, -o));
    }
    const out = await off.startRendering();
    return encodeAudio([out.getChannelData(0), out.getChannelData(1)], sr, 128);
  },
};

const AUDIO_MIME = { mp3: 'audio/mpeg', wav: 'audio/wav' };

// Aufnahme als MP3 speichern (ca. 0,5 MB/Minute statt 5 MB als WAV). Fällt bei Problemen auf WAV zurück.
let mp3Worker = null;
function encodeAudio(channels, sampleRate, kbps) {
  const wav = () => ({ blob: encodeWav(channels, sampleRate), format: 'wav' });
  if (!window.Worker || ![32000, 44100, 48000].includes(sampleRate)) return Promise.resolve(wav());
  return new Promise((resolve) => {
    try {
      mp3Worker = mp3Worker || new Worker('mp3-worker.js');
      const timer = setTimeout(() => resolve(wav()), 60000);
      mp3Worker.onmessage = (e) => { clearTimeout(timer); resolve(e.data.ok ? { blob: e.data.blob, format: 'mp3' } : wav()); };
      mp3Worker.onerror = () => { clearTimeout(timer); mp3Worker = null; resolve(wav()); };
      mp3Worker.postMessage({ channels, sampleRate, kbps });
    } catch { resolve(wav()); }
  });
}

function encodeWav(channels, sampleRate) {
  const n = channels[0].length, nc = channels.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function drawWave(canvas, buf) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, hgt = canvas.clientHeight || 38;
  canvas.width = w * dpr; canvas.height = hgt * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f2a65a';
  const data = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));
  for (let x = 0; x < w; x++) {
    let max = 0;
    const start = x * step;
    for (let i = 0; i < step; i += 8) { const a = Math.abs(data[start + i] || 0); if (a > max) max = a; }
    const bh = Math.max(1, Math.min(1, max * 1.6) * hgt);
    g.fillRect(x, (hgt - bh) / 2, 1, bh);
  }
}

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- Bottom-Sheet ---------------- */
const Sheet = {
  open(content) {
    const s = $('#sheet');
    s.innerHTML = '';
    s.append(h('div', { class: 'sheet-grab' }), content);
    s.classList.remove('hidden');
    $('#sheet-backdrop').classList.remove('hidden');
  },
  close() {
    $('#sheet').classList.add('hidden');
    $('#sheet-backdrop').classList.add('hidden');
  },
  menu(title, items) {
    this.open(h('div', {},
      title ? h('div', { class: 'sheet-title' }, title) : null,
      h('div', { class: 'sheet-list' }, items.map((it) => h('button', {
        class: it.danger ? 'danger' : '',
        onclick: () => { this.close(); it.action(); },
      }, it.label)))
    ));
  },
  prompt(title, value, onOk, placeholder = '') {
    const input = h('input', { value: value || '', placeholder });
    const ok = () => { this.close(); onOk(input.value.trim()); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    this.open(h('div', {},
      h('div', { class: 'sheet-title' }, title),
      h('div', { class: 'field' }, input),
      h('div', { class: 'row' }, h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => this.close() }, 'Abbrechen'),
        h('button', { class: 'btn primary', onclick: ok }, 'OK'))
    ));
    setTimeout(() => input.focus(), 50);
  },
  confirm(title, okLabel, onOk) {
    this.open(h('div', {},
      h('div', { class: 'sheet-title' }, title),
      h('div', { class: 'row' }, h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: () => this.close() }, 'Abbrechen'),
        h('button', { class: 'btn rec', onclick: () => { this.close(); onOk(); } }, okLabel))
    ));
  },
};
document.addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') Sheet.close(); });

/* ---------------- Startseite ---------------- */
async function renderHome() {
  const app = $('#app');
  const all = (await DB.allSongs()).sort((a, b) => b.updatedAt - a.updatedAt);
  let tab = Settings.get('homeTab', 'songs');
  let query = '';

  const list = h('ul', { class: 'song-list' });
  const actions = h('div', { class: 'home-actions' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const drawTabs = () => {
    const nIdeas = all.filter((s) => s.isIdea).length;
    tabs.innerHTML = '';
    tabs.append(
      h('button', { class: tab === 'songs' ? 'on' : '', role: 'tab', onclick: () => { tab = 'songs'; Settings.set('homeTab', tab); draw(); } }, 'Songs'),
      h('button', { class: tab === 'ideas' ? 'on' : '', role: 'tab', onclick: () => { tab = 'ideas'; Settings.set('homeTab', tab); draw(); } }, 'Ideen', nIdeas ? h('span', { class: 'badge' }, String(nIdeas)) : null));
  };

  const drawActions = () => {
    actions.innerHTML = '';
    if (tab === 'songs') {
      actions.append(h('button', { class: 'new-song', onclick: () => createSong(false) }, h('span', { style: 'font-size:24px' }, '+'), 'Neuer Song'));
    } else {
      actions.append(h('div', { class: 'two' },
        h('button', { class: 'new-song', onclick: () => createSong(true) }, h('span', { style: 'font-size:22px' }, '✎'), 'Neue Idee'),
        h('button', { class: 'new-song alt', onclick: () => { Engine.ensure(); createSong(true, true); } }, h('span', { style: 'font-size:20px' }, '●'), 'Sprachmemo')));
    }
  };

  const fill = () => {
    list.innerHTML = '';
    const q = query.toLowerCase();
    const pool = all.filter((s) => (tab === 'ideas') === !!s.isIdea);
    const shown = pool.filter((s) => !q || (s.title || '').toLowerCase().includes(q) || songToText(s).toLowerCase().includes(q));
    if (!shown.length) {
      const msg = pool.length ? 'Nichts gefunden.'
        : tab === 'ideas' ? 'Noch keine Ideen. Halte hier schnell Zeilen oder Melodien fest – später kannst du sie in einen Song verschieben.'
        : 'Noch keine Songs. Tippe auf „Neuer Song“ und leg los.';
      list.append(h('li', { class: 'empty' }, msg));
      return;
    }
    for (const s of shown) {
      const counts = { section: 0, tab: 0, audio: 0 };
      s.blocks.forEach((b) => { if (b.type in counts) counts[b.type] += b.type === 'audio' ? b.tracks.length : 1; });
      list.append(h('li', {}, h('button', { class: 'song-item', onclick: () => go('#/song/' + s.id) },
        h('div', { class: 't' }, s.title || (s.isIdea ? 'Idee' : 'Ohne Titel')),
        songSnippet(s) ? h('div', { class: 's' }, songSnippet(s)) : null,
        h('div', { class: 'm' },
          h('span', {}, fmtDate(s.updatedAt)),
          s.capo ? h('span', {}, `Capo ${s.capo}`) : null,
          counts.section ? h('span', {}, `${counts.section} Teil${counts.section > 1 ? 'e' : ''}`) : null,
          counts.tab ? h('span', {}, `${counts.tab} Tab${counts.tab > 1 ? 's' : ''}`) : null,
          counts.audio ? h('span', {}, `🎙 ${counts.audio}`) : null,
        ))));
    }
  };

  const draw = () => { drawTabs(); drawActions(); fill(); };

  app.innerHTML = '';
  app.append(
    h('header', { class: 'topbar' },
      h('h1', {}, 'Songwriter'),
      syncButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'Einstellungen', onclick: openSettings }, '⚙︎')),
    h('main', {},
      tabs,
      actions,
      h('input', { class: 'search', type: 'search', placeholder: 'Suchen…', oninput: (e) => { query = e.target.value; fill(); } }),
      list)
  );
  draw();
}

async function createSong(isIdea = false, record = false) {
  const s = newSong(isIdea);
  let opts = { focusNew: true };
  if (record) {
    const b = makeBlock('audio', s);
    b.label = 'Sprachmemo';
    s.blocks = [b];
    opts = { autoRecord: b.id };
  }
  await DB.putSong(s);
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  Sync.schedule();
  go('#/song/' + s.id, opts);
}

function openSettings() {
  const lat = Settings.get('latencyMs', 0);
  const val = h('span', {}, `${lat} ms`);
  const range = h('input', {
    type: 'range', min: -200, max: 300, step: 5, value: lat,
    oninput: (e) => { val.textContent = e.target.value + ' ms'; Settings.set('latencyMs', +e.target.value); },
  });
  Sheet.open(h('div', {},
    h('div', { class: 'sheet-title' }, 'Cloud-Sync'),
    syncSettings(),
    h('div', { class: 'sheet-title' }, 'Aufnahme'),
    h('div', { class: 'field' },
      h('label', {}, 'Latenz-Ausgleich für 2. Spur: ', val),
      range,
      h('div', { class: 'hint' }, 'Wenn neue Spuren immer etwas zu spät klingen, Wert erhöhen. Gilt für zukünftige Aufnahmen; jede Spur lässt sich zusätzlich einzeln verschieben.')),
    h('div', { class: 'row' }, h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => Sheet.close() }, 'Fertig'))
  ));
}

// Sync-Bereich in den Einstellungen: Verbindung → Anmelden → Status
function syncSettings() {
  const box = h('div', { class: 'sync-box' });
  const draw = () => {
    box.innerHTML = '';
    if (!Sync.configured()) {
      const url = h('input', { placeholder: 'https://xxxx.supabase.co', value: Sync.config().url, autocapitalize: 'off', spellcheck: false });
      const key = h('input', { placeholder: 'anon public key', value: Sync.config().key, autocapitalize: 'off', spellcheck: false });
      box.append(
        h('div', { class: 'hint' }, 'Damit Songs und Aufnahmen auf allen Geräten gleich sind. Einmalig die Supabase-Verbindung eintragen (Anleitung im README).'),
        h('div', { class: 'field' }, h('label', {}, 'Project URL'), url),
        h('div', { class: 'field' }, h('label', {}, 'Anon Key'), key),
        h('div', { class: 'row' }, h('div', { class: 'spacer' }),
          h('button', { class: 'btn primary', onclick: async () => {
            if (!url.value.trim() || !key.value.trim()) { toast('Bitte beide Felder ausfüllen'); return; }
            await Sync.setConfig(url.value.trim(), key.value.trim());
            draw();
          } }, 'Verbinden')));
      return;
    }
    if (!Sync.user) {
      const email = h('input', { type: 'email', placeholder: 'E-Mail', autocomplete: 'email', autocapitalize: 'off' });
      const pw = h('input', { type: 'password', placeholder: 'Passwort (mind. 6 Zeichen)', autocomplete: 'current-password' });
      const run = async (fn) => {
        try { const msg = await fn(email.value.trim(), pw.value); if (msg) toast(msg, 4000); draw(); }
        catch (e) { toast(e.message || String(e), 4000); }
      };
      box.append(
        h('div', { class: 'hint' }, 'Melde dich an. Auf jedem Gerät mit demselben Konto anmelden.'),
        h('div', { class: 'field' }, email, pw),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => run((e, p) => Sync.signUp(e, p)) }, 'Konto erstellen'),
          h('div', { class: 'spacer' }),
          h('button', { class: 'btn primary', onclick: () => run((e, p) => Sync.signIn(e, p)) }, 'Anmelden')),
        h('button', { class: 'link-btn', onclick: () => Sheet.confirm('Verbindung zu Supabase entfernen?', 'Entfernen', () => Sync.setConfig('', '')) }, 'Supabase-Verbindung ändern'));
      return;
    }
    box.append(
      h('div', { class: 'hint' }, `Angemeldet als ${Sync.user.email}. `, Sync.statusText()),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: async () => { await Sync.signOut(); draw(); } }, 'Abmelden'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small primary', onclick: async () => { await Sync.run(); draw(); } }, 'Jetzt synchronisieren')));
  };
  draw();
  return box;
}

function syncButton() {
  const b = h('button', { class: 'icon-btn sync-ind', 'aria-label': 'Sync-Status', onclick: openSettings });
  Sync.indicators.add(b);
  Sync.paint(b);
  return b;
}

/* ---------------- Song-Editor ---------------- */
let current = null; // aktueller Song
let saveTimer = null;

function save(now = false) {
  if (!current) return;
  current.updatedAt = Date.now();
  clearTimeout(saveTimer);
  const s = current;
  const doIt = () => { saveTimer = null; return DB.putSong(s).then(() => Sync.schedule()).catch((e) => toast('Speichern fehlgeschlagen: ' + e.message)); };
  if (now) return doIt();
  saveTimer = setTimeout(doIt, 400);
}

// Ein anderes Gerät hat etwas geändert: Ansicht auffrischen, ohne laufende Eingaben zu stören
function onRemoteChanges(ids) {
  if (!current) { if (!location.hash.startsWith('#/song/')) renderHome(); return; }
  if (!ids.has(current.id)) return;
  const typing = document.activeElement && document.activeElement.closest('#app') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (typing || saveTimer || Engine.recording || Engine.playing) return; // lokale Version gewinnt beim nächsten Speichern
  const y = window.scrollY;
  renderSong(current.id).then(() => window.scrollTo(0, y));
}

async function renderSong(id, opts = {}) {
  const song = await DB.getSong(id);
  if (!song) { current = null; go('#/'); return; }
  song.blocks.forEach((b) => delete b._editing);
  current = song;
  const app = $('#app');
  app.innerHTML = '';

  const title = h('input', {
    class: 'title-input', value: song.title, placeholder: song.isIdea ? 'Idee (Titel optional)' : 'Songtitel',
    oninput: (e) => { song.title = e.target.value; save(); },
  });

  const blocksEl = h('div', { id: 'blocks' });
  app.append(
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Zurück', onclick: () => go('#/') }, '‹'),
      title,
      syncButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'Menü', onclick: () => songMenu(song) }, '⋯')),
    h('main', {}, songMeta(song), blocksEl),
    h('button', { class: 'fab', 'aria-label': 'Hinzufügen', onclick: () => addMenu(song) }, '+')
  );
  renderBlocks();

  if (opts.focusNew) {
    // Neuer Song: direkt ins leere Notizfeld schreiben
    const ta = $('textarea.free', blocksEl);
    setTimeout(() => (ta || title).focus(), 60);
  }
  if (opts.autoRecord) {
    const btn = $(`[data-id="${opts.autoRecord}"] .round.rec`);
    if (btn) btn.click();
  }
}

// Zeile unter dem Titel: Idee-Hinweis bzw. Capo
function songMeta(song) {
  if (song.isIdea) {
    return h('div', { class: 'meta-row' },
      h('span', { class: 'pill' }, 'Idee'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => moveIdeaMenu(song) }, 'In Song verschieben'));
  }
  const capo = h('select', {
    class: 'capo-select', 'aria-label': 'Capo',
    onchange: (e) => { song.capo = +e.target.value || 0; save(); },
  }, h('option', { value: 0 }, 'Kein Capo'),
  Array.from({ length: 12 }, (_, i) => h('option', { value: i + 1 }, `Capo ${i + 1}. Bund`)));
  capo.value = String(song.capo || 0);
  return h('div', { class: 'meta-row' }, capo);
}

function renderBlocks(focusId) {
  const el = $('#blocks');
  if (!el || !current) return;
  el.innerHTML = '';
  for (const b of current.blocks) el.append(renderBlock(b));
  el.querySelectorAll('textarea.free, textarea.lyrics-edit').forEach(autoGrow);
  if (focusId) {
    const node = el.querySelector(`[data-id="${focusId}"]`);
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const f = node.querySelector('textarea, input.prog-input');
      if (f) setTimeout(() => f.focus(), 250);
    }
  }
}

function addMenu(song) {
  const add = (type, name) => {
    Sheet.close();
    const b = makeBlock(type, song, name);
    if (type === 'section' || type === 'tab') b._editing = true;
    song.blocks.push(b);
    save();
    renderBlocks(b.id);
  };
  const btn = (ic, label, fn) => h('button', { onclick: fn }, h('span', { class: 'ic' }, ic), label);
  Sheet.open(h('div', {},
    h('div', { class: 'sheet-title' }, 'Songteil mit Text & Akkorden'),
    h('div', { class: 'sheet-grid' }, SECTION_TYPES.map((n) => btn('♪', n, () => add('section', n)))),
    h('div', { class: 'sheet-title' }, 'Weitere'),
    h('div', { class: 'sheet-grid' },
      btn('✎', 'Notiz / Idee', () => add('text')),
      btn('♯', 'Akkordfolge', () => add('chords')),
      btn('𝄞', 'Gitarren-Tab', () => add('tab')),
      btn('🎙', 'Aufnahme', () => add('audio')))
  ));
}

function songMenu(song) {
  const items = [];
  if (song.isIdea) {
    items.push({ label: 'In Song verschieben…', action: () => moveIdeaMenu(song) });
    items.push({ label: 'Zu eigenem Song machen', action: () => { song.isIdea = false; save(true); renderSong(song.id); toast('Ist jetzt ein Song'); } });
  } else {
    items.push({ label: 'Zurück in die Ideen', action: () => { song.isIdea = true; save(true); renderSong(song.id); } });
  }
  items.push({ label: 'Als Text teilen / kopieren', action: () => shareText(song) });
  items.push({ label: song.isIdea ? 'Idee löschen' : 'Song löschen', danger: true, action: () => Sheet.confirm('Wirklich löschen? Aufnahmen gehen ebenfalls verloren.', 'Löschen', () => deleteSong(song)) });
  Sheet.menu(song.title || (song.isIdea ? 'Idee' : 'Ohne Titel'), items);
}

// Idee an einen bestehenden Song anhängen (Inhalt wandert mit, Idee verschwindet)
async function moveIdeaMenu(idea) {
  const songs = (await DB.allSongs()).filter((s) => !s.isIdea).sort((a, b) => b.updatedAt - a.updatedAt);
  const items = songs.map((s) => ({ label: s.title || 'Ohne Titel', action: () => moveIdeaInto(idea, s.id) }));
  items.unshift({ label: '+ Neuer Song aus dieser Idee', action: () => { idea.isIdea = false; save(true); renderSong(idea.id); toast('Neuer Song erstellt'); } });
  Sheet.menu('In welchen Song?', items);
}

async function moveIdeaInto(idea, songId) {
  await save(true);
  const target = await DB.getSong(songId);
  if (!target) return;
  const blocks = idea.blocks.filter((b) => !(b.type === 'text' && !b.text.trim()));
  if (idea.title && blocks[0]) {
    if (blocks[0].type === 'text') blocks[0] = { ...blocks[0], text: idea.title + '\n' + blocks[0].text };
    else blocks.unshift({ id: uid(), type: 'text', text: idea.title });
  }
  target.blocks.push(...blocks);
  target.updatedAt = Date.now();
  await DB.putSong(target);
  await removeSongRecord(idea.id); // Audio bleibt erhalten, es gehört jetzt dem Ziel-Song
  current = null;
  toast(`In „${target.title || 'Ohne Titel'}“ verschoben`);
  go('#/song/' + target.id);
}

async function shareText(song) {
  const text = songToText(song);
  if (navigator.share) {
    try { await navigator.share({ title: song.title || 'Song', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('In die Zwischenablage kopiert'); } catch { toast('Kopieren nicht möglich'); }
}

// Song aus der lokalen DB löschen und die Löschung für den Sync merken
async function removeSongRecord(id) {
  await DB.deleteSong(id);
  await DB.putTomb({ id, deletedAt: Date.now() });
  Sync.schedule();
}

async function removeAudio(track) {
  await DB.deleteAudio(track.audioId);
  Engine.buffers.delete(track.audioId);
  Sync.removeAudio(track.audioId, track.format);
}

async function deleteSong(song) {
  clearTimeout(saveTimer);
  for (const b of song.blocks) if (b.type === 'audio') for (const t of b.tracks) await removeAudio(t);
  await removeSongRecord(song.id);
  current = null;
  go('#/');
}

function blockMenu(b) {
  const i = current.blocks.indexOf(b);
  const items = [];
  if (i > 0) items.push({ label: '↑ Nach oben', action: () => { move(i, -1); } });
  if (i < current.blocks.length - 1) items.push({ label: '↓ Nach unten', action: () => { move(i, 1); } });
  items.push({ label: 'Duplizieren', action: () => {
    const copy = JSON.parse(JSON.stringify(b));
    copy.id = uid();
    if (copy.type === 'audio') copy.tracks = []; // Audio wird nicht kopiert
    if (copy.label) copy.label += ' (Kopie)';
    current.blocks.splice(i + 1, 0, copy); save(); renderBlocks(copy.id);
  } });
  items.push({ label: 'Löschen', danger: true, action: () => Sheet.confirm('Diesen Teil löschen?', 'Löschen', async () => {
    if (b.type === 'audio') { if (Engine.ownerId === b.id) await stopAll(); for (const t of b.tracks) await removeAudio(t); }
    current.blocks.splice(current.blocks.indexOf(b), 1); save(); renderBlocks();
  }) });
  Sheet.menu(b.label || 'Notiz', items);
  function move(idx, d) {
    const [x] = current.blocks.splice(idx, 1);
    current.blocks.splice(idx + d, 0, x);
    save(); renderBlocks(); $(`[data-id="${x.id}"]`)?.scrollIntoView({ block: 'center' });
  }
}

function blockShell(b, typeName, body) {
  return h('section', { class: 'block ' + b.type + '-block', 'data-id': b.id },
    h('div', { class: 'block-head' },
      b.type === 'text'
        ? h('div', { class: 'spacer' })
        : h('input', { class: 'block-label', value: b.label || '', 'aria-label': 'Titel', oninput: (e) => { b.label = e.target.value; save(); } }),
      typeName ? h('span', { class: 'block-type' }, typeName) : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Optionen', onclick: () => blockMenu(b) }, '⋯')),
    h('div', { class: 'block-body' }, body));
}

function renderBlock(b) {
  switch (b.type) {
    case 'text': return renderText(b);
    case 'section': return renderSection(b);
    case 'chords': return renderChords(b);
    case 'tab': return renderTab(b);
    case 'audio': return renderAudio(b);
  }
  return h('div');
}

/* --- Freie Notiz --- */
function renderText(b) {
  const ta = h('textarea', {
    class: 'free', rows: 1, placeholder: 'Schreib einfach los… Ideen, Zeilen, Stimmungen. Mit + fügst du Vers, Refrain, Tabs oder Aufnahmen hinzu.',
    oninput: (e) => { b.text = e.target.value; autoGrow(e.target); save(); },
  });
  ta.value = b.text || '';
  return blockShell(b, '', ta);
}

/* --- Vers / Refrain mit Akkorden --- */
function renderLyricsView(text) {
  const wrap = h('div', { class: 'lyrics-view' });
  if (!text.trim()) { wrap.append(h('div', { class: 'placeholder' }, 'Tippen, um Text und Akkorde zu schreiben…')); return wrap; }
  for (const line of text.split('\n')) {
    if (!line.trim()) { wrap.append(h('div', { class: 'line empty-line' })); continue; }
    const hasChords = /\[[^\]]+\]/.test(line);
    const lineEl = h('div', { class: 'line' + (hasChords ? '' : ' no-chords') });
    const parts = line.split(/\[([^\]]+)\]/);
    const segs = [];
    if (parts[0]) segs.push(['', parts[0]]);
    for (let i = 1; i < parts.length; i += 2) segs.push([parts[i], parts[i + 1] || '']);
    for (const [ch, ly] of segs) {
      // lange Textstücke an Wortgrenzen aufteilen, damit sie umbrechen können
      const words = ly.split(/(?<=\s)/);
      words.forEach((wd, k) => lineEl.append(h('span', { class: 'seg' }, h('span', { class: 'ch' }, k === 0 ? ch : ''), h('span', { class: 'ly' }, wd || (k === 0 && ch ? ' ' : '')))));
      if (!words.length) lineEl.append(h('span', { class: 'seg' }, h('span', { class: 'ch' }, ch), h('span', { class: 'ly' }, ' ')));
    }
    wrap.append(lineEl);
  }
  return wrap;
}

function renderSection(b) {
  const body = h('div');
  const draw = () => {
    body.innerHTML = '';
    if (!b._editing) {
      const view = renderLyricsView(b.text || '');
      view.addEventListener('click', () => { b._editing = true; draw(); const ta = $('textarea', body); ta.focus(); });
      body.append(view);
      return;
    }
    const ta = h('textarea', {
      class: 'lyrics-edit', placeholder: 'Text schreiben. Cursor dorthin setzen, wo der Akkordwechsel ist, und unten einen Akkord antippen.',
      oninput: (e) => { b.text = e.target.value; autoGrow(e.target); save(); },
    });
    ta.value = b.text || '';
    const insert = (chord) => {
      const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s;
      const ins = `[${chord}]`;
      ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + ins.length;
      b.text = ta.value; save(); autoGrow(ta); ta.focus();
    };
    const keepFocus = (e) => e.preventDefault();
    const used = chordsInSong(current);
    const chips = [...used, ...COMMON_CHORDS.filter((c) => !used.includes(c))];
    body.append(
      ta,
      h('div', { class: 'chip-row' },
        h('button', { class: 'chip plain', onpointerdown: keepFocus, onclick: () => Sheet.prompt('Akkord eingeben', '', (c) => c && insert(c), 'z.B. Gmaj7, D/F#') }, '+ Akkord'),
        chips.map((c) => h('button', { class: 'chip', onpointerdown: keepFocus, onclick: () => insert(c) }, c))),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('div', { class: 'hint', style: 'flex:1;margin:0' }, 'Akkorde stehen in [eckigen Klammern] und erscheinen über dem Text.'),
        h('button', { class: 'btn small primary', onclick: () => { b._editing = false; draw(); } }, 'Fertig'))
    );
    requestAnimationFrame(() => autoGrow(ta));
  };
  draw();
  return blockShell(b, b.kind || 'Teil', body);
}

/* --- Akkordfolge --- */
function renderChords(b) {
  const body = h('div');
  let sel = -1;
  const draw = () => {
    body.innerHTML = '';
    const prog = h('div', { class: 'prog' });
    if (!b.chords.length) prog.append(h('span', { class: 'placeholder' }, 'Akkorde unten antippen oder eingeben…'));
    b.chords.forEach((c, i) => prog.append(h('button', {
      class: 'pc' + (c === '|' ? ' bar' : '') + (i === sel ? ' sel' : ''),
      onclick: () => { sel = sel === i ? -1 : i; draw(); },
    }, c)));
    const input = h('input', { class: 'prog-input', placeholder: 'z.B. Am F C G', enterkeyhint: 'done' });
    const addFromInput = () => {
      const parts = input.value.split(/[\s,]+/).filter(Boolean);
      if (!parts.length) return;
      b.chords.push(...parts); save(); draw();
      $('.prog-input', body).focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromInput(); } });
    const used = chordsInSong(current);
    const chips = [...used, ...COMMON_CHORDS.filter((c) => !used.includes(c))];
    body.append(...[
      prog,
      sel >= 0 ? h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn small', disabled: sel === 0, onclick: () => { [b.chords[sel - 1], b.chords[sel]] = [b.chords[sel], b.chords[sel - 1]]; sel--; save(); draw(); } }, '←'),
        h('button', { class: 'btn small', disabled: sel === b.chords.length - 1, onclick: () => { [b.chords[sel + 1], b.chords[sel]] = [b.chords[sel], b.chords[sel + 1]]; sel++; save(); draw(); } }, '→'),
        h('button', { class: 'btn small', onclick: () => Sheet.prompt('Akkord ändern', b.chords[sel], (c) => { if (c) { b.chords[sel] = c; save(); draw(); } }) }, 'Ändern'),
        h('button', { class: 'btn small rec', onclick: () => { b.chords.splice(sel, 1); sel = -1; save(); draw(); } }, 'Entfernen')) : null,
      h('div', { class: 'row', style: 'margin-top:10px' }, input, h('button', { class: 'btn', onclick: addFromInput }, 'Hinzufügen')),
      h('div', { class: 'chip-row' },
        h('button', { class: 'chip plain', onclick: () => { b.chords.push('|'); save(); draw(); } }, '| Takt'),
        chips.map((c) => h('button', { class: 'chip', onclick: () => { b.chords.push(c); save(); draw(); } }, c)))
    ].filter(Boolean));
  };
  draw();
  return blockShell(b, 'Akkorde', body);
}

/* --- Gitarren-Tab --- */
const SAVE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
// Eingabe-Reihenfolge: tiefe E-Saite zuerst (Indizes in STRINGS)
const STRING_ORDER = [5, 4, 3, 2, 1, 0];

function renderTab(b) {
  const body = h('div');
  const draw = () => {
    body.innerHTML = '';
    if (!b._editing) {
      const edit = () => { b._editing = true; draw(); };
      const editBtn = h('button', { class: 'icon-btn tab-corner', 'aria-label': 'Tab bearbeiten', title: 'Bearbeiten', onclick: (e) => { e.stopPropagation(); edit(); } });
      editBtn.innerHTML = EDIT_ICON;
      const view = h('pre', { class: 'tab-view', onclick: edit }, b.text || '');
      body.append(h('div', { class: 'tab-wrap' }, view, editBtn));
      return;
    }
    body.append(...tabEditor(b, () => { b._editing = false; save(); draw(); }));
  };
  draw();
  return blockShell(b, 'Tab', body);
}

function tabEditor(b, done) {
  const undo = [];
  let string = STRING_ORDER[0];
  let chordMode = false;
  let pending = {}; // Saite -> Bund (für Akkord-Modus)

  const ta = h('textarea', {
    class: 'tab-edit', spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off',
    oninput: (e) => { b.text = e.target.value; fit(); save(); },
  });
  ta.value = b.text || '';
  const fit = () => { ta.rows = Math.max(7, ta.value.split('\n').length + 1); };
  fit();
  const saveBtn = h('button', { class: 'icon-btn tab-corner primary', 'aria-label': 'Tab speichern', title: 'Speichern', onclick: done });
  saveBtn.innerHTML = SAVE_ICON;

  // Die letzten 6 Tab-Zeilen finden (oder neue anlegen)
  const system = () => {
    let lines = (b.text || '').split('\n');
    const isTab = (l) => /^[eBGDAEhH]\s*\|/.test(l);
    let end = lines.length;
    while (end > 0 && !lines[end - 1].trim()) end--;
    const start = end - 6;
    if (start < 0 || !lines.slice(start, end).every(isTab)) {
      lines = lines.slice(0, end);
      if (lines.length) lines.push('');
      const s = lines.length;
      lines.push(...STRINGS.map((x) => x + '|-'));
      return { lines, start: s };
    }
    return { lines: lines.slice(0, end), start };
  };
  const commit = (col) => {
    undo.push(b.text);
    const { lines, start } = system();
    const width = Math.max(1, ...Object.values(col).map((v) => String(v).length));
    for (let i = 0; i < 6; i++) {
      const v = col[i];
      lines[start + i] += (v == null ? '-'.repeat(width) : String(v).padEnd(width, '-')) + '-';
    }
    setText(lines.join('\n'));
  };
  const setText = (t) => { b.text = t; ta.value = t; fit(); save(); ta.scrollLeft = ta.scrollWidth; };
  const bar = () => {
    undo.push(b.text);
    const { lines, start } = system();
    for (let i = 0; i < 6; i++) lines[start + i] += '|-';
    setText(lines.join('\n'));
  };
  const newLine = () => {
    undo.push(b.text);
    const t = (b.text || '').replace(/\s+$/, '');
    setText((t ? t + '\n\n' : '') + STRINGS.map((x) => x + '|-').join('\n'));
  };

  const strBtns = h('div', { class: 'strings' });
  const drawStrings = () => {
    strBtns.innerHTML = '';
    STRING_ORDER.forEach((i) => {
      const s = STRINGS[i];
      strBtns.append(h('button', {
        class: (i === string ? 'on' : '') + (pending[i] != null ? ' pending' : ''),
        onclick: () => { string = i; drawStrings(); },
      }, pending[i] != null ? `${s}:${pending[i]}` : s));
    });
  };
  drawStrings();

  const frets = h('div', { class: 'frets' });
  for (let f = 0; f <= 15; f++) {
    frets.append(h('button', {
      onclick: () => {
        if (chordMode) {
          pending[string] = f;
          const k = STRING_ORDER.indexOf(string);
          if (k < STRING_ORDER.length - 1) string = STRING_ORDER[k + 1];
          drawStrings();
        } else commit({ [string]: f });
      },
    }, String(f)));
  }
  const chordBtn = h('button', { class: 'btn small toggle', onclick: () => { chordMode = !chordMode; pending = {}; string = STRING_ORDER[0]; chordBtn.classList.toggle('on', chordMode); setBtn.classList.toggle('hidden', !chordMode); drawStrings(); } }, 'Mehrere Saiten');
  const setBtn = h('button', { class: 'btn small primary hidden', onclick: () => { if (Object.keys(pending).length) { commit(pending); pending = {}; string = STRING_ORDER[0]; drawStrings(); } } }, 'Setzen');
  const padWrap = h('div', { class: 'pad' },
    h('div', { class: 'hint', style: 'margin:0' }, 'Saite wählen, dann Bund antippen – wird hinten angehängt. Bei „Mehrere Saiten“ geht es von E nach e. Oben kannst du frei editieren.'),
    strBtns, frets,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => commit({}) }, '– Pause'),
      h('button', { class: 'btn small', onclick: bar }, '| Takt'),
      h('button', { class: 'btn small', onclick: () => { if (undo.length) setText(undo.pop()); } }, '↶'),
      h('button', { class: 'btn small', onclick: newLine }, 'Neue Zeile'),
      chordBtn, setBtn));
  const padToggle = h('button', { class: 'btn small', onclick: () => { padWrap.classList.toggle('hidden'); padToggle.textContent = padWrap.classList.contains('hidden') ? 'Eingabehilfe zeigen' : 'Eingabehilfe ausblenden'; } }, 'Eingabehilfe ausblenden');
  return [
    h('div', { class: 'tab-wrap' }, ta, saveBtn),
    h('div', { class: 'row', style: 'margin-top:8px' }, padToggle, h('div', { class: 'spacer' }), h('button', { class: 'btn small primary', onclick: done }, 'Speichern')),
    padWrap,
  ];
}

/* --- Aufnahme mit mehreren Spuren --- */
const audioUIs = new Map(); // blockId -> update()

Engine.onTick = () => { for (const fn of audioUIs.values()) fn(); };

async function stopAll() {
  if (Engine.recording) await finishRecording();
  Engine.stopPlayback();
  Engine.ownerId = null;
  Engine.onTick();
}

let recBlock = null;
async function finishRecording() {
  const b = recBlock;
  recBlock = null;
  const res = await Engine.stopRecording();
  if (!res || !b) return;
  const audioId = uid();
  await DB.putAudio({ id: audioId, blob: res.blob, format: res.format, uploaded: false, createdAt: Date.now() });
  Engine.buffers.set(audioId, res.buf);
  b.tracks.push({ id: uid(), name: `Spur ${b.tracks.length + 1}`, audioId, format: res.format, volume: 1, muted: false, offset: res.offsetMs, duration: res.duration });
  save(true);
  renderBlocks();
  toast(b.tracks.length > 1 ? 'Spur hinzugefügt – mit ▶ alles zusammen anhören' : 'Aufnahme gespeichert');
}

function renderAudio(b) {
  const body = h('div');
  const time = h('span', { class: 'time' }, '0:00.0');
  const meterBar = h('div');
  const meter = h('div', { class: 'meter hidden' }, meterBar);

  const recBtn = h('button', {
    class: 'round rec', 'aria-label': 'Aufnehmen',
    onclick: async () => {
      if (Engine.recording && Engine.ownerId === b.id) { await finishRecording(); return; }
      await stopAll();
      try {
        recBlock = b;
        await Engine.startRecording(b.tracks, b.id);
        if (b.tracks.some((t) => !t.muted)) toast('Overdub läuft – Kopfhörer empfohlen');
      } catch (e) {
        recBlock = null;
        toast(e.name === 'NotAllowedError' ? 'Mikrofon-Zugriff wurde verweigert' : 'Aufnahme nicht möglich: ' + e.message, 3500);
      }
      update();
    },
  }, '●');
  const playBtn = h('button', {
    class: 'round play', 'aria-label': 'Abspielen',
    onclick: async () => {
      if (Engine.ownerId === b.id && (Engine.playing || Engine.recording)) { await stopAll(); return; }
      await stopAll();
      if (!b.tracks.length) return;
      await Engine.play(b.tracks, b.id);
      update();
    },
  }, '▶');

  const update = () => {
    if (!document.body.contains(body)) { audioUIs.delete(b.id); return; }
    const mine = Engine.ownerId === b.id;
    const isRec = mine && Engine.recording;
    const isPlay = mine && Engine.playing && !Engine.recording;
    recBtn.classList.toggle('active', isRec);
    recBtn.textContent = isRec ? '■' : '●';
    playBtn.classList.toggle('active', isPlay);
    playBtn.textContent = isPlay ? '■' : '▶';
    playBtn.disabled = !b.tracks.length || isRec;
    time.textContent = mine ? fmtTime(Engine.elapsed()) : '0:00.0';
    meter.classList.toggle('hidden', !isRec);
    if (isRec) meterBar.style.width = Math.round(Engine.level * 100) + '%';
  };
  audioUIs.set(b.id, update);

  const tracksEl = h('div', { class: 'tracks' });
  b.tracks.forEach((t, i) => tracksEl.append(renderTrack(b, t, i)));

  body.append(...[
    h('div', { class: 'transport' }, recBtn, playBtn,
      h('div', { class: 'hint', style: 'margin:0;max-width:52%' }, b.tracks.length ? 'Nochmal ● = neue Spur über die bisherigen' : 'Tippe ● zum Aufnehmen'),
      time),
    meter,
    tracksEl,
    b.tracks.length > 1 ? h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn small', onclick: async () => {
        toast('Mix wird erstellt…');
        const mix = await Engine.mixdown(b.tracks);
        if (mix) shareOrDownload(mix.blob, `${(current.title || 'Song').replace(/[^\w\- äöüÄÖÜ]/g, '')} - ${b.label}.${mix.format}`);
      } }, 'Mix exportieren')) : null,
  ].filter(Boolean));
  requestAnimationFrame(update);
  return blockShell(b, `${b.tracks.length} Spur${b.tracks.length === 1 ? '' : 'en'}`, body);
}

function renderTrack(b, t, i) {
  const canvas = h('canvas', { class: 'wave' });
  Engine.buffer(t.audioId).then((buf) => buf && requestAnimationFrame(() => drawWave(canvas, buf))).catch(() => {});
  const offVal = h('span', { style: 'min-width:64px;text-align:right' }, `${t.offset || 0} ms`);
  const offsetRow = h('div', { class: 'offset-row hidden' },
    h('span', {}, 'Versatz'),
    h('input', { type: 'range', min: -1000, max: 1000, step: 5, value: t.offset || 0, oninput: (e) => { t.offset = +e.target.value; offVal.textContent = t.offset + ' ms'; save(); } }),
    offVal);
  const muteBtn = h('button', { class: 'mute' + (t.muted ? ' on' : ''), onclick: () => { t.muted = !t.muted; muteBtn.classList.toggle('on', t.muted); save(); } }, 'M');
  return h('div', { class: 'track' },
    h('div', { class: 'track-top' },
      h('input', { class: 'track-name', value: t.name, oninput: (e) => { t.name = e.target.value; save(); } }),
      h('span', { class: 'track-dur' }, fmtTime(t.duration)),
      h('button', { class: 'icon-btn', 'aria-label': 'Spur-Optionen', onclick: () => Sheet.menu(t.name, [
        { label: 'Nur diese Spur anhören', action: async () => { await stopAll(); await Engine.play([{ ...t, muted: false, offset: 0 }], b.id); } },
        { label: 'Timing verschieben', action: () => offsetRow.classList.toggle('hidden') },
        { label: 'Als Datei teilen', action: async () => { const r = await DB.getAudio(t.audioId); if (r) shareOrDownload(r.blob, `${t.name}.${t.format || 'wav'}`); } },
        { label: 'Spur löschen', danger: true, action: () => Sheet.confirm(`„${t.name}“ löschen?`, 'Löschen', async () => {
          if (Engine.ownerId === b.id) await stopAll();
          b.tracks.splice(b.tracks.indexOf(t), 1);
          await removeAudio(t);
          save(true); renderBlocks();
        }) },
      ]) }, '⋯')),
    canvas,
    h('div', { class: 'track-ctrl' },
      muteBtn,
      h('span', { style: 'font-size:13px;color:var(--muted)' }, 'Vol'),
      h('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: t.volume ?? 1, oninput: (e) => { t.volume = +e.target.value; save(); } })),
    offsetRow);
}

/* ---------------- Routing ---------------- */
let routeOpts = {};
function go(hash, opts = {}) {
  routeOpts = opts;
  if (location.hash === hash) route(); else location.hash = hash;
}

async function route() {
  const opts = routeOpts; routeOpts = {};
  Sheet.close();
  if (Engine.recording) await finishRecording();
  if (Engine.playing) await stopAll();
  if (current && saveTimer) await save(true); // nur ungespeicherte Änderungen sichern
  audioUIs.clear();
  const m = location.hash.match(/^#\/song\/(.+)$/);
  window.scrollTo(0, 0);
  if (m) await renderSong(m[1], opts);
  else { current = null; await renderHome(); }
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.hidden && current && saveTimer) save(true); });
window.addEventListener('resize', () => document.querySelectorAll('textarea.free, textarea.lyrics-edit').forEach(autoGrow));

Sync.init().catch((e) => console.warn(e));

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

route();
