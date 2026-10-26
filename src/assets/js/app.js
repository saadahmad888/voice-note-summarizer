(() => {
  const C = window.VNS || { apiBase: '', native: false };
  const API = C.apiBase || '';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jobsEl = $('#jobs'), emptyEl = $('#empty'), tpl = $('#job-tpl');
  const cap = window.capacitorExports;
  const isNative = !!(C.native && cap && cap.Capacitor && cap.Capacitor.isNativePlatform());

  // ---------- Settings (remembered on this device) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('vns:' + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('vns:' + k, v); } catch {} },
  };
  for (const id of ['outLang', 'inLang', 'sender']) {
    const el = $('#' + id);
    el.value = store.get(id, el.value);
    el.addEventListener('change', () => store.set(id, el.value));
  }
  const settings = () => ({ outLang: $('#outLang').value, inLang: $('#inLang').value, sender: $('#sender').value.trim() });

  // ---------- Toast + clipboard ----------
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('is-on'), 2200);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { ta.remove(); }
    }
    toast('Copied');
  }
  const waLink = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

  // ---------- Queue ----------
  const queue = [];
  let busy = false;
  function addFiles(list) {
    const files = [...list].filter((f) => f && f.size > 0);
    if (!files.length) return;
    for (const file of files) {
      const job = makeJob(file.name || 'Voice note');
      job.file = file;
      queue.push(job);
      setStatus(job, 'Waiting…', 0);
    }
    pump();
  }
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const job = queue.shift();
      if (!job.el.isConnected) continue;
      await run(job);
    }
    busy = false;
  }

  function makeJob(name) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    $('.job__name', el).textContent = prettyName(name);
    $('.job__x', el).addEventListener('click', () => { el.remove(); syncEmpty(); });
    jobsEl.prepend(el);
    syncEmpty();
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return { el, name };
  }
  function prettyName(n) {
    if (/^PTT-\d{8}-WA\d+/i.test(n) || /^AUD-\d{8}/i.test(n)) return 'WhatsApp voice note';
    return n.replace(/\.(opus|ogg|oga|m4a|mp3|wav|aac|amr|webm|3gp|mp4)$/i, '');
  }
  function syncEmpty() { emptyEl.hidden = jobsEl.children.length > 0; }
  function setStatus(job, text, pct) {
    $('.job__status', job.el).textContent = text;
    const bar = $('.job__progress', job.el);
    if (pct != null) { bar.firstElementChild.style.width = pct + '%'; bar.setAttribute('aria-valuenow', Math.round(pct)); }
  }

  // ---------- Network ----------
  async function post(path, body, headers, tries = 3) {
    let lastErr;
    for (let a = 0; a < tries; a++) {
      try {
        const res = await fetch(API + path, { method: 'POST', body, headers });
        const data = await res.json().catch(() => ({}));
        if (res.ok) return data;
        const err = new Error(data.error || `Server said ${res.status}`);
        err.status = res.status;
        if (res.status === 413 || res.status === 400 || res.status === 415) throw err; // won't fix itself
        lastErr = err;
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 429) throw e;
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
    }
    throw lastErr;
  }
  function explain(e) {
    if (!navigator.onLine) return 'You are offline. Connect to the internet and tap Try again.';
    if (e && e.status === 429) return 'Too many notes right now. Wait a minute, then tap Try again.';
    if (e && e.status === 413) return 'This note is too large. Notes up to 30 minutes work.';
    if (e && e.code === 'decode') return 'This file could not be read as audio. Share the voice note itself, not a link or document.';
    if (e && /Failed to fetch|NetworkError|Load failed/i.test(e.message)) return 'Could not reach the summarizer. Check your internet and tap Try again.';
    return (e && e.message) || 'Something went wrong. Tap Try again.';
  }

  // ---------- Pipeline ----------
  async function run(job) {
    const el = job.el;
    el.classList.remove('is-error', 'is-done');
    el.classList.add('is-working');
    $('.job__body', el).innerHTML = '';
    const opts = settings();
    try {
      setStatus(job, 'Reading the audio…', 4);
      let prepared;
      try { prepared = await window.VNSAudio.prepare(job.file); }
      catch (err) {
        // Browser can't decode this format: send the original file if it's small enough.
        if (job.file.size > 20 * 1024 * 1024) { const e = new Error('decode'); e.code = 'decode'; throw e; }
        prepared = { chunks: [job.file], seconds: 0, raw: true };
      }
      const { chunks, seconds } = prepared;
      if (seconds) $('.job__name', el).innerHTML = `${esc(prettyName(job.name))}<span class="badge">${window.VNSAudio.fmt(seconds)}</span>`;

      // Up to 3 chunks at a time, results kept in order
      const parts = new Array(chunks.length).fill('');
      const q = new URLSearchParams();
      if (opts.inLang) q.set('lang', opts.inLang);
      let next = 0, done = 0;
      const label = () => (chunks.length > 1 ? `Listening… part ${Math.min(done + 1, chunks.length)} of ${chunks.length}` : 'Listening…');
      setStatus(job, label(), 8);
      const worker = async () => {
        while (next < chunks.length) {
          const i = next++;
          const data = await post(`/api/transcribe?${q}`, chunks[i], { 'Content-Type': chunks[i].type || 'application/octet-stream' });
          parts[i] = (data.text || '').trim();
          done++;
          setStatus(job, label(), 8 + (76 * done) / chunks.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
      const transcript = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (transcript.length < 3) throw new Error('No speech was found in this note. Is it the right file?');

      setStatus(job, 'Writing three lines…', 86);
      const sum = await post('/api/summarize', JSON.stringify({ transcript, output: opts.outLang, sender: opts.sender, seconds }), { 'Content-Type': 'application/json' });
      setStatus(job, prepared.trimmed ? 'Done — first 30 minutes summarized' : 'Done', 100);
      el.classList.remove('is-working'); el.classList.add('is-done');
      render(job, { ...sum, transcript }, opts);
    } catch (e) {
      el.classList.remove('is-working'); el.classList.add('is-error');
      setStatus(job, 'Could not summarize');
      const body = $('.job__body', el);
      body.innerHTML = `<div class="job__err"><p>${esc(explain(e))}</p><button class="btn btn--soft" type="button">Try again</button></div>`;
      $('button', body).addEventListener('click', () => { queue.push(job); pump(); });
    }
  }

  // ---------- Result ----------
  const waIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8 0-1.4.7-2 1-2.3.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.2.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.7-.1 1.4Z"/></svg>';

  function render(job, r, opts) {
    const body = $('.job__body', job.el);
    const urduLines = opts.outLang === 'urdu';
    const lines = (r.summary || []).slice(0, 3);
    const facts = [];
    const d = r.details || {};
    if (d.when && d.when.length) facts.push(['When', d.when.join(', ')]);
    if (d.where && d.where.length) facts.push(['Where', d.where.join(', ')]);
    if (d.who_brings_what && d.who_brings_what.length) facts.push(['Who brings what', d.who_brings_what.map((x) => (x.who ? `${x.who}: ${x.what}` : x.what)).join('; ')]);
    if (d.to_do && d.to_do.length) facts.push(['To do', d.to_do.join('; ')]);
    const replies = (r.replies || []).slice(0, 3);
    const shareText = `${r.title ? r.title + '\n' : ''}${lines.map((l) => '• ' + l).join('\n')}${r.roman_urdu ? '\n\n' + r.roman_urdu : ''}`;

    body.innerHTML = `
      <p class="sum__h"><span class="spark" aria-hidden="true"></span>Summary, ${lines.length} line${lines.length === 1 ? '' : 's'}</p>
      ${r.title ? `<p class="sum__title">${esc(r.title)}</p>` : ''}
      <ul class="sum__lines"${urduLines ? ' lang="ur" dir="rtl" style="font-family:var(--urdu);line-height:2.1"' : ''}>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      ${r.roman_urdu ? `<p class="sum__ru"><small>Roman Urdu</small>${esc(r.roman_urdu)}</p>` : ''}
      ${facts.length ? `<dl class="sum__facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${replies.length ? `<div class="sum__replies"><p>Reply in WhatsApp</p><div class="chips">${replies.map((t) => `<a class="chip" href="${waLink(t)}" target="_blank" rel="noopener">${waIcon}${esc(t)}</a>`).join('')}</div></div>` : ''}
      <div class="sum__actions">
        <button class="btn btn--ink" type="button" data-act="copy">Copy summary</button>
        <button class="btn btn--ghost" type="button" data-act="share">Share summary</button>
      </div>
      ${r.transcript ? `<details class="sum__tx"><summary>Full transcript</summary><p>${esc(r.transcript)}</p><div class="sum__actions"><button class="btn btn--soft" type="button" data-act="copy-tx">Copy transcript</button></div></details>` : ''}`;

    body.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'copy') copy(shareText);
      if (act === 'copy-tx') copy(r.transcript);
      if (act === 'share') {
        if (navigator.share && !isNative) { try { await navigator.share({ text: shareText }); } catch {} }
        else window.open(waLink(shareText), '_blank');
      }
    });
  }

  // ---------- Sample ----------
  const SAMPLE = {
    title: 'Shaadi on Friday — bring one dish',
    summary: ['Shaadi is on Friday at the Model Town hall, Lahore.', 'Every household brings one dish. Baji makes biryani.', "Khala's train arrives at 4 pm. Someone must pick her up."],
    roman_urdu: 'Shaadi Friday ko, Model Town hall mein. Sab ek dish laayein, Baji biryani. Khala ko 4 baje station se pick karna hai.',
    details: { when: ['Friday', '4 pm (train)'], where: ['Model Town hall, Lahore', 'Railway station'], who_brings_what: [{ who: 'Baji', what: 'biryani' }, { who: 'Everyone else', what: 'one dish each' }], to_do: ['Pick Khala up from the station at 4 pm'] },
    replies: ['Ji Khala, done', 'Main station aa jaunga', 'Hum kheer le aayenge'],
    transcript: 'Assalam o alaikum sab ko… haan to main ye keh rahi thi ke Friday ko shaadi hai, Lahore mein, Model Town wale hall mein. Aur dekho, I don\'t want ke sab log khaali haath aa jayen, har ghar se ek dish aani chahiye… Baji tum biryani bana lena, tumhari biryani sab ko pasand hai… aur haan, meri train chaar baje pohnchegi station pe, koi mujhe lene aa jaye…',
  };
  function showSample() {
    const job = makeJob('Sample: Khala’s voice note');
    $('.job__name', job.el).innerHTML = `Sample: Khala’s voice note<span class="badge">6:47</span>`;
    setStatus(job, 'Sample, no audio uploaded', 100);
    job.el.classList.add('is-done');
    render(job, SAMPLE, { outLang: 'both' });
  }
  $('#sample').addEventListener('click', showSample);
  if (new URLSearchParams(location.search).has('sample')) showSample();

  // ---------- Picking files ----------
  const input = $('#file');
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => { e.preventDefault(); if (e.target.closest && !e.target.closest('#drop')) addFiles(e.dataTransfer.files); });

  // ---------- Android app: voice notes shared from WhatsApp ----------
  if (isNative) {
    const Share = cap.registerPlugin('ShareReceiver');
    const pull = async () => {
      try {
        const res = await Share.getShared();
        const files = (res && res.files) || [];
        const loaded = [];
        for (const f of files) {
          const url = cap.Capacitor.convertFileSrc('file://' + f.path);
          const blob = await (await fetch(url)).blob();
          loaded.push(new File([blob], f.name || 'Voice note', { type: f.mimeType || blob.type || 'audio/ogg' }));
        }
        if (loaded.length) addFiles(loaded);
      } catch (e) { console.warn('share receive failed', e); }
    };
    Share.addListener('shared', pull);
    pull();
  }

  // ---------- Installed web app: Web Share Target ----------
  if (!isNative && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  const params = new URLSearchParams(location.search);
  if (params.has('shared') && 'caches' in window) {
    (async () => {
      const cache = await caches.open('vns-shared');
      const keys = await cache.keys();
      const files = [];
      for (const req of keys) {
        const res = await cache.match(req);
        const blob = await res.blob();
        files.push(new File([blob], decodeURIComponent(res.headers.get('x-name') || 'Voice note'), { type: blob.type }));
        await cache.delete(req);
      }
      history.replaceState(null, '', '/app/');
      if (files.length) addFiles(files); else toast('Nothing was shared. Pick the voice note instead.');
    })();
  }

  syncEmpty();
})();
