// Tune In 07 demo: offline birthplace finder and sample frequencies, one persistent audio element.
const $ = (id) => document.getElementById(id);
const API = '/api/tune-in-01';
const DOMAINS = [
  { key: 'core', name: 'Core', meaning: 'Listening to this frequency tunes you in to who you are and what is yours to do.', color: '#6521C9', line: '#A737C8', ink: '#6521C9' },
  { key: 'love', name: 'Love', meaning: 'Listening to this frequency tunes you in to who to let close and how to connect.', color: '#B90044', line: '#CF4090', ink: '#B90044' },
  { key: 'vitality', name: 'Vitality', meaning: 'Listening to this frequency tunes you in to what feeds you and what drains you.', color: '#FF9112', line: '#C25500', ink: '#C25500' },
  { key: 'abundance', name: 'Abundance', meaning: 'Listening to this frequency tunes you in to when to move and which opportunities are yours.', color: '#12A56E', line: '#0A7A52', ink: '#0A7A52' },
];
const TRACKS = [
  { id: 'quiet-success', name: 'Quiet Success', duration: '3 min', free: true },
  { id: 'kindred-spirits', name: 'Kindred Spirits', duration: '5 min', free: true },
  { id: 'elysian-surge', name: 'Elysian Surge', duration: '5 min', free: true },
  { id: 'starseed', name: 'Starseed', duration: '9 min' },
  { id: 'astrolith', name: 'Astrolith', duration: '9 min' },
  { id: 'cosmic-drift', name: 'Cosmic Drift', duration: '25 min' },
  { id: 'temple-space', name: 'Temple Space', duration: '30 min' },
  { id: 'galactic-deep', name: 'Galactic Deep', duration: '60 min', waveform: 'galactic-slumber' },
];
const SVG_PLAY = '<svg class="icon"><use href="#i-play"/></svg>';
const SVG_PAUSE = '<svg class="icon"><use href="#i-pause"/></svg>';
const SVG_LOCK = '<svg class="icon"><use href="#i-lock"/></svg>';
const frame = $('stageFrame');
const toneCache = new Map();
const urlCache = new Map();
let waveforms = {};
let bands = {};
let frequencies = null;
let domain = DOMAINS[0];
let currentTrack = null;
let lastMusicTrack = null;
let mode = null;
let selectedPlace = null;
let placeRequest = 0;
let places = [];
let placesReady = false;
let loadRequest = 0;
let loadAbort = null;
let activeKey = '';
let stageReady = false;
let stageVisible = true;
let editing = false;
let editSnapshot = null;
let heardTone = false;
let heardMusic = false;
let loading = false;
let pendingLockedTrack = null;

const currentHz = () => Math.round(frequencies[domain.key]);
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const stage = () => stageReady ? frame.contentWindow?.zStage : null;
const stageAudio = () => stage()?.audio;

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  setTimeout(() => { if ($('toast').textContent === message) $('toast').hidden = true; }, 4500);
}

function setInstruction() {
  $('instruction').textContent = !frequencies ? 'Enter your birth details to try the demo player.'
    : mode === 'music' ? 'Switch frequencies while the song plays.'
      : 'Choose a song with this ' + domain.name + ' tone inside.';
  $('domainDescription').textContent = frequencies ? `${domain.name} · ${currentHz()} Hz` : '';
  $('stageIdle').querySelector('p').textContent = 'A frequency gives a tone its pitch.';
  $('hearTone').lastChild.textContent = `Hear the ${domain.name} tone`;
  $('toneOnly').setAttribute('aria-pressed', mode === 'tone' ? 'true' : 'false');
  $('musicMode').setAttribute('aria-pressed', mode === 'music' ? 'true' : 'false');
}

function setDomainPresentation() {
  $('frequencyExplanation').textContent = domain.meaning;
  $('listenScreen').style.setProperty('--active-color', domain.color);
  $('listenScreen').style.setProperty('--active-ink', domain.ink);
}

