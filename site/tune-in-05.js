// Tune In 05: two screens, with one persistent audio element in the rich stage.
const $ = (id) => document.getElementById(id);
const API = '/api/tune-in-01';
const PLACES_API = '/api/tune-in-05';
const DOMAINS = [
  { key: 'core', name: 'Core', meaning: 'Who you are. What is yours to do.', color: '#6521C9', line: '#A737C8' },
  { key: 'love', name: 'Love', meaning: 'Who to let close. How to connect.', color: '#B90044', line: '#CF4090' },
  { key: 'vitality', name: 'Vitality', meaning: 'What feeds you. What drains you.', color: '#FF9112', line: '#C25500' },
  { key: 'abundance', name: 'Abundance', meaning: 'When to move. Which opportunities are yours.', color: '#12A56E', line: '#0A7A52' },
];
const TRACKS = [
  { id: 'quiet-success', name: 'Quiet Success', duration: '3 min', free: true, color: '#6521C9' },
  { id: 'kindred-spirits', name: 'Kindred Spirits', duration: '5 min', free: true, color: '#B90044' },
  { id: 'elysian-surge', name: 'Elysian Surge', duration: '5 min', free: true, color: '#C25500' },
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
let placeTimer = null;
let placeAbort = null;
let calcRequest = 0;
let calcAbort = null;
const placeCache = new Map();
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
  $('instruction').textContent = !frequencies ? 'Enter your birth details to hear your frequencies.'
    : mode === 'music' && currentTrack ? `${currentTrack.name} carries your ${domain.name} frequency.`
      : heardTone ? 'Hear this frequency carried through music below.'
        : `Start with your ${domain.name} tone, then choose a song.`;
  $('domainDescription').textContent = frequencies ? `${domain.name} · ${currentHz()} Hz` : '';
  $('stageIdle').querySelector('p').replaceChildren(
    document.createTextNode('A frequency gives a tone its pitch.'),
    document.createElement('br'),
    document.createTextNode(domain.meaning),
  );
  $('hearTone').lastChild.textContent = `Hear my ${domain.name} tone`;
  $('toneOnly').setAttribute('aria-pressed', mode === 'tone' ? 'true' : 'false');
  $('musicMode').setAttribute('aria-pressed', mode === 'music' ? 'true' : 'false');
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
  $('miniTitle').textContent = mode === 'music' && currentTrack ? currentTrack.name : `Your ${domain.name} frequency`;
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
const stagePath = new URL('tune-in-05-stage.html?center=1&light=1&minui=1', location.href);
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
  if (!Array.isArray(bars) || bars.length !== 103) return '<svg class="song-wave" viewBox="0 0 320 42" aria-hidden="true"></svg>';
  const halo = [], core = [];
  for (let index = 0; index < bars.length; index++) {
    const [top, bottom, rms] = bars[index];
    const x = (index * 3.1).toFixed(2);
    const haloHeight = (top + bottom) * 21;
    const coreHeight = Math.max(0, Math.min(haloHeight - 0.5, rms * 42 * 0.8));
    halo.push(`M${x} ${(21 - top * 21).toFixed(2)}h2.2v${haloHeight.toFixed(2)}h-2.2Z`);
    if (coreHeight > 0) core.push(`M${x} ${(21 - coreHeight * top / (top + bottom || .001)).toFixed(2)}h2.2v${coreHeight.toFixed(2)}h-2.2Z`);
  }
  const color = item.free ? item.color : '#928E91';
  return `<svg class="song-wave" viewBox="0 0 320 42" preserveAspectRatio="none" aria-hidden="true"><path d="${halo.join('')}" fill="${color}" opacity=".32"/><path d="${core.join('')}" fill="${color}"/></svg>`;
}

