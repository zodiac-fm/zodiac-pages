import {drawDisc} from './tune-in-01-discs.js';
const $ = id => document.getElementById(id);
const API = '/api/tune-in-01';
const domains = [
  {key:'core',name:'Core',meaning:'Who you are',color:'#6521C9',soft:'#EFECFF'},
  {key:'love',name:'Love',meaning:'How you connect',color:'#B90044',soft:'#FFE8EA'},
  {key:'vitality',name:'Vitality',meaning:'Your energy',color:'#C25500',soft:'#FFEADA'},
  {key:'abundance',name:'Abundance',meaning:'Opportunity & timing',color:'#0A7A52',soft:'#DCF4E8'}
];
const tracks = [
  {id:'quiet-success',name:'Quiet Success',duration:'3 min',tags:'RESET · CALM · GROUND',free:true},
  {id:'kindred-spirits',name:'Kindred Spirits',duration:'5 min',tags:'ENERGY · HAPPY · FLOW',free:true},
  {id:'elysian-surge',name:'Elysian Surge',duration:'5 min',tags:'ENERGY · BUILD · DRIVE',free:true},
  {id:'starseed',name:'Starseed',duration:'9 min',tags:'MEDITATE · DEEP · DREAMY'},
  {id:'astrolith',name:'Astrolith',duration:'9 min',tags:'FOCUS · MEDITATE · CALM'},
  {id:'cosmic-drift',name:'Cosmic Drift',duration:'25 min',tags:'FOCUS · MEDITATE · NAP'},
  {id:'temple-space',name:'Temple Space',duration:'30 min',tags:'GROUND · MEDITATE · FLOW'},
  {id:'galactic-deep',name:'Galactic Deep',duration:'60 min',tags:'SLEEP · FOCUS · UNWIND'}
];
const screens=['listen','meaning','story','membership'];
const screenNames=['Your music','Your natural way','Inside out','Keep tuning in'];
const playIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const pauseIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor"/></svg>';
const lockIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="10" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M9 10V7a3 3 0 016 0v3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const audio=$('musicAudio');
let hz={core:422,love:432,vitality:579,abundance:611}, example=true, domain=domains[0], track=null, screen='listen';
let selectedPlace=null, placeRequest=0, audioRequest=0, loadedKey='', loading=false, audioStarted=false, toneOn=false, context, oscillator, gain, bands={}, plan='annual', lastFocus=null;
const urlCache=new Map();
audio.volume=.65;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=s=>Number.isFinite(s)?`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`:'0:00';
const mediaHz=key=>Math.max(250,Math.min(950,Math.round(hz[key])));
const bandIndex=n=>n<425?0:n<600?1:n<775?2:3;
const bandNames=['Root','Solar Plexus','Throat','Crown'];