function updateControls() {
  const audio = stageAudio();
  const playing = !!audio && !audio.paused && !audio.ended;
  const available = !!audio?.src;
  $('stageToggle').hidden = !available && !loading;
  $('stageToggle').innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
  $('stageToggle').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('miniToggle').innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
  $('miniToggle').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  $('miniTitle').textContent = mode === 'music' && currentTrack ? currentTrack.name : `Sample ${domain.name} tone`;
  $('miniMeta').textContent = frequencies ? `${domain.name} · ${currentHz()} Hz` : '';
  $('miniPlayer').hidden = !available || stageVisible || editing || !$('welcomeScreen').hidden;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function bindStage() {
  stageReady = !!frame.contentWindow?.zStage;
  const audio = stageAudio();
  if (!audio || audio.dataset.parentBound) return;
  audio.dataset.parentBound = '1';
  for (const event of ['play', 'pause', 'ended', 'waiting', 'playing']) audio.addEventListener(event, updateControls);
  audio.addEventListener('play', () => {
    $('stageError').textContent = '';
    if (mode === 'music') { heardMusic = true; $('afterListen').hidden = false; }
    if (mode === 'tone') heardTone = true;
    setInstruction();
  });
  audio.addEventListener('error', () => {
    if (!loading && audio.src) $('stageError').textContent = 'The sound could not load. Tap Play to try again.';
  });
  updateControls();
}

frame.addEventListener('load', bindStage);
// Keep one same-origin frame alive for all tone and music transitions. Its source is blank until selection.
const stagePath = new URL('tune-in-10-stage.html?center=1&light=1&minui=1', location.href);
if (new URL(frame.src, location.href).pathname !== stagePath.pathname) frame.src = stagePath.href;
else bindStage();

function waitForStage() {
  if (stage()) return Promise.resolve(stage());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { frame.removeEventListener('load', ready); reject(new Error('The player is taking too long to load. Tap again.')); }, 12000);
    function ready() { bindStage(); if (!stage()) return; clearTimeout(timeout); frame.removeEventListener('load', ready); resolve(stage()); }
    frame.addEventListener('load', ready);
  });
}

function waveformMarkup(item) {
  const bars = waveforms[item.waveform || item.id];
  if (!Array.isArray(bars) || bars.length !== 103) return '<svg class="song-wave" viewBox="0 0 320 32" aria-hidden="true"></svg>';
  const colors = item.free
    ? {
        core: ['#A737C8', '#6521C9'],
        love: ['#CF4090', '#B90044'],
        vitality: ['#FFC251', '#FF9112'],
        abundance: ['#46D99A', '#12A56E'],
      }[domain.key]
    : ['#B8B4B7', '#928E91'];
  const [gradEnd, primary] = colors;
  const gradientId = `wg-${domain.key}-${item.id}`;
  const height = 32, center = height / 2;
  const halo = [], core = [];
  for (let index = 0; index < bars.length; index++) {
    const [top, bottom, rms] = bars[index];
    const x = (index * 3.1).toFixed(2);
    const total = top + bottom;
    const haloHeight = total * center;
    const coreHeight = Math.max(0, Math.min(haloHeight - .5, rms * height * .8));
    halo.push(`<rect x="${x}" y="${(center - top * center).toFixed(2)}" width="2.2" height="${haloHeight.toFixed(2)}"/>`);
    if (coreHeight > 0) core.push(`<rect x="${x}" y="${(center - coreHeight * top / (total || .001)).toFixed(2)}" width="2.2" height="${coreHeight.toFixed(2)}"/>`);
  }
  return `<svg class="song-wave" viewBox="0 0 320 32" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${gradEnd}"/><stop offset="100%" stop-color="${primary}"/></linearGradient></defs><g fill="url(#${gradientId})" opacity=".38">${halo.join('')}</g><g fill="url(#${gradientId})">${core.join('')}</g></svg>`;
}

function songRow(item) {
  const locked = !item.free;
  const selected = item.free && mode === 'music' && currentTrack?.id === item.id;
  return `<article class="song-row${locked ? ' is-locked' : ''}${selected ? ' is-current' : ''}" data-${locked ? 'locked' : 'track'}="${item.id}" role="button" tabindex="0" aria-label="${locked ? 'Explore membership for' : 'Hear'} ${item.name}"><span class="song-action" aria-hidden="true">${locked ? SVG_LOCK : SVG_PLAY}</span><div class="song-body"><div class="song-copy"><strong class="song-name">${item.name}</strong><span class="song-time">${item.duration}</span></div>${waveformMarkup(item)}</div></article>`;
}

