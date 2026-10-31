'use strict';

/* =========================================================
   Cloud-Sync über Supabase
   - Songs: Tabelle "songs" (eine Zeile pro Song, Inhalt als JSON)
   - Aufnahmen: privater Storage-Bucket "audio", Pfad <user-id>/<audio-id>.mp3 (ältere Aufnahmen .wav)
   - Konflikte: pro Song gewinnt die neuere Änderung (updatedAt)
   Die App funktioniert ohne Sync ganz normal; Sync läuft im Hintergrund.
   ========================================================= */

const Sync = {
  client: null,
  user: null,
  state: 'off', // off | idle | syncing | ok | error | offline
  lastSync: 0,
  lastError: '',
  indicators: new Set(),
  _timer: null,
  _running: false,
  _again: false,

  config() {
    const def = window.SONGWRITER_CONFIG || {};
    return { url: Settings.get('sbUrl', def.supabaseUrl || ''), key: Settings.get('sbKey', def.supabaseAnonKey || '') };
  },
  configured() { return !!this.client; },

  async init() {
    const { url, key } = this.config();
    if (!url || !key || !window.supabase) { this.setState('off'); return; }
    try {
      this.client = window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sw.auth' },
      });
    } catch (e) {
      this.client = null; this.lastError = e.message; this.setState('error'); return;
    }
    const { data } = await this.client.auth.getSession();
    this.user = data.session?.user || null;
    this.client.auth.onAuthStateChange((_ev, session) => {
      const was = this.user?.id;
      this.user = session?.user || null;
      this.setState(this.user ? 'idle' : 'off');
      if (this.user && this.user.id !== was) this.schedule(0);
    });
    this.setState(this.user ? 'idle' : 'off');
    if (this.user) this.schedule(0);
  },

  async setConfig(url, key) {
    Settings.set('sbUrl', url);
    Settings.set('sbKey', key);
    this.client = null; this.user = null;
    await this.init();
    if (url && !this.client) toast('Verbindung fehlgeschlagen – URL prüfen', 3500);
  },

  async signUp(email, password) {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.session) return 'Konto erstellt. Bitte den Link in der Bestätigungs-Mail öffnen, dann hier anmelden.';
    return 'Konto erstellt und angemeldet';
  },
  async signIn(email, password) {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-Mail oder Passwort falsch' : error.message);
    return 'Angemeldet – Synchronisation läuft';
  },
  async signOut() {
    await this.client.auth.signOut();
    this.user = null;
    this.setState('off');
  },

  schedule(ms = 2500) {
    if (!this.client || !this.user) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.run(), ms);
  },

  async run() {
    if (!this.client || !this.user) return;
    if (!navigator.onLine) { this.setState('offline'); return; }
    if (this._running) { this._again = true; return; }
    this._running = true;
    this.setState('syncing');
    try {
      const changed = await this.syncOnce();
      this.lastSync = Date.now();
      this.lastError = '';
      this.setState('ok');
      if (changed) onRemoteChanges(changed);
    } catch (e) {
      console.warn('Sync-Fehler', e);
      this.lastError = e.message || String(e);
      this.setState('error');
    }
    this._running = false;
    if (this._again) { this._again = false; this.schedule(300); }
  },

  path(audioId, format) { return `${this.user.id}/${audioId}.${format || 'wav'}`; },

  // Ein kompletter Abgleich. Gibt die IDs lokal geänderter Songs zurück.
  async syncOnce() {
    const db = this.client;
    const { data: remote, error } = await db.from('songs').select('id, updated_at, deleted');
    if (error) throw error;
    const rmap = new Map(remote.map((r) => [r.id, r]));
    const locals = await DB.allSongs();
    const lmap = new Map(locals.map((s) => [s.id, s]));
    const tombs = await DB.allTombs();
    const tmap = new Map(tombs.map((t) => [t.id, t]));
    const changed = new Set();

    // 1) Lokale Löschungen hochladen
    for (const t of tombs) {
      const r = rmap.get(t.id);
      if (r && !r.deleted && t.deletedAt >= r.updated_at) {
        const { error: e } = await db.from('songs').upsert({ id: t.id, data: null, updated_at: t.deletedAt, deleted: true });
        if (e) throw e;
        rmap.set(t.id, { id: t.id, updated_at: t.deletedAt, deleted: true });
      }
      await DB.deleteTomb(t.id);
    }

    // 2) Lokale Änderungen hochladen (erst Audio, dann Song)
    for (const s of locals) {
      const r = rmap.get(s.id);
      if (r && r.updated_at >= s.updatedAt) continue;
      await this.uploadAudioOf(s);
      const data = JSON.parse(JSON.stringify(s, (k, v) => (k.startsWith('_') ? undefined : v)));
      const { error: e } = await db.from('songs').upsert({ id: s.id, data, updated_at: s.updatedAt, deleted: false });
      if (e) throw e;
    }

    // 3) Neuere Stände vom Server holen
    const need = [];
    for (const r of remote) {
      const l = lmap.get(r.id);
      if (r.deleted) {
        if (l && l.updatedAt <= r.updated_at) { await DB.deleteSong(r.id); changed.add(r.id); }
        continue;
      }
      const t = tmap.get(r.id);
      if (t && t.deletedAt >= r.updated_at) continue;
      if (!l || r.updated_at > l.updatedAt) need.push(r.id);
    }
    for (let i = 0; i < need.length; i += 50) {
      const { data: rows, error: e } = await db.from('songs').select('id, data, updated_at').in('id', need.slice(i, i + 50));
      if (e) throw e;
      for (const row of rows) {
        if (!row.data) continue;
        row.data.updatedAt = row.updated_at;
        await DB.putSong(row.data);
        changed.add(row.id);
      }
    }

    // 4) Fehlende Aufnahmen herunterladen, nicht mehr benutzte lokal aufräumen
    const all = await DB.allSongs();
    const used = new Map(); // audioId -> Format
    for (const s of all) for (const b of s.blocks) if (b.type === 'audio') for (const t of b.tracks) used.set(t.audioId, t.format || 'wav');
    for (const [id, format] of used) {
      if (await DB.getAudio(id)) continue;
      const { data: blob, error: e } = await db.storage.from('audio').download(this.path(id, format));
      if (e || !blob) continue; // evtl. noch nicht hochgeladen – beim nächsten Mal
      await DB.putAudio({ id, blob: new Blob([blob], { type: AUDIO_MIME[format] }), format, uploaded: true, createdAt: Date.now() });
    }
    const audioIds = await DB.allAudioIds();
    for (const id of audioIds) {
      if (used.has(id)) continue;
      const rec = await DB.getAudio(id);
      if (rec && Date.now() - (rec.createdAt || 0) > 60 * 60 * 1000) await DB.deleteAudio(id);
    }

    return changed.size ? changed : null;
  },

  async uploadAudioOf(song) {
    for (const b of song.blocks) {
      if (b.type !== 'audio') continue;
      for (const t of b.tracks) {
        const rec = await DB.getAudio(t.audioId);
        if (!rec || rec.uploaded) continue;
        const { error } = await this.client.storage.from('audio').upload(this.path(t.audioId, t.format), rec.blob, { upsert: true, contentType: AUDIO_MIME[t.format || 'wav'] });
        if (error) throw error;
        await DB.putAudio({ ...rec, uploaded: true });
      }
    }
  },

  removeAudio(audioId, format) {
    if (!this.client || !this.user || !navigator.onLine) return;
    this.client.storage.from('audio').remove([this.path(audioId, format)]).catch(() => {});
  },

  setState(s) {
    this.state = s;
    for (const el of [...this.indicators]) {
      if (!document.body.contains(el)) { this.indicators.delete(el); continue; }
      this.paint(el);
    }
  },

  paint(el) {
    const map = {
      off: ['', '☁︎', 'Sync aus'],
      idle: ['', '☁︎', 'Sync bereit'],
      syncing: ['busy', '↻', 'Synchronisiere…'],
      ok: ['ok', '☁︎', 'Synchronisiert'],
      error: ['err', '⚠︎', 'Sync-Fehler'],
      offline: ['off', '☁︎', 'Offline'],
    };
    const [cls, icon, label] = map[this.state] || map.off;
    el.className = 'icon-btn sync-ind ' + cls + (this.client && this.user ? '' : ' dim');
    el.textContent = icon;
    el.title = label;
    el.setAttribute('aria-label', label);
  },

  statusText() {
    if (this.state === 'error') return 'Letzter Fehler: ' + this.lastError;
    if (this.state === 'offline') return 'Gerade offline – wird nachgeholt.';
    if (this.lastSync) return 'Zuletzt synchronisiert: ' + new Date(this.lastSync).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    return '';
  },
};

window.addEventListener('online', () => Sync.schedule(500));
window.addEventListener('offline', () => Sync.client && Sync.user && Sync.setState('offline'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) Sync.schedule(300); });
