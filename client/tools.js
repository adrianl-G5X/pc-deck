// Outils de la tablette (menu « Outils » en haut) : fenêtres du PC, lancer un programme, fichiers du PC,
// capture d'écran, historique du presse-papiers, dictée et commandes vocales, réglages de cet appareil
// (fond d'écran, son des touches, plusieurs PC). Plus : sorties son dans le mélangeur, ±10 s dans le lecteur,
// « Fermer » dans le détail processeur / mémoire, valeurs et états affichés sur les boutons.
// Utilise $, send, toast, buzz, NATIVE… d'app.js (chargé avant).

const Tools = (() => {
  const box = $('toolBox'), body = $('toolBody');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (text, fn, cls = '') => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
  let current = null; // outil affiché

  // Vidéo ou musique de la visionneuse : arrêtée dès qu'on la quitte (sinon le son continue en arrière-plan)
  function stopMedia() {
    for (const m of body.querySelectorAll('video, audio')) { m.pause(); m.removeAttribute('src'); m.load(); }
    videoWanted = null;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) for (const m of body.querySelectorAll('video, audio')) m.pause(); });
  function open(title, kind) {
    stopMedia();
    current = kind;
    $('toolTitle').textContent = title;
    body.replaceChildren(el('p', 'tool-note', 'Chargement…'));
    $('toolsBox').hidden = true;
    box.hidden = false;
  }
  function close() { stopMedia(); box.hidden = true; current = null; box.querySelector('.tool-box').classList.remove('wide'); }
  // Retour : visionneuse -> dossier ; dossier -> dossier d'avant ; sinon -> menu des outils.
  // Aussi le bouton retour de la tablette (appli Android) et Échap.
  function back() {
    if (current === 'files' && body.querySelector('.tool-view')) { stopMedia(); box.querySelector('.tool-box').classList.remove('wide'); pdfView = null; showFiles(folder); return; }
    if (current === 'files' && fileHistory.length) { send({ type: 'files', path: fileHistory.pop() }); return; }
    close();
    $('toolsBox').hidden = false;
  }
  $('toolBack').addEventListener('click', () => { buzz(8); back(); });
  window.pcdeckBack = () => {
    if (!box.hidden) { back(); return true; }
    if (!$('toolsBox').hidden) { $('toolsBox').hidden = true; return true; }
    return false;
  };
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  $('toolsBtn').addEventListener('click', () => { buzz(8); $('toolsBox').hidden = false; });
  $('toolsBox').addEventListener('click', (e) => { if (e.target === $('toolsBox')) $('toolsBox').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.pcdeckBack(); });

  // ---------- Fenêtres ouvertes sur le PC (Alt+Tab au doigt) ----------
  function showWindows(list) {
    if (current !== 'windows') return;
    if (!list.length) { body.replaceChildren(el('p', 'tool-note', 'Aucune fenêtre ouverte.')); return; }
    body.replaceChildren(...list.map((w) => {
      const row = el('div', 'tool-row');
      const t = el('div', 'tool-main tool-app');
      const ico = el('span', 'tool-ico');
      if (w.logo) { const img = el('img'); img.src = w.logo; img.alt = ''; ico.append(img); } else ico.textContent = w.name.charAt(0);
      t.append(ico, el('b', '', w.name));
      t.addEventListener('click', () => { buzz(); send({ type: 'window-act', h: w.h, op: 'front' }); });
      row.append(t, btn('Autre écran', () => send({ type: 'window-act', h: w.h, op: 'other' })),
        btn('Fermer', () => { buzz(20); send({ type: 'window-act', h: w.h, op: 'close' }); }, 'danger'));
      return row;
    }));
  }

  // ---------- Lancer un programme installé ----------
  let programs = [];
  function showPrograms() {
    if (current !== 'programs') return;
    const input = el('input', 'tool-search');
    input.type = 'search'; input.placeholder = 'Rechercher un programme…';
    const list = el('div', 'tool-list');
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const draw = () => {
      const q = norm(input.value.trim());
      list.replaceChildren(...programs.filter((p) => !q || norm(p.name).includes(q)).slice(0, 60).map((p) => {
        const row = el('div', 'tool-row');
        const t = el('div', 'tool-main');
        t.append(el('b', '', p.name));
        t.addEventListener('click', () => { buzz(); send({ type: 'launch', i: p.i }); close(); });
        row.append(t);
        return row;
      }));
    };
    input.addEventListener('input', draw);
    body.replaceChildren(input, list);
    draw();
  }

  // ---------- Fichiers du PC (Bureau, Documents, Téléchargements, Images, Vidéos, Musique) ----------
  const size = (b) => (!b ? '0 Ko' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' Go' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' Mo' : Math.max(1, Math.round(b / 1e3)) + ' Ko').replace('.', ',');
  const MEDIA = /\.(jpe?g|png|gif|webp|bmp|heic|mp4|m4v|mov|webm|mkv|avi)$/i;
  const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
  const thumbs = new Map(); // chemin -> miniature (gardées tant que la page est ouverte)
  let folder = null; // dossier affiché (pour revenir après la visionneuse)
  let fileHistory = []; // dossiers d'avant (bouton Retour)
  function goFolder(p) {
    if (folder) fileHistory.push(folder.dir || '');
    send({ type: 'files', path: p });
  }
  function showFiles(r) {
    if (current !== 'files') return;
    stopMedia();
    folder = r;
    const rows = [];
    if (r.dir) rows.push(Object.assign(el('div', 'tool-path'), { textContent: r.dir }));
    if (r.parent !== null && r.parent !== undefined) {
      const up = el('div', 'tool-row'); const t = el('div', 'tool-main'); t.append(el('b', '', '⬆ Dossier parent'));
      t.addEventListener('click', () => goFolder(r.parent)); up.append(t); rows.push(up);
    }
    const media = [];
    for (const f of r.items) {
      const row = el('div', 'tool-row');
      const t = el('div', 'tool-main tool-app');
      const ico = el('span', 'tool-ico' + (f.dir ? ' dir' : ''));
      ico.innerHTML = iconSvg(f.dir ? 'folder' : VIDEO.test(f.name) ? 'play' : MEDIA.test(f.name) ? 'camera' : 'layers') || '';
      if (!f.dir && MEDIA.test(f.name)) { ico.dataset.thumb = f.path; media.push(f.path); if (thumbs.get(f.path)) setThumb(ico, thumbs.get(f.path)); }
      const txt = el('span', 'tool-txt'); txt.append(el('b', '', f.name), el('small', '', f.dir ? '' : size(f.size)));
      t.append(ico, txt);
      t.addEventListener('click', () => (f.dir ? goFolder(f.path) : preview(f)));
      row.append(t);
      rows.push(row);
    }
    // Miniatures : demandées au PC une à une (les déjà vues reviennent tout de suite)
    for (const pth of media.filter((x) => !thumbs.has(x)).slice(0, 60)) { thumbs.set(pth, null); send({ type: 'thumb', path: pth }); }
    if (!r.items.length) rows.push(el('p', 'tool-note', 'Dossier vide.'));
    body.replaceChildren(...rows);
  }
  function setThumb(ico, data) {
    const img = el('img'); img.src = data; img.alt = '';
    ico.replaceChildren(img);
    ico.classList.add('thumb');
  }
  // Adresse d'un fichier avec son lien temporaire (?k=) : rien d'autre ne passe dans l'adresse
  function fileUrl(f, dl) {
    return `${location.protocol === 'https:' ? 'https' : 'http'}://${link.host}/api/file?k=${f.k}${dl ? '&dl=1' : ''}`;
  }
  let wanted = null; // fichier en attente de son lien temporaire
  function preview(f) {
    buzz(8);
    stopMedia();
    wanted = f;
    body.replaceChildren(el('p', 'tool-note', 'Ouverture…'));
    send({ type: 'file-ticket', path: f.path });
  }
  // Visionneuse : chaque type de fichier lu dans l'appli, sans en sortir
  //  photo -> en grand ; vidéo -> lecteur de l'appli Android (4K, HEVC, MKV…) ou du navigateur ; musique -> lecteur ;
  //  PDF -> pages dessinées par le PC ; texte -> affiché ; le reste (Word, Excel…) -> aperçu de Windows.
  const AUDIO = /\.(mp3|m4a|aac|wav|flac|ogg|opus|wma)$/i;
  const TEXT = /\.(txt|md|json|csv|log|xml|html?|css|js|ts|py|ini|cfg|conf|bat|ps1|srt|vtt|yml|yaml|sql|c|cpp|h|java|cs)$/i;
  let pdfView = null; // { k, img, label, page, pages }
  let bigWanted = null; // aperçu Windows attendu (chemin)
  function showPreview(f) {
    box.querySelector('.tool-box').classList.add('wide');
    const view = el('div', 'tool-view');
    const info = el('p', 'tool-note'); info.textContent = `${f.name} · ${size(f.size)}`;
    const row = el('div', 'tool-actions');
    row.append(btn('Télécharger', () => download(f), 'main'), btn('Retour', () => { box.querySelector('.tool-box').classList.remove('wide'); pdfView = null; videoWanted = null; showFiles(folder); }));
    pdfView = null;
    if (VIDEO.test(f.name)) {
      startVideo(f, view);
    } else if (AUDIO.test(f.name)) {
      const a = el('audio'); a.src = fileUrl(f); a.controls = true; a.autoplay = true;
      a.onerror = () => view.replaceChildren(el('p', 'tool-note', 'Ce format de musique ne se lit pas ici, mais tu peux le télécharger.'));
      view.classList.add('audio');
      const ico = el('span', 'tool-ico big'); ico.innerHTML = iconSvg('music') || '';
      view.append(ico, a);
    } else if (MEDIA.test(f.name)) {
      const img = el('img'); img.src = fileUrl(f); img.alt = f.name;
      img.onerror = () => { bigWanted = f.path; send({ type: 'thumb', path: f.path, big: true }); }; // HEIC… : l'aperçu de Windows
      view.append(img);
    } else if (/\.pdf$/i.test(f.name)) {
      const img = el('img'); img.alt = f.name;
      const label = el('span', 'pdf-page', 'Page 1');
      const prev = btn('‹ Page précédente', () => pdfGo(-1)), next = btn('Page suivante ›', () => pdfGo(1));
      const nav = el('div', 'tool-actions pdf-nav'); nav.append(prev, label, next);
      pdfView = { k: f.k, img, label, page: 0, pages: 1 };
      view.classList.add('doc');
      view.append(el('p', 'tool-note', 'Chargement de la page…'));
      body.replaceChildren(view, nav, info, row);
      send({ type: 'pdf-page', k: f.k, page: 0 });
      return;
    } else if (TEXT.test(f.name)) {
      const pre = el('pre', 'tool-text', 'Chargement…');
      view.classList.add('doc');
      view.append(pre);
      fetch(fileUrl(f), { headers: { Range: 'bytes=0-299999' } }).then((r) => r.arrayBuffer()).then((b) => {
        pre.textContent = new TextDecoder('utf-8').decode(b) + (f.size > 300000 ? '\n\n… (début du fichier seulement : télécharge-le pour tout voir)' : '');
      }).catch(() => { pre.textContent = 'Lecture impossible.'; });
    } else {
      // Word, Excel, PowerPoint, archives… : l'aperçu que Windows sait faire (souvent la 1re page)
      bigWanted = f.path;
      view.append(el('p', 'tool-note', 'Aperçu…'));
      send({ type: 'thumb', path: f.path, big: true });
    }
    body.replaceChildren(view, info, row);
  }
  // ---------- Vidéos : lues directement si la tablette sait (H.264), sinon converties à la volée par le PC (ffmpeg) ----------
  let videoWanted = null; // { f, view }
  function startVideo(f, view) {
    view.replaceChildren(el('p', 'tool-note', 'Préparation de la vidéo…'));
    videoWanted = { f, view };
    send({ type: 'video-info', k: f.k });
  }
  function onVideoInfo(m) {
    if (!videoWanted || videoWanted.f.k !== m.k) return;
    const { f, view } = videoWanted;
    videoWanted = null;
    const easy = /^(h264|vp8|vp9|av1)$/.test(m.codec || '') && /\.(mp4|m4v|webm|mov)$/i.test(f.name);
    if (m.ffmpeg === 'on' && !easy) return convertedPlayer(f, m, view);
    if (m.ffmpeg === 'on' || easy) return directPlayer(f, view, m.ffmpeg === 'on' ? () => convertedPlayer(f, m, view) : null);
    // Pas de convertisseur sur le PC : appli Android = son lecteur ; sinon le navigateur, et proposer d'installer ffmpeg
    const install = btn('Installer le convertisseur vidéo sur le PC', () => { send({ type: 'ffmpeg-install' }); view.replaceChildren(el('p', 'tool-note', 'Installation sur le PC… (1 à 2 min), puis rouvre la vidéo.')); }, 'main');
    if (NATIVE?.playVideo) {
      const play = el('button', 'tool-play'); play.type = 'button';
      play.innerHTML = (thumbs.get(f.path) ? `<img src="${thumbs.get(f.path)}" alt="">` : '') + '<span>▶</span>';
      play.addEventListener('click', () => { buzz(); NATIVE.playVideo(fileUrl(f)); });
      view.replaceChildren(play, el('p', 'tool-note', "Si l'image ne s'affiche pas, installe le convertisseur : toutes les vidéos se liront ici."), install);
      return;
    }
    directPlayer(f, view, null, install);
  }
  // Vidéo lue telle quelle (instantané, qualité d'origine) ; pas d'image -> version convertie si possible
  function directPlayer(f, view, fallback, install) {
    const v = el('video'); v.src = fileUrl(f); v.controls = true; v.playsInline = true; v.autoplay = true;
    if (thumbs.get(f.path)) v.poster = thumbs.get(f.path);
    const noPicture = () => {
      if (v.videoWidth && !v.error) return;
      v.pause(); v.removeAttribute('src'); v.load();
      if (fallback) return fallback();
      view.replaceChildren(el('p', 'tool-note', 'Cette vidéo ne se lit pas ici telle quelle.'), ...(install ? [install] : []));
    };
    v.addEventListener('playing', () => setTimeout(noPicture, 1500));
    v.addEventListener('loadedmetadata', () => { if (!v.videoWidth) noPicture(); });
    v.onerror = noPicture;
    view.replaceChildren(v);
  }
  // Vidéo convertie par le PC : pas d'avance rapide dans le flux, alors la barre redemande la vidéo au bon moment
  function convertedPlayer(f, info, view) {
    const base = `${location.protocol === 'https:' ? 'https' : 'http'}://${link.host}`;
    const wrap = el('div', 'vplayer');
    const v = el('video'); v.playsInline = true; v.autoplay = true;
    if (thumbs.get(f.path)) v.poster = thumbs.get(f.path);
    const wait = el('div', 'vwait', 'Chargement…');
    const bar = el('div', 'vbar');
    const play = el('button', 'vbtn'); play.type = 'button'; play.setAttribute('aria-label', 'Lecture / pause');
    const cur = el('span', 'vtime', '0:00');
    const range = el('input'); range.type = 'range'; range.min = 0; range.max = Math.max(1, Math.floor(info.duration || 0)); range.step = 1; range.value = 0;
    range.setAttribute('aria-label', 'Position dans la vidéo');
    const dur = el('span', 'vtime', clock(info.duration || 0));
    const full = el('button', 'vbtn wide'); full.type = 'button'; full.textContent = 'Plein écran';
    bar.append(play, cur, range, dur, full);
    wrap.append(v, wait, bar);
    let offset = 0, dragging = false;
    const icon = () => { play.innerHTML = iconSvg(v.paused ? 'play' : 'pause') || (v.paused ? '▶' : '❚❚'); };
    const load = (t) => { offset = Math.max(0, Math.min(t, (info.duration || t + 1) - 1)); wait.hidden = false; v.src = `${base}/api/video?k=${f.k}&t=${Math.floor(offset)}`; v.play().catch(() => {}); };
    v.addEventListener('playing', () => { wait.hidden = true; icon(); });
    v.addEventListener('pause', icon);
    v.addEventListener('waiting', () => { wait.hidden = false; });
    v.addEventListener('timeupdate', () => { if (!dragging) { range.value = offset + v.currentTime; cur.textContent = clock(offset + v.currentTime); } });
    v.addEventListener('error', () => { wait.hidden = false; wait.textContent = 'La vidéo ne se lit pas (fichier abîmé ?)'; });
    v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
    play.addEventListener('click', () => { buzz(); v.paused ? v.play() : v.pause(); });
    range.addEventListener('input', () => { dragging = true; cur.textContent = clock(Number(range.value)); });
    range.addEventListener('change', () => { dragging = false; load(Number(range.value)); });
    full.addEventListener('click', () => { const on = wrap.classList.toggle('vfull'); full.textContent = on ? 'Réduire' : 'Plein écran'; });
    icon();
    view.replaceChildren(wrap);
    load(0);
  }
  function pdfGo(d) {
    if (!pdfView) return;
    const p = Math.min(pdfView.pages - 1, Math.max(0, pdfView.page + d));
    if (p === pdfView.page) return;
    pdfView.label.textContent = `Page ${p + 1} / ${pdfView.pages}…`;
    send({ type: 'pdf-page', k: pdfView.k, page: p });
  }
  function showPdfPage(m) {
    if (!pdfView || m.k !== pdfView.k) return;
    Object.assign(pdfView, { page: m.page, pages: m.pages });
    pdfView.img.src = m.data;
    pdfView.label.textContent = `Page ${m.page + 1} / ${m.pages}`;
    const view = body.querySelector('.tool-view');
    if (view && !view.contains(pdfView.img)) view.replaceChildren(pdfView.img);
    view?.scrollTo(0, 0);
  }
  function showBig(m) {
    if (m.path !== bigWanted) return;
    bigWanted = null;
    const view = body.querySelector('.tool-view');
    if (!view) return;
    if (m.data) { const img = el('img'); img.src = m.data; img.alt = ''; view.replaceChildren(img, el('p', 'tool-note', 'Aperçu (1re page). Télécharge le fichier pour l\'ouvrir en entier.')); }
    else view.replaceChildren(el('p', 'tool-note', 'Pas d\'aperçu pour ce type de fichier : télécharge-le pour l\'ouvrir.'));
  }
  async function download(f) {
    buzz();
    if (NATIVE?.download) { NATIVE.download(fileUrl(f, true), f.name); toast(`${f.name} : téléchargement…`); return; }
    toast(`${f.name} : téléchargement…`);
    try {
      const r = await fetch(`${location.protocol === 'https:' ? 'https' : 'http'}://${link.host}/api/file?path=${encodeURIComponent(f.path)}&dl=1`, { headers: { 'X-PCDeck-Token': loadToken() || '' } });
      if (!r.ok) throw new Error(r.status === 403 ? 'refusé' : 'introuvable');
      saveBlob(await r.blob(), f.name);
      toast(`${f.name} téléchargé`);
    } catch (err) { showError(`${f.name} non téléchargé : ${err.message}`); }
  }
  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ---------- Capture d'écran du PC ----------
  function showSnapshot(data) {
    if (current !== 'snapshot') return;
    const img = el('img', 'tool-shot'); img.src = 'data:image/jpeg;base64,' + data; img.alt = "Capture de l'écran du PC";
    const name = `Capture PC ${new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-')}.jpg`;
    const save = btn('Enregistrer sur cet appareil', async () => {
      const blob = await (await fetch(img.src)).blob();
      if (navigator.canShare?.({ files: [new File([blob], name, { type: 'image/jpeg' })] })) {
        navigator.share({ files: [new File([blob], name, { type: 'image/jpeg' })] }).catch(() => {});
      } else saveBlob(blob, name);
    }, 'main');
    const again = btn('Nouvelle capture', () => { body.replaceChildren(el('p', 'tool-note', 'Capture…')); send({ type: 'snapshot' }); });
    const row = el('div', 'tool-actions'); row.append(save, again);
    body.replaceChildren(img, row, el('p', 'tool-note', 'Appui long sur l\'image pour la copier ou la partager.'));
  }

  // ---------- Historique du presse-papiers ----------
  function showClips(items) {
    if (current !== 'clips') return;
    if (!items.length) { body.replaceChildren(el('p', 'tool-note', 'Rien encore : les textes copiés sur le PC apparaîtront ici.')); return; }
    body.replaceChildren(...items.map((t) => {
      const row = el('div', 'tool-row');
      const m = el('div', 'tool-main'); m.append(el('span', 'clip', t.length > 240 ? t.slice(0, 240) + '…' : t));
      row.append(m,
        btn('Copier ici', async () => { try { await navigator.clipboard.writeText(t); toast('Copié sur cet appareil'); } catch { $('padText').value = t; $('padBox').hidden = false; close(); toast('Texte mis dans la zone : appui long pour le copier'); } }),
        btn('Remettre sur le PC', () => { send({ type: 'clip-set', text: t }); }));
      return row;
    }));
  }

  // ---------- Voix : dictée (texte tapé sur le PC) et commandes (« lance Spotify ») ----------
  let voiceMode = null;
  function listen(mode) {
    voiceMode = mode;
    if (NATIVE?.listen) { NATIVE.listen(); return; } // appli Android : reconnaissance vocale du téléphone
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showError('La reconnaissance vocale n\'existe pas dans ce navigateur. Utilise Chrome, ou l\'appli Android.'); return; }
    const rec = new SR();
    rec.lang = 'fr-FR'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => heard(e.results[0][0].transcript);
    rec.onerror = (e) => showError(e.error === 'not-allowed' ? 'Micro refusé : autorise le micro pour cette page (ou utilise l\'appli Android).' : 'Je n\'ai rien entendu, réessaie.');
    rec.start();
    toast('Je t\'écoute…');
  }
  window.onNativeSpeech = (text) => (text ? heard(text) : showError('Je n\'ai rien entendu, réessaie.'));
  function heard(text) {
    text = String(text || '').trim();
    if (!text) return;
    if (voiceMode === 'dictate') { send({ type: 'pad', action: 'text', text }); toast(`Tapé : « ${text} »`); return; }
    // Commande : le bouton dont le nom ressemble le plus à la phrase (« lance Spotify » -> « Spotify »)
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
    const words = norm(text).replace(/\b(lance|ouvre|mets|met|active|allume|demarre|clique sur|appuie sur|sur|le|la|les|l|un|une|s il te plait)\b/g, ' ').split(/\s+/).filter(Boolean);
    let best = null, score = 0;
    for (const b of allButtons) {
      const lw = norm(b.label).split(/\s+/).filter(Boolean);
      const hit = lw.filter((w) => words.includes(w)).length / lw.length;
      if (hit > score) { score = hit; best = b; }
    }
    if (!best || score < 0.5) { showError(`« ${text} » : aucun bouton ne porte ce nom.`); return; }
    toast(`« ${text} » → ${best.label}`);
    pressButton(best); // garde « Tu es sûr ? » pour éteindre, verrouiller…
  }

  // ---------- Réglages de cet appareil : fond d'écran, son des touches, plusieurs PC ----------
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { toast('Image trop grande pour cet appareil', true); } } };
  // Fond d'écran. Source (par appareil) : « pc » = celui choisi dans les Paramètres du PC (par défaut), « own » = le sien, « none » = aucun.
  // Réglages par appareil : taille (fit) et assombrissement (dim). Le fond perso : image (texte, réduite) ou vidéo (gardée dans la base de l'appareil).
  const wallDb = () => new Promise((ok, no) => { const r = indexedDB.open('pcdeck-wall', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const wallVideo = async (blob) => { const db = await wallDb(); return new Promise((ok, no) => { const t = db.transaction('f', blob === undefined ? 'readonly' : 'readwrite'); const s = t.objectStore('f'); const q = blob === undefined ? s.get('video') : blob === null ? s.delete('video') : s.put(blob, 'video'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); }); };
  let wallUrl = null, wallSig = '', pcWall = null; // pcWall : { kind, v } du PC, ou { kind: null }
  const wallMode = () => store.get('pcdeck-wallmode') || 'pc';
  const wallFit = () => ['cover', 'contain', 'fill'].includes(store.get('pcdeck-wallfit')) ? store.get('pcdeck-wallfit') : 'cover';
  const wallDim = () => { const n = Number(store.get('pcdeck-walldim')); return Number.isFinite(n) && store.get('pcdeck-walldim') != null ? Math.min(80, Math.max(0, n)) : 55; };
  function paintWall() { // taille et assombrissement : tout de suite, sans recharger le fond
    const m = document.getElementById('wallMedia'), d = document.getElementById('wallDim');
    if (m) m.style.objectFit = wallFit();
    if (d) d.style.background = `rgba(0,0,0,${wallDim() / 100})`;
  }
  async function applyWallpaper() {
    const mode = wallMode();
    let src = null, kind = null, sig = 'none';
    if (mode === 'pc') {
      if (!link) return; // pas encore connecté : rappelé à la connexion
      try { pcWall = await (await fetch(`${location.protocol === 'https:' ? 'https' : 'http'}://${link.host}/wallpaper/info`, { cache: 'no-store' })).json(); } catch { return; }
      if (pcWall.kind) { kind = pcWall.kind; sig = `pc${pcWall.v}`; }
    } else if (mode === 'own') {
      if (store.get('pcdeck-wallpaper-kind') === 'video') { kind = 'video'; sig = 'ownvideo' + (store.get('pcdeck-wallpaper-id') || ''); }
      else if (store.get('pcdeck-wallpaper')) { kind = 'image'; src = store.get('pcdeck-wallpaper'); sig = 'ownimg' + src.length; }
    }
    if (sig === wallSig && document.getElementById('wallMedia') || (sig === 'none' && wallSig === 'none')) { paintWall(); return; }
    wallSig = sig;
    document.getElementById('wallMedia')?.remove(); document.getElementById('wallDim')?.remove();
    if (wallUrl) { URL.revokeObjectURL(wallUrl); wallUrl = null; }
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-wallpaper');
    document.body.classList.toggle('has-wallvideo', !!kind);
    if (!kind) return;
    try {
      if (mode === 'pc') src = `${location.protocol === 'https:' ? 'https' : 'http'}://${link.host}/wallpaper?v=${pcWall.v}`;
      else if (kind === 'video') {
        const blob = await wallVideo();
        if (!blob) { store.set('pcdeck-wallpaper-kind', null); document.body.classList.remove('has-wallvideo'); return; }
        src = wallUrl = URL.createObjectURL(blob);
      }
      const m = document.createElement(kind === 'video' ? 'video' : 'img');
      m.id = 'wallMedia'; m.src = src; m.setAttribute('aria-hidden', 'true');
      if (kind === 'video') { m.muted = true; m.loop = true; m.autoplay = true; m.playsInline = true; }
      const dim = document.createElement('div'); dim.id = 'wallDim';
      document.body.prepend(dim); document.body.prepend(m);
      paintWall();
      if (kind === 'video') m.play().catch(() => {});
    } catch { document.body.classList.remove('has-wallvideo'); }
  }
  applyWallpaper();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyWallpaper(); }); // le fond du PC a pu changer
  window.pcdeckWallpaper = applyWallpaper; // rappelé quand la connexion au PC est prête
  // Son des touches : petit « clic » à chaque appui (Web Audio, rien à télécharger)
  let actx = null;
  document.addEventListener('pointerdown', (e) => {
    if (store.get('pcdeck-keysound') !== '1' || !e.target.closest('.deck-btn')) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = 1400; g.gain.setValueAtTime(0.12, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.05);
      o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.05);
    } catch {}
  }, true);

  // Plusieurs PC : liste gardée sur cet appareil [{ name, host, token }]
  const pcs = () => { try { return JSON.parse(store.get('pcdeck-pcs')) || []; } catch { return []; } };
  function rememberPc(name) {
    if (!link || !name) return;
    applyWallpaper(); // connecté : on peut chercher le fond du PC
    const list = pcs().filter((p) => p.name !== name);
    list.unshift({ name, host: link.kind === 'usb' ? (loadNetwork()?.lan?.[0] ? `${loadNetwork().lan[0]}:${loadNetwork().port || 8787}` : link.host) : link.host, token: loadToken() });
    store.set('pcdeck-pcs', JSON.stringify(list.slice(0, 8)));
    currentPc = name;
  }
  let currentPc = null;
  function switchPc(p) {
    if (!NATIVE) { location.href = `http://${p.host}/`; return; } // navigateur : chaque PC a sa propre adresse
    store.set(TOKEN_KEY, p.token || null);
    const [ip, port] = p.host.split(':');
    store.set(NETWORK_KEY, JSON.stringify({ port: Number(port) || 8787, lan: [ip] }));
    NATIVE.setWifiHost?.(p.host);
    location.reload();
  }
  function showDevice() {
    const wp = el('div', 'tool-block');
    const mode = wallMode();
    const pick = (opts, value, onChange) => { const s = el('select'); for (const [v, t] of opts) s.append(new Option(t, v)); s.value = value; s.addEventListener('change', () => onChange(s.value)); return s; };
    wp.append(el('h3', '', "Fond d'écran"));
    wp.append(pick([['pc', 'Celui du PC'], ['own', 'Mon propre fond (cet appareil)'], ['none', 'Aucun fond sur cet appareil']], mode, (v) => { store.set('pcdeck-wallmode', v); applyWallpaper(); showDevice(); }));
    if (mode === 'pc') wp.append(el('p', 'tool-note', pcWall && pcWall.kind ? 'Le fond choisi dans les Paramètres du PC.' : "Aucun fond choisi sur le PC (Paramètres du PC → Affichage → Fond d'écran)."));
    if (mode === 'own') {
      const file = el('input'); file.type = 'file'; file.accept = 'image/*,video/*'; file.hidden = true;
      file.addEventListener('change', async () => {
        const f = file.files[0]; if (!f) return;
        if (f.type.startsWith('video/')) { // vidéo : jouée en boucle, sans son, derrière les boutons
          if (f.size > 200 * 1024 * 1024) { toast('Vidéo trop lourde (200 Mo maximum) : choisis-en une plus courte', true); return; }
          try { await wallVideo(f); store.set('pcdeck-wallpaper', null); store.set('pcdeck-wallpaper-id', String(Date.now())); store.set('pcdeck-wallpaper-kind', 'video'); applyWallpaper(); }
          catch { toast('Cet appareil ne peut pas garder cette vidéo', true); }
          return;
        }
        const img = new Image();
        img.onload = () => { // réduite (1600 px) pour tenir dans la mémoire de l'appareil
          const k = Math.min(1, 1600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          store.set('pcdeck-wallpaper-kind', null); wallVideo(null).catch(() => {}); store.set('pcdeck-wallpaper', c.toDataURL('image/jpeg', 0.82)); applyWallpaper(); URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(f);
      });
      wp.append(file, btn('Choisir une image ou une vidéo', () => file.click(), 'main'),
        btn('Retirer mon fond', () => { store.set('pcdeck-wallpaper', null); store.set('pcdeck-wallpaper-kind', null); wallVideo(null).catch(() => {}); applyWallpaper(); }));
    }
    if (mode !== 'none') { // taille et assombrissement : propres à cet appareil
      wp.append(el('label', 'tool-note', 'Taille'),
        pick([['cover', "Remplir l'écran"], ['contain', 'Entier (bandes autour)'], ['fill', 'Étirer']], wallFit(), (v) => { store.set('pcdeck-wallfit', v); paintWall(); }));
      const dl = el('label', 'tool-note', 'Assombrir (pour bien lire les boutons)');
      const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '80'; range.step = '5'; range.value = String(wallDim());
      range.addEventListener('input', () => { store.set('pcdeck-walldim', range.value); paintWall(); });
      wp.append(dl, range);
    }
    const ks = el('label', 'tool-check'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = store.get('pcdeck-keysound') === '1';
    cb.addEventListener('change', () => store.set('pcdeck-keysound', cb.checked ? '1' : null));
    ks.append(cb, ' Son des touches');
    const tips = btn('Revoir les astuces', () => { close(); showTips(); });
    const pcBlock = el('div', 'tool-block');
    pcBlock.append(el('h3', '', 'Mes PC'));
    for (const p of pcs()) {
      const row = el('div', 'tool-row'); const t = el('div', 'tool-main');
      t.append(el('b', '', p.name + (p.name === currentPc ? ' ✓' : '')), el('small', '', p.host));
      row.append(t);
      if (p.name !== currentPc) row.append(btn('Utiliser', () => switchPc(p), 'main'));
      row.append(btn('✕', () => { store.set('pcdeck-pcs', JSON.stringify(pcs().filter((x) => x.name !== p.name))); showDevice(); }));
      pcBlock.append(row);
    }
    const addRow = el('div', 'tool-row');
    const addr = el('input', 'tool-search'); addr.placeholder = 'Adresse du nouveau PC (ex. 192.168.1.20)'; addr.inputMode = 'url';
    addRow.append(addr, btn('Ajouter', () => {
      const h = addr.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!h) return toast('Écris l\'adresse du PC (affichée sur ce PC : « Connecter un appareil »)', true);
      switchPc({ name: h, host: h.includes(':') ? h : `${h}:8787`, token: null }); // pas encore de laissez-passer : le code sera demandé
    }, 'main'));
    pcBlock.append(addRow);
    // Données utilisées par cet appareil (comptées par le PC : Wi-Fi ou données mobiles)
    const useBlock = el('div', 'tool-block');
    useBlock.append(el('h3', '', 'Données utilisées'), el('p', 'tool-note', 'Calcul…'));
    useBlock.id = 'dataUse';
    send({ type: 'data-usage' });
    body.replaceChildren(useBlock, wp, ks, tips, pcBlock);
  }

  function showDataUse(m) {
    const b = document.getElementById('dataUse');
    if (!b) return;
    const sum = (x) => x.screen + x.files + x.other;
    const table = el('div', 'data-use');
    const line = (label, t, mo, strong) => {
      const r = el('div', strong ? 'du-row du-total' : 'du-row');
      r.append(el('span', '', label), el('b', '', size(t)), el('b', '', size(mo)));
      return r;
    };
    const head = el('div', 'du-row du-head'); head.append(el('span', ''), el('span', '', "Aujourd'hui"), el('span', '', '30 jours'));
    table.append(head, line('Total', sum(m.today), sum(m.month), true), line('Écran du PC et son', m.today.screen, m.month.screen),
      line('Fichiers et vidéos', m.today.files, m.month.files), line('Le reste (boutons, infos…)', m.today.other, m.month.other));
    const c = navigator.connection;
    const note = c?.type === 'cellular' || c?.saveData ? 'En ce moment : données mobiles.' : 'Compté par le PC, que cet appareil soit en Wi-Fi ou en données mobiles.';
    b.replaceChildren(el('h3', '', 'Données utilisées'), table, el('p', 'tool-note', note));
  }

  // ---------- Menu « Outils » ----------
  for (const b of document.querySelectorAll('#toolsBox [data-ico]')) b.innerHTML = iconSvg(b.dataset.ico) || '';
  const TOOLS = {
    windows: ['Fenêtres ouvertes', () => send({ type: 'windows' })],
    programs: ['Lancer un programme', () => send({ type: 'programs' })],
    files: ['Fichiers du PC', () => { fileHistory = []; folder = null; send({ type: 'files', path: '' }); }],
    snapshot: ["Capture d'écran", () => send({ type: 'snapshot' })],
    clips: ['Presse-papiers', () => send({ type: 'cliphist' })],
    device: ['Cet appareil', () => showDevice()],
  };
  // ---------- Ordre et noms des outils (sur cet appareil) : « Modifier » ----------
  const grid = document.querySelector('#toolsBox .tools-grid');
  const DEFAULT_NAMES = Object.fromEntries([...grid.children].map((b) => [b.dataset.tool, b.querySelector('.tl').textContent]));
  const DEFAULT_ORDER = Object.keys(DEFAULT_NAMES);
  // Ordre et noms : gardés sur le PC (Paramètres → Affichage → Outils de la tablette), les mêmes sur tous les appareils
  let toolPrefs = { order: [], names: {} };
  let saveTimer = null;
  const saveTools = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => send({ type: 'tools-layout', ...toolPrefs }), 600); };
  function setLayout(t) { // appelée quand le PC envoie l'affichage
    toolPrefs = { order: [...(t?.order || [])], names: { ...(t?.names || {}) } };
    if (!editingTools) applyTools();
  }
  function applyTools() {
    const order = [...toolPrefs.order.filter((k) => DEFAULT_ORDER.includes(k)), ...DEFAULT_ORDER.filter((k) => !toolPrefs.order.includes(k))];
    for (const k of order) {
      const b = grid.querySelector(`[data-tool="${k}"]`);
      b.querySelector('.tl').textContent = toolPrefs.names[k] || DEFAULT_NAMES[k];
      grid.append(b);
    }
  }
  let editingTools = false;
  if (window.pendingToolsLayout) setLayout(window.pendingToolsLayout); else applyTools();
  function setToolEdit(on) {
    editingTools = on;
    $('toolsBox').classList.toggle('editing', on);
    $('toolsEdit').textContent = on ? 'Terminé' : 'Modifier';
    $('toolsReset').hidden = !on;
    for (const b of grid.children) {
      b.querySelector('.tl-edit')?.remove();
      b.querySelector('.tl').hidden = on;
      if (!on) continue;
      const k = b.dataset.tool;
      const box = el('span', 'tl-edit');
      const name = el('input'); name.value = b.querySelector('.tl').textContent; name.maxLength = 30; name.setAttribute('aria-label', 'Nom de l’outil');
      name.addEventListener('click', (e) => e.stopPropagation());
      name.addEventListener('input', () => { const v = name.value.trim(); if (v && v !== DEFAULT_NAMES[k]) toolPrefs.names[k] = v; else delete toolPrefs.names[k]; b.querySelector('.tl').textContent = v || DEFAULT_NAMES[k]; saveTools(); });
      const move = (d) => (e) => {
        e.stopPropagation(); buzz(8);
        const list = [...grid.children], i = list.indexOf(b), j = i + d;
        if (j < 0 || j >= list.length) return;
        d < 0 ? grid.insertBefore(b, list[j]) : grid.insertBefore(list[j], b);
        toolPrefs.order = [...grid.children].map((x) => x.dataset.tool);
        saveTools();
      };
      const arrows = el('span', 'tl-move');
      arrows.append(btn('◀', move(-1)), btn('▶', move(1)));
      box.append(name, arrows);
      b.append(box);
    }
  }
  $('toolsEdit').addEventListener('click', () => { buzz(8); setToolEdit(!editingTools); });
  $('toolsReset').addEventListener('click', () => { toolPrefs = { order: [], names: {} }; saveTools(); applyTools(); setToolEdit(true); });

  for (const b of document.querySelectorAll('#toolsBox [data-tool]')) {
    b.addEventListener('click', () => {
      if (editingTools) return; // en mode « Modifier », toucher un outil ne l'ouvre pas
      buzz(8);
      const k = b.dataset.tool;
      if (k === 'pad') { $('toolsBox').hidden = true; $('padBox').hidden = false; return; }
      if (k === 'dictate' || k === 'voice') { $('toolsBox').hidden = true; listen(k); return; }
      open(TOOLS[k][0], k);
      TOOLS[k][1]();
    });
  }

  // ---------- Sorties son dans le mélangeur ----------
  function showDevices(m) {
    const wrap = $('mixerDevices');
    if (m.error) { wrap.replaceChildren(); return; }
    const sel = (list, label) => {
      if (list.length < 2) return null;
      const l = el('label', 'mx-dev'); l.append(el('span', '', label));
      const s = el('select');
      for (const d of list) { const o = new Option(d.name.replace(/\s*\((.*)\)$/, ' · $1'), d.id); o.selected = d.current; s.append(o); }
      s.addEventListener('change', () => { buzz(); send({ type: 'audio-set', id: s.value }); });
      l.append(s);
      return l;
    };
    wrap.replaceChildren(...[sel(m.outputs, 'Sortie'), sel(m.inputs, 'Micro')].filter(Boolean));
  }
  $('mixerBtn').addEventListener('click', () => send({ type: 'audio-devices' }));

  // ---------- Lecteur : ±10 s, et toucher la barre pour aller à un moment ----------
  $('plBack').addEventListener('click', () => { buzz(); send({ type: 'media-seek', delta: -10 }); });
  $('plFwd').addEventListener('click', () => { buzz(); send({ type: 'media-seek', delta: 10 }); });
  document.querySelector('.player-main .media-bar').addEventListener('click', (e) => {
    if (!media?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    send({ type: 'media-seek', to: ((e.clientX - r.left) / r.width) * media.duration });
  });

  // ---------- Détail processeur / mémoire : fermer un programme ----------
  $('detailBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-kill]');
    if (!b) return;
    if (await askConfirm({ label: `Fermer ${b.dataset.kill} ? Ce qui n'est pas enregistré sera perdu.` })) send({ type: 'kill', name: b.dataset.kill });
  });

  // ---------- Valeurs et états affichés sur les boutons ----------
  let cycles = {};
  function tickValues() {
    const s = lastStats;
    for (const t of document.querySelectorAll('.deck-btn .target[data-value]')) {
      const k = t.dataset.value;
      const v = {
        cpu: s?.cpu?.usage != null && `${Math.round(s.cpu.usage)} %`, cpuTemp: s?.cpu?.temp != null && `${Math.round(s.cpu.temp)} °C`,
        gpu: s?.gpu?.usage != null && `${Math.round(s.gpu.usage)} %`, gpuTemp: s?.gpu?.temp != null && `${Math.round(s.gpu.temp)} °C`,
        ram: s?.ram?.percent != null && `${Math.round(s.ram.percent)} %`, fps: s?.fps != null && `${s.fps} FPS`,
        volume: levels?.system && (levels.system.muted ? 'coupé' : `${levels.system.volume} %`),
        clock: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      }[k];
      t.textContent = v || '—';
    }
    for (const t of document.querySelectorAll('.deck-btn .target[data-cycle]')) {
      const names = JSON.parse(t.dataset.cycle), i = cycles[t.closest('.deck-btn').dataset.id];
      t.textContent = i == null ? `→ ${names[0]}` : `${names[i]} · suivant : ${names[(i + 1) % names.length]}`;
    }
  }
  setInterval(tickValues, 1000);

  // ---------- Messages du PC ----------
  function onMessage(msg) {
    switch (msg.type) {
      case 'windows': return showWindows(msg.windows);
      case 'programs': programs = msg.programs; return showPrograms();
      case 'files': return showFiles(msg);
      case 'file-ticket':
        if (wanted && wanted.path === msg.path) { wanted.k = msg.k; showPreview(wanted); }
        return;
      case 'pdf-page': return showPdfPage(msg);
      case 'data-usage': return showDataUse(msg);
      case 'video-info': return onVideoInfo(msg);
      case 'ffmpeg': return toast(msg.status === 'on' ? 'Convertisseur vidéo installé : rouvre la vidéo' : 'Installation du convertisseur : ' + msg.message, msg.status !== 'on');
      case 'thumb':
        if (msg.big) return showBig(msg);
        thumbs.set(msg.path, msg.data);
        if (msg.data) for (const ico of document.querySelectorAll('#toolBody [data-thumb]')) if (ico.dataset.thumb === msg.path) setThumb(ico, msg.data);
        return;
      case 'snapshot': return showSnapshot(msg.data);
      case 'cliphist': return showClips(msg.items);
      case 'audio-devices': return showDevices(msg);
      case 'cycles': cycles = msg.cycles || {}; return tickValues();
    }
  }
  return { setLayout, onMessage, rememberPc, setCycles: (c) => { cycles = c || {}; tickValues(); }, tickValues };
})();
