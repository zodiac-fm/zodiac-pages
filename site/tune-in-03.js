// Tune In 03: personal frequencies first, then the matched music library.
const $ = (id) => document.getElementById(id);
const API = '/api/tune-in-01';
const DOMAINS = [
  { key: 'core', name: 'Core', description: 'Identity, self-trust & direction.', color: '#6521C9', end: '#A737C8', soft: '#D2C8FF', tint: '#EFECFF', text: '#6521C9' },
  { key: 'love', name: 'Love', description: 'Connection, belonging & boundaries.', color: '#B90044', end: '#CF4090', soft: '#FFBDC3', tint: '#FFE8EA', text: '#B90044' },
  { key: 'vitality', name: 'Vitality', description: 'Energy, pace & rest.', color: '#FF9112', end: '#FFC251', soft: '#FFC392', tint: '#FFEADA', text: '#C25500' },
  { key: 'abundance', name: 'Abundance', description: 'Opportunity, timing & value.', color: '#12A56E', end: '#46D99A', soft: '#8FE1BE', tint: '#DCF4E8', text: '#0A7A52' },
];
const TRACKS = [
  { id: 'quiet-success', type: 'quiet', name: 'Quiet Success', duration: '3 min', seconds: 180, tags: 'RESET · CALM · DE-STRESS · UNWIND · GROUND', free: true },
  { id: 'kindred-spirits', type: 'kindred', name: 'Kindred Spirits', duration: '5 min', seconds: 300, tags: 'ENERGY · HAPPY · BRIGHT · FLOW · MOTIVATE', free: true },
  { id: 'elysian-surge', type: 'elysian', name: 'Elysian Surge', duration: '5 min', seconds: 300, tags: 'ENERGY · MOTIVATE · BUILD · DRIVE · FLOW', free: true },
  { id: 'starseed', type: 'starseed', name: 'Starseed', duration: '9 min', seconds: 540, tags: 'MEDITATE · DEEP · DREAMY · CALM · UNWIND' },
  { id: 'astrolith', type: 'astrolith', name: 'Astrolith', duration: '9 min', seconds: 540, tags: 'FOCUS · MEDITATE · CALM · DEEP · FLOW' },
  { id: 'cosmic-drift', type: 'cosmic', name: 'Cosmic Drift', duration: '25 min', seconds: 1500, tags: 'FOCUS · MEDITATE · NAP · CALM · DREAMY' },
  { id: 'temple-space', type: 'temple', name: 'Temple Space', duration: '30 min', seconds: 1800, tags: 'GROUND · MEDITATE · FOCUS · CALM · FLOW' },
  { id: 'galactic-deep', type: 'galactic', waveform: 'galactic-slumber', name: 'Galactic Deep', duration: '60 min', seconds: 3600, tags: 'SLEEP · FOCUS · MEDITATE · UNWIND · DEEP' },
];
const FREE = TRACKS.filter((track) => track.free);
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 10V7a3 3 0 0 1 6 0v3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const audio = $('musicAudio');
const findFrequenciesMarkup = $('findFrequencies').innerHTML;
let hz = null;
let personalized = false;
let toneHeard = false;
const heardDomains = new Set();
let usedNoonEstimate = false;
let domain = DOMAINS[0];
let track = FREE.find((item) => item.id === new URLSearchParams(location.search).get('track')) || FREE[0];
let waveforms = {};
let envelopes = {};
let bands = {};
let selectedPlace = null;
let placeRequest = 0;
let placeTimer;
let audioRequest = 0;
let audioAbort = null;
let requestedPlayIntent = false;
let loadedKey = '';
let loading = false;
let audioStarted = false;
let toneOn = false;
let toneRequest = 0;
let context;
let oscillator;
let gain;
let stageVisible = true;
let lastFocus = null;
const urlCache = new Map();

const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const currentHz = () => clamp(Math.round(hz[domain.key]), 250, 950);
const currentKey = () => `${track.id}-${currentHz()}`;
const timeLabel = (seconds) => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
const bandName = (value) => value < 425 ? 'Root' : value < 600 ? 'Solar Plexus' : value < 775 ? 'Throat' : 'Crown';

function message(text) {
  if (!$('toast')) return;
  $('toast').textContent = text;
  $('toast').hidden = !text;
  if (text) setTimeout(() => { if ($('toast').textContent === text) $('toast').hidden = true; }, 4500);
}

