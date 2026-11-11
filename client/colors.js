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
  }

  return { vars, apply, NAMES };
})();