function renderSongs() {
  $('songList').innerHTML = TRACKS.slice(0, 3).map(songRow).join('');
  $('lockedPreview').innerHTML = songRow(TRACKS[3]);
  $('moreLocked').innerHTML = TRACKS.slice(4).map(songRow).join('');
}

function renderFrequencies() {
  $('frequencyControls').innerHTML = DOMAINS.map((item) => `<button type="button" class="frequency-control${domain.key === item.key ? ' selected' : ''}" data-frequency="${item.key}" aria-pressed="${domain.key === item.key ? 'true' : 'false'}"><span>${item.name}</span><span class="frequency-hz">${frequencies ? `${Math.round(frequencies[item.key])} Hz` : '—'}</span></button>`).join('');
  setDomainPresentation();
  renderSongs();
  setInstruction();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(25000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      rate_limited: 'A few too many requests. Please wait a minute and try again.',
      audio_signing_unavailable: 'The music connection is unavailable right now.',
      audio_unavailable: 'That recording is unavailable right now.',
    };
    throw new Error(messages[body.error?.code] || 'Please try again in a moment.');
  }
  return body;
}

function encodeWav(buf) {
  const samples = buf.getChannelData(0), count = samples.length, sampleRate = buf.sampleRate;
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  function word(offset, value) { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); }
  word(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) { const value = Math.max(-1, Math.min(1, samples[index])); view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true); }
  return bytes;
}

function toneURL(hz) {
  if (toneCache.has(hz)) return toneCache.get(hz);
  const task = (async () => {
    const sampleRate = 22050, duration = 180;
    const context = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
    const oscillator = context.createOscillator(); oscillator.type = 'sine'; oscillator.frequency.value = hz;
    const gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination);
    gain.gain.setValueAtTime(0, 0); gain.gain.linearRampToValueAtTime(.7, 2.5);
    for (let t = 7; t < duration - 5; t += 6) gain.gain.linearRampToValueAtTime(.42 + .28 * Math.sin(t * .9) + .06 * Math.sin(t * .23), t);
    gain.gain.linearRampToValueAtTime(0, duration - .2); oscillator.start();
    const rendered = await context.startRendering();
    return URL.createObjectURL(new Blob([encodeWav(rendered)], { type: 'audio/wav' }));
  })();
  toneCache.set(hz, task);
  task.catch(() => toneCache.delete(hz));
  return task;
}

async function signedAudioURL(item, hz, signal) {
  const key = `${item.id}-${hz}`;
  const cached = urlCache.get(key);
  if (cached && cached.until > Date.now()) return cached.url;
  const result = await api(`${API}?action=audio&track=${encodeURIComponent(item.id)}&hz=${hz}`, { signal });
  if (typeof result.url !== 'string' || !result.url.startsWith('https://')) throw new Error('The recording could not be loaded.');
  urlCache.set(key, { url: result.url, until: Date.now() + 240000 });
  return result.url;
}

function showLoading(text) {
  loading = true;
  $('stageLoading').textContent = text;
  $('stageLoading').hidden = false;
  $('stageError').textContent = '';
  updateControls();
}

function clearLoading() {
  loading = false;
  $('stageLoading').hidden = true;
  updateControls();
}