function setPhase(phase) {
  document.body.dataset.phase = phase;
  $('entryView').hidden = phase !== 'entry';
  $('experienceView').hidden = phase === 'entry';
  $('frequencyGuide').hidden = phase !== 'frequencies';
  $('musicLibrary').hidden = phase !== 'music';
  $('toMusic').hidden = phase !== 'frequencies' || !toneHeard;
  if (phase !== 'entry') window.scrollTo({ top: 0, behavior: 'instant' });
  if (personalized) updatePlayback();
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(25000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      invalid_birth_details: 'Please check your birth date, time and place.',
      invalid_place_query: 'Enter at least two letters of your birthplace.',
      rate_limited: 'A few too many requests. Please wait a minute and try again.',
      calculation_unavailable: 'Frequency calculation is unavailable right now.',
      places_unavailable: 'Place search is unavailable right now.',
      audio_signing_unavailable: 'The music connection is unavailable right now.',
      audio_unavailable: 'That recording is unavailable right now.',
    };
    throw new Error(messages[body.error?.code] || 'Please try again in a moment.');
  }
  return body;
}

function waveformMarkup(item, progress = 0) {
  const bars = waveforms[item.waveform || item.id];
  if (!Array.isArray(bars) || bars.length !== 103) return '<svg class="song-wave" viewBox="0 0 320 42" aria-hidden="true"></svg>';
  const halo = [];
  const core = [];
  for (let i = 0; i < bars.length; i++) {
    const [top, bottom, rms] = bars[i];
    const x = (i * 3.1).toFixed(2);
    const haloY = 21 - top * 21;
    const haloH = (top + bottom) * 21;
    const coreH = Math.max(0, Math.min(haloH - 0.5, rms * 42 * 0.8));
    const coreY = 21 - coreH * top / (top + bottom || 0.001);
    halo.push(`M${x} ${haloY.toFixed(2)}h2.2v${haloH.toFixed(2)}h-2.2Z`);
    if (coreH > 0) core.push(`M${x} ${coreY.toFixed(2)}h2.2v${coreH.toFixed(2)}h-2.2Z`);
  }
  const fill = item.free ? domain.color : '#928E91';
  const end = item.free ? domain.end : '#BAB6B8';
  const id = `wave-${item.id}`;
  return `<svg class="song-wave" viewBox="0 0 320 42" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}-fill" x2="0" y2="1"><stop stop-color="${end}"/><stop offset="1" stop-color="${fill}"/></linearGradient><clipPath id="${id}-clip"><rect class="played-clip" width="${(clamp(progress, 0, 1) * 320).toFixed(2)}" height="42"/></clipPath></defs><path d="${halo.join('')}" fill="url(#${id}-fill)" opacity=".36"/><path d="${core.join('')}" fill="url(#${id}-fill)"/><g clip-path="url(#${id}-clip)" fill="${item.free ? '#FFF8EE' : '#E5E1DF'}"><path d="${halo.join('')}" opacity=".58"/><path d="${core.join('')}"/></g></svg>`;
}

function renderSongs() {
  const freeRow = (item) => `<article class="song-row ${track.id === item.id ? 'is-current' : ''}" data-track="${item.id}"><div class="song-top"><button class="song-play" type="button" data-play-track="${item.id}" aria-label="Play ${item.name}"><span class="song-play-icon">${PLAY}</span><span class="song-name">${item.name}</span></button><span class="song-time">${item.duration}</span></div><button class="wave-seek" type="button" data-seek-track="${item.id}" aria-label="Seek within ${item.name}">${waveformMarkup(item, track.id === item.id ? playbackProgress() : 0)}</button><div class="song-tags">${item.tags}</div><div class="song-meta"><span><i class="dot"></i>${domain.name} · ${hz[domain.key]} Hz</span></div></article>`;
  const lockedRow = (item) => `<article class="song-row is-locked" data-track="${item.id}" data-locked="${item.id}" role="button" tabindex="0" aria-label="Explore membership for ${item.name}"><div class="song-top"><span class="song-play"><span class="song-play-icon">${PLAY}</span><span class="song-name">${item.name}</span></span><span class="song-time">${item.duration}</span></div><span class="wave-seek">${waveformMarkup(item)}<span class="lock-overlay" aria-hidden="true">${LOCK}</span></span><div class="song-tags">${item.tags}</div><div class="song-meta"><span>Full library</span><span>Locked</span></div></article>`;
  $('songList').innerHTML = FREE.map(freeRow).join('');
  $('lockedSongs').innerHTML = TRACKS.filter((item) => !item.free).map(lockedRow).join('');
  updatePlayback();
}

function renderFrequencies() {
  if (!personalized) return;
  document.body.style.setProperty('--active', domain.color);
  document.body.style.setProperty('--active-end', domain.end);
  document.body.style.setProperty('--active-soft', domain.soft);
  document.body.style.setProperty('--active-text', domain.text);
  $('frequencyControls').innerHTML = DOMAINS.map((item) => `<button type="button" class="frequency-control ${domain.key === item.key ? 'selected' : ''}" data-frequency="${item.key}" aria-pressed="${domain.key === item.key}" style="--frequency:${item.color};--frequency-text:${item.text}"><span class="frequency-name"><i></i>${item.name}</span><span class="frequency-hz">${hz[item.key]} Hz</span></button>`).join('');
  $('stageMeta').textContent = `${domain.name} · ${hz[domain.key]} Hz · ${bandName(hz[domain.key])} band`;
  $('domainDescription').textContent = domain.description;
  $('musicContext').textContent = `Every song below carries your ${domain.name} frequency of ${hz[domain.key]} Hz. Choose the music you feel like hearing.`;
  if ($('birthSummary')) {
    $('birthSummary').textContent = usedNoonEstimate ? 'Using noon as an estimated birth time.' : 'Calculated from your birth details.';
    $('birthSummary').hidden = false;
  }
  renderSongs();
  renderBands();
  drawFrequency();
}

