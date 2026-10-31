// Wandelt Aufnahmen im Hintergrund in MP3 um (ca. 10x kleiner als WAV).
importScripts('vendor/lame.min.js');

onmessage = (e) => {
  const { channels, sampleRate, kbps } = e.data;
  try {
    const enc = new lamejs.Mp3Encoder(channels.length, sampleRate, kbps);
    const toInt16 = (f) => {
      const out = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      return out;
    };
    const pcm = channels.map(toInt16);
    const parts = [];
    const step = 1152 * 10;
    for (let i = 0; i < pcm[0].length; i += step) {
      const l = pcm[0].subarray(i, i + step);
      const buf = pcm.length > 1 ? enc.encodeBuffer(l, pcm[1].subarray(i, i + step)) : enc.encodeBuffer(l);
      if (buf.length) parts.push(new Uint8Array(buf));
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    postMessage({ ok: true, blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err) {
    postMessage({ ok: false, error: String(err && err.message || err) });
  }
};