async function selectAudio(nextMode, item = null, preserve = false, autoplay = true) {
  if (!frequencies) return promptBirthDetails();
  if (editing) closeEdit(true);
  const previousAudio = stageAudio();
  const retainPosition = preserve && !!previousAudio?.src;
  const position = retainPosition ? previousAudio.currentTime : 0;
  const shouldPlay = retainPosition ? !previousAudio.paused && !previousAudio.ended : autoplay;
  ++loadRequest;
  loadAbort?.abort();
  const request = loadRequest;
  loadAbort = new AbortController();
  mode = nextMode;
  currentTrack = item;
  if (nextMode === 'music' && item) lastMusicTrack = item;
  const hz = currentHz();
  const key = `${nextMode}:${item?.id || 'tone'}:${hz}`;
  renderFrequencies();
  $('stageIdle').hidden = true;
  frame.hidden = false;
  if (stageReady) frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('resize'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showLoading(nextMode === 'tone' ? 'Preparing your frequency…' : 'Preparing your music…');
  try {
    const player = await waitForStage();
    if (request !== loadRequest) return;
    // Pause immediately when changing selections; a stale request cannot restart it.
    player.pause();
    const url = nextMode === 'tone' ? await toneURL(hz) : await signedAudioURL(item, hz, loadAbort.signal);
    if (request !== loadRequest) return;
    activeKey = key;
    await player.switch(url, hz, nextMode === 'tone' ? `${domain.name} · Pure Tone` : item.name, domain.color, domain.line, { position, play: shouldPlay });
    if (request !== loadRequest) return;
    clearLoading();
  } catch (error) {
    if (request !== loadRequest) return;
    clearLoading();
    $('stageError').textContent = error?.name === 'NotAllowedError'
      ? 'Ready to listen. Tap Play.'
      : error?.name === 'AbortError' ? '' : error?.message || 'The sound could not load. Tap again.';
  }
  updateControls();
}

async function toggleStage() {
  if (!frequencies || !mode) return promptBirthDetails();
  try {
    const player = await waitForStage();
    if (loading) return;
    if (activeKey !== `${mode}:${currentTrack?.id || 'tone'}:${currentHz()}` || !player.audio.src) return selectAudio(mode, currentTrack);
    await player.toggle();
    $('stageError').textContent = '';
  } catch (error) {
    $('stageError').textContent = error?.name === 'NotAllowedError' ? 'Tap Play again to listen.' : 'Playback could not start. Tap Play to try again.';
  }
  updateControls();
}

function promptBirthDetails() {
  $('welcomeScreen').hidden = false;
  $('listenScreen').hidden = true;
  $('birthPlace').focus({ preventScroll: true });
  $('birthError').textContent = 'Enter your birth details first to hear your frequencies.';
  $('welcomeScreen').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleBirthTimeFields() {
  for (const id of ['birthHour', 'birthMinute', 'birthPeriod']) $(id).disabled = $('unknownTime').checked;
}

function populateBirthSelects() {
  const addOptions = (id, items) => {
    const select = $(id);
    if (select.options.length > 1) return;
    for (const [value, label] of items) select.add(new Option(label, String(value)));
  };
  addOptions('birthMonth', Array.from({ length: 12 }, (_, index) => [index + 1, new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2000, index, 1))]));
  addOptions('birthDay', Array.from({ length: 31 }, (_, index) => [index + 1, String(index + 1)]));
  addOptions('birthYear', Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => [new Date().getFullYear() - index, String(new Date().getFullYear() - index)]));
  addOptions('birthHour', Array.from({ length: 12 }, (_, index) => [index + 1, String(index + 1)]));
  addOptions('birthMinute', Array.from({ length: 60 }, (_, index) => [index, String(index).padStart(2, '0')]));
  toggleBirthTimeFields();
}

function birthDateTime() {
  const year = Number($('birthYear').value), month = Number($('birthMonth').value), day = Number($('birthDay').value);
  const dateValue = new Date(year, month - 1, day), today = new Date();
  if (!year || !month || !day || year < 1900 || year > today.getFullYear() ||
      dateValue.getFullYear() !== year || dateValue.getMonth() !== month - 1 || dateValue.getDate() !== day ||
      dateValue > new Date(today.getFullYear(), today.getMonth(), today.getDate())) throw new Error('Choose a valid birth date from 1900 through today.');
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if ($('unknownTime').checked) return { year, month, day, hour: 12, min: 0, date, clock: '12:00' };
  const hour12 = Number($('birthHour').value), min = Number($('birthMinute').value), period = $('birthPeriod').value;
  if (!hour12 || hour12 < 1 || hour12 > 12 || $('birthMinute').value === '' || min < 0 || min > 59 || !['AM', 'PM'].includes(period)) throw new Error('Choose a valid birth hour, minute and AM or PM, or use the noon estimate.');
  const hour = hour12 % 12 + (period === 'PM' ? 12 : 0);
  return { year, month, day, hour, min, date, clock: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}

function snapshotForm() {
  return { place: selectedPlace, fields: Object.fromEntries(['birthMonth', 'birthDay', 'birthYear', 'birthPlace', 'birthHour', 'birthMinute', 'birthPeriod', 'unknownTime'].map((id) => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])) };
}