function playbackProgress() {
  return audio.duration && Number.isFinite(audio.duration) ? clamp(audio.currentTime / audio.duration, 0, 1) : 0;
}

function updatePlayback() {
  if (!personalized) return;
  const playing = !audio.paused && !!audio.src && !loading;
  const active = playing || toneOn;
  const musicPhase = document.body.dataset.phase === 'music';
  $('stageTitle').textContent = musicPhase ? track.name : `Your ${domain.name} frequency`;
  $('profileBadge').textContent = musicPhase ? '03 · HEAR IT IN MUSIC' : '02 · HEAR YOUR FREQUENCIES';
  if ($('trackDescription')) $('trackDescription').textContent = `${track.tags.replaceAll(' · ', ', ').toLowerCase()} · ${track.duration}`;
  $('mainPlay').innerHTML = playing || loading ? PAUSE : PLAY;
  $('mainPlay').setAttribute('aria-label', loading ? 'Cancel loading music' : playing ? `Pause ${track.name}` : `Play ${track.name}`);
  $('miniToggle').innerHTML = (musicPhase ? playing : toneOn) ? PAUSE : PLAY;
  $('miniToggle').setAttribute('aria-label', musicPhase ? (playing ? 'Pause music' : 'Play music') : (toneOn ? `Pause ${domain.name} frequency` : `Hear ${domain.name} frequency`));
  $('miniTitle').textContent = musicPhase ? track.name : `Your ${domain.name} frequency`;
  $('miniMeta').textContent = `${domain.name} · ${hz[domain.key]} Hz${loading ? ' · Loading…' : ''}`;
  $('elapsed').textContent = timeLabel(audio.currentTime);
  $('duration').textContent = timeLabel(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : track.seconds);
  $('seek').value = String(Math.round(playbackProgress() * 1000));
  $('seek').disabled = !Number.isFinite(audio.duration) || !audio.duration;
  $('miniProgress').style.width = `${playbackProgress() * 100}%`;
  $('tonePlay').setAttribute('aria-pressed', String(toneOn));
  $('tonePlay').querySelector('use')?.setAttribute('href', toneOn ? '#i-pause' : '#i-play');
  $('toneButtonText').textContent = musicPhase ? (toneOn ? `Pause ${domain.name} frequency` : 'Hear frequency alone') : (toneOn ? `Pause ${domain.name} frequency` : `Hear my ${domain.name} frequency`);
  $('toneGuideText').textContent = toneOn
    ? `You’re hearing your ${domain.name} frequency as a pure tone. Now hear that same ${hz[domain.key]} Hz frequency within music.`
    : heardDomains.has(domain.key)
      ? `That is your ${domain.name} frequency, heard as a pure tone. Next, hear the same ${hz[domain.key]} Hz frequency within music.`
      : 'Listen to your frequency on its own. Then hear it carried through music.';
  $('visualCaption').textContent = musicPhase
    ? (toneOn ? `Your ${hz[domain.key]} Hz frequency · heard as a pure tone` : `Your ${hz[domain.key]} Hz frequency, carried through the music.`)
    : `Your ${hz[domain.key]} Hz frequency · heard as a pure tone`;
  document.body.classList.toggle('music-playing', playing);
  document.body.classList.toggle('tone-playing', toneOn);
  document.body.classList.toggle('has-heard-frequency', toneHeard);
  document.querySelectorAll('.song-row[data-track]').forEach((row) => {
    const current = row.dataset.track === track.id;
    row.classList.toggle('is-current', current && !row.classList.contains('is-locked'));
    const play = row.querySelector('[data-play-track]');
    if (play) {
      play.setAttribute('aria-label', `${current && playing ? 'Pause' : 'Play'} ${row.dataset.track === track.id ? track.name : TRACKS.find((item) => item.id === row.dataset.track).name}`);
      play.querySelector('.song-play-icon').innerHTML = current && playing ? PAUSE : PLAY;
    }
    const clip = row.querySelector('.played-clip');
    if (clip) clip.setAttribute('width', String(current && !toneOn ? playbackProgress() * 320 : 0));
  });
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: musicPhase ? track.name : `Your ${domain.name} frequency`, artist: `Zodiac.fm · ${hz[domain.key]} Hz` });
    navigator.mediaSession.playbackState = playing || toneOn ? 'playing' : 'paused';
  }
  updateMiniPlayer();
  drawFrequency();
  document.body.classList.toggle('audio-active', active);
}

