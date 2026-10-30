const providers = {
  soulseek: new SoulseekProvider()
};

const state = { queue: [], index: -1, playing: false, loading: false, duration: 0, seeking: false };
const $ = (id) => document.getElementById(id);
let playToken = 0;

// ---------- utilidades ----------
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  });
  children.forEach((c) => node.append(c));
  return node;
}

function fmt(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

let toastTimer;
function toast(msg, ms = 6000, kind = 'error') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (kind === 'ok' ? ' ok' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// anima as listas em cascata (cada item entra um pouco depois do anterior)
function stagger(ul) {
  [...ul.children].forEach((li, i) => li.style.setProperty('--i', i));
}

// preenche a parte "já percorrida" dos sliders finos
function fillRange(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--p', pct + '%');
}

const currentTrack = () => state.queue[state.index];
const currentProvider = () => (currentTrack() ? providers[currentTrack().source] : null);

// ---------- armazenamento local (playlists e aparência) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }
};

// Só playlists do Soulseek são mantidas (versões antigas guardavam Spotify/SoundCloud).
let playlists = store.get('playlists', []).map((pl) => ({
  ...pl,
  tracks: (pl.tracks || []).filter((t) => t.source === 'soulseek')
}));
let openPlaylistId = null;
let confirmDeleteId = null;

const savePlaylists = () => store.set('playlists', playlists);
const trackKey = (t) => t.source + ':' + t.id;
const slimTrack = (t) => ({
  source: t.source, id: t.id, username: t.username, filename: t.filename, size: t.size,
  ext: t.ext, bitrate: t.bitrate, title: t.title, artist: t.artist, detail: t.detail, duration: t.duration,
  pending: t.pending, alts: t.alts, art: t.art
});

// Capas: Deezer pelo artista + título, uma consulta por vez e com cache por consulta.
const artMem = new Map();
let artChain = Promise.resolve();
const artQuery = (t) => (String(t.artist || '').split(',')[0] + ' ' + (t.title || '')).trim();
function ensureArt(t) {
  if (t.art) return Promise.resolve(t.art);
  const q = artQuery(t);
  if (!artMem.has(q)) {
    const p = artChain.then(() => window.api.artLookup(q)).catch(() => null);
    artChain = p;
    artMem.set(q, p);
  }
  return artMem.get(q).then((a) => { if (a) t.art = a; return a; });
}

// "Minhas músicas" (♥) e "Recentes"
let saved = store.get('saved', []);
let recent = store.get('recent', []);
const RECENT_MAX = 50;
const isSaved = (t) => saved.some((s) => trackKey(s) === trackKey(t));

function toggleSaved(track) {
  if (isSaved(track)) saved = saved.filter((s) => trackKey(s) !== trackKey(track));
  else saved.unshift(slimTrack(track));
  store.set('saved', saved);
  renderSaved();
  renderRecent();
  renderQueue();
  return isSaved(track);
}

function pushRecent(track) {
  recent = [slimTrack(track), ...recent.filter((t) => trackKey(t) !== trackKey(track))].slice(0, RECENT_MAX);
  store.set('recent', recent);
  renderRecent();
}

// Atualiza o arquivo escolhido (busca do Spotify ou fonte que venceu a corrida) em todo lugar salvo.
function syncFile(track) {
  const file = { username: track.username, filename: track.filename, size: track.size, ext: track.ext,
    bitrate: track.bitrate, detail: track.detail, alts: track.alts, art: track.art, pending: false };
  const all = [...saved, ...recent, ...playlists.flatMap((pl) => pl.tracks)];
  all.forEach((t) => { if (trackKey(t) === trackKey(track)) Object.assign(t, file); });
  savePlaylists();
  store.set('saved', saved);
  store.set('recent', recent);
}

// O cache apaga o que só foi ouvido; músicas salvas e de playlists ficam.
function pruneCache() {
  const keep = [...saved, ...playlists.flatMap((pl) => pl.tracks)]
    .filter((t) => !t.pending && t.filename)
    .flatMap((t) => [t, ...(t.alts || [])])
    .map((t) => ({ filename: t.filename, size: t.size }));
  window.api.cachePrune(keep).catch(() => {});
}

// Faixa vinda do Spotify só tem título/artista: acha o arquivo no Soulseek (uma vez só por faixa).
function resolve(track) {
  if (!track.pending) return Promise.resolve(true);
  track._resolving = track._resolving || providers.soulseek.findBest(track).then((hit) => {
    if (!hit) return false;
    Object.assign(track, { username: hit.username, filename: hit.filename, size: hit.size, ext: hit.ext,
      bitrate: hit.bitrate, detail: hit.detail, alts: hit.alts, pending: false });
    syncFile(track);
    return true;
  }).finally(() => { delete track._resolving; });
  return track._resolving;
}

// Pré-carga: enquanto uma toca, as próximas da fila já vão baixando.
const PREFETCH = 2;
function prefetch(from) {
  state.queue.slice(from, from + PREFETCH).forEach(async (t) => {
    try { if (await resolve(t)) await providers.soulseek.fetch(t); } catch {}
  });
}

// ---------- itens de lista ----------
function trackItem(track, actions, extraClass = '', loading = false) {
  const art = loading
    ? el('div', { class: 'ph dance' }, el('img', { src: 'dance.webp', alt: '' }))
    : el('div', { class: 'ph' }, track.ext ? track.ext.toUpperCase() : '♪');
  if (!loading) {
    ensureArt(track).then((a) => {
      if (!a || !a.s) return;
      art.replaceChildren(el('img', { class: 'cover', src: a.s, alt: '' }));
      art.classList.add('has-art');
    });
  }
  const sub = [track.artist, track.detail].filter(Boolean).join(' · ');
  return el(
    'li',
    { class: 'item ' + track.source + ' ' + extraClass },
    art,
    el('div', { class: 'meta' },
      el('div', { class: 'title', title: track.title }, track.title),
      el('div', { class: 'artist', title: sub }, sub)),
    el('div', { class: 'actions' }, ...actions)
  );
}

function iconBtn(label, text, fn, attrs = {}) {
  return el('button', { 'aria-label': label, title: label, onclick: fn, ...attrs }, text);
}

function playlistBtn(track) {
  return iconBtn('Adicionar à playlist', '♫', (e) => pickPlaylist(track, e.currentTarget), { 'data-pl-btn': '' });
}

function heartBtn(track) {
  const on = isSaved(track);
  const b = iconBtn(on ? 'Tirar de Minhas músicas' : 'Salvar em Minhas músicas', on ? '♥' : '♡', () => {
    const now = toggleSaved(track);
    b.textContent = now ? '♥' : '♡';
    b.classList.toggle('on', now);
    b.title = b.ariaLabel = now ? 'Tirar de Minhas músicas' : 'Salvar em Minhas músicas';
  }, { class: on ? 'on' : '' });
  return b;
}

// lista simples de faixas (Minhas músicas / Recentes): tocar a partir daqui, fila, playlist, ♥
function renderTrackList(ul, empty, tracks) {
  ul.replaceChildren();
  ul.classList.add('still');
  empty.hidden = tracks.length > 0;
  tracks.forEach((t, i) =>
    ul.append(trackItem(t, [
      iconBtn('Tocar a partir daqui', '▶', () => playTracks(tracks, i)),
      iconBtn('Adicionar à fila', '+', () => addToQueue(t)),
      playlistBtn(t),
      heartBtn(t)
    ])));
  stagger(ul);
}
const renderSaved = () => renderTrackList($('saved-list'), $('saved-empty'), saved);
function renderRecent() {
  renderTrackList($('recent-list'), $('recent-empty'), recent);
  $('btn-recent-clear').hidden = !recent.length;
}
$('btn-recent-clear').addEventListener('click', () => {
  recent = [];
  store.set('recent', recent);
  renderRecent();
});

function renderQueue(animate = false) {
  const ul = $('queue');
  ul.replaceChildren();
  ul.classList.toggle('still', !animate);
  state.queue.forEach((track, i) => {
    ul.append(
      trackItem(
        track,
        [
          iconBtn('Tocar', '▶', () => playIndex(i)),
          playlistBtn(track),
          heartBtn(track),
          iconBtn('Remover da fila', '✕', () => removeAt(i))
        ],
        i === state.index ? 'current' : '',
        i === state.index && state.loading
      )
    );
  });
  stagger(ul);
  $('queue-empty').hidden = state.queue.length > 0;
  setQueueCount(state.queue.length);
}

function renderNow() {
  const t = currentTrack();
  $('now-title').textContent = t ? t.title : 'Nada tocando';
  $('now-artist').textContent = t ? [t.artist, t.detail].filter(Boolean).join(' · ') : '';
  const art = $('now-art');
  const want = state.loading ? 'dance.webp' : stage.art || 'icon.png';
  if (art.getAttribute('src') !== want) art.setAttribute('src', want);
  art.className = state.loading ? 'dance' : 'disc' + (state.playing ? ' spin' : '');
  if (!t) { stage.token++; $('stage').hidden = true; }
  $('stage').classList.toggle('loading', state.loading);
  $('stage-status').hidden = !state.loading;
}

function renderPlayButton() {
  const b = $('btn-play');
  b.textContent = state.playing ? '⏸' : '▶';
  b.setAttribute('aria-label', state.playing ? 'Pausar' : 'Tocar');
  document.body.classList.toggle('playing', state.playing);
  $('now-art').classList.toggle('spin', state.playing && !state.loading && !$('now-art').classList.contains('dance'));
  $('stage-art').classList.toggle('spin', state.playing);
}

// ---------- palco central: letra sincronizada ou, sem letra, a capa girando ----------
const stage = { token: 0, art: null, lines: null, idx: -1 };

// Só troca a imagem: redesenhar o player aqui apagava o status de carregamento.
function setStageArt(url) {
  stage.art = url || null;
  $('stage-art').src = url || 'icon.png';
  if (!state.loading) $('now-art').setAttribute('src', stage.art || 'icon.png');
}

// Status enquanto procura/baixa: no player e embaixo da capa pulsando no centro.
function setLoadStatus(text) {
  $('now-artist').textContent = text;
  $('stage-status').textContent = text;
}

async function loadStage(track) {
  const token = ++stage.token;
  stage.lines = null;
  stage.idx = -1;
  $('stage').hidden = false;
  $('lyrics').hidden = true;
  $('lyrics').replaceChildren();
  $('stage-art').hidden = false;

  // tags do FLAC são as mais confiáveis; senão, o que o Deezer reconheceu; senão, o nome do arquivo
  const meta = await window.api.trackMeta(track).catch(() => null);
  const found = await ensureArt(track);
  if (token !== stage.token) return;
  setStageArt((meta && meta.picture) || (found && found.l));
  const artist = (meta && meta.artist) || (found && found.artist) || String(track.artist || '').split(',')[0];
  const title = (meta && meta.title) || (found && found.title) || track.title;

  const ly = await window.api.lyrics({ artist, title, duration: track.duration || state.duration }).catch(() => null);
  if (token !== stage.token || !ly || !(ly.synced || ly.plain)) return;
  const ol = $('lyrics');
  if (ly.synced) {
    stage.lines = ly.synced;
    ly.synced.forEach((l) => ol.append(el('li', { onclick: () => { const p = currentProvider(); if (p) p.seek(l.t); } }, l.text || '♪')));
  } else {
    ly.plain.split(/\r?\n/).forEach((l) => ol.append(el('li', {}, l || ' ')));
  }
  ol.classList.toggle('plain', !ly.synced);
  ol.scrollTop = 0;
  ol.hidden = false;
  $('stage-art').hidden = true;
}

function syncLyrics(pos) {
  if (!stage.lines) return;
  let i = stage.lines.length - 1;
  while (i >= 0 && stage.lines[i].t > pos + 250) i--; // 250 ms adiantado: a linha acende junto com a voz
  if (i === stage.idx) return;
  const ol = $('lyrics');
  if (ol.children[stage.idx]) ol.children[stage.idx].classList.remove('on');
  stage.idx = i;
  const li = ol.children[i];
  if (!li) return;
  li.classList.add('on');
  ol.scrollTo({ top: li.offsetTop - ol.clientHeight / 2 + li.offsetHeight / 2, behavior: 'smooth' });
}

// ---------- fila e reprodução ----------
function addToQueue(track, playNow = false) {
  state.queue.push({ ...track });
  renderQueue(true);
  if (playNow || state.index === -1) playIndex(state.queue.length - 1);
}

function removeAt(i) {
  const wasCurrent = i === state.index;
  state.queue.splice(i, 1);
  if (i < state.index) state.index--;
  if (wasCurrent) {
    playToken++;
    Object.values(providers).forEach((x) => x.pause());
    state.index = -1;
    state.playing = false;
    state.loading = false;
    renderNow();
    renderPlayButton();
    if (state.queue[i]) return playIndex(i);
  }
  renderQueue();
}

async function playIndex(i) {
  const track = state.queue[i];
  if (!track) return;
  const token = ++playToken;
  state.index = i;
  state.duration = 0;
  state.playing = false;
  state.loading = true;
  renderQueue();
  renderNow();
  renderPlayButton();
  $('seek').value = 0;
  $('time-pos').textContent = '0:00';
  $('time-dur').textContent = '0:00';
  Object.values(providers).forEach((p) => p.stop()); // a anterior para já, não depois da busca
  setLoadStatus('Preparando…');
  // enquanto baixa, o palco já mostra a capa (a letra vem quando a música começa)
  stage.token++;
  stage.lines = null;
  stage.art = null;
  $('lyrics').hidden = true;
  $('stage').hidden = false;
  $('stage-art').hidden = false;
  setStageArt(null);
  ensureArt(track).then((a) => { if (token === playToken && !stage.art && a) setStageArt(a.l); });

  try {
    if (track.pending) {
      setLoadStatus('Procurando no Soulseek…');
      const found = await resolve(track);
      if (token !== playToken) return;
      if (!found) {
        const miss = new Error('Não achei "' + track.title + '" no Soulseek. Pulando…');
        miss.notFound = true;
        throw miss;
      }
    }
    await providers[track.source].play(track, (text) => {
      if (token === playToken) setLoadStatus(text);
    });
    if (token !== playToken) return;
    state.playing = true;
    syncFile(track);
    pushRecent(track);
    pruneCache();
    prefetch(i + 1);
    loadStage(track);
    jamOnPlay(track);
  } catch (e) {
    if (token !== playToken) return;
    state.playing = false;
    toast(e.message, e.notFound ? 3500 : 6000);
    if (e.notFound && i < state.queue.length - 1) { state.loading = false; renderNow(); renderPlayButton(); return next(); }
  } finally {
    if (token === playToken) state.loading = false;
  }
  if (token !== playToken) return;
  renderQueue();
  renderNow();
  renderPlayButton();
}

function next() {
  if (state.index < state.queue.length - 1) playIndex(state.index + 1);
  else { state.playing = false; renderPlayButton(); }
}
function prev() {
  if (state.index > 0) playIndex(state.index - 1);
}

function togglePlay() {
  const p = currentProvider();
  if (!p) return;
  if (state.playing) p.pause(); else p.resume();
}

// ---------- eventos do provider ----------
Object.values(providers).forEach((p) => {
  p.on('playing', (v) => {
    if (currentProvider() !== p) return;
    state.playing = v;
    renderPlayButton();
    if (!state.loading) jamSync(); // anfitrião: play/pause vai para a jam
  });
  p.on('progress', (pos, dur) => {
    if (currentProvider() !== p) return;
    state.duration = dur || state.duration;
    if (!state.seeking && state.duration) {
      $('seek').value = Math.round((pos / state.duration) * 1000);
      fillRange($('seek'));
    }
    $('time-pos').textContent = fmt(pos);
    $('time-dur').textContent = fmt(state.duration);
    syncLyrics(pos);
  });
  p.on('end', () => { if (currentProvider() === p) next(); });
  p.on('error', (msg) => toast(msg));
});

// ---------- controles ----------
$('btn-play').addEventListener('click', togglePlay);
$('btn-next').addEventListener('click', next);
$('btn-prev').addEventListener('click', prev);
$('btn-clear').addEventListener('click', () => {
  playToken++;
  Object.values(providers).forEach((p) => p.pause());
  state.queue = [];
  state.index = -1;
  state.playing = false;
  state.loading = false;
  renderQueue(); renderNow(); renderPlayButton();
});

$('seek').addEventListener('input', () => {
  state.seeking = true;
  $('time-pos').textContent = fmt((Number($('seek').value) / 1000) * state.duration);
  fillRange($('seek'));
});
$('seek').addEventListener('change', () => {
  const p = currentProvider();
  if (p && state.duration) p.seek((Number($('seek').value) / 1000) * state.duration);
  setTimeout(jamSync, 300); // depois do seek aplicar
  state.seeking = false;
});

$('volume').addEventListener('input', () => {
  const v = Number($('volume').value) / 100;
  Object.values(providers).forEach((p) => p.setVolume(v));
  fillRange($('volume'));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
  if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    togglePlay();
  }
});

