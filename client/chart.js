// Petit graphique en courbes, sans bibliothèque externe (fonctionne hors ligne).
// Utilisation :
//   const chart = createLineChart(conteneur, {
//     series: [{ key: 'down', label: 'Réception', color: '--series-1' }],
//     format: (v) => v + ' W',
//   });
//   chart.update(historique); // historique = [{ t, down, ... }, ...]

// autoZoom (ex. 4) : l'axe vertical ne part plus de 0 mais s'ajuste aux valeurs
// visibles, pour bien voir les variations ; le nombre = écart minimal affiché.
function createLineChart(container, { series, format, minMax = 1, autoZoom = 0, windowMs = 120000 }) {
  const canvas = document.createElement('canvas');
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  container.classList.add('chart');
  container.append(canvas, tooltip);

  const ctx = canvas.getContext('2d');
  const pad = { top: 8, right: 8, bottom: 20, left: 56 };
  let data = [];
  // Point visé : on retient son heure (t), pour qu'il reste le même point
  // même quand la courbe défile. Il reste affiché 3 s après le survol.
  const HOLD_MS = 3000;
  let hoverT = null;
  let hideTimer = null;

  const css = (name) => getComputedStyle(container).getPropertyValue(name).trim();

  function niceMax(v) {
    if (v <= minMax) return minMax;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return v;
  }

  // Vue affichée : largeur `span` (ms) ; endAbs = instant du bord droit, null = suit le direct
  const MIN_SPAN = 10000;
  let span = windowMs;
  let endAbs = null;
  function viewEnd() {
    const lastT = data.length ? data[data.length - 1].t : 0;
    if (endAbs == null) return lastT;
    // L'historique avance : la vue figée ne sort jamais des données disponibles
    return Math.min(lastT, Math.max(endAbs, (data.length ? data[0].t : 0) + span));
  }
  const ago = (ms) => {
    const s = Math.round(ms / 1000);
    return s >= 120 && s % 60 === 0 ? '−' + s / 60 + ' min' : '−' + s + ' s';
  };

  function niceStep(v) {
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return v;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    let max = 0;
    let lo = Infinity;
    const lastT = data.length ? data[data.length - 1].t : 0;
    const endT = viewEnd();
    const fromT = endT - span;
    // Échelle verticale calculée sur la partie affichée seulement
    for (const p of data) if (p.t >= fromT && p.t <= endT) for (const s of series) if (p[s.key] != null) {
      max = Math.max(max, p[s.key]);
      lo = Math.min(lo, p[s.key]);
    }
    let min = 0;
    let zoomStep = 0;
    if (autoZoom && lo !== Infinity) {
      // Zoom auto : 2 intervalles "ronds" qui encadrent les valeurs
      const hi = max;
      zoomStep = niceStep(Math.max(hi - lo, autoZoom) / 4);
      min = Math.max(0, Math.floor(lo / zoomStep) * zoomStep);
      max = Math.max(min + zoomStep, Math.ceil(hi / zoomStep) * zoomStep);
    } else {
      max = niceMax(max);
    }

    // Axe horizontal = temps réel : le bord droit est endT ("maintenant" sans zoom).
    const x = (i) => pad.left + plotW - ((endT - data[i].t) / span) * plotW;
    const y = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;

    // Grille discrète + graduations
    ctx.font = '12px Bahnschrift, "Roboto Condensed", sans-serif-condensed, system-ui, sans-serif';
    ctx.fillStyle = css('--text-muted');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    // Zoom auto : 4 à 5 intervalles plus fins
    const n = zoomStep ? Math.round((max - min) / zoomStep) : 2;
    for (let i = 0; i <= n; i++) {
      const v = min + ((max - min) * i) / n;
      ctx.strokeStyle = i === 0 ? css('--axis') : css('--grid');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, Math.round(y(v)) + 0.5);
      ctx.lineTo(w - pad.right, Math.round(y(v)) + 0.5);
      ctx.stroke();
      ctx.fillText(format(v), pad.left - 8, y(v));
    }
    // Quadrillage vertical façon oscilloscope : une ligne toutes les 30 secondes
    ctx.strokeStyle = css('--grid');
    for (let k = 1; k < 4; k++) {
      const gx = Math.round(pad.left + (plotW * k) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, pad.top);
      ctx.lineTo(gx, pad.top + plotH);
      ctx.stroke();
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(ago(lastT - fromT), pad.left, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(lastT - endT < 500 ? 'maintenant' : ago(lastT - endT), w - pad.right, h - 4);
    if (span < windowMs - 500) {
      ctx.textAlign = 'center';
      ctx.fillText('zoom ×' + (windowMs / span).toFixed(1).replace('.0', ''), pad.left + plotW / 2, h - 4);
    }

    // Courbes (coupées aux bords de la zone de tracé)
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, 0, plotW, h);
    ctx.clip();
    for (const s of series) {
      ctx.strokeStyle = css(s.color);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      data.forEach((p, i) => {
        const v = p[s.key];
        if (v == null) { started = false; return; }
        if (!started) ctx.moveTo(x(i), y(v)); else ctx.lineTo(x(i), y(v));
        started = true;
      });
      ctx.stroke();
    }
    ctx.restore();

    // Survol : ligne verticale + points + infobulle
    const hoverIndex = hoverT == null ? -1 : data.findIndex((p) => p.t === hoverT);
    if (hoverIndex >= 0 && x(hoverIndex) >= pad.left) {
      const p = data[hoverIndex];
      const hx = x(hoverIndex);
      ctx.strokeStyle = css('--axis');
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + 0.5, pad.top);
      ctx.lineTo(Math.round(hx) + 0.5, pad.top + plotH);
      ctx.stroke();
      for (const s of series) {
        if (p[s.key] == null) continue;
        ctx.beginPath();
        ctx.arc(hx, y(p[s.key]), 4, 0, Math.PI * 2);
        ctx.fillStyle = css(s.color);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = css('--surface-1');
        ctx.stroke();
      }
      const ago = Math.round((data[data.length - 1].t - p.t) / 1000);
      tooltip.innerHTML =
        `<div class="tt-time">${ago === 0 ? 'maintenant' : 'il y a ' + ago + ' s'}</div>` +
        series
          .map((s) => `<div><span class="swatch" style="background:var(${s.color})"></span>${s.label} <b>${p[s.key] == null ? '—' : format(p[s.key])}</b></div>`)
          .join('');
      tooltip.style.display = 'block';
      const left = hx + 12 + tooltip.offsetWidth > w ? hx - 12 - tooltip.offsetWidth : hx + 12;
      tooltip.style.left = left + 'px';
      tooltip.style.top = pad.top + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  }

  function pointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    const plotW = rect.width - pad.left - pad.right;
    const ratio = (e.clientX - rect.left - pad.left) / plotW;
    if (ratio < 0 || ratio > 1 || !data.length) return; // hors de la zone : on garde le point actuel
    // point le plus proche de l'instant visé
    const target = viewEnd() - (1 - ratio) * span;
    let best = Infinity;
    let found = null;
    for (const p of data) {
      const d = Math.abs(p.t - target);
      if (d < best) { best = d; found = p.t; }
    }
    if (best > 3000) return; // rien à cet endroit
    clearTimeout(hideTimer);
    hoverT = found;
    draw();
  }
  // Doigt levé ou souris sortie : l'infobulle reste encore 3 secondes
  function release() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hoverT = null; draw(); }, HOLD_MS);
  }
  // ---------- Zoom dans le temps ----------
  // Ordinateur : molette = zoom sur l'instant pointé, cliquer-glisser = se déplacer,
  //              double-clic = vue complète.
  // Mobile     : pincer à 2 doigts = zoom, glisser à 2 doigts = se déplacer,
  //              double appui = vue complète. Un doigt garde l'infobulle.
  function plotRatio(clientX) {
    const r = canvas.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left - pad.left) / (r.width - pad.left - pad.right)));
  }
  // Garde l'instant `t` à la position `ratio` avec la nouvelle largeur `newSpan`
  function setView(newSpan, t, ratio) {
    span = Math.min(windowMs, Math.max(MIN_SPAN, newSpan));
    const lastT = data.length ? data[data.length - 1].t : 0;
    const firstT = data.length ? data[0].t : 0;
    let end = t + (1 - ratio) * span;
    end = Math.max(Math.min(firstT + span, lastT), Math.min(lastT, end));
    endAbs = lastT - end < 500 || span >= windowMs ? null : end; // collé à "maintenant" : suit le direct
    draw();
  }
  function resetView() {
    span = windowMs;
    endAbs = null;
    draw();
  }

  canvas.addEventListener('wheel', (e) => {
    if (!data.length) return;
    e.preventDefault();
    const ratio = plotRatio(e.clientX);
    const t = viewEnd() - (1 - ratio) * span;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      // Glissement horizontal (pavé tactile) : se déplacer dans le temps
      setView(span, t + (e.deltaX / canvas.clientWidth) * span, ratio);
    } else {
      setView(span * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), t, ratio);
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', resetView);

  const pointers = new Map();
  let pinch = null; // geste à 2 doigts
  let drag = null; // souris : cliquer-glisser
  let lastTap = 0;

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e.clientX);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const r = plotRatio((a + b) / 2);
      pinch = { d0: Math.max(10, Math.abs(a - b)), span0: span, t0: viewEnd() - (1 - r) * span };
      hoverT = null;
      draw();
      return;
    }
    if (e.pointerType === 'mouse' && e.button === 0) {
      drag = { x0: e.clientX, end0: viewEnd(), moved: false };
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    if (e.pointerType !== 'mouse') {
      const now = Date.now();
      if (now - lastTap < 300) { resetView(); lastTap = 0; return; }
      lastTap = now;
    }
    pointerMove(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.clientX);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      setView((pinch.span0 * pinch.d0) / Math.max(10, Math.abs(a - b)), pinch.t0, plotRatio((a + b) / 2));
      return;
    }
    if (drag && (drag.moved || Math.abs(e.clientX - drag.x0) > 4)) {
      drag.moved = true;
      hoverT = null;
      const plotW = canvas.clientWidth - pad.left - pad.right;
      setView(span, drag.end0 - ((e.clientX - drag.x0) / plotW) * span, 1);
      return;
    }
    pointerMove(e);
  });
  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (e.pointerType === 'mouse') drag = null;
  }
  canvas.addEventListener('pointerup', (e) => { pointerEnd(e); if (e.pointerType !== 'mouse') release(); });
  canvas.addEventListener('pointerleave', release);
  canvas.addEventListener('pointercancel', (e) => { pointerEnd(e); release(); });
  new ResizeObserver(draw).observe(container);

  return {
    update(history) {
      data = history;
      draw();
    },
  };
}