function updateMiniPlayer() {
  const available = document.body.dataset.phase === 'music' ? (audioStarted && audio.src) || toneOn : toneOn;
  $('miniPlayer').hidden = !personalized || !available || (stageVisible && !document.querySelector('dialog[open]')) || document.body.classList.contains('player-expanded');
}

async function signedAudioURL(signal) {
  const key = currentKey();
  const cached = urlCache.get(key);
  if (cached && cached.until > Date.now()) return cached.url;
  const result = await api(`${API}?action=audio&track=${encodeURIComponent(track.id)}&hz=${currentHz()}`, { signal });
  if (typeof result.url !== 'string' || !result.url.startsWith('https://')) throw new Error('The recording could not be loaded.');
  urlCache.set(key, { url: result.url, until: Date.now() + 240000 });
  return result.url;
}

function stopTone() {
  ++toneRequest;
  if (oscillator && context && gain) {
    try {
      gain.gain.setTargetAtTime(0, context.currentTime, 0.035);
      const old = oscillator;
      setTimeout(() => { try { old.stop(); } catch {} }, 150);
    } catch {}
  }
  oscillator = null;
  toneOn = false;
  updatePlayback();
}

async function loadTrack({ at = 0, resume = true } = {}) {
  audioAbort?.abort();
  const controller = new AbortController();
  audioAbort = controller;
  const ticket = ++audioRequest;
  const key = currentKey();
  requestedPlayIntent = resume;
  stopTone();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loadedKey = '';
  loading = true;
  $('audioError').textContent = '';
  updatePlayback();
  try {
    const url = await signedAudioURL(controller.signal);
    if (ticket !== audioRequest) return;
    audio.src = url;
    audio.load();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => done(new Error('The recording is taking too long to load. Tap Play to retry.')), 20000);
      const ready = () => done();
      const failed = () => done(new Error('The recording could not load. Tap Play to retry.'));
      const aborted = () => done(new DOMException('Audio request cancelled.', 'AbortError'));
      function done(error) {
        clearTimeout(timeout);
        audio.removeEventListener('loadedmetadata', ready);
        audio.removeEventListener('error', failed);
        controller.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      }
      audio.addEventListener('loadedmetadata', ready, { once: true });
      audio.addEventListener('error', failed, { once: true });
      controller.signal.addEventListener('abort', aborted, { once: true });
      if (audio.readyState >= 1) done();
    });
    if (ticket !== audioRequest) return;
    audio.currentTime = Math.min(at, Math.max(0, (audio.duration || 0) - 0.15));
    loadedKey = key;
    loading = false;
    if (resume) {
      try { await audio.play(); }
      catch (error) {
        $('audioError').textContent = error.name === 'NotAllowedError' ? 'Your music is ready. Tap Play to listen.' : 'Playback could not start. Tap Play to try again.';
      }
    }
  } catch (error) {
    if (ticket === audioRequest) {
      loading = false;
      $('audioError').textContent = error.message || 'This recording is unavailable right now.';
    }
  }
  if (ticket === audioRequest) {
    requestedPlayIntent = false;
    updatePlayback();
  }
}

function cancelLoading() {
  if (!loading) return;
  ++audioRequest;
  audioAbort?.abort();
  audioAbort = null;
  requestedPlayIntent = false;
  loading = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loadedKey = '';
  $('audioError').textContent = '';
  updatePlayback();
}

function clearMusic() {
  if (loading) return cancelLoading();
  ++audioRequest;
  audioAbort?.abort();
  audioAbort = null;
  requestedPlayIntent = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  loadedKey = '';
  updatePlayback();
}

async function playTrack(item) {
  if (!item.free) return openMembership(item);
  if (track.id === item.id && loading) return cancelLoading();
  if (track.id === item.id && loadedKey === currentKey() && audio.src && !loading && !audio.error) {
    stopTone();
    if (audio.paused) {
      try { await audio.play(); }
      catch { $('audioError').textContent = 'Tap Play again to listen.'; }
    } else audio.pause();
    updatePlayback();
    return;
  }
  track = item;
  renderSongs();
  await loadTrack();
}

async function switchDomain(key) {
  const next = DOMAINS.find((item) => item.key === key);
  if (!next || next === domain) return;
  const position = audio.currentTime;
  const wasPlaying = (!audio.paused && !loading) || (loading && requestedPlayIntent);
  const wasTone = toneOn;
  domain = next;
  renderFrequencies();
  if (wasTone && oscillator && context) {
    heardDomains.add(domain.key);
    oscillator.frequency.setTargetAtTime(currentHz(), context.currentTime, 0.025);
    updatePlayback();
  } else if (document.body.dataset.phase === 'music' && (audio.src || loading)) await loadTrack({ at: position, resume: wasPlaying });
}