// ---------- abas ----------
const TABS = ['search', 'saved', 'recent', 'playlists'];
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelector('.tabs').dataset.active = name;
  TABS.forEach((n) => ($('tab-' + n).hidden = n !== name));
}
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ---------- busca no Soulseek ----------
let searching = false;

function setSearchStatus(text) {
  const p = $('search-status');
  p.textContent = text;
  p.hidden = !text;
}

async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q || searching) return;
  searching = true;
  $('btn-search').disabled = true;
  $('results').replaceChildren();
  setSearchStatus('Buscando na rede Soulseek…');
  try {
    const tracks = await providers.soulseek.search(q, (files, users) =>
      setSearchStatus('Buscando… ' + files + ' arquivos de ' + users + ' usuários')
    );
    if (!tracks.length) {
      setSearchStatus('Nenhum arquivo de áudio encontrado para "' + q + '". Tente outras palavras.');
      return;
    }
    setSearchStatus(tracks.length + ' resultados, com os de download mais rápido primeiro.');
    const ul = $('results');
    tracks.forEach((t) =>
      ul.append(
        trackItem(t, [
          iconBtn('Baixar e tocar agora', '▶', () => addToQueue(t, true)),
          iconBtn('Adicionar à fila', '+', () => addToQueue(t)),
          playlistBtn(t),
          heartBtn(t)
        ])
      )
    );
    stagger(ul);
  } catch (e) {
    setSearchStatus('');
    toast(e.message);
  } finally {
    searching = false;
    $('btn-search').disabled = false;
  }
}
$('btn-search').addEventListener('click', doSearch);
$('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

// ---------- playlists ----------
function createPlaylist(name, tracks = []) {
  name = (name || '').trim();
  if (!name) { toast('Dê um nome para a playlist.', 4000); return null; }
  const seen = new Set();
  const unique = tracks.map(slimTrack).filter((t) => !seen.has(trackKey(t)) && seen.add(trackKey(t)));
  const pl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, tracks: unique };
  playlists.push(pl);
  savePlaylists();
  renderPlaylists();
  return pl;
}

