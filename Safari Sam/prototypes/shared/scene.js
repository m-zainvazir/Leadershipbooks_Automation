/* Safari Sam — the inside of a gate. Shared by all three main-world prototypes.
   SafariScene.open(worldId, { onClose }) fills the screen with that place; "Leave" closes it.
   Home and Zoo are hand-built scenes; every other place is built from its creature list. */
(function () {
  const DATA = window.SAFARI;
  const FACTS = window.SAFARI_FACTS || {};
  const worldById = (id) => DATA.worlds.find((w) => w.id === id);
  const hoodById = (id) => DATA.hoods.find((h) => h.id === id);

  const SAM_SVG = `<svg class="sam-svg" viewBox="0 0 120 150" aria-hidden="true">
    <path d="M26 150 Q28 106 60 102 Q92 106 94 150 Z" fill="#c9a46a" stroke="#2b2118" stroke-width="3"/>
    <path d="M44 150 L50 112 M76 150 L70 112" stroke="#a9874f" stroke-width="3"/>
    <rect x="52" y="92" width="16" height="16" rx="6" fill="#e8b386"/>
    <path d="M46 104 L60 124 L74 104 Z" fill="#d94f3d" stroke="#2b2118" stroke-width="2.5" stroke-linejoin="round"/>
    <ellipse cx="31" cy="74" rx="6" ry="8" fill="#e8b386" stroke="#2b2118" stroke-width="2.5"/>
    <ellipse cx="89" cy="74" rx="6" ry="8" fill="#e8b386" stroke="#2b2118" stroke-width="2.5"/>
    <circle cx="60" cy="70" r="29" fill="#f1c194" stroke="#2b2118" stroke-width="3"/>
    <circle cx="49" cy="72" r="4.2" fill="#2b2118"/><circle cx="71" cy="72" r="4.2" fill="#2b2118"/>
    <circle cx="50.6" cy="70.4" r="1.5" fill="#fff"/><circle cx="72.6" cy="70.4" r="1.5" fill="#fff"/>
    <circle cx="41" cy="82" r="5" fill="#f08f7d" opacity=".55"/><circle cx="79" cy="82" r="5" fill="#f08f7d" opacity=".55"/>
    <path d="M50 84 Q60 94 70 84" stroke="#7a3b2a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    <ellipse cx="60" cy="50" rx="48" ry="9.5" fill="#b58f52" stroke="#2b2118" stroke-width="3"/>
    <path d="M25 50 Q26 12 60 12 Q94 12 95 50 Z" fill="#e2c486" stroke="#2b2118" stroke-width="3" stroke-linejoin="round"/>
    <path d="M26.5 41 Q60 47 93.5 41 L94.6 48 Q60 54 25.4 48 Z" fill="#7a5a2e"/>
    <circle cx="60" cy="12" r="4" fill="#b58f52" stroke="#2b2118" stroke-width="2.5"/>
  </svg>`;

  // ---------- small helpers ----------
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function at(node, x, y) { node.style.left = x + '%'; node.style.top = y + '%'; return node; }
  function box(parent, cls, x, y, w, h, html) {
    const b = el('div', cls, html);
    Object.assign(b.style, { left: x + '%', top: y + '%', width: w + '%', height: h + '%' });
    parent.appendChild(b);
    return b;
  }
  function prop(parent, emoji, x, y, s, cls) {
    const p = at(el('span', 'ss-prop' + (cls ? ' ' + cls : ''), emoji), x, y);
    p.style.setProperty('--s', s || 1);
    p.setAttribute('aria-hidden', 'true');
    parent.appendChild(p);
    return p;
  }
  // Same "random" layout every visit to a place.
  function seeded(text) {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return () => {
      h += 0x6d2b79f5;
      let t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sprinkle(parent, cls, n, rnd, area = [0, 100, 0, 100]) {
    for (let i = 0; i < n; i++) {
      const d = at(el('i', cls), area[0] + rnd() * (area[1] - area[0]), area[2] + rnd() * (area[3] - area[2]));
      d.style.setProperty('--r', rnd().toFixed(3));
      d.style.animationDelay = (-rnd() * 12).toFixed(2) + 's';
      parent.appendChild(d);
    }
  }

  // ---------- state ----------
  let cur = null; // { root, world, card, bubble, cleanups[], onClose, returnFocus }

  function critter(parent, c, x, y, opt = {}) {
    const b = at(el('button', 'ss-critter' + (c.z === 'air' ? ' air' : '') + (opt.cls ? ' ' + opt.cls : '')), x, y);
    b.type = 'button';
    b.style.setProperty('--s', opt.s != null ? opt.s : (c.s || 1));
    b.style.setProperty('--d', (-(x * 7 + y * 3) % 30 / 10).toFixed(2) + 's');
    b.setAttribute('aria-label', c.n);
    b.innerHTML = `<span class="ss-emoji" aria-hidden="true">${c.e}</span><span class="ss-tag">${c.n}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); meet(c, b); });
    parent.appendChild(b);
    return b;
  }

  // ---------- open / close ----------
  function open(id, opts = {}) {
    const w = worldById(id);
    if (!w || cur) return;
    const hood = hoodById(w.hood);
    const root = el('div', 'ss');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', w.name);
    root.style.setProperty('--hood', hood.color);
    root.innerHTML = `
      <header class="ss-top">
        <button type="button" class="ss-leave"><span class="ss-leave-icon" aria-hidden="true">🚪</span><span>Leave</span></button>
        <div class="ss-title"><span class="ss-title-icon" aria-hidden="true">${w.icon}</span><span>${w.name}</span></div>
        <div class="ss-hood">${hood.name}</div>
      </header>
      <div class="ss-stage"><div class="ss-canvas"></div></div>
      <div class="ss-sam"><button type="button" class="ss-sam-btn" aria-label="Safari Sam">${SAM_SVG}</button><div class="ss-bubble" aria-live="polite"></div></div>
      <div class="ss-card" role="region" aria-label="Creature card" hidden>
        <button type="button" class="ss-card-x" aria-label="Close card">✕</button>
        <div class="ss-card-pic" aria-hidden="true"></div>
        <div class="ss-card-body">
          <h2 class="ss-card-name"></h2>
          <p class="ss-card-q"></p>
          <p class="ss-card-a"></p>
          <div class="ss-card-end">
            <button type="button" class="ss-why">Why did God do that?</button>
            <p class="ss-liked" hidden>Because He liked it!</p>
          </div>
          <p class="ss-card-src">Sample fact from the <i>Because He Liked It!</i> notes</p>
        </div>
      </div>`;
    document.body.appendChild(root);

    const stage = root.querySelector('.ss-stage');
    const canvas = root.querySelector('.ss-canvas');
    cur = {
      root, world: w, stage, canvas,
      card: root.querySelector('.ss-card'),
      bubble: root.querySelector('.ss-bubble'),
      cleanups: [], timers: [],
      onClose: opts.onClose,
      returnFocus: document.activeElement
    };

    (BUILDERS[w.scene] || buildQuick)(w, canvas);
    wireStage(stage, root);

    root.querySelector('.ss-leave').addEventListener('click', close);
    root.querySelector('.ss-sam-btn').addEventListener('click', () => say(w.greet, 6000));
    root.querySelector('.ss-card-x').addEventListener('click', hideCard);
    root.querySelector('.ss-why').addEventListener('click', liked);
    stage.addEventListener('click', hideCard);
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (!cur.card.hidden) hideCard(); else close();
    };
    document.addEventListener('keydown', onKey);
    cur.cleanups.push(() => document.removeEventListener('keydown', onKey));

    root.querySelector('.ss-leave').focus({ preventScroll: true });
    cur.timers.push(setTimeout(() => say(w.greet, 7000), 450));
  }

  function close() {
    if (!cur || cur.closing) return;
    const c = cur;
    c.closing = true;
    c.cleanups.forEach((fn) => fn());
    c.timers.forEach(clearTimeout);
    c.root.classList.add('leaving');
    setTimeout(() => {
      c.root.remove();
      cur = null;
      if (c.returnFocus && c.returnFocus.focus) c.returnFocus.focus({ preventScroll: true });
      if (c.onClose) c.onClose(c.world.id);
    }, 320);
  }

  function say(text, ms) {
    if (!cur) return;
    const b = cur.bubble;
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(cur.sayTimer);
    cur.sayTimer = setTimeout(() => b.classList.remove('show'), ms || 5000);
  }

  // ---------- the creature card ----------
  function meet(c, btn) {
    btn.classList.remove('boing');
    void btn.offsetWidth;
    btn.classList.add('boing', 'met');
    const f = FACTS[c.k] || { q: 'What makes it special?', a: 'Its page is coming soon.' };
    const card = cur.card;
    card.querySelector('.ss-card-pic').textContent = c.e;
    card.querySelector('.ss-card-name').textContent = c.n;
    card.querySelector('.ss-card-q').textContent = f.q;
    card.querySelector('.ss-card-a').textContent = f.a;
    card.querySelector('.ss-why').hidden = false;
    card.querySelector('.ss-liked').hidden = true;
    card.hidden = false;
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    cur.bubble.classList.remove('show');
  }
  function hideCard() { if (cur) cur.card.hidden = true; }
  function liked(e) {
    e.stopPropagation();
    const card = cur.card;
    card.querySelector('.ss-why').hidden = true;
    const out = card.querySelector('.ss-liked');
    out.hidden = false;
    const end = card.querySelector('.ss-card-end');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const s = el('span', 'ss-spark', i % 2 ? '⭐' : '✨');
      s.style.setProperty('--dx', Math.cos(a) * (70 + (i % 3) * 30) + 'px');
      s.style.setProperty('--dy', Math.sin(a) * (45 + (i % 3) * 20) + 'px');
      end.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  // ---------- wide scenes: arrows and mouse wheel ----------
  function wireStage(stage, root) {
    const l = el('button', 'ss-nav l', '◀');
    const r = el('button', 'ss-nav r', '▶');
    l.type = r.type = 'button';
    l.setAttribute('aria-label', 'Look left');
    r.setAttribute('aria-label', 'Look right');
    root.append(l, r);
    const update = () => {
      const max = stage.scrollWidth - stage.clientWidth;
      l.hidden = stage.scrollLeft < 8;
      r.hidden = max < 8 || stage.scrollLeft > max - 8;
    };
    const step = (dir) => (e) => {
      e.stopPropagation();
      stage.scrollBy({ left: dir * stage.clientWidth * 0.7, behavior: 'smooth' });
    };
    l.addEventListener('click', step(-1));
    r.addEventListener('click', step(1));
    stage.addEventListener('scroll', () => { update(); cur.bubble.classList.remove('show'); }, { passive: true });
    stage.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && stage.scrollWidth > stage.clientWidth) {
        stage.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
    window.addEventListener('resize', update);
    cur.cleanups.push(() => window.removeEventListener('resize', update));
    requestAnimationFrame(update);
  }

  // ---------- Home: a doll's house cut open ----------
  function buildHome(w, cv) {
    const C = (k) => w.creatures.find((c) => c.k === k);
    cv.classList.add('ss-home');
    cv.style.setProperty('--ar', 1.75);
    cv.append(el('div', 'ss-sun'));
    prop(cv, '☁️', 74, 16, 1.2, 'ss-cloud');
    prop(cv, '☁️', 92, 30, 0.8, 'ss-cloud slow');
    box(cv, 'h-grass', 0, 86, 100, 14);

    box(cv, 'h-chimney', 48, 5, 4, 12);
    box(cv, 'h-roof', 3, 3.5, 62, 21.5);
    box(cv, 'h-body', 6, 24.5, 56, 62);
    box(cv, 'h-room h-bed', 7.4, 26.4, 53.2, 26.2);
    box(cv, 'h-floor', 6, 52.6, 56, 2.4);
    box(cv, 'h-room h-living', 7.4, 55, 28.2, 30.4);
    box(cv, 'h-wall', 35.6, 55, 1.6, 30.4);
    box(cv, 'h-room h-kitchen', 37.2, 55, 23.4, 30.4);
    box(cv, 'h-label', 8.6, 27.4, 0, 0, 'Bedroom');
    box(cv, 'h-label', 26, 56, 0, 0, 'Living room');
    box(cv, 'h-label', 50.2, 56, 0, 0, 'Kitchen');
    box(cv, 'h-label', 64.6, 87.4, 0, 0, 'Backyard');

    // bedroom: spider in the corner, hamster in its cage, bed
    prop(cv, '🕸️', 10.4, 35.2, 0.85);
    box(cv, 'h-thread', 12.7, 26.4, 0.2, 9.4);
    critter(cv, C('Spider'), 12.8, 40.4, { s: 0.5, cls: 'hang' });
    box(cv, 'h-window', 33, 29.5, 8.6, 12.5);
    prop(cv, '🖼️', 24.5, 41, 0.6);
    box(cv, 'h-table', 13.2, 46.6, 12.2, 6);
    box(cv, 'h-cage', 13.8, 33.4, 11, 13.2);
    critter(cv, C('Siberian dwarf hamster'), 18.2, 45.6, { s: 0.62 });
    box(cv, 'h-bars', 13.8, 33.4, 11, 13.2);
    prop(cv, '🛏️', 51.5, 52.6, 1.55);
    prop(cv, '🧸', 42.3, 52.6, 0.6);

    // living room: cat on the sofa, goldfish bowl on a stand
    prop(cv, '🕰️', 20, 66, 0.55);
    prop(cv, '🛋️', 18.6, 85.6, 1.9);
    critter(cv, C('Cat'), 15.6, 77.6, { s: 0.82 });
    prop(cv, '🪴', 9.6, 85.6, 0.8);
    box(cv, 'h-stand', 27.2, 74.4, 7, 11.2);
    at(cv.appendChild(el('div', 'h-bowl')), 30.7, 74.6);
    critter(cv, C('Fish that tells composers apart (probably goldfish)'), 30.7, 71.4, { s: 0.5, cls: 'swim' });

    // kitchen: canary cage by the window, mouse hole by the floor
    box(cv, 'h-window', 47.6, 59.2, 9, 12.5);
    box(cv, 'h-hook', 41.6, 55, 0.2, 4.4);
    box(cv, 'h-birdcage', 38.6, 59.2, 6.2, 14);
    critter(cv, C('Canary and ostrich'), 41.7, 71.2, { s: 0.55 });
    box(cv, 'h-bars round', 38.6, 59.2, 6.2, 14);
    box(cv, 'h-counter', 50.6, 74.4, 9.6, 11.2);
    prop(cv, '🫖', 55.4, 74.6, 0.55);
    box(cv, 'h-mousehole', 38.9, 79.8, 3.4, 5.8);
    critter(cv, C('Mouse'), 40.6, 85.4, { s: 0.48 });
    prop(cv, '🧀', 46, 85.6, 0.42);

    // backyard: the dog and its kennel
    prop(cv, '🌳', 92, 78, 2.6);
    box(cv, 'h-fence', 63.4, 71, 36.6, 14.4);
    box(cv, 'h-kennel-roof', 69.4, 58, 18.4, 11);
    box(cv, 'h-kennel', 71, 68.6, 15.2, 18);
    box(cv, 'h-kennel-door', 75.4, 74, 6.4, 12.6);
    box(cv, 'h-kennel-sign', 76.2, 70.2, 4.8, 3.6, '🦴');
    critter(cv, C('Dog'), 80.6, 93.5, { s: 1 });
    prop(cv, '🥣', 69, 94, 0.45);
    prop(cv, '🎾', 90, 94, 0.4);
  }

  // ---------- Zoo: a wide path past the enclosures ----------
  const PENS = [
    { name: 'Big Cats', w: 9, look: 'sand', props: [['🪨', 26, 78, 1.4], ['🌳', 84, 60, 1.9]], who: [['Lion', 32, 74, 1.05], ['Tiger', 66, 90, 1]] },
    { name: 'Elephants', w: 9.5, look: 'dust', trough: true, props: [['🌳', 86, 58, 2]], who: [['Elephant', 44, 86, 1.6]] },
    { name: 'Savanna Yard', w: 13, look: 'grass-dry', props: [['🌳', 12, 52, 2.4]], who: [['Giraffe', 30, 76, 1.75], ['Zebra', 58, 90, 1.05], ['Rhino', 84, 86, 1.25]] },
    { name: 'Gorilla Forest', w: 8, look: 'green', props: [['🌴', 18, 60, 1.9], ['🪵', 76, 90, 0.9]], who: [['Gorilla', 52, 84, 1.25]] },
    { name: 'Panda House', w: 8, look: 'green', props: [['🎋', 16, 64, 1.7], ['🎋', 86, 62, 1.5]], who: [['Giant panda', 52, 86, 1.15]] },
    { name: 'Ice Den', w: 8, look: 'ice', pool: [44, 60, 50, 24], props: [['🧊', 84, 58, 0.8]], who: [['Polar bear', 28, 80, 1.3]] },
    { name: 'Penguin Cove', w: 8, look: 'ice', pool: [10, 62, 62, 22], who: [['Penguin', 40, 78, 0.7], ['Penguin', 84, 70, 0.8], ['Penguin', 22, 96, 0.85]] },
    { name: 'Down Under', w: 9, look: 'sand', props: [['🌳', 72, 66, 2.6]], who: [['Kangaroo', 30, 88, 1.3], ['Koala', 72, 36, 0.75]] },
    { name: 'River Pool', w: 10, look: 'green', pool: [6, 52, 70, 34], who: [['Hippo', 40, 80, 1.4], ['Crocodile', 78, 95, 1.1]] },
    { name: 'Flamingo Lake', w: 7.5, look: 'green', pool: [8, 60, 74, 26], who: [['Flamingo', 32, 80, 1.05], ['Flamingo', 66, 84, 0.9]] },
    { name: 'Desert Corner', w: 7.5, look: 'desert', props: [['🌵', 82, 70, 1.4]], who: [['Camel', 42, 88, 1.45]] },
    { name: 'Rainforest House', w: 10, look: 'glass', props: [['🌴', 14, 76, 2], ['🌿', 86, 92, 1.1]], who: [['Parrot', 40, 42, 0.85], ['Sloth', 68, 50, 0.9]] }
  ];

  function buildZoo(w, cv) {
    const C = (k) => w.creatures.find((c) => c.k === k);
    cv.classList.add('ss-zoo');
    cv.style.setProperty('--ar', 4.6);
    const start = 7, gap = 1.4, end = 7;
    const total = start + PENS.reduce((s, p) => s + p.w + gap, 0) + end;
    const pct = (u) => (u / total) * 100;

    cv.append(el('div', 'ss-sun'));
    [12, 31, 55, 77, 93].forEach((x, i) => prop(cv, '☁️', x, 14 + (i % 2) * 8, 1 - (i % 2) * 0.25, 'ss-cloud' + (i % 2 ? ' slow' : '')));
    box(cv, 'z-hills', 0, 22, 100, 24);
    box(cv, 'z-grass', 0, 42, 100, 42);
    box(cv, 'z-path', 0, 82, 100, 18);

    // entrance arch
    box(cv, 'z-pillar', pct(1), 36, pct(0.9), 48);
    box(cv, 'z-pillar', pct(5.1), 36, pct(0.9), 48);
    box(cv, 'z-banner', pct(0.6), 31, pct(5.8), 12, 'ZOO');
    prop(cv, '🎈', pct(0.9), 33, 0.8);
    prop(cv, '🎈', pct(6.1), 32, 0.7);

    let u = start;
    for (const p of PENS) {
      const pen = box(cv, 'z-pen z-' + p.look, pct(u), 38, pct(p.w), 44);
      if (p.pool) box(pen, 'z-pool', ...p.pool);
      if (p.trough) box(pen, 'z-trough', 64, 80, 22, 8);
      (p.props || []).forEach(([e, x, y, s]) => prop(pen, e, x, y, s));
      p.who.forEach(([k, x, y, s]) => critter(pen, C(k), x, y, { s }));
      pen.appendChild(el('div', 'z-fence'));
      const sign = box(cv, 'z-sign', pct(u + p.w / 2), 84.5, 0, 0, `<b>${p.name}</b>`);
      sign.setAttribute('aria-hidden', 'true');
      u += p.w + gap;
    }
    prop(cv, '🪑', pct(u + 1.5), 92, 0.8);
    prop(cv, '🍦', pct(u + 4), 92, 0.9);
    box(cv, 'z-sign', pct(u + 3), 84.5, 0, 0, '<b>Snacks</b>');
  }

  // ---------- every other place: built from the creature list ----------
  const ON_THE_GROUND = ['land', 'glass', 'ice', 'night'];

  const SCENERY = {
    land(w, cv, rnd) {
      cv.append(el('div', 'ss-sun'));
      prop(cv, '☁️', 18, 15, 1.1, 'ss-cloud');
      prop(cv, '☁️', 58, 10, 0.8, 'ss-cloud slow');
      box(cv, 'ss-hill far', 42, 42, 70, 24);
      box(cv, 'ss-hill', -10, 40, 62, 26);
      decorRow(w, cv, rnd, 56);
      box(cv, 'ss-ground', 0, 54, 100, 46);
    },
    glass(w, cv, rnd) {
      box(cv, 'ss-glass', 0, 0, 100, 56);
      decorRow(w, cv, rnd, 56);
      box(cv, 'ss-ground', 0, 54, 100, 46);
    },
    ice(w, cv, rnd) {
      cv.append(el('div', 'ss-sun pale'));
      box(cv, 'ss-hill far', 42, 44, 70, 22);
      box(cv, 'ss-hill', -10, 42, 62, 24);
      decorRow(w, cv, rnd, 56);
      box(cv, 'ss-ground', 0, 54, 100, 46);
      sprinkle(cv, 'ss-snow', 40, rnd, [0, 100, -10, 90]);
    },
    night(w, cv, rnd) {
      sprinkle(cv, 'ss-star', 26, rnd, [0, 100, 12, 46]);
      cv.append(el('div', 'ss-moon'));
      const pts = ['0 0', '100% 0'];
      for (let x = 100; x >= 0; x -= 4) pts.push(`${x}% ${x % 8 ? 18 + rnd() * 40 : 8 + rnd() * 10}%`);
      box(cv, 'ss-rocks', 0, 0, 100, 30).style.clipPath = `polygon(${pts.join(',')})`;
      box(cv, 'ss-ground', 0, 60, 100, 40);
      [10, 34, 62, 88].forEach((x) => prop(cv, '🍄', x + rnd() * 4, 66 + rnd() * 4, 0.4));
    },
    water(w, cv, rnd) {
      box(cv, 'ss-surface', 0, 0, 100, 7);
      [8, 30, 52, 74, 92].forEach((x) => box(cv, 'ss-ray', x, -10, 7, 110));
      sprinkle(cv, 'ss-bub', 18, rnd, [2, 98, 30, 100]);
      if (w.ground) {
        box(cv, 'ss-floor', -5, 86, 110, 20);
        decorRow(w, cv, rnd, 97, 0.9);
      }
    },
    deep(w, cv, rnd) {
      sprinkle(cv, 'ss-snowfall', 46, rnd, [0, 100, -10, 100]);
      box(cv, 'ss-floor dark', -5, 92, 110, 14);
    },
    sky(w, cv, rnd) {
      cv.append(el('div', 'ss-sun'));
      [[8, 24, 1.8], [36, 12, 1.2], [64, 30, 2.2], [88, 14, 1.4], [20, 70, 2.6], [76, 78, 2.4], [48, 92, 3]].forEach(
        ([x, y, s], i) => prop(cv, '☁️', x, y, s, 'ss-cloud big' + (i % 2 ? ' slow' : '')));
    },
    under(w, cv, rnd) {
      box(cv, 'ss-topsoil', 0, 0, 100, 12);
      [[6, 30, 30], [44, 46, 38], [70, 24, 26], [14, 66, 34], [60, 72, 30]].forEach(([x, y, wd]) => box(cv, 'ss-tunnel', x, y, wd, 7));
      box(cv, 'ss-core', 25, 84, 50, 40);
      for (let i = 0; i < 8; i++) prop(cv, '🪨', 4 + rnd() * 92, 24 + rnd() * 60, 0.35 + rnd() * 0.3, 'dim');
    },
    space(w, cv, rnd) {
      sprinkle(cv, 'ss-star', 90, rnd);
      box(cv, 'ss-shoot', 70, 10, 14, 0.5);
    }
  };

  // Background emoji spread along the horizon (keeps each emoji's variation selector with it).
  function decorRow(w, cv, rnd, y, s = 1.5) {
    const glyphs = (w.decor || '').match(/\p{Extended_Pictographic}️?/gu) || [];
    glyphs.forEach((g, i) => prop(cv, g, ((i + 0.5) / glyphs.length) * 100 + (rnd() - 0.5) * 6, y + rnd() * 2, s * (0.8 + rnd() * 0.4), 'decor'));
  }

  // Lay creatures out in tidy rows (big ones at the back), with a little wobble so it looks natural.
  function rows(list, ys, x0, x1, rnd) {
    const out = [];
    const perRow = Math.ceil(list.length / ys.length);
    const sorted = [...list].sort((a, b) => (b.s || 1) - (a.s || 1));
    ys.forEach((y, r) => {
      const row = sorted.slice(r * perRow, (r + 1) * perRow);
      row.forEach((c, i) => {
        const slot = (x1 - x0) / row.length;
        const x = x0 + slot * (i + 0.5) + (r % 2 ? slot * 0.18 : -slot * 0.12) + (rnd() - 0.5) * slot * 0.25;
        out.push({ c, x, y: y + (rnd() - 0.5) * 4, depth: r });
      });
    });
    return out;
  }

  function buildQuick(w, cv) {
    const rnd = seeded(w.id);
    cv.classList.add('ss-k-' + w.kind);
    cv.style.setProperty('--ar', 1.6);
    cv.style.setProperty('--sky1', w.sky[0]);
    cv.style.setProperty('--sky2', w.sky[1]);
    if (w.ground) cv.style.setProperty('--ground', w.ground);
    SCENERY[w.kind](w, cv, rnd);

    let spots;
    if (ON_THE_GROUND.includes(w.kind)) {
      const air = w.creatures.filter((c) => c.z === 'air');
      const ground = w.creatures.filter((c) => c.z !== 'air');
      const ys = ground.length > 5 ? (w.kind === 'night' ? [76, 93] : [72, 92]) : [88];
      spots = rows(ground, ys, 10, 94, rnd).map((p) => ({ ...p, s: (p.c.s || 1) * (p.depth === 0 && ys.length > 1 ? 0.86 : 1) }));
      spots = spots.concat(rows(air, [w.kind === 'night' ? 46 : 34], 12, 90, rnd).map((p) => ({ ...p, y: p.y + (rnd() - 0.5) * 12 })));
    } else {
      const n = w.creatures.length;
      const ys = n <= 5 ? [64] : n <= 10 ? (w.kind === 'deep' ? [44, 86] : [46, 84]) : [38, 62, 88];
      spots = rows(w.creatures, ys, 10, 92, rnd);
    }
    spots.forEach((p) => critter(cv, p.c, p.x, p.y, { s: p.s }));

    if (w.kind === 'deep') {
      const torch = el('div', 'ss-torch');
      cv.appendChild(torch);
      const aim = (x, y) => { torch.style.setProperty('--tx', x + 'px'); torch.style.setProperty('--ty', y + 'px'); };
      const follow = (e) => { const r = cv.getBoundingClientRect(); aim(e.clientX - r.left, e.clientY - r.top); };
      cv.addEventListener('pointermove', follow);
      cv.addEventListener('pointerdown', follow);
      cv.addEventListener('focusin', (e) => {
        const r = cv.getBoundingClientRect(), b = e.target.getBoundingClientRect();
        aim(b.left + b.width / 2 - r.left, b.top + b.height / 2 - r.top);
      });
    }
  }

  const BUILDERS = { home: buildHome, zoo: buildZoo, quick: buildQuick };

  window.SafariScene = { open, close, sam: () => SAM_SVG, world: worldById, hood: hoodById, isOpen: () => !!cur };
})();
