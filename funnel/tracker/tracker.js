'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const link = (url, label) => safeUrl(url) ? `<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener">${escape(label)} ↗</a>` : '';
  const codeReference = version => version.repositoryRef ? `<p class="revision-meta">Code reference: ${link('https://github.com/'+version.repositoryRef.repository+'/commit/'+version.repositoryRef.commit,version.repositoryRef.repository+' · '+version.repositoryRef.commit.slice(0,8))}${version.repositoryRef.path?' · '+escape(version.repositoryRef.path):''}<br>Contributor supplied. Deployment has not been verified by this link.</p>` : '';
  const date = value => value ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Denver'}).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00Z':value)) : 'No date recorded';
  const dateTime = value => value ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/Denver',timeZoneName:'short'}).format(new Date(value)) : '';
  const nowDate = () => new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'America/Denver'}).format(new Date());
  const getStored = key => {try{return localStorage.getItem(key);}catch{return null;}};
  const setStored = (key,value) => {try{localStorage.setItem(key,value);}catch{/* Shared records never depend on local storage. */}};
  const previousVisit = getStored('funnel-tracker-visit');
  setStored('funnel-tracker-visit',new Date().toISOString());
  let data = null, revision = null, canEdit = false, actor = '', signedInUser = null, family = 'lander', variant = 'g', view = 'sections', activeSection = null, editMode = '', saving = false, allChanges = false;
  const familyNames = {lander:'Lander',bc:'Birth chart',results:'Results',join:'Cart / Join',corporate:'Corporate site'};
  const variantNames = {g:'General',a:'Astrology',m:'Manifesting',shared:'Shared page',paid:'$3 trial',free:'Free trial',home:'Home'};
  const variantsFor = f => f === 'corporate' ? ['home'] : f === 'bc' ? ['shared'] : f === 'join' ? ['paid','free'] : ['g','a','m'];
  const latest = s => s.versions[s.versions.length - 1];
  const isNew = s => previousVisit && new Date(latest(s).createdAt) > new Date(previousVisit);
  const hasPending = s => s.live && s.live.versionId !== latest(s).id;
  const hasPreviewGap = s => /has not been verified|does not yet contain/.test(s.scopeNote||'');
  const familySections = () => data.sections.filter(s => s.family === family && (s.variant === variant || s.variant === 'shared'));
  const findSection = id => data.sections.find(s => s.id === id);
  const field = (name,label,control,help='') => `<div class="field"><label for="${name}">${label}</label>${help?control.replace(' id=',` aria-describedby="${name}-help" id=`):control}${help?`<small id="${name}-help">${help}</small>`:''}</div>`;
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>{$('toast').hidden=true;},4500);}
  async function request(body,path='/api/funnel-tracker'){
    const response = await fetch(path,body ? {method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)} : {cache:'no-store',credentials:'same-origin'});
    let result; try{result=await response.json();}catch{throw new Error('The shared service did not return a valid response. Refresh and check the section history before trying again.');}
    if(!response.ok){ const err=new Error(result.message || result.error?.message || (response.status===409?'Someone saved a change while you were editing. Refresh, compare their revision, then save again.':response.status===401?'Company sign-in is required.':'Shared records are temporarily unavailable. Refresh and check the section history before trying again.'));err.status=response.status;err.result=result;throw err; }
    return result;
  }
  async function refresh(silent=false){
    try{
      const result=await request();
      if(!result.data || !Array.isArray(result.data.sections))throw new Error('The shared service returned incomplete section records.');
      const oldRevision=revision;data=result.data;revision=result.revision;canEdit=Boolean(result.canEdit);signedInUser=result.user||null;actor=signedInUser?.email||result.actor||'';
      document.querySelector('main').hidden=false;$('sign-in').hidden=true;$('all-changes').hidden=false;
      const source=data.sources?.find(s=>/google doc|document/i.test(s.label));if(source&&safeUrl(source.url)){$('source-link').href=safeUrl(source.url);$('source-link').hidden=false;}
      $('sync-status').textContent='Shared records · refreshed '+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Denver'}).format(new Date());
      $('access').disabled=false;$('access').textContent=signedInUser?.name?.split(' ')[0]||'Your account';$('access').title=actor;$('access-state').textContent=`Signed in as ${actor}. Your verified account is recorded with every change.`;
      render();document.dispatchEvent(new CustomEvent('tracker:ready',{detail:{user:signedInUser,family,variant,data,revision,canEdit}}));if(!silent && oldRevision && oldRevision!==revision)toast('The workspace has new changes.');return true;
    }catch(error){
      if(error.status===401){data=null;canEdit=false;signedInUser=null;actor='';document.dispatchEvent(new Event('tracker:signed-out'));document.querySelector('main').hidden=true;$('sign-in').hidden=false;$('all-changes').hidden=true;$('source-link').hidden=true;$('source-link').removeAttribute('href');$('access').textContent='Company sign-in';for(const id of ['sections','revisions','change-log','page-notes','detail-scope','live-summary','edit-fields'])$(id).textContent='';if($('section-dialog').open)$('section-dialog').close();if($('edit-dialog').open)$('edit-dialog').close();return false;}
      $('sync-status').textContent='Could not refresh shared records';
      if(error.result?.user){signedInUser=error.result.user;actor=signedInUser.email;$('access').textContent=signedInUser.name?.split(' ')[0]||'Your account';$('access').title=actor;}
      if(!data){$('sections').innerHTML='<div class="empty">Shared records are unavailable. Use Refresh to try again.</div>';}
      if(!data)$('sign-in-status').textContent=signedInUser?'Your company account is signed in. Private records are awaiting storage setup.':'Company access and private storage are being connected. Your section records remain private.';
      if(!silent)toast(error.message);return false;
    }
  }
  function status(s){return hasPending(s)?'<span class="status">● Newer draft</span>':s.live?'<span class="status live">● Latest revision live</span>':'<span class="status unknown">Live unconfirmed</span>';}
  function render(){
    if(!data)return;
    document.dispatchEvent(new CustomEvent('tracker:selection',{detail:{family,variant}}));
    document.querySelectorAll('[data-family]').forEach(b=>{const selected=b.dataset.family===family;b.classList.toggle('selected',selected);b.setAttribute('aria-current',selected?'page':'false');});
    $('variants').innerHTML=variantsFor(family).map(v=>`<button data-variant="${v}" class="${v===variant?'selected':''}" aria-pressed="${v===variant}">${['g','a','m'].includes(v)?`<span>${v.toUpperCase()}</span>`:''}${variantNames[v]}</button>`).join('');
    $('variants').querySelectorAll('button').forEach(b=>b.onclick=()=>{variant=b.dataset.variant;allChanges=false;view='sections';setRoute();render();});
    const list=allChanges?data.sections:familySections(),title=family==='bc'?'Birth chart':variantNames[variant];
    $('family-label').textContent=familyNames[family]+' / '+(family==='bc'?'One shared page':variantNames[variant]);
    $('page-title').textContent=title;$('overview-title').textContent=family==='bc'?'Birth chart':title+' '+(family==='join'?'join':family==='lander'?'lander':'results');
    $('page-description').textContent=family==='lander'?'Matching numbers share one format. Sections 11–16 and the footer share the same requirements.':family==='results'?'Only sections 02, 03 and 09 vary by category. Personal results and offer values are runtime variables.':family==='bc'?'The accepted birth chart design, organized into sections for implementation.': 'Accepted Join 04 design. Paid and free offers keep separate revision histories.';
    if(allChanges){$('family-label').textContent='Across the whole funnel';$('page-title').textContent='All funnel changes';$('overview-title').textContent='The whole funnel';$('page-description').textContent='Dated drafts and production confirmations from every page and variation, newest first.';}
    const pageUrl=allChanges?null:list.find(s=>s.variant===variant)?.sourceUrl;
    $('page-preview').hidden=!safeUrl(pageUrl);if(safeUrl(pageUrl))$('page-preview').href=safeUrl(pageUrl);
    $('total').textContent=list.length;$('pending').textContent=list.filter(hasPending).length;$('confirmed').textContent=list.filter(s=>s.live).length;$('unknown').textContent=list.filter(s=>!s.live).length;
    $('page-notes').textContent=data.pageNotes?.[family]||'No page notes recorded.';
    $('sections').hidden=view!=='sections';$('change-log').hidden=view!=='changes';$('section-view').classList.toggle('selected',view==='sections');$('change-view').classList.toggle('selected',view==='changes');
    const query=$('search').value.trim().toLowerCase(),filter=$('filter').value;
    const filtered=list.filter(s=>{
      const v=latest(s);if(query&&!`${s.id} ${s.name} ${v.content} ${v.summary}`.toLowerCase().includes(query))return false;
      return filter==='all'||filter==='pending'&&(!s.live||hasPending(s))||filter==='live'&&s.live||filter==='unknown'&&!s.live||filter==='unseen'&&isNew(s);
    });
    $('sections').innerHTML=filtered.length?filtered.map(s=>{const v=latest(s);return `<div class="section-row" role="button" tabindex="0" data-section="${escape(s.id)}" aria-label="${escape(s.id+' '+s.name+'. Open revision history')}"><span class="section-code">${escape(s.id)}</span><div><div class="section-name">${escape(s.name)}${isNew(s)?'<span class="new-label">New</span>':''}${s.shared?'<span class="shared-label">Shared format</span>':''}</div><p class="section-note"><strong>Revision ${v.number}</strong> · ${escape(v.summary)}</p></div><div class="section-meta">${status(s)}<time datetime="${escape(v.createdAt)}">${date(v.createdAt)}</time></div><span class="chevron" aria-hidden="true">›</span></div>`;}).join(''):'<div class="empty">No sections match this view.</div>';
    $('sections').querySelectorAll('[data-section]').forEach(row=>{row.onclick=()=>openSection(row.dataset.section);row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openSection(row.dataset.section);}};});
    $('sections').querySelectorAll('[data-section]').forEach(row=>{if(hasPreviewGap(findSection(row.dataset.section)))row.querySelector('.section-name').insertAdjacentHTML('beforeend','<span class="new-label">Preview gap</span>');});
    const ids=new Set(list.map(s=>s.id));
    const events=(data.events||[]).filter(e=>ids.has(e.sectionId));
    const imports=list.flatMap(s=>s.versions.filter(v=>v.author==='Source import').map(v=>({sectionId:s.id,type:'import',createdAt:v.createdAt,author:v.author,summary:v.summary,versionId:v.id})));
    const rows=[...events,...imports].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $('change-count').textContent=events.length;$('all-change-count').textContent=(data.events||[]).length;
    $('change-log').innerHTML=rows.length?rows.filter(e=>!query||`${e.sectionId} ${e.summary} ${findSection(e.sectionId)?.name}`.toLowerCase().includes(query)).map(e=>`<article class="log-row"><time datetime="${escape(e.createdAt)}">${e.type==='import'?date(e.createdAt)+' · source date':dateTime(e.createdAt)}</time><strong>${escape(e.sectionId)} · ${escape(findSection(e.sectionId)?.name)}</strong><p>${escape(e.type==='live'?'Production confirmation recorded':e.type==='import'?'Starting record imported from the source':'New draft revision recorded')}${e.author?' · '+escape(e.author):''}</p><p>${escape(e.summary||'')}</p><button data-open="${escape(e.sectionId)}">Open section history</button></article>`).join(''):'<div class="empty">No changes recorded yet.</div>';
    $('change-log').querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openSection(b.dataset.open));
  }
  function openSection(id){
    activeSection=id;const s=findSection(id);if(!s)return;
    $('detail-code').textContent=s.id+' · '+familyNames[s.family];$('detail-title').textContent=s.name;$('detail-scope').textContent=s.scopeNote||'';
    const liveVersion=s.live&&s.versions.find(v=>v.id===s.live.versionId);
    $('live-summary').innerHTML=s.live?`<strong>Production: revision ${escape(liveVersion?.number||'?')}</strong><p>Went live ${date(s.live.liveAt)}. Recorded by ${escape(s.live.author||'a contributor')}.</p>${link(s.live.productionUrl,'Open customer production')}${s.live.note?`<p>${escape(s.live.note)}</p>`:''}${hasPending(s)?'<p class="revision-summary">A newer draft is waiting. The confirmed live version stays unchanged.</p>':''}`:'<strong>Production status has not been confirmed.</strong><p>The preview is available. Record the exact revision after Walter takes it live.</p>';
    $('revisions').innerHTML=[...s.versions].reverse().map((v,i)=>{const previous=s.versions[s.versions.indexOf(v)-1];return `<article class="revision"><div class="revision-head"><span>Revision ${v.number}${i===0?' · Latest draft':''}</span>${s.live?.versionId===v.id?'<span class="status live">Confirmed live</span>':'<span class="status">Draft reference</span>'}</div><p class="revision-meta">${v.author==='Source import'?date(v.createdAt)+' · source date':dateTime(v.createdAt)} · ${escape(v.author)}</p><p class="revision-summary">${escape(v.summary)}</p><div class="revision-content">${escape(v.content)}</div>${link(v.previewUrl,'Open this preview')}${previous?`<details><summary>Compare with revision ${previous.number}</summary><p>${escape(previous.content)}</p></details>`:''}</article>`;}).join('');
    [...s.versions].reverse().forEach((version,index)=>{if(version.repositoryRef)$('revisions').children[index]?.insertAdjacentHTML('beforeend',codeReference(version));});
    const matching=data.sections.filter(other=>other.family===s.family&&other.id!==s.id&&['g','a','m'].includes(other.variant)&&other.id.slice(-2)===s.id.slice(-2));
    if(matching.length){$('revisions').insertAdjacentHTML('afterbegin',`<div class="matching-sections"><span>Matching sections:</span>${matching.map(other=>`<button data-match="${escape(other.id)}">${escape(other.id)}</button>`).join('')}<span>Check the shared format when changing structure.</span></div>`);$('revisions').querySelectorAll('[data-match]').forEach(b=>b.onclick=()=>openSection(b.dataset.match));}
    const liveEvents=(data.events||[]).filter(event=>event.sectionId===s.id&&event.type==='live');
    if(liveEvents.length)$('revisions').insertAdjacentHTML('beforeend',`<details class="live-history"><summary>Production confirmation history (${liveEvents.length})</summary>${[...liveEvents].reverse().map(event=>`<article><time>${dateTime(event.createdAt)}</time><p>Revision ${escape(s.versions.find(v=>v.id===event.versionId)?.number||'?')} · ${escape(event.author)}</p>${event.production?`<p>Went live ${date(event.production.liveAt)}.</p>${link(event.production.productionUrl,'Recorded production page')}`:''}<p>${escape(event.summary)}</p></article>`).join('')}</details>`);
    if(!$('section-dialog').open)$('section-dialog').showModal();
  }
  function requireAccess(){if(canEdit)return true;openAccess();return false;}
  function openAccess(){
    if(signedInUser){
      editMode='access-state';$('edit-eyebrow').textContent='Company account';$('edit-title').textContent=signedInUser.name||'Signed in';$('edit-help').textContent=`${actor} · verified Zodiac.fm company account`;
      $('edit-fields').innerHTML='<p class="muted">Each revision and production confirmation records your verified company account, its date and the exact version.</p><h3>Connect Hermes</h3><p>Give your Hermes session temporary access to read sections and save drafts under your company name. It expires after one hour. Confirm live versions here in the tracker.</p><button type="button" id="connect-hermes">Create temporary connection</button><div id="hermes-connection" hidden><p id="hermes-expiry" role="status"></p><label for="hermes-token">Your temporary token</label><input id="hermes-token" type="password" readonly autocomplete="off" spellcheck="false"><button type="button" id="copy-hermes">Copy token</button><p>Keep this token in your own Hermes environment as FUNNEL_TRACKER_TOKEN. Do not paste it into a chat or commit it. The helper is at funnel/tracker/hermes.cjs in zodiac-pages.</p></div><div class="detail-actions"><button type="button" id="end-editing">Sign out</button></div>';
      $('save-edit').textContent='Done';$('form-error').textContent='';$('edit-dialog').showModal();
      $('end-editing').onclick=async()=>{try{await request({action:'logout'});$('edit-dialog').close();await refresh(true);await configureSignIn();toast('Signed out.');}catch(error){$('form-error').textContent=error.message;}};
      $('connect-hermes').onclick=async()=>{const button=$('connect-hermes');button.disabled=true;$('form-error').textContent='';try{const result=await request({action:'agent-token'});$('hermes-token').value=result.token;$('hermes-expiry').textContent='Access for '+actor+' expires '+dateTime(result.expiresAt)+'.';$('hermes-connection').hidden=false;button.textContent='Connection created';}catch(error){$('form-error').textContent=error.message;button.disabled=false;}};
      $('copy-hermes').onclick=async()=>{try{await navigator.clipboard.writeText($('hermes-token').value);toast('Temporary token copied.');}catch{$('form-error').textContent='Clipboard access is unavailable. Open this tracker directly over HTTPS and try again.';}};
      return;
    }
    $('sign-in').hidden=false;$('sign-in').scrollIntoView({block:'start'});configureSignIn();
  }
  function openRevision(){
    if(!requireAccess())return;const s=findSection(activeSection),v=latest(s);editMode='revision';$('edit-eyebrow').textContent=s.id+' · Revision '+(v.number+1);$('edit-title').textContent='Add a revision';$('edit-help').textContent='This saves a dated draft. The confirmed production revision stays unchanged. Include the full section requirements so each revision stands on its own.';
    $('edit-fields').innerHTML=field('summary','What changed?','<input id="summary" name="summary" maxlength="500" required placeholder="For example: Phone hero and offer jump updated">')+field('content','Complete section requirements',`<textarea id="content" name="content" rows="7" maxlength="24000" required>${escape(v.content)}</textarea>`)+field('preview-url','Preview URL',`<input id="preview-url" name="previewUrl" type="url" pattern="https://.*" maxlength="2000" value="${escape(v.previewUrl||'')}" placeholder="https://…" required>`,'Use a versioned preview link so older revisions stay useful.');$('save-edit').textContent='Save revision';$('form-error').textContent='';$('edit-dialog').showModal();
  }
  function appendRepositoryFields(){
    $('edit-fields').insertAdjacentHTML('beforeend',field('repository-url','GitHub commit URL (optional)','<input id="repository-url" name="repositoryUrl" type="url" maxlength="2048" placeholder="https://github.com/zodiac-fm/repository/commit/…">','Any Zodiac company repository can be referenced. Use the full commit URL. This records the reference and does not verify a deployment.')+field('repository-path','File path (optional)','<input id="repository-path" name="repositoryPath" maxlength="500" placeholder="src/pages/results.tsx">','Path within that repository.'));
  }
  function openLive(){
    if(!requireAccess())return;const s=findSection(activeSection);editMode='live';$('edit-eyebrow').textContent=s.id+' · Production record';$('edit-title').textContent='Record a live version';$('edit-help').textContent='Record only a revision confirmed in the customer funnel. This updates the tracker. It does not deploy or change the funnel.';
    $('edit-fields').innerHTML=field('version-id','Which revision is live?',`<select id="version-id" name="versionId" required>${[...s.versions].reverse().map(v=>`<option value="${escape(v.id)}">Revision ${v.number} · ${escape(v.summary)}</option>`).join('')}</select>`)+field('production-url','Customer production URL',`<input id="production-url" name="productionUrl" type="url" pattern="https://.*" maxlength="2000" required placeholder="https://app.zodiac.fm/…" value="${escape(s.live?.productionUrl||'')}">`,'A design preview URL does not establish production status.')+field('live-date','Went live on',`<input id="live-date" name="liveAt" type="date" max="${nowDate()}" value="${nowDate()}" required>`)+field('live-note','Confirmation note','<textarea id="live-note" name="note" rows="3" maxlength="2000" required placeholder="For example: Walter confirmed revision 2 is live for affiliate traffic."></textarea>')+'<label class="check-field"><input name="confirmed" type="checkbox" required><span>I checked this exact revision in customer production, or Walter confirmed it.</span></label>';
    $('save-edit').textContent='Record live version';$('form-error').textContent='';$('edit-dialog').showModal();
  }
  $('edit-form').onsubmit=async e=>{
    e.preventDefault();if(saving)return;if(editMode==='access-state'){$('edit-dialog').close();return;}const form=new FormData(e.currentTarget),mode=editMode;let body;
    if(mode==='revision'){
      body={action:'revision',sectionId:activeSection,expectedRevision:revision,payload:{summary:String(form.get('summary')).trim(),content:String(form.get('content')).trim(),previewUrl:String(form.get('previewUrl')).trim()}};
      const commitUrl=String(form.get('repositoryUrl')||'').trim(),repositoryPath=String(form.get('repositoryPath')||'').trim();
      if(commitUrl){const match=/^https:\/\/github\.com\/(zodiac-fm\/[A-Za-z0-9_.-]+)\/commit\/([a-fA-F0-9]{40})\/?$/.exec(commitUrl);if(!match){$('form-error').textContent='Use a full GitHub commit URL from a zodiac-fm repository, including its 40 character commit identifier.';return;}body.payload.repositoryRef={repository:match[1],commit:match[2].toLowerCase(),...(repositoryPath?{path:repositoryPath}:{})};}
      else if(repositoryPath){$('form-error').textContent='Add the GitHub commit URL for this file reference.';return;}
    }
    else body={action:'live',sectionId:activeSection,expectedRevision:revision,payload:{versionId:String(form.get('versionId')),productionUrl:String(form.get('productionUrl')).trim(),liveAt:String(form.get('liveAt')),note:String(form.get('note')).trim(),confirmed:form.get('confirmed')==='on'}};
    saving=true;$('save-edit').disabled=true;$('form-error').textContent='';
    try{await request(body);await refresh(true);$('edit-dialog').close();if(activeSection&&$('section-dialog').open)openSection(activeSection);toast(mode==='live'?'Production confirmation saved for everyone.':'Dated revision saved for everyone.');}
    catch(error){$('form-error').textContent=error.message;if(error.status===409){await refresh(true);$('form-error').textContent=error.message+' Your text is still here.';}}
    finally{saving=false;$('save-edit').disabled=false;}
  };
  function setRoute(){const url=new URL(location.href);url.searchParams.set('page',family);url.searchParams.set('variant',variant);if(!url.searchParams.has('mode'))url.searchParams.set('mode','review');if(view==='changes')url.searchParams.set('view','changes');else url.searchParams.delete('view');if(allChanges)url.searchParams.set('all','1');else url.searchParams.delete('all');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  const params=new URLSearchParams(location.search);if(Object.hasOwn(familyNames,params.get('page')))family=params.get('page');variant=variantsFor(family).includes(params.get('variant'))?params.get('variant'):variantsFor(family)[0];if(params.get('view')==='changes')view='changes';allChanges=params.get('all')==='1'&&view==='changes';
  document.querySelectorAll('[data-family]').forEach(b=>b.onclick=()=>{family=b.dataset.family;variant=variantsFor(family)[0];allChanges=false;view='sections';$('search').value='';setRoute();render();});
  document.addEventListener('tracker:select-variant',e=>{if(variantsFor(family).includes(e.detail.variant)){variant=e.detail.variant;setRoute();render();}});
  $('all-changes').onclick=()=>{document.dispatchEvent(new Event('tracker:show-sections'));document.dispatchEvent(new Event('tracker:show-changes'));allChanges=true;view='changes';$('search').value='';setRoute();render();};
  document.addEventListener('tracker:refresh-request',()=>refresh(true));
  $('edit-dialog').addEventListener('close',()=>{const input=$('hermes-token');if(input)input.value='';});
  $('section-view').onclick=()=>{view='sections';allChanges=false;setRoute();render();};$('change-view').onclick=()=>{view='changes';allChanges=false;setRoute();render();};$('search').oninput=render;$('filter').onchange=render;$('refresh').onclick=()=>refresh();$('access').onclick=openAccess;$('add-revision').onclick=()=>{openRevision();if(editMode==='revision')appendRepositoryFields();};$('confirm-live').onclick=openLive;$('close-detail').onclick=()=>$('section-dialog').close();$('close-edit').onclick=()=>$('edit-dialog').close();$('cancel-edit').onclick=()=>$('edit-dialog').close();
  for(const id of ['section-dialog','edit-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id)){const r=$(id).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$(id).close();}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&signedInUser)refresh(true);});setInterval(()=>{if(!document.hidden&&signedInUser&&!saving&&!$('edit-dialog').open)refresh(true);},60000);
  let googleScriptPromise;
  async function configureSignIn(){
    try{
      const config=await request(null,'/api/funnel-tracker?action=config');
      if(!config.authConfigured||!config.googleClientId){$('google-sign-in').textContent='';$('access').textContent='Setup pending';$('access').disabled=true;$('sign-in-status').textContent='Company sign-in is being set up. Your section records remain private.';return;}
      $('access').disabled=false;if(!signedInUser)$('access').textContent='Company sign-in';
      if(!googleScriptPromise)googleScriptPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.onload=resolve;script.onerror=()=>reject(new Error('Google sign-in could not load. Refresh to try again.'));document.head.appendChild(script);});
      await googleScriptPromise;
      google.accounts.id.initialize({client_id:config.googleClientId,hd:'zodiac.fm',auto_select:false,...(config.nonce?{nonce:config.nonce}:{}),callback:async result=>{try{$('sign-in-status').textContent='Verifying your company account…';const session=await request({action:'session',credential:result.credential});signedInUser=session.user||null;await refresh();}catch(error){$('sign-in-status').textContent=error.message;}}});
      $('google-sign-in').textContent='';google.accounts.id.renderButton($('google-sign-in'),{theme:'outline',size:'large',text:'signin_with',shape:'rectangular'});
      $('sign-in-status').textContent=config.storageConfigured?'Use your @zodiac.fm company account.':'Company sign-in is available. Private records are awaiting storage setup.';
    }catch(error){$('sign-in-status').textContent=error.message;}
  }
  async function start(){await configureSignIn();await refresh(true);}
  start();
})();