function addToPlaylist(pl, track) {
  if (pl.tracks.some((t) => trackKey(t) === trackKey(track))) {
    toast('"' + track.title + '" já está em "' + pl.name + '".', 3000, 'ok');
    return;
  }
  pl.tracks.push(slimTrack(track));
  savePlaylists();
  renderPlaylists();
  if (openPlaylistId === pl.id) renderPlaylistDetail();
  toast('Adicionada a "' + pl.name + '".', 2500, 'ok');
}

function playPlaylist(pl, start = 0) {
  if (!pl.tracks.length) { toast('A playlist está vazia.', 3000); return; }
  playTracks(pl.tracks, start);
}

function playTracks(tracks, start = 0) {
  state.queue = tracks.map((t) => ({ ...t }));
  state.index = -1;
  renderQueue(true);
  playIndex(start);
}

// Capa da playlist: a do Spotify quando importada; senão um mosaico com as capas das 4 primeiras faixas.
function playlistCover(pl) {
  const box = el('div', { class: 'pl-cover', onclick: () => openPlaylist(pl.id) }, '♫');
  if (pl.cover) {
    box.replaceChildren(el('img', { src: pl.cover, alt: '' }));
    return box;
  }
  const first = pl.tracks.slice(0, 4);
  Promise.all(first.map(ensureArt)).then((arts) => {
    const urls = arts.filter((a) => a && a.s).map((a) => a.s);
    if (!urls.length) return;
    const use = urls.length >= 4 ? urls.slice(0, 4) : urls.slice(0, 1);
    box.classList.toggle('mosaic', use.length === 4);
    box.replaceChildren(...use.map((u) => el('img', { src: u, alt: '' })));
  });
  return box;
}