function restoreForm(snapshot) {
  if (!snapshot) return;
  selectedPlace = snapshot.place;
  for (const [id, value] of Object.entries(snapshot.fields)) { if ($(id).type === 'checkbox') $(id).checked = value; else $(id).value = value; }
  toggleBirthTimeFields();
  $('placeResults').replaceChildren();
  $('birthError').textContent = '';
}

function openEdit() {
  if (!frequencies) return;
  // Ignore any selection whose asynchronous signing or tone generation is still finishing.
  ++loadRequest;
  loadAbort?.abort();
  clearLoading();
  editSnapshot = snapshotForm();
  editing = true;
  $('welcomeScreen').hidden = false;
  $('listenScreen').hidden = true;
  $('cancelEdit').hidden = false;
  $('welcomeScreen').scrollIntoView({ behavior: 'smooth', block: 'start' });
  updateControls();
}

function closeEdit(restore = false) {
  if (restore) {
    $('findFrequencies').disabled = false;
    $('findFrequencies').textContent = 'Try new frequencies';
    restoreForm(editSnapshot);
  }
  editing = false;
  $('welcomeScreen').hidden = true;
  $('listenScreen').hidden = false;
  $('cancelEdit').hidden = true;
  frame.hidden = !mode;
  $('stageIdle').hidden = !!mode;
  updateControls();
}

function updatePersonalization(result) {
  frequencies = Object.fromEntries(DOMAINS.map((item) => [item.key, Number(result.frequencies[item.key])]));
  $('headerShare').hidden = false;
  $('editBirth').hidden = false;
  $('welcomeScreen').hidden = true;
  $('listenScreen').hidden = false;
  $('stageIdle').hidden = !!mode;
  frame.hidden = !mode || editing;
  $('birthError').textContent = '';
  renderFrequencies();
  updateControls();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openMembership(track = null) {
  pendingLockedTrack = track;
  $('membershipTitle').textContent = 'Keep tuning in.';
  $('unlockTrack').textContent = track?.name || 'more music';
  $('unlockIntro').hidden = false;
  $('checkoutPreview').hidden = true;
  $('unlockError').textContent = '';
  $('membershipDialog').showModal();
}

function showCheckoutPreview() {
  const email = $('unlockEmail').value.trim();
  const phone = $('unlockPhone').value.trim();
  const phoneDigits = phone.replace(/\D/g, '');
  if (!$('unlockEmail').validity.valid || !email) {
    $('unlockError').textContent = 'Enter a valid email address.';
    $('unlockEmail').focus();
    return;
  }
  if (phoneDigits.length < 7) {
    $('unlockError').textContent = 'Enter a phone number with at least 7 digits.';
    $('unlockPhone').focus();
    return;
  }
  let birth;
  try { birth = birthDateTime(); }
  catch (error) { $('unlockError').textContent = error.message; return; }
  const date = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(birth.year, birth.month - 1, birth.day));
  const time = $('unknownTime').checked ? '12:00 noon estimate' : birth.clock;
  const details = $('checkoutDetails');
  details.replaceChildren();
  const addDetail = (label, value) => {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = value;
    details.append(term, description);
  };
  addDetail('Email', email);
  addDetail('Phone', phone);
  addDetail('Birth date and time', `${date}, ${time}`);
  addDetail('Birth place', $('birthPlace').value.trim());
  addDetail('Selected song', pendingLockedTrack?.name || 'More music');
  addDetail('Sample frequencies', DOMAINS.map((item) => `${item.name}: ${Math.round(frequencies[item.key])} Hz`).join(', '));
  $('unlockIntro').hidden = true;
  $('checkoutPreview').hidden = false;
}

