// Contrôle à distance : affiche l'écran du PC en direct et renvoie souris / clavier.
// Souris : comme sur le PC (clic gauche, droit, molette).
// Doigt  : appui court = clic, glisser = cliquer-glisser, appui long = clic droit,
//          deux doigts = défiler.
// Clavier : celui de l'ordinateur directement, ou le bouton « Clavier » sur tablette.

const Remote = (() => {
  const el = (id) => document.getElementById(id);
  const box = el('remote');
  const img = el('remoteImg');
  const stage = el('remoteStage');
  const kbd = el('remoteInput');
  let available = { view: false, control: false };
  let open = false;
  let control = false;
  let monitor = 0;
  let lastUrl = null;
  let rightNext = false;
  let frames = 0;
  let fpsTimer = null;

  // ---------- Affichage ----------
  function setAvailable(remote) {
    available = remote || { view: false, control: false };
    el('remoteBtn').hidden = !available.view;
    if (open) available.view ? start() : close();
  }

  // Fluidité : Éco 15, Normal 30, Élevé 60 images/s (retenue sur cet appareil)
  let fps = 30;
  try { fps = Number(localStorage.getItem('pcdeck-fps')) || 30; } catch {}
  function showFps() {
    for (const b of el('remoteFps').children) b.classList.toggle('on', Number(b.dataset.fps) === fps);
  }
  for (const b of el('remoteFps').children) {
    b.addEventListener('click', () => {
      fps = Number(b.dataset.fps);
      try { localStorage.setItem('pcdeck-fps', String(fps)); } catch {}
      showFps();
      start();
    });
  }
  showFps();

  function start() {
    const w = Math.min(1920, Math.round(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1)));
    send({ type: 'screen-start', monitor, maxWidth: w, quality: 60, fps });
  }

  function show() {
    open = true;
    box.hidden = false;
    start();
    clearInterval(fpsTimer);
    fpsTimer = setInterval(() => {
      // Écran immobile : le PC n'envoie rien (une image par seconde pour rester à jour)
      el('remoteInfo').textContent = !img.src ? 'en attente…' : frames > 1 ? `${frames} img/s` : 'écran immobile';
      frames = 0;
    }, 1000);
  }

  function close() {
    if (document.fullscreenElement === box) document.exitFullscreen().catch(() => {});
    releaseAll();
    open = false;
    setView(1, 0, 0);
    box.hidden = true;
    send({ type: 'screen-stop' });
    clearInterval(fpsTimer);
    kbd.blur();
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = null;
    img.removeAttribute('src');
  }

  function started(msg) {
    if (!msg.ok) {
      toast(msg.error || 'Écran indisponible');
      close();
      return;
    }
    control = !!msg.control;
    monitor = msg.monitor;
    box.classList.toggle('view-only', !control);
    const mons = el('remoteMons');
    mons.innerHTML = '';
    if ((msg.monitors || []).length > 1) {
      msg.monitors.forEach((m, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'remote-key' + (i === monitor ? ' on' : '');
        b.textContent = `Écran ${i + 1}`;
        b.addEventListener('click', () => { monitor = i; setView(1, 0, 0); start(); });
        mons.append(b);
      });
    }
  }

  function frame(data) {
    if (!open) return;
    frames++;
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' }));
    const old = lastUrl;
    lastUrl = url;
    img.onload = () => { if (old) URL.revokeObjectURL(old); };
    img.src = url;
  }

  // ---------- Souris / doigt ----------
  // Touches et boutons envoyés "appuyés" : à relâcher si on quitte la fenêtre (Alt+Tab...),
  // sinon le PC piloté les croit enfoncés pour toujours.
  const held = new Set();
  function input(m) {
    if (!control) return;
    const id = m.action === 'key' ? 'k' + m.vk : m.action === 'button' ? 'b' + m.button : null;
    if (id) m.state === 'down' ? held.add(id) : held.delete(id);
    send({ type: 'input', ...m });
  }
  function releaseAll() {
    for (const id of [...held]) {
      input(id[0] === 'k' ? { action: 'key', vk: Number(id.slice(1)), state: 'up' } : { action: 'button', button: id.slice(1), state: 'up' });
    }
  }
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  // Position dans l'image (0..1), ou null si en dehors
  function pos(e) {
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  let moveQueued = null;
  function moveTo(p) {
    if (!p) return;
    if (!moveQueued) requestAnimationFrame(() => { input({ action: 'move', ...moveQueued }); moveQueued = null; });
    moveQueued = p;
  }
  function moveNow(p) {
    moveQueued = null;
    if (p) input({ action: 'move', ...p });
  }
  function click(button) {
    input({ action: 'button', button, state: 'down' });
    input({ action: 'button', button, state: 'up' });
  }
  function setRightNext(v) {
    rightNext = v;
    el('remoteRight').classList.toggle('on', v);
  }

  // ---------- Zoom (pincer à 2 doigts) ----------
  // L'image est agrandie avec une transformation CSS ; pos() suit automatiquement
  // (getBoundingClientRect tient compte du zoom), donc les clics tombent au bon endroit.
  const view = { s: 1, x: 0, y: 0 };
  const stageBox = () => stage.getBoundingClientRect();
  function gesture() {
    const [a, b] = [...touches.values()];
    return { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  function setView(s, x, y) {
    if (s <= 1.01) { s = 1; x = 0; y = 0; }
    else {
      // Pas de vide inutile : l'image zoomée reste collée aux bords de la zone
      const W = img.offsetWidth * s, H = img.offsetHeight * s;
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const bx = img.offsetLeft, by = img.offsetTop;
      x = W <= sw ? (sw - W) / 2 - bx : Math.min(-bx, Math.max(sw - W - bx, x));
      y = H <= sh ? (sh - H) / 2 - by : Math.min(-by, Math.max(sh - H - by, y));
    }
    view.s = s; view.x = x; view.y = y;
    img.style.transform = s === 1 ? '' : `translate(${x}px, ${y}px) scale(${s})`;
    el('remoteZoom').hidden = s === 1;
  }
  el('remoteZoom').addEventListener('click', () => setView(1, 0, 0));
  window.addEventListener('resize', () => setView(1, 0, 0));

  const touches = new Map();
  let touch = null; // { id, x0, y0, t0, drag, longTimer, scrollY }

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  stage.addEventListener('pointerdown', (e) => {
    if (!control && e.pointerType === 'mouse') return;
    try { stage.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType === 'mouse') {
      moveNow(pos(e));
      const button = e.button === 2 ? 'r' : e.button === 1 ? 'm' : 'l';
      input({ action: 'button', button: rightNext && button === 'l' ? 'r' : button, state: 'down' });
      return;
    }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // Deux doigts : zoom (pincer), déplacement de la vue (si zoomé) ou défilement
      if (touch) {
        clearTimeout(touch.longTimer);
        if (touch.drag) input({ action: 'button', button: rightNext ? 'r' : 'l', state: 'up' });
      }
      const g = gesture();
      touch = { scroll: true, mode: null, d0: g.d, c0: g.c, s0: view.s, t0: { x: view.x, y: view.y }, y: g.c.y, acc: 0 };
      return;
    }
    if (touches.size > 2) return;
    touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, drag: false, scroll: false };
    touch.longTimer = setTimeout(() => {
      if (!touch || touch.drag || touch.scroll) return;
      touch.done = true;
      moveNow(pos(e));
      click('r');
      navigator.vibrate?.(20);
    }, 550);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!control && e.pointerType === 'mouse') return;
    if (e.pointerType === 'mouse') {
      moveTo(pos(e));
      return;
    }
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!touch) return;
    if (touch.scroll) {
      if (touches.size < 2) return;
      const g = gesture();
      if (!touch.mode) {
        // On décide une fois par geste : pincer = zoom, sinon déplacer (zoomé) ou défiler
        if (Math.abs(g.d / touch.d0 - 1) > 0.08) touch.mode = 'zoom';
        else if (Math.hypot(g.c.x - touch.c0.x, g.c.y - touch.c0.y) > 10) touch.mode = view.s > 1.01 ? 'pan' : 'scroll';
        else return;
      }
      if (touch.mode === 'zoom' || touch.mode === 'pan') {
        const s = touch.mode === 'zoom' ? Math.min(5, Math.max(1, (touch.s0 * g.d) / touch.d0)) : touch.s0;
        // Le point de l'image sous les doigts au départ reste sous les doigts
        const b = { x: img.offsetLeft, y: img.offsetTop };
        const ux = (touch.c0.x - stageBox().x - b.x - touch.t0.x) / touch.s0;
        const uy = (touch.c0.y - stageBox().y - b.y - touch.t0.y) / touch.s0;
        setView(s, g.c.x - stageBox().x - b.x - s * ux, g.c.y - stageBox().y - b.y - s * uy);
        return;
      }
      const y = g.c.y;
      touch.acc += y - touch.y;
      touch.y = y;
      while (Math.abs(touch.acc) >= 30) {
        const step = Math.sign(touch.acc);
        input({ action: 'wheel', delta: step * 120 });
        touch.acc -= step * 30;
      }
      return;
    }
    if (e.pointerId !== touch.id || touch.done) return;
    if (!touch.drag && Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) > 12) {
      // Glisser : on appuie au point de départ puis on suit le doigt
      touch.drag = true;
      clearTimeout(touch.longTimer);
      moveNow(pos({ clientX: touch.x0, clientY: touch.y0 }));
      input({ action: 'button', button: rightNext ? 'r' : 'l', state: 'down' });
    }
    if (touch.drag) moveTo(pos(e));
  });

  function pointerEnd(e) {
    if (!control && e.pointerType === 'mouse') return;
    if (e.pointerType === 'mouse') {
      moveNow(pos(e));
      const button = e.button === 2 ? 'r' : e.button === 1 ? 'm' : 'l';
      input({ action: 'button', button: rightNext && button === 'l' ? 'r' : button, state: 'up' });
      if (rightNext) setRightNext(false);
      return;
    }
    touches.delete(e.pointerId);
    if (!touch) return;
    if (touch.scroll) {
      if (!touches.size) touch = null;
      return;
    }
    if (e.pointerId !== touch.id) return;
    clearTimeout(touch.longTimer);
    if (touch.drag) {
      moveNow(pos(e));
      input({ action: 'button', button: rightNext ? 'r' : 'l', state: 'up' });
      setRightNext(false);
    } else if (!touch.done && e.type === 'pointerup') {
      moveNow(pos(e));
      click(rightNext ? 'r' : 'l');
      setRightNext(false);
    }
    touch = null;
  }
  stage.addEventListener('pointerup', pointerEnd);
  stage.addEventListener('pointercancel', pointerEnd);

  // Molette de souris ou pavé tactile à 2 doigts : le pavé envoie beaucoup de petits
  // mouvements, on les additionne et on les transmet en proportion (défilement fluide).
  let wheelAcc = 0;
  let wheelQueued = false;
  stage.addEventListener('wheel', (e) => {
    if (!control) return;
    e.preventDefault();
    if (e.ctrlKey) return; // pincer pour zoomer : ignoré
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1; // lignes, pages -> pixels
    wheelAcc += -e.deltaY * unit * 1.2; // 100 px (un cran de molette) = 120 pour Windows
    moveTo(pos(e));
    if (wheelQueued) return;
    wheelQueued = true;
    requestAnimationFrame(() => {
      wheelQueued = false;
      const delta = Math.round(wheelAcc);
      if (!delta) return;
      wheelAcc -= delta;
      input({ action: 'wheel', delta: Math.max(-1200, Math.min(1200, delta)) });
    });
  }, { passive: false });

  // ---------- Clavier ----------
  const VK = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27,
    ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    PrintScreen: 44, Insert: 45, Delete: 46, Meta: 91, ContextMenu: 93, AltGraph: 18,
  };
  for (let i = 1; i <= 12; i++) VK['F' + i] = 111 + i;

  function vkOf(e) {
    if (VK[e.key] !== undefined) return VK[e.key];
    const m = /^(Key|Digit)(.)$/.exec(e.code || '');
    if (m) return m[2].charCodeAt(0); // A-Z = 65-90, 0-9 = 48-57
    return 0;
  }
  // Caractère simple sans raccourci : envoyé tel quel (accents compris)
  const isText = (e) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !(e.altKey && !e.getModifierState?.('AltGraph'));

  document.addEventListener('keydown', (e) => {
    if (!open || !control || e.target === kbd) return;
    e.preventDefault();
    if (isText(e)) {
      input({ action: 'text', text: e.key });
      return;
    }
    const vk = vkOf(e);
    if (vk) input({ action: 'key', vk, state: 'down' });
  });
  document.addEventListener('keyup', (e) => {
    if (!open || !control || e.target === kbd) return;
    e.preventDefault();
    if (isText(e)) return;
    const vk = vkOf(e);
    if (vk) input({ action: 'key', vk, state: 'up' });
  });

  // Clavier de la tablette : un champ caché reçoit ce qui est tapé
  function tapKey(vk) {
    input({ action: 'key', vk, state: 'down' });
    input({ action: 'key', vk, state: 'up' });
  }
  kbd.addEventListener('beforeinput', (e) => {
    e.preventDefault();
    if (e.inputType === 'deleteContentBackward') tapKey(8);
    else if (e.inputType === 'deleteContentForward') tapKey(46);
    else if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') tapKey(13);
    else if (e.data) input({ action: 'text', text: e.data });
  });
  kbd.addEventListener('keydown', (e) => {
    // Touches que le clavier tactile envoie sans passer par beforeinput
    if (e.key === 'Enter') { e.preventDefault(); tapKey(13); }
    else if (e.key === 'Backspace' && !kbd.value) { e.preventDefault(); tapKey(8); }
  });

  // ---------- Barre du haut ----------
  el('remoteBtn').addEventListener('click', show);
  el('remoteClose').addEventListener('click', close);
  el('remoteKbd').addEventListener('click', () => {
    if (document.activeElement === kbd) kbd.blur();
    else kbd.focus();
  });
  el('remoteRight').addEventListener('click', () => setRightNext(!rightNext));

  // Plein écran (navigateur) : la visionneuse occupe tout l'écran de l'ordinateur.
  // Les touches spéciales (Windows, Échap...) partent alors vers le PC piloté ;
  // pour sortir : garder Échap appuyé, ou ce bouton.
  // En plein écran, la barre du haut se cache aussi : l'écran du PC prend toute la place.
  // Le petit bouton ☰ en haut à droite la fait réapparaître.
  // Sur iPhone (pas de vrai plein écran dans Safari), seule la barre se cache.
  const fullBtn = el('remoteFull');
  const canFull = !!box.requestFullscreen && !window.PcDeckNative;
  fullBtn.hidden = false;
  function setCompact(on) {
    box.classList.toggle('compact', on);
  }
  fullBtn.addEventListener('click', () => {
    if (canFull) {
      if (document.fullscreenElement) document.exitFullscreen();
      else box.requestFullscreen({ navigationUI: 'hide' }).then(() => setCompact(true), () => setCompact(true));
    } else {
      setCompact(true);
    }
  });
  el('remoteHandle').addEventListener('click', () => setCompact(!box.classList.contains('compact')));
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === box;
    fullBtn.textContent = on ? 'Quitter le plein écran' : 'Plein écran';
    if (!on) setCompact(false);
    if (on && control) navigator.keyboard?.lock?.().catch(() => {});
    else navigator.keyboard?.unlock?.();
  });

  return { setAvailable, started, frame };
})();