function renderPlaylists() {
  const ul = $('pl-list');
  ul.replaceChildren();
  ul.classList.add('still');
  $('pl-empty').hidden = playlists.length > 0;
  playlists.forEach((pl) => {
    const n = pl.tracks.length;
    ul.append(
      el('li', { class: 'pl-row' },
        playlistCover(pl),
        el('button', { class: 'pl-open', onclick: () => openPlaylist(pl.id) },
          el('span', { class: 'pl-name' }, pl.name),
          el('span', { class: 'pl-count' }, n + (n === 1 ? ' faixa' : ' faixas'))),
        el('div', { class: 'actions' }, iconBtn('Tocar playlist', '▶', () => playPlaylist(pl))))
    );
  });
  stagger(ul);
}

function openPlaylist(id) {
  openPlaylistId = id;
  confirmDeleteId = null;
  $('pl-home').hidden = true;
  $('pl-detail').hidden = false;
  renderPlaylistDetail();
}

function closePlaylist() {
  openPlaylistId = null;
  confirmDeleteId = null;
  $('pl-home').hidden = false;
  $('pl-detail').hidden = true;
  renderPlaylists();
}

function renderPlaylistDetail() {
  const pl = playlists.find((p) => p.id === openPlaylistId);
  if (!pl) { closePlaylist(); return; }
  $('pl-title').value = pl.name;
  $('btn-pl-delete').textContent = confirmDeleteId === pl.id ? 'Confirmar exclusão' : 'Excluir playlist';
  const ul = $('pl-tracks');
  ul.replaceChildren();
  ul.classList.add('still');
  $('pl-tracks-empty').hidden = pl.tracks.length > 0;
  pl.tracks.forEach((t, i) => {
    ul.append(
      trackItem(t, [
        iconBtn('Tocar a partir daqui', '▶', () => playPlaylist(pl, i)),
        iconBtn('Adicionar à fila', '+', () => addToQueue(t)),
        heartBtn(t),
        iconBtn('Remover da playlist', '✕', () => {
          pl.tracks.splice(i, 1);
          savePlaylists();
          renderPlaylistDetail();
        })
      ])
    );
  });
  stagger(ul);
}