function shareURL() {
  const url = new URL(location.href), query = new URLSearchParams(location.search);
  url.search = ''; url.hash = '';
  for (const key of ['infclid', 'coupon', 'utm_source', 'utm_medium', 'utm_campaign']) {
    const value = query.get(key);
    if (value && value.length <= 200) url.searchParams.set(key, value);
  }
  if (currentTrack?.free) url.searchParams.set('track', currentTrack.id);
  return url.href;
}

populateBirthSelects();
$('birthForm').noValidate = true;
$('unknownTime').addEventListener('change', toggleBirthTimeFields);
const normalizePlace = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').trim();
const placeParts = (place) => [...new Set([place.name, place.region, place.country].filter(Boolean).map((part) => part.trim()))];
const placeDescription = (place) => placeParts(place).join(', ');

function renderPlaces() {
  const query = $('birthPlace').value.trim();
  const ticket = ++placeRequest;
  $('placeResults').replaceChildren();
  $('placeStatus').textContent = '';
  if (query.length < 2 || query.length > 120) return;
  const needle = normalizePlace(query);
  const found = places.filter((place) => normalizePlace(placeDescription(place)).includes(needle))
    .sort((left, right) => {
      const score = (place) => normalizePlace(place.name) === needle ? 0 : normalizePlace(place.name).startsWith(needle) ? 1 : 2;
      return score(left) - score(right) || left.name.localeCompare(right.name);
    }).slice(0, 6);
  $('placeResults').innerHTML = found.map((place, index) =>
    `<li><button type="button" data-place="${index}">${escapeHTML(place.name)}<small>${escapeHTML(placeParts(place).slice(1).join(', '))}</small></button></li>`
  ).join('') + `<li><button type="button" data-place="typed">Use “${escapeHTML(query)}”<small>As entered · demo only</small></button></li>`;
  $('placeStatus').textContent = 'Choose a suggestion, or use the place you typed.';
  $('placeResults').querySelectorAll('[data-place]').forEach((button) => button.addEventListener('click', () => {
    if (ticket !== placeRequest) return;
    selectedPlace = button.dataset.place === 'typed'
      ? { description: query, verified: false }
      : { description: placeDescription(found[Number(button.dataset.place)]), verified: true };
    $('birthPlace').value = selectedPlace.description;
    ++placeRequest;
    $('placeResults').replaceChildren();
    $('placeStatus').textContent = 'Place selected';
    $('birthError').textContent = '';
  }));
}

$('birthPlace').addEventListener('input', () => { selectedPlace = null; renderPlaces(); });
fetch('tune-in-places.json')
  .then((response) => { if (!response.ok) throw new Error('Local places unavailable'); return response.json(); })
  .then((list) => { if (Array.isArray(list)) { places = list.filter((item) => typeof item.name === 'string' && typeof item.country === 'string'); placesReady = true; if (!selectedPlace) renderPlaces(); } })
  .catch(() => { placesReady = false; if (!selectedPlace) renderPlaces(); });

// Four distinct, uniform sample integers on the same 250–950 Hz display scale.
function randomBelow(bound) {
  const sample = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / bound) * bound;
  do { crypto.getRandomValues(sample); } while (sample[0] >= limit);
  return sample[0] % bound;
}
function demoFrequencies() {
  const available = Array.from({ length: 701 }, (_, index) => index + 250);
  return Object.fromEntries(DOMAINS.map((item, index) => {
    const chosen = index + randomBelow(available.length - index);
    [available[index], available[chosen]] = [available[chosen], available[index]];
    return [item.key, available[index]];
  }));
}

