// Turns any voice note the browser can decode into small 16 kHz mono WAV chunks.
// 16 kHz mono is what speech recognition uses anyway, so this shrinks uploads ~5x
// and lets very long notes go up in pieces.
window.VNSAudio = (() => {
  const RATE = 16000;
  const CHUNK_SECONDS = 60;    // ~1.9 MB per chunk (Cloudflare recommends small chunks)
  const MAX_SECONDS = 30 * 60; // 30 minutes per note

  function decode(ctx, buf) {
    return new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  async function decodeToMono16k(arrayBuffer) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) throw new Error('no-webaudio');
    let ctx;
    try { ctx = new Offline(1, 1, RATE); }           // decodes straight to 16 kHz
    catch { ctx = new Offline(1, 1, 44100); }        // older Safari: min 22.05 kHz
    const audio = await decode(ctx, arrayBuffer.slice(0));
    const n = audio.length, ch = audio.numberOfChannels;
    let mono;
    if (ch === 1) mono = audio.getChannelData(0);
    else {
      mono = new Float32Array(n);
      for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / ch; }
    }
    if (audio.sampleRate !== RATE) mono = resample(mono, audio.sampleRate, RATE);
    return mono;
  }

  function resample(input, from, to) {
    const ratio = from / to, outLen = Math.floor(input.length / ratio), out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio), end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = start; j < end; j++) sum += input[j];
      out[i] = sum / Math.max(1, end - start);
    }
    return out;
  }

  // Gentle loudness normalisation helps quiet phone recordings.
  function normalise(pcm) {
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 4) { const v = Math.abs(pcm[i]); if (v > peak) peak = v; }
    if (peak > 0 && peak < 0.5) { const g = Math.min(4, 0.9 / peak); for (let i = 0; i < pcm.length; i++) pcm[i] *= g; }
    return pcm;
  }

  function toWav(pcm) {
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0, o = 44; i < pcm.length; i++, o += 2) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // Split at the quietest moment near each chunk boundary so words aren't cut in half.
  function cutPoints(pcm) {
    const size = CHUNK_SECONDS * RATE, win = 3 * RATE, frame = RATE / 50; // 20 ms frames
    const cuts = [0];
    let pos = size;
    while (pos < pcm.length - RATE * 5) {
      let best = pos, bestE = Infinity;
      for (let f = pos - win; f < pos + win - frame; f += frame) {
        let e = 0; for (let i = f; i < f + frame; i += 2) e += pcm[i] * pcm[i];
        if (e < bestE) { bestE = e; best = f; }
      }
      cuts.push(best); pos = best + size;
    }
    cuts.push(pcm.length);
    return cuts;
  }

  async function prepare(file) {
    const ab = await file.arrayBuffer();
    let pcm = normalise(await decodeToMono16k(ab));
    const fullSeconds = pcm.length / RATE;
    let trimmed = false;
    if (fullSeconds > MAX_SECONDS) { pcm = pcm.subarray(0, MAX_SECONDS * RATE); trimmed = true; }
    const cuts = cutPoints(pcm), chunks = [];
    for (let i = 0; i < cuts.length - 1; i++) chunks.push(toWav(pcm.subarray(cuts[i], cuts[i + 1])));
    return { chunks, seconds: Math.min(fullSeconds, MAX_SECONDS), fullSeconds, trimmed };
  }

  const fmt = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  return { prepare, fmt, MAX_SECONDS };
})();