$('btn-pl-create').addEventListener('click', () => {
  const pl = createPlaylist($('pl-name').value);
  if (pl) {
    $('pl-name').value = '';
    toast('Playlist "' + pl.name + '" criada.', 2500, 'ok');
    openPlaylist(pl.id);
  }
});
$('pl-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-pl-create').click(); });

$('btn-pl-from-queue').addEventListener('click', () => {
  if (!state.queue.length) { toast('A fila está vazia.', 3000); return; }
  const pl = createPlaylist($('pl-name').value, state.queue);
  if (pl) {
    $('pl-name').value = '';
    toast('Fila salva em "' + pl.name + '".', 2500, 'ok');
    openPlaylist(pl.id);
  }
});

const spStatus = (m) => { const s = $('pl-spotify-status'); s.hidden = !m; s.textContent = m || ''; };
let spNames = {};
window.api.onSpotifyProgress((m) => spStatus(m));

$('btn-pl-spotify').addEventListener('click', async () => {
  const btn = $('btn-pl-spotify');
  btn.disabled = true;
  $('sp-picker').hidden = true;
  spStatus('Iniciando…');
  try {
    const r = await window.api.spotifyList();
    if (!r.ok) { spStatus(r.error); return; }
    spNames = {};
    const ul = $('sp-list');
    ul.replaceChildren();
    r.playlists.forEach((p) => {
      spNames[p.id] = p.name;
      const meta = [p.total != null ? p.total + ' faixas' : '', p.isPublic ? 'pública' : 'privada', p.owner && p.id !== '__liked__' ? 'de ' + p.owner : '']
        .filter(Boolean).join(' · ');
      ul.append(el('li', {},
        el('label', {},
          el('input', { type: 'checkbox', value: p.id }),
          el('span', { class: 'sp-name', title: p.name }, p.name),
          el('span', { class: 'sp-meta' }, meta))));
    });
    spStatus(r.playlists.length ? '' : 'Nenhuma playlist encontrada nessa conta.');
    $('sp-picker').hidden = !r.playlists.length;
  } catch (e) {
    spStatus(e.message);
  } finally {
    btn.disabled = false;
  }
});