$('birthForm').addEventListener('submit', (event) => {
  event.preventDefault();
  $('birthError').textContent = '';
  try { birthDateTime(); }
  catch (error) { $('birthError').textContent = error.message; return; }
  const typedPlace = $('birthPlace').value.trim();
  if (typedPlace.length < 2 || typedPlace.length > 120) {
    $('birthError').textContent = 'Enter a city or town (2–120 characters).';
    $('birthPlace').focus();
    return;
  }
  if (!selectedPlace) selectedPlace = { description: typedPlace, verified: false };
  try {
    const result = { frequencies: demoFrequencies() };
    const oldHz = frequencies ? currentHz() : null;
    updatePersonalization(result);
    if (editing) closeEdit();
    if (mode && oldHz !== currentHz()) selectAudio(mode, currentTrack, true);
    else if (!mode) $('hearTone').focus({ preventScroll: true });
    if (oldHz !== null) toast('New demo frequencies are ready.');
  } catch (error) {
    $('birthError').textContent = error?.message || 'The demo could not start. Please try again.';
  }
});

document.addEventListener('click', async (event) => {
  const frequency = event.target.closest('[data-frequency]');
  if (frequency) {
    if (!frequencies) return promptBirthDetails();
    const previousDomain = domain;
    domain = DOMAINS.find((item) => item.key === frequency.dataset.frequency) || domain;
    if (domain === previousDomain) return;
    if (!mode) { renderFrequencies(); return; }
    return selectAudio(mode, currentTrack, true);
  }
  const song = event.target.closest('[data-track]');
  if (song) return selectAudio('music', TRACKS.find((item) => item.id === song.dataset.track));
  const locked = event.target.closest('[data-locked]');
  if (locked) {
    openMembership(TRACKS.find((item) => item.id === locked.dataset.locked) || null);
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'open-stage') { $('playerWindow').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (action === 'share') {
    try { if (navigator.share) await navigator.share({ title: 'Tune In · Zodiac.fm', url: shareURL() }); else { await navigator.clipboard.writeText(shareURL()); toast('Link copied.'); } }
    catch (error) { if (error.name !== 'AbortError') toast('Share is unavailable in this browser.'); }
  }
  if (event.target.closest('[data-close]')) event.target.closest('dialog')?.close();
});

document.addEventListener('keydown', (event) => {
  const row = event.target.closest?.('.song-row[role="button"]');
  if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); row.click(); }
});
document.addEventListener('tune-preview-tone', () => {
  if (frequencies && mode === null) selectAudio('tone', null, false, false);
});
$('stageToggle').addEventListener('click', toggleStage);
$('miniToggle').addEventListener('click', toggleStage);
$('hearTone').addEventListener('click', () => selectAudio('tone'));
$('toneOnly').addEventListener('click', () => selectAudio('tone'));
$('musicMode').addEventListener('click', () => selectAudio('music', lastMusicTrack || TRACKS[0]));
$('editBirth').addEventListener('click', openEdit);
$('cancelEdit').addEventListener('click', () => closeEdit(true));
new IntersectionObserver(([entry]) => { stageVisible = entry.intersectionRatio >= .18; updateControls(); }, { threshold: [.18] }).observe($('playerWindow'));
if ('mediaSession' in navigator) {
  try { navigator.mediaSession.setActionHandler('play', () => { if (stageAudio()?.paused) toggleStage(); }); } catch {}
  try { navigator.mediaSession.setActionHandler('pause', () => { if (!stageAudio()?.paused) toggleStage(); }); } catch {}
}
$('appContinue').addEventListener('click', (event) => {
  event.preventDefault();
  openMembership();
});
$('unlockForm').noValidate = true;
$('unlockForm').addEventListener('submit', (event) => {
  event.preventDefault();
  $('unlockError').textContent = '';
  showCheckoutPreview();
});
$('backToContact').addEventListener('click', () => {
  $('checkoutPreview').hidden = true;
  $('unlockIntro').hidden = false;
  $('unlockEmail').focus();
});
$('backToMusic').addEventListener('click', () => {
  $('membershipDialog').close();
});
renderFrequencies();
fetch('tune-in-02-waveforms.json')
  .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
  .then((bars) => { waveforms = bars; renderSongs(); })
  .catch(() => { $('stageError').textContent = 'Song waveforms are unavailable right now.'; });
fetch('tune-in-01-bands.json')
  .then((response) => response.ok ? response.json() : {})
  .then((readings) => { bands = readings; })
  .catch(() => {});