async function playTone() {
  if (toneOn) return stopTone();
  const ticket = ++toneRequest;
  if (loading) cancelLoading();
  else { ++audioRequest; audioAbort?.abort(); audioAbort = null; }
  audio.pause();
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    if (ticket !== toneRequest) return;
    oscillator = context.createOscillator();
    gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = currentHz();
    gain.gain.value = 0;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    gain.gain.setTargetAtTime(0.045, context.currentTime, 0.08);
    toneOn = true;
    toneHeard = true;
    heardDomains.add(domain.key);
    $('toMusic').hidden = document.body.dataset.phase !== 'frequencies';
    $('audioError').textContent = '';
  } catch { $('audioError').textContent = 'Tap again to enable sound in this browser.'; }
  updatePlayback();
}

function drawFrequency() {
  if (!personalized) return;
  const canvas = $('frequencyCanvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 320;
  const height = rect.height || 300;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const c = canvas.getContext('2d');
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, width, height);
  const left = width < 400 ? 39 : 48;
  const right = width - 16;
  const top = 25;
  const bottom = height - 25;
  const span = right - left;
  const yOf = (value) => bottom - (clamp(value, 250, 950) - 250) / 700 * (bottom - top);
  c.font = '11px system-ui, sans-serif';
  c.textAlign = 'right';
  const marks = height < 180 ? [250, 600, 950] : [250, 400, 600, 800, 950];
  for (const mark of marks) {
    const y = yOf(mark);
    c.strokeStyle = 'rgba(241,235,248,.12)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(left, y); c.lineTo(right, y); c.stroke();
    if (Math.abs(mark - currentHz()) > 34) {
      c.fillStyle = 'rgba(245,238,249,.48)';
      c.fillText(String(mark), left - 8, y + 4);
    }
  }
  const target = yOf(currentHz());
  const source = envelopes[track.type];
  if (document.body.dataset.phase === 'frequencies' || toneOn) {
    c.strokeStyle = domain.soft;
    c.lineWidth = 2;
    c.beginPath();
    const cycles = 7 + (currentHz() - 250) / 700 * 8;
    for (let i = 0; i <= 320; i++) {
      const x = left + span * i / 320;
      const y = target + Math.sin(2 * Math.PI * cycles * i / 320) * Math.sin(Math.PI * i / 320) * Math.min(28, height * 0.09);
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.stroke();
  } else if (Array.isArray(source) && source.length) {
    const progress = playbackProgress();
    const amp = Math.min((bottom - top) * 0.32, 80);
    for (let i = 0; i < source.length; i++) {
      const x = left + span * i / source.length;
      const value = clamp(Number(source[i]) || 0, 0, 1);
      const half = Math.max(1, value * amp);
      c.fillStyle = domain.soft;
      c.globalAlpha = i / source.length <= progress ? 0.9 : 0.4;
      c.fillRect(x, target - half, Math.max(1, span / source.length), half * 2);
    }
    c.globalAlpha = 1;
    const playX = left + span * progress;
    c.strokeStyle = 'rgba(255,255,255,.75)';
    c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(playX, top); c.lineTo(playX, bottom); c.stroke();
  }
  c.strokeStyle = domain.soft;
  c.lineWidth = 1.5;
  c.setLineDash([4, 4]);
  c.beginPath(); c.moveTo(left, target); c.lineTo(right, target); c.stroke();
  c.setLineDash([]);
  c.fillStyle = domain.soft;
  c.font = 'bold 12px system-ui, sans-serif';
  c.fillText(String(currentHz()), left - 8, target + 4);
  canvas.setAttribute('aria-label', document.body.dataset.phase === 'frequencies' || toneOn
    ? `${domain.name} pure frequency at ${currentHz()} hertz`
    : `${track.name} waveform centered on ${domain.name} at ${currentHz()} hertz, with playback position`);
}

function renderBands() {
  if (!$('bandReadings')) return;
  $('bandReadings').innerHTML = DOMAINS.map((item) => {
    const value = hz[item.key];
    const name = bandName(value);
    const entry = bands[item.key]?.[name];
    return `<details class="band-reading" ${item.key === domain.key ? 'open' : ''} style="--frequency:${item.color}"><summary><span>${item.name}</span><span>${value} Hz · ${name}</span></summary><div class="band-body">${entry ? entry.paragraphs.map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join('') : '<p>Your band reading is loading.</p>'}</div></details>`;
  }).join('');
}

function openDialog(dialog, focusTarget) {
  if (!dialog) return;
  lastFocus = document.activeElement;
  if (!dialog.open) dialog.showModal();
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  updateMiniPlayer();
}

function closeDialog(dialog) {
  if (dialog?.open) dialog.close();
  lastFocus?.focus?.({ preventScroll: true });
  updateMiniPlayer();
}

function toggleBirthTimeFields() {
  const disabled = $('unknownTime').checked;
  for (const id of ['birthHour', 'birthMinute', 'birthPeriod']) $(id).disabled = disabled;
}

function populateBirthSelects() {
  const addOptions = (id, items) => {
    const select = $(id);
    if (!select.options.length || select.options[0].value !== '') select.add(new Option({ birthMonth: 'Month', birthDay: 'Day', birthYear: 'Year', birthHour: 'Hour', birthMinute: 'Minute', birthPeriod: 'AM / PM' }[id], ''), 0);
    if (select.options.length > 1) return;
    for (const [value, label] of items) select.add(new Option(label, String(value)));
  };
  addOptions('birthMonth', Array.from({ length: 12 }, (_, index) => [index + 1, new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date(2000, index, 1))]));
  addOptions('birthDay', Array.from({ length: 31 }, (_, index) => [index + 1, String(index + 1)]));
  addOptions('birthYear', Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => [new Date().getFullYear() - index, String(new Date().getFullYear() - index)]));
  addOptions('birthHour', Array.from({ length: 12 }, (_, index) => [index + 1, String(index + 1)]));
  addOptions('birthMinute', Array.from({ length: 60 }, (_, index) => [index, String(index).padStart(2, '0')]));
  addOptions('birthPeriod', [['AM', 'AM'], ['PM', 'PM']]);
  toggleBirthTimeFields();
}