$('sp-all').addEventListener('click', () => {
  const boxes = [...$('sp-list').querySelectorAll('input')];
  const all = boxes.every((b) => b.checked);
  boxes.forEach((b) => { b.checked = !all; });
});
$('sp-cancel').addEventListener('click', () => { $('sp-picker').hidden = true; spStatus(''); });

$('sp-go').addEventListener('click', async () => {
  const ids = [...$('sp-list').querySelectorAll('input:checked')].map((b) => b.value);
  if (!ids.length) { spStatus('Marque pelo menos uma playlist.'); return; }
  $('sp-go').disabled = true;
  try {
    const r = await window.api.spotifyFetch({ ids, names: spNames });
    if (!r.ok) { spStatus(r.error); return; }
    $('sp-picker').hidden = true;
    importSpotify(r);
  } catch (e) {
    spStatus(e.message);
  } finally {
    $('sp-go').disabled = false;
  }
});

function importSpotify(r) {
  let added = 0;
  r.playlists.forEach((p) => {
    const tracks = p.tracks.map((t) => ({
      source: 'soulseek', id: 'sp:' + t.id, pending: true, title: t.title, artist: t.artist,
      detail: 'Do Spotify', duration: t.duration
    }));
    let pl = playlists.find((x) => x.name === p.name);
    if (!pl) {
      pl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: p.name, tracks: [] };
      playlists.push(pl);
    }
    if (p.cover) pl.cover = p.cover;
    const have = new Set(pl.tracks.map(trackKey));
    tracks.forEach((t) => { if (!have.has(trackKey(t))) { pl.tracks.push(slimTrack(t)); added++; } });
  });
  savePlaylists();
  renderPlaylists();
  let msg = r.playlists.length + ' playlist(s) importada(s) (' + added + ' faixas). Cada música é procurada no Soulseek quando você toca.';
  if (r.capped) msg += '\nPelo link vêm no máximo 100 faixas; para a playlist inteira, use "Minhas playlists do Spotify" (com login).';
  if (r.skipped && r.skipped.length) {
    msg += '\nO Spotify não liberou: ' + r.skipped.slice(0, 5).join(', ') + (r.skipped.length > 5 ? '…' : '') + '.';
  }
  spStatus(msg);
}

async function importSpotifyLink() {
  const link = $('sp-link').value.trim();
  if (!link) return;
  $('btn-sp-link').disabled = true;
  spStatus('Lendo o link do Spotify…');
  try {
    const r = await window.api.spotifyPublic(link);
    if (!r.ok) { spStatus(r.error); return; }
    $('sp-link').value = '';
    importSpotify(r);
  } catch (e) {
    spStatus(e.message);
  } finally {
    $('btn-sp-link').disabled = false;
  }
}
$('btn-sp-link').addEventListener('click', importSpotifyLink);
$('sp-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') importSpotifyLink(); });

