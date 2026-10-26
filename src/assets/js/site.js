(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sticky nav hairline
  const nav = document.querySelector('.nav');
  const onScroll = () => nav && nav.classList.toggle('is-stuck', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Reveal on scroll, staggered among siblings
  const items = [...document.querySelectorAll('[data-reveal]')];
  items.forEach((el) => {
    const sibs = [...el.parentElement.children].filter((c) => c.hasAttribute('data-reveal'));
    el.style.setProperty('--i', Math.min(sibs.indexOf(el), 6));
  });
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add('is-in'));
  }

  // Hero: a 6:47 voice note collapses into three lines
  const stage = document.querySelector('[data-hero]');
  if (!stage) return;
  const count = stage.querySelector('[data-count]');
  const typed = stage.querySelector('[data-type]');
  const fullText = typed.textContent.trim();
  const note = stage.querySelector('.float--note');
  const vn = stage.querySelector('.phone__vn');
  let timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  function finalState() {
    stage.className = stage.className.replace(/\bs\d\b/g, '').trim() + ' s0 s3 s4 s5';
    typed.textContent = fullText;
    count.textContent = '6:47';
  }

  function run() {
    timers.forEach(clearTimeout); timers = [];
    if (reduce) { finalState(); return; }
    stage.classList.remove('s0', 's2', 's3', 's4', 's5');
    typed.textContent = '';
    count.textContent = '0:00';
    requestAnimationFrame(() => stage.classList.add('s0'));
    // Play the note: timer runs fast to 6:47
    at(500, () => {
      note.classList.add('is-playing'); vn.classList.add('is-playing');
      const t0 = performance.now(), dur = 1500, total = 407;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        count.textContent = fmt(total * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    at(2100, () => { stage.classList.add('s2'); });
    at(3300, () => {
      stage.classList.remove('s2'); stage.classList.add('s3');
      note.classList.remove('is-playing'); vn.classList.remove('is-playing');
      // Type the Roman Urdu summary
      typed.innerHTML = '<span></span><i class="caret"></i>';
      const span = typed.firstChild; let i = 0;
      const step = () => {
        span.textContent = fullText.slice(0, ++i);
        if (i < fullText.length) timers.push(setTimeout(step, 22 + Math.random() * 30));
        else timers.push(setTimeout(() => { typed.textContent = fullText; }, 1400));
      };
      timers.push(setTimeout(step, 400));
    });
    at(4700, () => stage.classList.add('s4'));
    at(5600, () => stage.classList.add('s5'));
  }

  // Start when the stage is on screen; click to replay
  if ('IntersectionObserver' in window) {
    const once = new IntersectionObserver((e) => { if (e[0].isIntersecting) { run(); once.disconnect(); } }, { threshold: 0.25 });
    once.observe(stage);
  } else run();
  stage.addEventListener('click', run);
})();