function birthDateTime() {
  const year = Number($('birthYear').value);
  const month = Number($('birthMonth').value);
  const day = Number($('birthDay').value);
  const dateValue = new Date(year, month - 1, day);
  const today = new Date();
  if (!year || !month || !day || year < 1900 || year > today.getFullYear() ||
      dateValue.getFullYear() !== year || dateValue.getMonth() !== month - 1 || dateValue.getDate() !== day ||
      dateValue > new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    throw new Error('Choose a valid birth date from 1900 through today.');
  }
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if ($('unknownTime').checked) return { year, month, day, hour: 12, min: 0, date, clock: '12:00' };
  const hour12 = Number($('birthHour').value);
  const min = Number($('birthMinute').value);
  const period = $('birthPeriod').value;
  if (!hour12 || hour12 < 1 || hour12 > 12 || $('birthMinute').value === '' || min < 0 || min > 59 || !['AM', 'PM'].includes(period)) {
    throw new Error('Choose a valid birth hour, minute and AM or PM, or use the noon estimate.');
  }
  const hour = hour12 % 12 + (period === 'PM' ? 12 : 0);
  return { year, month, day, hour, min, date, clock: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}

function openMembership(item) {
  if ($('lockedTitle')) $('lockedTitle').textContent = item.name;
  openDialog($('membershipDialog'));
}

function timezoneOffset(date, clock, zone) {
  const target = new Date(`${date}T${clock}:00Z`).getTime();
  let candidate = target;
  const format = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(format.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offset = (local - candidate) / 3600000;
    candidate = target - offset * 3600000;
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
  if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` !== `${date}T${clock}`) throw new Error('That local time falls in a daylight-saving clock change. Please check your birth time.');
  return (target - candidate) / 3600000;
}

populateBirthSelects();
$('birthPlace').addEventListener('input', () => {
  selectedPlace = null;
  $('placeResults').replaceChildren();
  $('placeStatus').textContent = '';
  clearTimeout(placeTimer);
  const query = $('birthPlace').value.trim();
  const ticket = ++placeRequest;
  if (query.length < 2) return;
  placeTimer = setTimeout(async () => {
    try {
      const places = await api(`${API}?action=places&q=${encodeURIComponent(query)}`);
      if (ticket !== placeRequest) return;
      $('placeResults').innerHTML = places.slice(0, 6).map((place, index) => `<li><button type="button" data-place="${index}">${escapeHTML(place.name)}<small>${escapeHTML([place.admin1, place.country].filter(Boolean).join(', '))}</small></button></li>`).join('') + (places.length ? '<li class="maps-credit" translate="no">Google Maps</li>' : '');
      if (!places.length) $('placeStatus').textContent = 'No matches. Try a nearby town or city.';
      $('placeResults').querySelectorAll('[data-place]').forEach((button) => button.addEventListener('click', () => {
        ++placeRequest;
        selectedPlace = places[Number(button.dataset.place)];
        $('birthPlace').value = [selectedPlace.name, selectedPlace.admin1, selectedPlace.country].filter(Boolean).join(', ');
        $('placeResults').replaceChildren();
        $('placeStatus').textContent = 'Birthplace selected';
      }));
    } catch {
      if (ticket === placeRequest) $('placeStatus').textContent = 'Place search is unavailable. Please try again shortly.';
    }
  }, 350);
});
$('unknownTime').addEventListener('change', toggleBirthTimeFields);
$('birthForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('birthError').textContent = '';
  let birth;
  try { birth = birthDateTime(); }
  catch (error) { $('birthError').textContent = error.message; return; }
  if (!selectedPlace) {
    $('birthError').textContent = 'Choose your birthplace from the search results.';
    $('birthPlace').focus();
    return;
  }
  $('findFrequencies').disabled = true;
  $('findFrequencies').textContent = 'Finding your frequencies…';
  try {
    const tzone = timezoneOffset(birth.date, birth.clock, selectedPlace.timezone);
    const result = await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'calculate', year: birth.year, month: birth.month, day: birth.day, hour: birth.hour, min: birth.min, lat: selectedPlace.latitude, lon: selectedPlace.longitude, tzone }) });
    if (!result.frequencies || DOMAINS.some((item) => !Number.isFinite(result.frequencies[item.key]) || result.frequencies[item.key] < 250 || result.frequencies[item.key] > 950)) throw new Error('Your frequencies could not be calculated. Please try again.');
    const position = audio.currentTime;
    const wasPlaying = (!audio.paused && !loading) || (loading && requestedPlayIntent);
    const hadAudio = !!audio.src || loading;
    const firstCalculation = !personalized;
    hz = Object.fromEntries(DOMAINS.map((item) => [item.key, Number(result.frequencies[item.key])]));
    personalized = true;
    usedNoonEstimate = $('unknownTime').checked;
    if (firstCalculation) {
      domain = DOMAINS[0];
      stopTone();
      clearMusic();
      setPhase('frequencies');
    }
    renderFrequencies();
    if (toneOn && oscillator && context) oscillator.frequency.setTargetAtTime(currentHz(), context.currentTime, 0.025);
    closeDialog($('birthDialog'));
    if (hadAudio && !firstCalculation) await loadTrack({ at: position, resume: wasPlaying });
    if (firstCalculation) $('tonePlay').focus({ preventScroll: true });
    if (!firstCalculation) message('Your frequencies are updated.');
  } catch (error) {
    $('birthError').textContent = error.message;
  } finally {
    $('findFrequencies').disabled = false;
    $('findFrequencies').innerHTML = personalized ? 'Update my frequencies' : findFrequenciesMarkup;
  }
});

document.addEventListener('click', async (event) => {
  const target = event.target.closest('button,[data-action],[data-close],[data-locked]');
  if (!target) return;
  if (target.dataset.playTrack) return playTrack(TRACKS.find((item) => item.id === target.dataset.playTrack));
  if (target.dataset.locked) return openMembership(TRACKS.find((item) => item.id === target.dataset.locked));
  if (target.dataset.seekTrack) {
    const item = TRACKS.find((entry) => entry.id === target.dataset.seekTrack);
    if (item.id !== track.id || !audio.duration || loadedKey !== currentKey()) return playTrack(item);
    const x = clamp((event.clientX - target.getBoundingClientRect().left) / target.getBoundingClientRect().width, 0, 1);
    audio.currentTime = x * audio.duration;
    updatePlayback();
    return;
  }
  if (target.dataset.frequency) return switchDomain(target.dataset.frequency);
  if (target.hasAttribute('data-close')) return closeDialog(target.closest('dialog'));
  switch (target.dataset.action) {
    case 'personalize':
      $('editFormHost').append($('birthForm'));
      $('findFrequencies').textContent = 'Update my frequencies';
      $('birthForm').querySelector('.form-privacy').textContent = 'Your listening continues while you edit.';
      openDialog($('birthDialog'), $('birthMonth'));
      break;
    case 'music':
      if (!personalized || !toneHeard) return;
      stopTone();
      setPhase('music');
      $('mainPlay').focus({ preventScroll: true });
      return loadTrack();
    case 'frequencies':
      clearMusic();
      setPhase('frequencies');
      $('tonePlay').focus({ preventScroll: true });
      break;
    case 'bands': renderBands(); openDialog($('bandDialog')); break;
    case 'toggle':
      if (loading) return cancelLoading();
      if (loadedKey === currentKey() && audio.src && !audio.error) return playTrack(track);
      return loadTrack();
    case 'tone': return playTone();
    case 'previous-track': return playTrack(FREE[(FREE.findIndex((item) => item.id === track.id) + FREE.length - 1) % FREE.length]);
    case 'next-track': return playTrack(FREE[(FREE.findIndex((item) => item.id === track.id) + 1) % FREE.length]);
    case 'expand':
      lastFocus = document.activeElement;
      document.body.classList.add('player-expanded');
      $('playerBackdrop').hidden = false;
      $('playerPanel').setAttribute('role', 'dialog');
      $('playerPanel').setAttribute('aria-modal', 'true');
      $('playerPanel').querySelector('[data-action="collapse"]')?.focus();
      updateMiniPlayer();
      break;
    case 'collapse':
      document.body.classList.remove('player-expanded');
      $('playerBackdrop').hidden = true;
      $('playerPanel').removeAttribute('role');
      $('playerPanel').removeAttribute('aria-modal');
      lastFocus?.focus?.({ preventScroll: true });
      updateMiniPlayer();
      break;
    case 'share': {
      const url = new URL(location.href);
      const original = new URLSearchParams(location.search);
      url.search = '';
      url.hash = '';
      for (const key of ['infclid', 'coupon', 'utm_source', 'utm_medium', 'utm_campaign']) {
        const value = original.get(key);
        if (value && value.length <= 200) url.searchParams.set(key, value);
      }
      url.searchParams.set('track', track.id);
      try {
        if (navigator.share) await navigator.share({ title: 'Tune In · Zodiac.fm', url: url.href });
        else { await navigator.clipboard.writeText(url.href); message('Link copied.'); }
      } catch (error) {
        if (error.name !== 'AbortError') message('Share is unavailable in this browser.');
      }
      break;
    }
  }
});

$('mainPlay').addEventListener('click', () => {
  if (loading) return cancelLoading();
  if (loadedKey === currentKey() && audio.src && !audio.error) playTrack(track);
  else loadTrack();
});
$('prevTrack').addEventListener('click', () => playTrack(FREE[(FREE.findIndex((item) => item.id === track.id) + FREE.length - 1) % FREE.length]));
$('nextTrack').addEventListener('click', () => playTrack(FREE[(FREE.findIndex((item) => item.id === track.id) + 1) % FREE.length]));
$('miniToggle').addEventListener('click', () => {
  if (document.body.dataset.phase === 'frequencies') return playTone();
  if (loading) return cancelLoading();
  if (loadedKey === currentKey() && audio.src && !audio.error) playTrack(track);
  else loadTrack();
});
$('tonePlay').addEventListener('click', (event) => { event.stopPropagation(); playTone(); });
$('seek').addEventListener('input', (event) => {
  if (audio.duration) audio.currentTime = Number(event.target.value) / 1000 * audio.duration;
});
for (const event of ['play', 'pause', 'timeupdate', 'durationchange', 'ended', 'waiting', 'playing', 'seeked']) audio.addEventListener(event, updatePlayback);
audio.addEventListener('play', () => { audioStarted = true; updateMiniPlayer(); });
audio.addEventListener('error', () => {
  if (audio.src && !loading) $('audioError').textContent = 'The recording stopped loading. Tap Play to retry.';
});
document.addEventListener('keydown', (event) => {
  const locked = event.target.closest?.('.song-row.is-locked[role="button"]');
  if (locked && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openMembership(TRACKS.find((item) => item.id === locked.dataset.locked));
    return;
  }
  if (event.key !== 'Escape' || !document.body.classList.contains('player-expanded')) return;
  document.querySelector('#playerPanel [data-action="collapse"]')?.click();
});
window.addEventListener('pagehide', stopTone);
window.addEventListener('resize', drawFrequency);
new ResizeObserver(drawFrequency).observe($('frequencyCanvas'));
new IntersectionObserver(([entry]) => { stageVisible = entry.isIntersecting; updateMiniPlayer(); }, { threshold: 0.18 }).observe($('playerPanel'));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => {
  if (dialog.id === 'birthDialog') $('entryFormHost').append($('birthForm'));
  lastFocus?.focus?.({ preventScroll: true });
  updateMiniPlayer();
});
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({
    play: () => { if (document.body.dataset.phase === 'frequencies') playTone(); else if (audio.paused) playTrack(track); },
    pause: () => { if (toneOn) stopTone(); else audio.pause(); },
    previoustrack: () => { if (document.body.dataset.phase === 'music') playTrack(FREE[(FREE.findIndex((item) => item.id === track.id) + FREE.length - 1) % FREE.length]); },
    nexttrack: () => { if (document.body.dataset.phase === 'music') playTrack(FREE[(FREE.findIndex((item) => item.id === track.id) + 1) % FREE.length]); },
  })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  }
}

audio.volume = 0.65;
const appURL = new URL('https://app.zodiac.fm/begin');
const pageParams = new URLSearchParams(location.search);
for (const key of ['infclid', 'coupon']) {
  const value = pageParams.get(key);
  if (value && value.length <= 200) appURL.searchParams.set(key, value);
}
if ($('appLink')) $('appLink').href = appURL.href;
if ($('appContinue')) $('appContinue').href = appURL.href;
setPhase('entry');
fetch('tune-in-02-waveforms.json')
  .then((response) => { if (!response.ok) throw new Error('waveform unavailable'); return response.json(); })
  .then((bars) => { waveforms = bars; if (personalized) renderSongs(); })
  .catch(() => { $('audioError').textContent = 'The song waveforms are unavailable right now.'; });
fetch('tune-in-02-envelopes.json')
  .then((response) => { if (!response.ok) throw new Error('envelope unavailable'); return response.json(); })
  .then((env) => { envelopes = env; drawFrequency(); })
  .catch(() => { $('audioError').textContent = 'The player visualization is unavailable right now.'; });
fetch('tune-in-01-bands.json')
  .then((response) => { if (!response.ok) throw new Error('band readings unavailable'); return response.json(); })
  .then((readings) => { bands = readings; renderBands(); })
  .catch(() => {});