$('btn-pl-back').addEventListener('click', closePlaylist);
$('btn-pl-play').addEventListener('click', () => {
  const pl = playlists.find((p) => p.id === openPlaylistId);
  if (pl) playPlaylist(pl);
});
$('pl-title').addEventListener('change', () => {
  const pl = playlists.find((p) => p.id === openPlaylistId);
  if (!pl) return;
  const name = $('pl-title').value.trim();
  if (name) { pl.name = name; savePlaylists(); } else { $('pl-title').value = pl.name; }
});
$('btn-pl-delete').addEventListener('click', () => {
  const pl = playlists.find((p) => p.id === openPlaylistId);
  if (!pl) return;
  if (confirmDeleteId === pl.id) {
    playlists = playlists.filter((p) => p.id !== pl.id);
    savePlaylists();
    closePlaylist();
    return;
  }
  confirmDeleteId = pl.id;
  renderPlaylistDetail();
  setTimeout(() => {
    if (confirmDeleteId === pl.id) { confirmDeleteId = null; if (openPlaylistId === pl.id) renderPlaylistDetail(); }
  }, 4000);
});

// menu "adicionar à playlist"
function closeMenu() {
  const m = document.getElementById('pl-menu');
  if (m) m.remove();
}

function pickPlaylist(track, anchor) {
  closeMenu();
  const menu = el('div', { id: 'pl-menu', class: 'menu', role: 'menu' });
  if (!playlists.length) menu.append(el('div', { class: 'menu-empty' }, 'Nenhuma playlist ainda.'));
  playlists.forEach((pl) =>
    menu.append(
      el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { addToPlaylist(pl, track); closeMenu(); } }, pl.name)
    )
  );
  const input = el('input', { type: 'text', class: 'menu-input', placeholder: 'Nova playlist' });
  const create = () => {
    const pl = createPlaylist(input.value, [track]);
    if (pl) { closeMenu(); toast('Playlist "' + pl.name + '" criada com a música.', 2500, 'ok'); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') create();
    if (e.key === 'Escape') closeMenu();
  });
  menu.append(el('div', { class: 'menu-new' }, input, el('button', { class: 'primary small', onclick: create }, 'Criar')));
  document.body.append(menu);

  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
  const below = r.bottom + 6;
  menu.style.top = (below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below) + 'px';
}

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#pl-menu') && !e.target.closest('[data-pl-btn]')) closeMenu();
});

// ---------- aparência: imagem de fundo e transparência ----------
function setBackground(url) {
  $('bg').style.backgroundImage = url ? 'url("' + url + '")' : '';
}

function applyAlpha(v) {
  document.documentElement.style.setProperty('--panel-alpha', (Number(v) / 100).toFixed(2));
}

$('btn-bg').addEventListener('click', async () => {
  try {
    const url = await window.api.bgChoose();
    if (url) setBackground(url);
  } catch (e) {
    toast(e.message);
  }
});

const savedAlpha = store.get('panelAlpha', 34);
$('alpha').value = savedAlpha;
applyAlpha(savedAlpha);
fillRange($('alpha'));
$('alpha').addEventListener('input', () => {
  applyAlpha($('alpha').value);
  fillRange($('alpha'));
  store.set('panelAlpha', Number($('alpha').value));
});

$('btn-logout').addEventListener('click', () => window.api.authLogout());

// ---------- gaveta da fila e contador ----------
function setQueueCount(n) {
  const b = $('queue-count');
  if (b.textContent !== String(n)) {
    b.textContent = n;
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
  }
}
$('btn-queue').addEventListener('click', () => document.body.classList.toggle('queue-open'));

// ---------- fundo que acompanha o mouse ----------
window.addEventListener('mousemove', (e) => {
  const root = document.documentElement.style;
  root.setProperty('--mx', (e.clientX / window.innerWidth - 0.5).toFixed(3));
  root.setProperty('--my', (e.clientY / window.innerHeight - 0.5).toFixed(3));
});

// ---------- jam: ouvir junto com outros usuários do Roxy ----------
const jam = new Jam((evt, ...a) => onJam(evt, ...a));
const JAM_HEARTBEAT_MS = 15000;
let jamPending = null; // convidado: estado do anfitrião esperando a faixa terminar de baixar
let jamInvite = null;  // convite recebido: { host, id }

function jamSnapshot() {
  const t = currentTrack();
  return {
    track: t ? slimTrack(t) : null,
    next: state.queue.slice(state.index + 1, state.index + 3).map(slimTrack), // o convidado já pré-carrega
    pos: Math.round($('audio').currentTime * 1000),
    playing: state.playing,
    at: Date.now()
  };
}
const jamSync = () => { if (jam.role === 'host') jam.broadcast(jamSnapshot()); };
setInterval(() => { if (jam.role === 'host' && currentTrack()) jamSync(); }, JAM_HEARTBEAT_MS);

// convidado: entra na faixa do anfitrião e se alinha à posição dele
function jamApply(s) {
  if (!s.track) return;
  const cur = currentTrack();
  if (!cur || trackKey(cur) !== trackKey(s.track)) {
    jamPending = s;
    playTracks([s.track, ...(s.next || [])], 0);
    return;
  }
  if (state.loading) { jamPending = s; return; }
  jamAlign(s);
}

