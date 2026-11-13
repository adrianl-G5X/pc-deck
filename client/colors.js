// Couleurs personnalisées : à partir de quelques couleurs choisies (fond, touches, texte, courbes),
// calcule toutes les teintes de l'appli (relief des touches, quadrillage, textes secondaires...).
// Utilisé par la tablette (app.js) et par l'aperçu des Paramètres (settings.html).
// Une couleur vide = celle du thème clair ou sombre.

const PcDeckColors = (() => {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const luma = (h) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const ok = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

  // Renvoie { '--rack': '#...', ... } : seulement ce qui change par rapport au thème
  function vars(display) {
    const c = display?.colors || {};
    const out = {};
    const bg = ok(c.background) ? c.background : null;
    const keys = ok(c.keys) ? c.keys : null;
    const txt = ok(c.text) ? c.text : null;
    if (bg || keys || txt) {
      // Le thème choisi donne les valeurs de départ ; on ne remplace que ce qui est personnalisé
      const light = display.theme === 'light';
      const rack = bg || (light ? '#e8e5de' : '#1b1d1f');
      const dark = luma(rack) < 0.5; // fond sombre : les teintes se calculent vers le blanc
      const towards = dark ? '#ffffff' : '#000000';
      const key = keys || (bg ? mix(rack, '#ffffff', dark ? 0.07 : 0.6) : null); // touches un peu plus claires que le fond
      const text = txt || (bg ? (dark ? '#e6e2d8' : '#1b1d1f') : null);
      if (bg) {
        out['--rack'] = rack;
        out['--scope'] = mix(rack, dark ? '#000000' : '#ffffff', dark ? 0.2 : 0.4);
        out['--line'] = mix(rack, towards, 0.1);
        out['--grid'] = mix(rack, towards, 0.07);
        out['--axis'] = mix(rack, towards, 0.14);
      }
      if (key) {
        const keyDark = luma(key) < 0.5;
        out['--key'] = key;
        out['--key-down'] = mix(key, keyDark ? '#ffffff' : '#000000', 0.04);
        out['--key-top'] = mix(key, '#ffffff', keyDark ? 0.14 : 0.6);
        out['--key-bottom'] = mix(key, '#000000', keyDark ? 0.5 : 0.18);
      }
      if (text) {
        const ref = out['--rack'] || rack;
        out['--text-primary'] = text;
        out['--text-secondary'] = mix(text, ref, 0.38);
        out['--text-muted'] = mix(text, ref, 0.6);
        out['--series-mono'] = text;
      }
    }
    if (ok(c.down)) out['--series-1'] = c.down;
    if (ok(c.up)) out['--series-2'] = c.up;
    return out;
  }

  const NAMES = ['--rack', '--scope', '--line', '--grid', '--axis', '--key', '--key-down', '--key-top', '--key-bottom',
    '--text-primary', '--text-secondary', '--text-muted', '--series-mono', '--series-1', '--series-2'];

  function apply(root, display) {
    for (const n of NAMES) root.style.removeProperty(n);
    for (const [n, v] of Object.entries(vars(display))) root.style.setProperty(n, v);
    document.querySelectorAll('img.logo').forEach(plate);
  }

  const cssVar = (cs, ...names) => names.map((n) => cs.getPropertyValue(n).trim()).find(Boolean) || '';
  const px = (d, i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

  // Adapte un logo aux touches (thème sombre surtout) :
  // - logo « tuile » (carré blanc d'Apple Music, iCloud...) : le carré blanc est retiré ;
  // - ce qui reste se confond avec les touches (note noire d'Apple Music) : peint couleur du texte ;
  // - logo sombre sans tuile sur touches sombres (ou clair sur clair) : petit fond contrasté derrière.
  // Recalculé à chaque changement de thème depuis l'image d'origine (data-orig).
  function plate(img) {
    if (!img.isConnected) return;
    const orig = img.dataset.orig || img.src;
    img.dataset.orig = orig;
    const cs = getComputedStyle(img);
    const key = cssVar(cs, '--t-key', '--key'), text = cssVar(cs, '--t-text', '--text-primary');
    const o = new Image();
    o.onload = () => {
      let out = orig, on = false;
      try {
        const S = Math.min(128, o.naturalWidth || 128);
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const g = c.getContext('2d');
        g.drawImage(o, 0, 0, S, S);
        const im = g.getImageData(0, 0, S, S), d = im.data;
        let removed = 0;
        if (ok(key) && luma(key) < 0.5) {
          // Fond clair relié au bord (en passant par les coins transparents) = la tuile
          const seen = new Uint8Array(S * S), stack = [];
          for (let k = 0; k < S; k++) stack.push(k, S * (S - 1) + k, k * S, k * S + S - 1);
          while (stack.length) {
            const p = stack.pop();
            if (seen[p]) continue;
            seen[p] = 1;
            const i = p * 4, clear = d[i + 3] < 40;
            if (!clear && px(d, i) < 0.85) continue;
            if (!clear) { d[i + 3] = 0; removed++; }
            const x = p % S, y = (p - x) / S;
            if (x > 0) stack.push(p - 1);
            if (x < S - 1) stack.push(p + 1);
            if (y > 0) stack.push(p - S);
            if (y < S - 1) stack.push(p + S);
          }
        }
        const tile = removed > S * S * 0.15;
        if (tile) { // retire aussi le liseré gris clair laissé par l'antialiasing
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && px(d, i) > 0.9) d[i + 3] = 0;
        }
        let sum = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { sum += px(d, i); n++; }
        const close = n && ok(key) && Math.abs(sum / n - luma(key)) < 0.2; // 0.2 : un logo coloré (rouge d'Opera) reste tel quel
        if (tile) {
          if (close && ok(text)) { const t = rgb(text); for (let i = 0; i < d.length; i += 4) { d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2]; } }
          g.putImageData(im, 0, 0);
          out = c.toDataURL('image/png');
        } else on = !!close;
      } catch {} // image d'un autre site : illisible, on la laisse telle quelle
      img.style.background = on ? (luma(key) < 0.5 ? 'rgba(255,255,255,.9)' : 'rgba(0,0,0,.75)') : '';
      img.style.padding = on ? '3px' : '';
      img.style.borderRadius = on ? '9px' : '';
      if (img.src !== out) img.src = out;
    };
    o.src = orig;
  }

  return { vars, apply, plate, NAMES };
})();