async function request(path,options={}){
  const r=await fetch(path,{...options,signal:options.signal||AbortSignal.timeout(25000)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const messages={invalid_birth_details:'Please check your birth date, time and place.',rate_limited:'A few too many requests. Please give it a minute and try again.',calculation_unavailable:'The frequency calculation is unavailable right now.',audio_signing_unavailable:'The music connection is unavailable right now.',audio_unavailable:'That recording is unavailable right now.'};
    throw new Error(messages[data.error?.code]||'Please try again in a moment.');
  }
  return data;
}
function setProfile(){
  $('profileLabel').textContent=example?'EXAMPLE FREQUENCIES':'YOUR FOUR FREQUENCIES';
  document.body.style.setProperty('--active',domain.color);
  document.body.style.setProperty('--active-soft',domain.soft);
  $('frequencyControls').innerHTML=domains.map(d=>`<button type="button" class="frequency-control ${d.key===domain.key?'selected':''}" data-frequency="${d.key}" aria-pressed="${d.key===domain.key}" style="--frequency:${d.color}"><span class="frequency-name"><i></i>${d.name}</span><span class="frequency-hz">${hz[d.key]}<small> Hz</small></span></button>`).join('');
  $('toneLabel').textContent=`${domain.name} · ${hz[domain.key]} Hz`;
  renderSongs(); renderBands(); updatePlayback(); drawTone();
}
function renderSongs(){
  $('songList').innerHTML=tracks.filter(t=>t.free).map(t=>`<button type="button" class="song-row ${track?.id===t.id?'is-current':''}" data-track="${t.id}" aria-label="Play ${t.name}"><canvas class="song-disc" width="190" height="190" data-disc="${t.id}" aria-hidden="true"></canvas><span class="song-info"><span class="song-name">${esc(t.name)}</span><span class="song-tags">${t.tags}</span><span class="song-bottom"><span class="song-domain">${domain.name} · ${hz[domain.key]} Hz</span><span>${t.duration}</span></span></span><span class="row-play">${playIcon}</span></button>`).join('');
  document.querySelectorAll('[data-disc]').forEach(canvas=>drawDisc(canvas,canvas.dataset.disc,domain.key));
  $('lockedSongs').innerHTML=tracks.filter(t=>!t.free).map(t=>`<button type="button" class="locked-song" data-action="membership" aria-label="Explore membership for ${t.name}"><span><b>${t.name}</b><small>${t.tags}</small></span><span>${t.duration}</span>${lockIcon}</button>`).join('');
}
function renderBands(){
  const container=$('bandReadings');
  container.innerHTML=domains.map(d=>{
    const index=bandIndex(hz[d.key]), band=bandNames[index], entry=bands[d.key]?.[band];
    const cutoff=[367,542,717,Infinity][index];
    const next=entry?.next && hz[d.key]>=cutoff?`<p class="band-nuance">${esc(entry.next.replaceAll('{hz}',hz[d.key]))}</p>`:'';
    const signals={core:'The signal for who you are and what is yours to do.',love:'The signal for who to let close and how to connect.',vitality:'The signal for what feeds you and what drains you.',abundance:'The signal for when to move and which opportunities are yours.'};
    return `<details class="band-reading" ${d.key==='core'?'open':''} style="--frequency:${d.color}"><summary><span><i></i>${d.name}<small>${d.meaning}</small></span><span class="band-value">${hz[d.key]} Hz<small>${band}</small></span></summary><div class="band-body"><p><strong>${signals[d.key]}</strong></p>${entry?entry.paragraphs.map(p=>`<p>${esc(p)}</p>`).join(''):'<p>Explore your preferred route to clarity in this part of life.</p>'}${next}</div></details>`;
  }).join('');
  if(example) container.insertAdjacentHTML('afterbegin','<p class="example-note">You’re exploring an example. <button type="button" class="text-link" data-action="personalize">Find your own frequencies.</button></p>');
}
function enter(){
  $('intro').hidden=true; $('experience').hidden=false; $('journeyNav').hidden=false;
  document.body.classList.add('has-profile');
  document.querySelectorAll('[data-action="personalize"]').forEach(b=>b.hidden=false);
  setProfile(); navigate('listen');
}
function navigate(next){
  screen=next; document.body.dataset.screen=next;
  document.querySelectorAll('.discovery-screen[data-screen]').forEach(el=>el.hidden=el.dataset.screen!==next);
  $('screenLabel').textContent=screenNames[screens.indexOf(next)];
  document.querySelectorAll('#journeyNav [data-action="previous"]').forEach(b=>b.disabled=next==='listen');
  document.querySelectorAll('#journeyNav [data-action="next"]').forEach(b=>b.textContent=next==='membership'?'Back to music':'Next →');
  document.body.classList.remove('player-expanded');
  $('playerBackdrop').hidden=true;
  updatePlayback(); window.scrollTo({top:0,behavior:'instant'});
  const title=document.querySelector(`.discovery-screen[data-screen="${next}"] h2`);
  if(title){title.tabIndex=-1;title.focus({preventScroll:true});}
}
function expand(){
  if(!matchMedia('(max-width: 799px)').matches){navigate('listen');return;}
  lastFocus=document.activeElement;
  document.body.classList.add('player-expanded'); $('playerBackdrop').hidden=false;
  $('playerPanel').setAttribute('role','dialog'); $('playerPanel').setAttribute('aria-modal','true');
  $('playerPanel').setAttribute('aria-label','Your music player');
  $('playerPanel').querySelector('[data-action="collapse"]')?.focus();
}
function collapse(){
  document.body.classList.remove('player-expanded'); $('playerBackdrop').hidden=true;
  $('playerPanel').removeAttribute('role'); $('playerPanel').removeAttribute('aria-modal');
  lastFocus?.focus({preventScroll:true});
}
function updatePlayback(){
  const active=track && !audio.paused;
  document.body.classList.toggle('music-playing',!!active);
  document.body.classList.toggle('has-track',!!track);
  $('miniPlayer').hidden=!track || !$('intro').hidden;
  if(track){
    $('miniTitle').textContent=track.name;
    $('miniMeta').textContent=`${domain.name} · ${hz[domain.key]} Hz${loading?' · Loading…':''}`;
  }
  $('miniToggle').innerHTML=active?pauseIcon:playIcon;
  $('miniToggle').setAttribute('aria-label',active?'Pause music':'Play music');
  document.querySelectorAll('[data-track]').forEach(row=>{
    const current=row.dataset.track===track?.id;
    row.classList.toggle('is-current',current);
    row.querySelector('.row-play').innerHTML=current&&loading?'<span class="loading-dot"></span>':current&&active?pauseIcon:playIcon;
    row.setAttribute('aria-label',`${current&&active?'Pause':'Play'} ${tracks.find(t=>t.id===row.dataset.track).name}`);
  });
  const duration=audio.duration||0, position=duration?audio.currentTime/duration:0;
  $('seek').value=Math.round(position*1000); $('seek').disabled=!duration;
  $('elapsed').textContent=time(audio.currentTime); $('duration').textContent=time(duration);
  $('miniProgress').style.width=`${position*100}%`;
  if('mediaSession' in navigator && track){
    navigator.mediaSession.metadata=new MediaMetadata({title:track.name,artist:`Zodiac.fm · ${domain.name} · ${hz[domain.key]} Hz`});
    navigator.mediaSession.playbackState=active?'playing':'paused';
  }
}
function stopTone(){
  if(oscillator){try{gain.gain.setTargetAtTime(0,context.currentTime,.035);const old=oscillator;setTimeout(()=>{try{old.stop();}catch{}},150);}catch{} oscillator=null;}
  toneOn=false; $('tonePlay').textContent='Hear the tone'; $('tonePlay').setAttribute('aria-pressed','false'); drawTone();
}
async function playTone(){
  if(toneOn){stopTone();return;}
  audioRequest++;loading=false; audio.pause();
  try{
    context ||= new (window.AudioContext||window.webkitAudioContext)();
    await context.resume();
    oscillator=context.createOscillator();gain=context.createGain();oscillator.type='sine';
    oscillator.frequency.value=hz[domain.key];gain.gain.value=0;
    oscillator.connect(gain).connect(context.destination);oscillator.start();
    gain.gain.setTargetAtTime(.055*Number($('volume').value),context.currentTime,.08);
    toneOn=true;$('tonePlay').textContent='Pause the tone';$('tonePlay').setAttribute('aria-pressed','true');
    drawTone();
  }catch{ $('audioError').textContent='Tap again to enable sound in this browser.'; }
  updatePlayback();
}
async function getAudioURL(t,key){
  const n=mediaHz(key), cacheKey=`${t.id}-${n}`, cached=urlCache.get(cacheKey);
  if(cached && cached.until>Date.now()) return cached.url;
  const result=await request(`${API}?action=audio&track=${encodeURIComponent(t.id)}&hz=${n}`);
  if(!result.url || !/^https:\/\//.test(result.url)) throw new Error('This recording is unavailable right now. Please try again.');
  urlCache.set(cacheKey,{url:result.url,until:Date.now()+240000});return result.url;
}
async function loadTrack(t,{at=0,resume=true}={}){
  const ticket=++audioRequest, requestedDomain=domain.key, requestedKey=`${t.id}-${mediaHz(requestedDomain)}`; stopTone(); audio.pause(); audio.removeAttribute('src'); audio.load(); loadedKey='';track=t; loading=true;
  $('audioError').textContent=''; updatePlayback();
  try{
    const url=await getAudioURL(t,requestedDomain);
    if(ticket!==audioRequest)return;
    audio.src=url; audio.load();
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>done(new Error('The recording is taking too long to load. Tap the song to retry.')),20000);
      const ready=()=>done(),error=()=>done(new Error('We couldn’t load that recording. Tap the song to retry.'));
      function done(err){clearTimeout(timeout);audio.removeEventListener('loadedmetadata',ready);audio.removeEventListener('error',error);err?reject(err):resolve();}
      audio.addEventListener('loadedmetadata',ready,{once:true});audio.addEventListener('error',error,{once:true});
      if(audio.readyState>=1)done();
    });
    if(ticket!==audioRequest)return;
    audio.currentTime=Math.min(at,Math.max(0,(audio.duration||0)-.15)); loadedKey=requestedKey;loading=false;
    if(resume){await audio.play();audioStarted=true;}
  }catch(err){if(ticket===audioRequest){loading=false;$('audioError').textContent=err.name==='NotAllowedError'?'Your music is ready. Tap Play to listen.':err.message;}}
  if(ticket===audioRequest)updatePlayback();
}
async function chooseTrack(id){
  const chosen=tracks.find(t=>t.id===id&&t.free);if(!chosen)return;
  if(track?.id===id && loadedKey===`${id}-${mediaHz(domain.key)}` && audio.src && !loading && !audio.error){stopTone();if(audio.paused){try{await audio.play();audioStarted=true;}catch{$('audioError').textContent='Tap the song again to play.';}}else audio.pause();updatePlayback();}
  else await loadTrack(chosen);
}
async function chooseFrequency(key){
  if(domain.key===key)return;
  const at=audio.currentTime,playing=!audio.paused,wasTone=toneOn;
  stopTone();domain=domains.find(d=>d.key===key);setProfile();
  if(wasTone)await playTone();else if(track)await loadTrack(track,{at,resume:playing});
}
let drawFrame=0;
function drawTone(){
  cancelAnimationFrame(drawFrame);
  const canvas=$('toneCanvas'), c=canvas.getContext('2d'), w=canvas.width,h=canvas.height;
  function paint(stamp){
    c.clearRect(0,0,w,h);c.strokeStyle='#dededb';c.lineWidth=1;
    c.beginPath();c.moveTo(0,h/2);c.lineTo(w,h/2);c.stroke();
    const phase=toneOn?stamp/450:0;
    for(let layer=0;layer<3;layer++){
      c.globalAlpha=layer===0?1:.13;c.strokeStyle=domain.color;c.lineWidth=layer===0?2:1;
      c.beginPath();for(let x=0;x<=w;x+=2){const envelope=Math.sin(x/w*Math.PI)**1.1;const y=h/2+Math.sin(x/w*Math.PI*(hz[domain.key]/70)+phase+layer*.3)*envelope*(h*.30-layer*4);x?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
    }c.globalAlpha=1;
    if(toneOn&&!matchMedia('(prefers-reduced-motion: reduce)').matches)drawFrame=requestAnimationFrame(paint);
  }paint(performance.now());
}

let searchTimer;
$('birthPlace').addEventListener('input',()=>{
  selectedPlace=null;$('placeStatus').textContent='';clearTimeout(searchTimer);const q=$('birthPlace').value.trim(), ticket=++placeRequest;
  $('placeResults').replaceChildren();if(q.length<2)return;
  searchTimer=setTimeout(async()=>{
    try{
      const result=await request(`${API}?action=places&q=${encodeURIComponent(q)}`);if(ticket!==placeRequest)return;
      const places=Array.isArray(result)?result:result.results||[];
      $('placeResults').innerHTML=places.slice(0,6).map((p,i)=>`<li><button type="button" data-place="${i}">${esc(p.name)}<small>${esc([p.admin1,p.country].filter(Boolean).join(', '))}</small></button></li>`).join('')+(places.length?'<li class="maps-credit" translate="no">Google Maps</li>':'');
      if(!places.length)$('placeStatus').textContent='No matches. Try a nearby town or city.';
      $('placeResults').querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{selectedPlace=places[Number(b.dataset.place)];$('birthPlace').value=[selectedPlace.name,selectedPlace.admin1,selectedPlace.country].filter(Boolean).join(', ');$('placeResults').replaceChildren();$('placeStatus').textContent='Birthplace selected';});
    }catch{if(ticket===placeRequest)$('placeStatus').textContent='Place search is unavailable. Please try again shortly.';}
  },350);
});
$('unknownTime').addEventListener('change',()=>{$('birthTime').disabled=$('unknownTime').checked;if($('unknownTime').checked)$('birthTime').value='12:00';});
function timezoneOffset(date,clock,zone){
  const target=new Date(`${date}T${clock}:00Z`).getTime();let candidate=target;
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<3;i++){
    const p=Object.fromEntries(fmt.formatToParts(new Date(candidate)).map(x=>[x.type,x.value]));
    const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    const offset=(local-candidate)/3600000;candidate=target-offset*3600000;
  }
  const parts=Object.fromEntries(fmt.formatToParts(new Date(candidate)).map(x=>[x.type,x.value]));
  if(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`!==`${date}T${clock}`)throw new Error('That local time falls in a daylight-saving clock change. Please check your birth time.');
  return (target-candidate)/3600000;
}
$('birthDate').max=new Date().toISOString().slice(0,10);$('birthDate').min='1900-01-01';
$('birthForm').addEventListener('submit',async e=>{
  e.preventDefault();$('birthError').textContent='';
  if(!selectedPlace){$('birthError').textContent='Choose your birthplace from the search results.';$('birthPlace').focus();return;}
  const date=$('birthDate').value,clock=$('unknownTime').checked?'12:00':$('birthTime').value;
  if(!date||!clock||!$('birthDate').validity.valid){$('birthError').textContent='Add a valid birth date and time, or choose “Unknown birth time?”';return;}
  $('findFrequencies').disabled=true;$('findFrequencies').textContent='Finding your frequencies…';
  try{
    const [year,month,day]=date.split('-').map(Number),[hour,min]=clock.split(':').map(Number);
    const tzone=timezoneOffset(date,clock,selectedPlace.timezone);
    const result=await request(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'calculate',year,month,day,hour,min,lat:selectedPlace.latitude,lon:selectedPlace.longitude,tzone})});
    const values=result.frequencies;
    if(!values||domains.some(d=>!Number.isFinite(Number(values[d.key]))||+values[d.key]<250||+values[d.key]>950))throw new Error('Your frequencies could not be calculated. Please try again.');
    audioRequest++;audio.pause();audio.removeAttribute('src');audio.load();stopTone();track=null;loading=false;
    hz=Object.fromEntries(domains.map(d=>[d.key,Number(values[d.key])]));example=false;
    try{sessionStorage.setItem('zfm-tune-in-01',JSON.stringify({hz}));}catch{}
    enter();
  }catch(err){$('birthError').textContent=`${err.message} You can still hear an example below.`;}
  finally{$('findFrequencies').disabled=false;$('findFrequencies').textContent='Hear my frequencies';}
});
function personalize(){
  collapse();audio.pause();stopTone();document.body.classList.remove('has-profile');document.querySelector('.header-actions [data-action="personalize"]').hidden=true;$('intro').hidden=false;$('experience').hidden=true;$('journeyNav').hidden=true;$('miniPlayer').hidden=true;
  window.scrollTo({top:0,behavior:'instant'});$('birthDate').focus({preventScroll:true});
}
function renderOffer(){
  $('offerBlock').innerHTML='<p class="offer-kicker">A LITTLE MORE ROOM TO LISTEN</p><div class="plan-options"><label><input type="radio" name="plan" value="annual" checked><span><b>$7.33<small>/mo</small></b><span>$88 billed yearly</span><em>Save $21 a year on the list price</em></span></label><label><input type="radio" name="plan" value="monthly"><span><b>$14<small>/mo</small></b><span>Billed monthly</span><em>$3 off the monthly list price</em></span></label></div><p class="offer-terms">$3 today for 7 days. Then <span id="renewal">$88 yearly</span>, starting on day 8. Cancel during the trial and nothing more is charged. The $3 trial charge is not refunded.</p>';
  document.querySelectorAll('[name="plan"]').forEach(el=>el.addEventListener('change',()=>{plan=el.value;$('renewal').textContent=plan==='annual'?'$88 yearly':'$14 monthly';}));
}
const sharedURL=new URL(location.href);sharedURL.hash='';sharedURL.search='';
const inputParams=new URLSearchParams(location.search);
for(const k of ['infclid','coupon','utm_source','utm_medium','utm_campaign']){
  const v=inputParams.get(k);if(v&&v.length<=200)sharedURL.searchParams.set(k,v);
}
$('shareUrl').value=sharedURL.href;
const appURL=new URL('https://app.zodiac.fm/begin');
for(const k of ['infclid','coupon']){const v=inputParams.get(k);if(v&&v.length<=200)appURL.searchParams.set(k,v);}
$('appLink').href=appURL.href;
async function share(){
  $('shareDialog').showModal();
}
document.addEventListener('click',async e=>{
  const button=e.target.closest('button,[data-action]');if(!button)return;
  if(button.dataset.track){await chooseTrack(button.dataset.track);return;}
  if(button.dataset.frequency){await chooseFrequency(button.dataset.frequency);return;}
  switch(button.dataset.action){
    case 'example':audioRequest++;audio.pause();audio.removeAttribute('src');audio.load();stopTone();track=null;loading=false;example=true;hz={core:422,love:432,vitality:579,abundance:611};enter();break;
    case 'personalize':personalize();break;
    case 'tone':await playTone();break;
    case 'toggle':if(track)await chooseTrack(track.id);break;
    case 'expand':expand();break;
    case 'collapse':collapse();break;
    case 'listen':collapse();navigate('listen');break;
    case 'next':collapse();navigate(screens[(screens.indexOf(screen)+1)%screens.length]);break;
    case 'previous':collapse();navigate(screens[Math.max(0,screens.indexOf(screen)-1)]);break;
    case 'membership':collapse();navigate('membership');break;
    case 'share':await share();break;
    case 'copy-link':try{await navigator.clipboard.writeText(sharedURL.href);button.textContent='Link copied';}catch{$('shareUrl').select();button.textContent='Select and copy the link';}break;
    case 'checkout':$('checkoutSummary').textContent=`Offer preview: $3 for 7 days, then ${plan==='annual'?'$88 billed yearly':'$14 billed monthly'} from day 8. This prototype does not collect payment or start a subscription.`;$('checkoutDialog').showModal();break;
    case 'close-dialog':button.closest('dialog')?.close();break;
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape')collapse();
  if(e.key==='Tab'&&document.body.classList.contains('player-expanded')){
    const nodes=[...$('playerPanel').querySelectorAll('button,input,summary,a')].filter(n=>!n.disabled&&n.getClientRects().length);
    if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus();}
    else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus();}
  }
});
$('seek').addEventListener('input',e=>{if(audio.duration)audio.currentTime=Number(e.target.value)/1000*audio.duration;});
$('volume').addEventListener('input',e=>{audio.volume=Number(e.target.value);if(toneOn)gain.gain.setTargetAtTime(.055*audio.volume,context.currentTime,.03);});
for(const event of ['play','pause','timeupdate','durationchange','ended','waiting','playing'])audio.addEventListener(event,updatePlayback);
audio.addEventListener('error',()=>{if(audio.src&&!loading)$('audioError').textContent='The recording stopped loading. Tap the song to try again.';});
if('mediaSession' in navigator){navigator.mediaSession.setActionHandler('play',()=>{if(track&&audio.paused)chooseTrack(track.id);});navigator.mediaSession.setActionHandler('pause',()=>audio.pause());}
window.addEventListener('pagehide',()=>{stopTone();});
renderOffer();setProfile();
fetch('tune-in-01-bands.json').then(r=>r.json()).then(data=>{bands=data;renderBands();}).catch(()=>{});
try{const saved=JSON.parse(sessionStorage.getItem('zfm-tune-in-01'));if(saved?.hz&&domains.every(d=>Number.isFinite(saved.hz[d.key])&&saved.hz[d.key]>=250&&saved.hz[d.key]<=950)){hz=saved.hz;example=false;enter();}}catch{}
