'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names = {g:'General',a:'Astrology',m:'Manifestation',shared:'Shared page',paid:'Paid trial',free:'Free trial',home:'Home'};
  const families = {lander:'Lander',results:'Results',bc:'Birth chart',join:'Cart / Join',corporate:'Corporate site'};
  const variants = family => family === 'corporate' ? ['home'] : family === 'bc' ? ['shared'] : family === 'join' ? ['paid','free'] : ['g','a','m'];
  const time = value => value ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Denver',timeZoneName:'short'}).format(new Date(value)) : 'Not checked yet';
  const url = value => {try{const parsed=new URL(value);return parsed.protocol==='https:'?parsed.href:'';}catch{return '';}};
  const api = '/api/funnel-production';
  let previousPageVisit=null;
  try{previousPageVisit=localStorage.getItem('funnel-tracker-page-visit');localStorage.setItem('funnel-tracker-page-visit',new Date().toISOString());}catch{/* Private shared history does not depend on this device marker. */}
  const requestedMode = new URLSearchParams(location.search).get('mode');
  let mode = requestedMode === 'history' ? 'pages' : requestedMode === 'records' ? 'sections' : 'review';
  let family='lander',variant='g',targets=[],loaded=false,loading=false,busy=new Set(),error='',user=null;
  const dialog=document.createElement('dialog');dialog.id='production-dialog';document.body.appendChild(dialog);
  async function request(body){
    const response=await fetch(api,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    let result;try{result=await response.json();}catch{throw new Error('The page service could not respond. Try refreshing.');}
    if(!response.ok)throw new Error(result.message||result.error?.message||(typeof result.error==='string'?result.error:'Page records could not be loaded.'));
    return result;
  }
  function setMode(value){
    mode=value;$('production-workspace').hidden=mode!=='pages';$('section-workspace').hidden=mode!=='sections';$('review-workspace').hidden=mode!=='review';
    document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
    const route=new URL(location.href);route.searchParams.set('mode',mode==='pages'?'history':mode==='sections'?'records':'review');history.replaceState(null,'',route);
    document.dispatchEvent(new CustomEvent('tracker:mode',{detail:{mode}}));
    if(mode==='pages'&&user&&!loaded)load();
  }
  async function load(){
    if(loading||!user)return;loading=true;
    try{const result=await request();if(!user)return;targets=result.targets||[];loaded=true;error='';}
    catch(e){error=e.message;}finally{loading=false;render();}
  }
  const statusLabel = target => {
    let label={never_checked:'Awaiting first screenshot',baseline:'First screenshot saved',current:'No change at last check',changed:'Change captured',needs_connection:'Connection needed',error:'Capture failed'}[target.status]||'Awaiting first screenshot';
    const latest=target.archives?.find(archive=>archive.id===target.currentArchiveId);
    const compared=latest?.comparisonVersion==='semantic-v2'&&latest.changeSummary?.diagnosticBaseline===false;
    if(target.status==='changed'&&!compared)label='Screenshot difference';
    if(target.status==='baseline'&&target.archiveCount>1&&target.comparisonVersion==='semantic-v2')label='Comparison ready';
    return latest?.kind==='changed'&&compared&&previousPageVisit&&new Date(target.lastChangedAt)>new Date(previousPageVisit)?'New change since your last visit · '+label:label;
  };
  function row(target){
    const address=url(target.productionUrl), draft=target.stage==='draft';
    return `<article class="production-row"><div class="production-row-main"><div class="production-row-heading"><h4>${esc(draft?target.label:target.channel==='direct'?'Direct':target.channel==='paid'?'Paid · Facebook':target.channel==='affiliate'?'Affiliate · David McEwen':target.label)}</h4><span class="capture-status ${esc(target.status||'never_checked')}">${esc(statusLabel(target))}</span></div>${address?`<a class="production-url" href="${esc(address)}" target="_blank" rel="noopener">${esc(address.replace('https://',''))} ↗</a>`:''}${target.expectedOffer?`<p class="offer-note">${esc(target.expectedOffer)}</p>`:''}<p class="capture-meta">${esc(target.sourceRepo||'zodiac-fm/zodiac-pages')}${target.captureKind==='sample-profile'?' · Fixed sample profile':''}</p>${target.error?`<p class="capture-error">${esc(target.error.message||'The page could not be captured. Its previous screenshots are safe.')}</p>`:''}<p class="capture-meta">Last check: ${esc(time(target.lastCheckedAt))}${target.lastChangedAt?' · Last recorded difference: '+esc(time(target.lastChangedAt)):''}</p></div><div class="production-actions"><button data-history="${esc(target.id)}" ${!target.archiveCount?'disabled':''}>${Number(target.archiveCount)||0} screenshot${target.archiveCount===1?'':'s'}${target.archiveCount?' · History':''}</button><button data-check="${esc(target.id)}" ${busy.has(target.id)?'disabled':''}>${busy.has(target.id)?'Checking…':'Check now'}</button></div></article>`;
  }
  function render(){
    if(!user)return;
    const selected=targets.filter(t=>t.family===family&&(t.variant===variant||t.variant==='shared'));
    const live=selected.filter(t=>t.stage==='production'),draft=selected.filter(t=>t.stage==='draft');
    $('production-workspace').innerHTML=`<div class="production-subhead"><nav class="production-variants" aria-label="Page category">${variants(family).map(v=>`<button data-page-variant="${v}" class="${variant===v?'selected':''}" aria-pressed="${variant===v}">${['g','a','m'].includes(v)?`<span>${v.toUpperCase()}</span>`:''}${names[v]}</button>`).join('')}</nav><button id="register-page">Add Vercel page</button></div><div class="production-title"><div><p class="eyebrow">${esc(families[family])} / ${esc(names[variant])}</p><h2>The page and its history.</h2></div><p>Checks run every 15 minutes.<br>Each detected change saves a screenshot and date.</p></div><div class="production-explainer"><p>Live links stay the same. Screenshots keep the previous versions available to both of you.</p><p>${family==='results'?'Results captures use a fixed sample profile, with separate paid and affiliate offers. Personal member details are excluded.':'A screenshot records what the monitor saw. Use Section versions to record who edited a section and which exact revision Walter took live.'}</p></div>${error?`<div class="capture-alert" role="alert">${esc(error)} <button id="retry-production">Try again</button></div>`:''}${!loaded?'<div class="loading">Loading private page records…</div>':`<section class="production-group"><div class="production-group-title"><h3>Live on ${family==='results'?'app.zodiac.fm':'zodiac.fm'}</h3><span>${live.length} tracked link${live.length===1?'':'s'}</span></div>${live.length?live.map(row).join(''):'<div class="production-empty">The live '+esc(families[family].toLowerCase())+' link has not been provided yet. Your Vercel pages are listed below.</div>'}</section><section class="production-group"><div class="production-group-title"><h3>Working pages on Vercel</h3><span>Drafts</span></div>${draft.length?draft.map(row).join(''):'<div class="production-empty">Add a Vercel page to start keeping its screenshot history.</div>'}</section><p class="production-footnote">The first successful check creates today’s starting record. Later checks save another screenshot when page content changes. A failed check keeps the last successful capture. Changes between checks may not be captured.</p>`}`;
    document.querySelectorAll('[data-page-variant]').forEach(b=>b.onclick=()=>{variant=b.dataset.pageVariant;document.dispatchEvent(new CustomEvent('tracker:select-variant',{detail:{variant}}));render();});
    document.querySelectorAll('[data-check]').forEach(b=>b.onclick=()=>check(b.dataset.check));
    const rows=$('production-workspace').querySelectorAll('.production-row-main');
    if(family==='corporate'){
      $('production-workspace').querySelector('.production-explainer p:last-child').textContent='The live corporate homepage and your Vercel drafts keep their dated screenshot history here.';
      [...live,...draft].forEach((target,index)=>{if(rows[index])rows[index].querySelector('h4').textContent=target.label;});
    }
    if(!live.length){const heading=$('production-workspace').querySelector('.production-group-title h3');if(heading)heading.textContent='Live page';}
    [...live,...draft].forEach((target,index)=>{if(target.editor&&rows[index])rows[index].insertAdjacentHTML('beforeend',`<p class="capture-meta">Added by ${esc(target.editor.name)} · ${esc(time(target.registeredAt))}</p>`);});
    document.querySelectorAll('[data-history]').forEach(b=>b.onclick=()=>historyFor(b.dataset.history));
    $('register-page').onclick=register;$('retry-production')?.addEventListener('click',load);
  }
  async function check(id){
    if(busy.has(id))return;busy.add(id);error='';render();
    try{const result=await request({action:'check',targetId:id});if(!user)return;if(result.target)targets=targets.map(t=>t.id===id?result.target:t);else await load();if(result.result?.error)error=result.result.error.message;}
    catch(e){error=e.message;}finally{busy.delete(id);render();}
  }
  function openDialog(content){dialog.innerHTML=`<div class="dialog-top"><p class="eyebrow">Page production</p><button id="close-production" class="icon-button" aria-label="Close page history">✕</button></div>${content}`;$('close-production').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();}
  function historyFor(id){
    const target=targets.find(t=>t.id===id);if(!target)return;
    openDialog(`<h2>${esc(target.label)}${target.stage==='production'?' · '+esc(target.channel):''}</h2><p class="muted">${target.captureKind==='sample-profile'?'Fixed sample profile. ':''}Screenshot dates show when the monitor observed the page. They do not identify who changed it.</p><div class="archive-list">${[...(target.archives||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map((a,i)=>{const source=new URL(api,location.origin);source.searchParams.set('targetId',target.id);source.searchParams.set('archiveId',a.id);return `<article class="archive-entry"><div class="archive-heading"><h3>${esc(archiveTitle(a))}${a.id===target.currentArchiveId?' · Latest':''}</h3><time>${esc(time(a.createdAt))}</time></div><p class="capture-meta">${esc(archiveSummary(a))}${a.sourceCommit?' Source commit: '+esc(a.sourceCommit.slice(0,10))+'.':''}</p><details ${i===0?'open':''}><summary>View screenshot</summary><a href="${esc(source.pathname+source.search)}" target="_blank" rel="noopener">Open full screenshot ↗</a><img loading="lazy" src="${esc(source.pathname+source.search)}" alt="${esc(target.label+' captured '+time(a.createdAt))}"></details></article>`;}).join('')}</div>`);
  }
  function archiveTitle(archive){
    if(archive.comparisonBaseline)return 'Verified starting point';
    if(archive.kind==='baseline')return 'Starting record';
    return archive.comparisonVersion==='semantic-v2'&&archive.changeSummary?.diagnosticBaseline===false?'Page change captured':'Screenshot difference';
  }
  function archiveSummary(archive){
    if(archive.comparisonBaseline)return 'This screenshot is the starting point for future page comparisons.';
    if(archive.kind==='baseline')return 'First successful screenshot of this link.';
    if(archive.comparisonVersion==='semantic-v2'&&archive.changeSummary?.diagnosticBaseline===false){
      const changes=archive.changeSummary,parts=[];
      if(changes.mainHtmlChanged||changes.normalizedDomChanged)parts.push('page content');
      if(changes.inlineCssChanged)parts.push('page styles');
      if(changes.resourceSetChanged)parts.push('linked styles, images, fonts or scripts');
      return parts.length?'The comparison found a change in '+parts.join(' and ')+'.':'A page difference was recorded.';
    }
    return 'The earlier comparison found a difference. That does not establish that the page was edited.';
  }
  function register(){
    openDialog(`<h2>Add a working page.</h2><p class="muted">Use its stable zodiac-pages.vercel.app link. Your company account will be recorded with the page.</p><form id="register-production"><label class="field">Page name<input name="name" required maxlength="160" placeholder="For example: General lander, new hero"></label><label class="field">Page family<select name="family">${Object.entries(families).map(([key,name])=>`<option value="${key}" ${key===family?'selected':''}>${name}</option>`).join('')}</select></label><label class="field">Category<select name="variant"></select></label><label class="field">Vercel URL<input name="url" required type="url" placeholder="https://zodiac-pages.vercel.app/…"></label><p id="register-error" class="form-error" role="alert"></p><div class="form-actions"><button type="button" id="cancel-production">Cancel</button><button class="primary" type="submit">Add page</button></div></form>`);
    const form=$('register-production');form.elements.name.maxLength=120;const select=form.elements.family;const update=()=>{form.elements.variant.innerHTML=variants(select.value).map(v=>`<option value="${v}" ${v===variant?'selected':''}>${names[v]}</option>`).join('');};update();select.onchange=update;$('cancel-production').onclick=()=>dialog.close();
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;$('register-error').textContent='';try{const fields=new FormData(form);await request({action:'register',payload:Object.fromEntries(fields)});await load();dialog.close();}catch(e){$('register-error').textContent=e.message;}finally{button.disabled=false;}};
  }
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  if($('all-changes').firstChild)$('all-changes').firstChild.textContent='Changes ';
  document.addEventListener('tracker:show-sections',()=>setMode('review'));
  document.addEventListener('tracker:add-page',()=>{setMode('pages');register();});
  document.addEventListener('tracker:selection',e=>{family=e.detail.family;variant=e.detail.variant;if(loaded)render();});
  document.addEventListener('tracker:ready',e=>{user=e.detail.user;family=e.detail.family;variant=e.detail.variant;setMode(mode);load();});
  new MutationObserver(()=>{if(document.querySelector('main').hidden){user=null;targets=[];loaded=false;dialog.close();dialog.innerHTML='';$('production-workspace').innerHTML='';}}).observe(document.querySelector('main'),{attributes:true,attributeFilter:['hidden']});
  setMode(mode);
})();