function songRow(item) {
  const locked = !item.free;
  const selected = item.free && mode === 'music' && currentTrack?.id === item.id;
  return `<article class="song-row${locked ? ' is-locked' : ''}${selected ? ' is-current' : ''}" data-${locked ? 'locked' : 'track'}="${item.id}" role="button" tabindex="0" aria-label="${locked ? 'Explore membership for' : 'Hear'} ${item.name}">${waveformMarkup(item)}<div class="song-copy"><strong class="song-name">${item.name}</strong><span class="song-time">${item.duration}</span></div>${locked ? `<span class="lock-overlay" aria-hidden="true">${SVG_LOCK}</span>` : ''}</article>`;
}

function renderSongs() {
  $('songList').innerHTML = TRACKS.slice(0, 3).map(songRow).join('');
  $('moreLocked').innerHTML = TRACKS.slice(3).map(songRow).join('');
}

function renderFrequencies() {
  $('frequencyControls').innerHTML = DOMAINS.map((item) => `<button type="button" class="frequency-control${domain.key === item.key ? ' selected' : ''}" data-frequency="${item.key}" aria-pressed="${domain.key === item.key ? 'true' : 'false'}"><span>${item.name}</span><span class="frequency-hz">${frequencies ? `${Math.round(frequencies[item.key])} Hz` : '—'}</span></button>`).join('');
  renderSongs();
  setInstruction();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(25000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      invalid_birth_details: 'Please check your birth date, time and place.',
      invalid_place_query: 'Enter at least three letters of your birthplace.',
      invalid_place_request: 'Choose your birthplace from the suggestions.',
      rate_limited: 'A few too many requests. Please wait a minute and try again.',
      calculation_unavailable: 'Frequency calculation is unavailable right now.',
      places_unavailable: 'Place search is unavailable right now.',
      place_resolve_unavailable: 'Birthplace lookup is unavailable right now.',
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

async function selectAudio(nextMode, item = null, preserve = false) {
  if (!frequencies) return promptBirthDetails();
  if (editing) closeEdit(true);
  const previousAudio = stageAudio();
  const retainPosition = preserve && !!previousAudio?.src;
  const position = retainPosition ? previousAudio.currentTime : 0;
  const shouldPlay = retainPosition ? !previousAudio.paused && !previousAudio.ended : true;
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
    ++calcRequest;
    calcAbort?.abort();
    $('findFrequencies').disabled = false;
    $('findFrequencies').textContent = 'Update my sound →';
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

function appURL() {
  const url = new URL('https://app.zodiac.fm/begin'), query = new URLSearchParams(location.search);
  for (const key of ['infclid', 'coupon']) {
    const value = query.get(key);
    if (value && value.length <= 200) url.searchParams.set(key, value);
  }
  return url.href;
}

populateBirthSelects();
$('birthForm').noValidate = true;
function invalidatePendingCalculation() {
  if (!$('findFrequencies').disabled) return;
  ++calcRequest;
  calcAbort?.abort();
  $('findFrequencies').disabled = false;
  $('findFrequencies').textContent = frequencies ? 'Update my sound →' : 'Find my sound →';
}
$('birthForm').addEventListener('input', invalidatePendingCalculation);
$('birthForm').addEventListener('change', invalidatePendingCalculation);
$('unknownTime').addEventListener('change', toggleBirthTimeFields);
$('birthPlace').addEventListener('input', () => {
  selectedPlace = null;
  $('placeResults').replaceChildren();
  $('placeStatus').textContent = '';
  clearTimeout(placeTimer);
  placeAbort?.abort();
  const query = $('birthPlace').value.trim();
  const ticket = ++placeRequest;
  if (query.length < 3) return;
  placeTimer = setTimeout(async () => {
    try {
      const cacheKey = query.toLocaleLowerCase('en-US');
      const cached = placeCache.get(cacheKey);
      let places;
      if (cached && cached.until > Date.now()) places = cached.results;
      else {
        placeAbort = new AbortController();
        const result = await api(`${PLACES_API}?action=search&q=${encodeURIComponent(query)}`, { signal: placeAbort.signal });
        places = Array.isArray(result.results) ? result.results : [];
        placeCache.set(cacheKey, { results: places, until: Date.now() + 90000 });
        if (placeCache.size > 30) placeCache.delete(placeCache.keys().next().value);
      }
      if (ticket !== placeRequest) return;
      $('placeResults').innerHTML = places.slice(0, 6).map((place, index) => {
        const [city, ...context] = place.description.split(',').map((part) => part.trim());
        return `<li><button type="button" data-place="${index}">${escapeHTML(city)}<small>${escapeHTML(context.join(', '))}</small></button></li>`;
      }).join('') + (places.length ? '<li class="maps-credit" translate="no">Google Maps</li>' : '');
      $('placeStatus').textContent = places.length ? '' : 'No matches. Try a nearby town or city.';
      $('placeResults').querySelectorAll('[data-place]').forEach((button) => button.addEventListener('click', () => {
        invalidatePendingCalculation();
        ++placeRequest;
        selectedPlace = places[Number(button.dataset.place)];
        $('birthPlace').value = selectedPlace.description;
        $('placeResults').replaceChildren();
        $('placeStatus').textContent = 'Birthplace selected';
        $('birthError').textContent = '';
      }));
    } catch (error) {
      if (ticket === placeRequest && error?.name !== 'AbortError') $('placeStatus').textContent = error?.message || 'Place search is unavailable. Please try again.';
    }
  }, 450);
});

$('birthForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('birthError').textContent = '';
  let birth;
  try { birth = birthDateTime(); }
  catch (error) { $('birthError').textContent = error.message; return; }
  if (!selectedPlace) {
    $('birthError').textContent = 'Choose your birthplace from the suggestions.';
    $('birthPlace').focus();
    return;
  }
  calcAbort?.abort();
  calcAbort = new AbortController();
  const request = ++calcRequest;
  $('findFrequencies').disabled = true;
  $('findFrequencies').textContent = 'Finding your frequencies…';
  try {
    const place = await api(`${PLACES_API}?action=resolve&date=${birth.date}&placeId=${encodeURIComponent(selectedPlace.placeId)}`, { signal: calcAbort.signal });
    if (![place.latitude, place.longitude, place.timezone].every(Number.isFinite)) throw new Error('Birthplace lookup is unavailable right now.');
    const result = await api(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'calculate', year: birth.year, month: birth.month, day: birth.day, hour: birth.hour, min: birth.min, lat: place.latitude, lon: place.longitude, tzone: place.timezone }),
      signal: calcAbort.signal,
    });
    if (request !== calcRequest) return;
    if (!result.frequencies || DOMAINS.some((item) => !Number.isFinite(result.frequencies[item.key]) || result.frequencies[item.key] < 250 || result.frequencies[item.key] > 950)) throw new Error('Your frequencies could not be calculated. Please try again.');
    const oldHz = frequencies ? currentHz() : null;
    updatePersonalization(result);
    if (editing) closeEdit();
    if (mode && oldHz !== currentHz()) selectAudio(mode, currentTrack, true);
    else if (!mode) $('hearTone').focus({ preventScroll: true });
    if (oldHz !== null) toast('Your frequencies are updated.');
  } catch (error) {
    if (request === calcRequest && error?.name !== 'AbortError') $('birthError').textContent = error?.message || 'Please try again.';
  } finally {
    if (request === calcRequest) {
      $('findFrequencies').disabled = false;
      $('findFrequencies').textContent = frequencies ? 'Update my sound →' : 'Find my sound →';
    }
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
    $('membershipTitle').textContent = TRACKS.find((item) => item.id === locked.dataset.locked)?.name || 'More time to tune in.';
    $('membershipDialog').showModal();
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
$('appLink').href = appURL(); $('appContinue').href = appURL();
renderFrequencies();
fetch('tune-in-02-waveforms.json')
  .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
  .then((bars) => { waveforms = bars; renderSongs(); })
  .catch(() => { $('stageError').textContent = 'Song waveforms are unavailable right now.'; });
fetch('tune-in-01-bands.json')
  .then((response) => response.ok ? response.json() : {})
  .then((readings) => { bands = readings; })
  .catch(() => {});
