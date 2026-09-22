// Tune In 09 guidance adapter. Loaded after the unchanged Tune In 07 module.
(() => {
  const p09 = {
    listen: document.getElementById('listenScreen'),
    birthForm: document.getElementById('birthForm'),
    frame: document.getElementById('stageFrame'),
    frequencies: document.getElementById('frequencyControls'),
    title: document.getElementById('journeyTitle'),
    eyebrow: document.getElementById('journeyEyebrow'),
    intro: document.getElementById('journeyIntro'),
    toneIntro: document.getElementById('toneIntro'),
    guide: document.getElementById('guideText'),
    enterMusic: document.getElementById('enterMusic'),
    backToTones: document.getElementById('backToTones'),
    musicMode: document.getElementById('musicMode'),
    toneOnly: document.getElementById('toneOnly'),
    phase: 'tones',
    entered: false,
    heardToneName: null,
    toneInMusic: false,
    boundAudio: new WeakSet(),
  };

  if (!p09.listen || !p09.birthForm || !p09.frame || !p09.frequencies || !p09.title || !p09.eyebrow || !p09.intro || !p09.guide || !p09.enterMusic || !p09.backToTones || !p09.musicMode || !p09.toneOnly) return;

  const p09SelectedName = () => p09.frequencies.querySelector('[data-frequency][aria-pressed="true"] span')?.textContent?.trim() || 'Core';
  const p09ToneMode = () => p09.toneOnly.getAttribute('aria-pressed') === 'true';

  function p09SyncCopy() {
    const name = p09SelectedName();
    const music = p09.phase === 'music';
    p09.title.textContent = music ? 'Now hear it in music.' : 'Four frequencies. One you.';
    p09.eyebrow.textContent = music ? `${name.toUpperCase()} IN MUSIC` : `YOUR ${name.toUpperCase()} TONE`;
    p09.intro.textContent = music ? `Hear your ${name} frequency inside the song.` : 'Each frequency has its own tone. Start with Core, then explore the others.';
    p09.listen.dataset.audioMode = p09ToneMode() ? 'tone' : 'music';
    p09.guide.textContent = music
      ? p09.toneInMusic
        ? `That’s your ${name} tone. Now hear it in music.`
        : 'Try another frequency. Keep the same song.'
      : p09.heardToneName === name
        ? `That’s your ${name} tone. Now hear it in music.`
        : `Start with your ${name} tone.`;
  }

  function p09SetPhase(next) {
    p09.phase = next;
    p09.listen.dataset.phase = next;
    if (p09.toneIntro) p09.toneIntro.hidden = next === 'music';
    p09SyncCopy();
    const frameWindow = p09.frame.contentWindow;
    if (frameWindow) frameWindow.dispatchEvent(new frameWindow.Event('resize'));
  }

  function p09Audio() {
    return p09.frame.contentWindow?.zStage?.audio || p09.frame.contentDocument?.querySelector('audio') || null;
  }

  function p09SyncFromAudio(event) {
    const audio = event?.currentTarget || p09Audio();
    if (event?.type === 'play' && audio?.src && !audio.paused) {
      if (p09ToneMode()) {
        if (p09.phase === 'music') p09.toneInMusic = true;
        else p09.heardToneName = p09SelectedName();
      } else p09.toneInMusic = false;
    }
    p09SyncCopy();
  }

  function p09BindStage() {
    const audio = p09Audio();
    if (!audio || p09.boundAudio.has(audio)) return;
    p09.boundAudio.add(audio);
    audio.addEventListener('play', p09SyncFromAudio);
    audio.addEventListener('pause', p09SyncFromAudio);
    audio.addEventListener('ended', p09SyncFromAudio);
    p09SyncFromAudio();
  }

  p09.birthForm.addEventListener('submit', () => {
    queueMicrotask(() => {
      if (!p09.entered && !p09.listen.hidden) {
        p09.entered = true;
        p09SetPhase('tones');
      }
    });
  });
  new MutationObserver(() => {
    if (!p09.entered && !p09.listen.hidden) {
      p09.entered = true;
      p09SetPhase('tones');
    }
  }).observe(p09.listen, { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(p09SyncCopy).observe(p09.frequencies, { childList: true, subtree: true });
  new MutationObserver(p09SyncCopy).observe(p09.toneOnly, { attributes: true, attributeFilter: ['aria-pressed'] });

  // Reuse the measured song marks for the entrance, without another audio request.
  function p09EntranceWaves() {
    const waves = document.querySelectorAll('#songList .song-wave');
    if (!waves.length || !waves[0].querySelector('path')) return false;
    const colors = ['#6521C9', '#B90044', '#FF9112', '#12A56E'];
    document.querySelectorAll('[data-preview-domain] i').forEach((slot, index) => {
      const wave = waves[index % waves.length].cloneNode(true);
      wave.querySelectorAll('path').forEach(path => path.setAttribute('fill', colors[index]));
      wave.setAttribute('aria-hidden', 'true');
      slot.replaceChildren(wave);
    });
    return true;
  }
  if (!p09EntranceWaves()) {
    const previewObserver = new MutationObserver(() => {
      if (p09EntranceWaves()) previewObserver.disconnect();
    });
    previewObserver.observe(document.getElementById('songList'), { childList: true, subtree: true });
  }

  p09.frame.addEventListener('load', p09BindStage);
  p09.enterMusic.addEventListener('click', () => {
    p09SetPhase('music');
    p09.musicMode.click();
  });
  p09.backToTones.addEventListener('click', () => p09SetPhase('tones'));

  p09SetPhase('tones');
  p09BindStage();
})();