function jamAlign(s) {
  const p = currentProvider();
  if (!p) return;
  const want = jamTarget(s);
  if (Math.abs($('audio').currentTime * 1000 - want) > JAM_DRIFT_MS) p.seek(want);
  if (s.playing && $('audio').paused) p.resume();
  if (!s.playing && !$('audio').paused) p.pause();
}

// chamado quando uma faixa começa a tocar
function jamOnPlay(track) {
  if (jam.role === 'host') jamSync();
  if (jam.role === 'guest' && jamPending && trackKey(jamPending.track) === trackKey(track)) {
    jamAlign(jamPending); // a posição conta o tempo que o download levou
    jamPending = null;
  }
}

function renderJam() {
  const chip = $('btn-jam');
  const joined = [...jam.guests.values()].filter((s) => s === 'joined').length;
  chip.textContent = jam.role === 'guest' ? 'Jam de ' + jam.host : jam.role === 'host' ? 'Jam · ' + joined : 'Jam';
  chip.classList.toggle('on', !!jam.role);
  const ul = $('jam-guests');
  ul.replaceChildren();
  for (const [user, st] of jam.guests) {
    ul.append(el('li', {}, user, el('span', {}, st === 'joined' ? 'na jam' : 'convidado')));
  }
  $('jam-text').textContent = jam.role === 'guest'
    ? 'Você está na jam de ' + jam.host + '. O que tocar lá toca aqui, na mesma posição (com 1 a 2 segundos de diferença).'
    : jam.role === 'host'
      ? 'Você é o anfitrião: o que você tocar toca para quem entrou. Cada um baixa o mesmo arquivo.'
      : 'Ouça junto com quem também usa o Roxy. O convite chega por mensagem privada do Soulseek.';
  $('jam-invite-row').hidden = jam.role === 'guest';
  $('btn-jam-leave').hidden = !jam.role;
  $('btn-jam-leave').textContent = jam.role === 'host' ? 'Encerrar a jam' : 'Sair da jam';
}

function onJam(evt, user, arg) {
  if (evt === 'changed') return renderJam();
  if (evt === 'invite') {
    jamInvite = { host: user, id: arg };
    $('jam-card-text').textContent = user + ' te chamou para uma jam.';
    $('jam-card').hidden = false;
    return;
  }
  if (evt === 'joined') { toast(user + ' entrou na jam.', 3000, 'ok'); return jamSync(); }
  if (evt === 'left') return toast(user + (arg === 'decline' ? ' recusou o convite.' : ' saiu da jam.'), 3000, 'ok');
  if (evt === 'ended') return toast(user + ' encerrou a jam.', 3500, 'ok');
  if (evt === 'state') return jamApply(user);
}

$('btn-jam').addEventListener('click', () => {
  const open = $('jam-panel').hidden;
  $('jam-panel').hidden = !open;
  $('btn-jam').setAttribute('aria-expanded', String(open));
  if (open) { renderJam(); $('jam-user').focus(); }
});
async function jamInviteUser() {
  try {
    await jam.invite($('jam-user').value);
    toast('Convite enviado para ' + $('jam-user').value.trim() + '.', 3000, 'ok');
    $('jam-user').value = '';
  } catch (e) {
    toast(e.message);
  }
}
$('btn-jam-invite').addEventListener('click', jamInviteUser);
$('jam-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') jamInviteUser(); });
$('btn-jam-leave').addEventListener('click', () => jam.leave());
$('btn-jam-accept').addEventListener('click', async () => {
  $('jam-card').hidden = true;
  if (!jamInvite) return;
  try { await jam.accept(jamInvite.host, jamInvite.id); toast('Você entrou na jam de ' + jamInvite.host + '.', 3000, 'ok'); }
  catch (e) { toast(e.message); }
});
$('btn-jam-decline').addEventListener('click', () => {
  $('jam-card').hidden = true;
  if (jamInvite) jam.decline(jamInvite.host, jamInvite.id);
  jamInvite = null;
});

// ---------- seu nick do Soulseek (para passar a quem for te chamar para uma jam) ----------
window.api.authState().then((s) => {
  if (!s || !s.user) return;
  $('me').textContent = '@' + s.user;
  $('me').hidden = false;
}).catch(() => {});
$('me').addEventListener('click', () => {
  navigator.clipboard.writeText($('me').textContent.slice(1))
    .then(() => toast('Nick copiado.', 2000, 'ok'))
    .catch(() => {});
});

// ---------- início ----------
(function init() {
  renderQueue();
  renderPlaylists();
  renderSaved();
  renderRecent();
  fillRange($('seek'));
  fillRange($('volume'));
  window.api.bgGet().then(setBackground).catch(() => {});
})();
