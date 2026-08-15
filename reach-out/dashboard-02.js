const DATA_URL = 'data/reach-out-v1.json';
const STORAGE_KEY = 'zodiac.reachout.operations.v1';
const COLORS = ['#6521C9','#B90044','#C25500','#0A7A52'];
const STATUSES = ['Researching','Qualified','Drafting','Ready for review','Approved','On hold','Closed'];
const APPROVALS = ['Not drafted','Draft','Ready for review','Approved','Held'];
const state = {base:null,operations:null,channel:'',query:'',relationship:'',priority:'',status:'',owner:'',selectedId:null};
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const firstUrl = value => (String(value || '').match(/https?:\/\/[^\s|)>,]+/) || [])[0]?.replace(/[.,;]$/,'') || '';
const firstEmail = value => (String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || '';
const optionList = (values,current) => values.map(value => `<option${value===current?' selected':''}>${esc(value)}</option>`).join('');
const excerpt = (value,limit=130) => {const text=String(value||'');if(text.length<=limit)return text;return `${text.slice(0,limit+1).replace(/\s+\S*$/,'').trim().replace(/[.,;:!?"'”’]+$/,'')}…`};
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

function loadOperations(){
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(parsed?.schema_version==='1.0'&&parsed.records) return parsed;
  }catch{}
  return {schema_version:'1.0',updated_at:now(),records:{}};
}

function persist(message='Saved here'){
  $('saveState').classList.add('saving');$('saveState').lastChild.textContent=' Saving';
  state.operations.updated_at=now();localStorage.setItem(STORAGE_KEY,JSON.stringify(state.operations));
  setTimeout(()=>{$('saveState').classList.remove('saving');$('saveState').lastChild.textContent=' Saved';},180);
  toast(message);
}

function toast(message){const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),1800)}
function operation(id){return state.operations.records[id]||{};}
function merged(base){
  const op=operation(base.contact_id);
  return {...base,...op,draft:op.draft||{subject:'',body:'',approval:'Not drafted',updated_at:''},notes:op.notes||[],activity:op.activity||[]};
}
function recordById(id){const base=state.base.records.find(record=>record.contact_id===id);return base?merged(base):null;}
function effectiveRecords(){return state.base.records.map(merged);}
function formatDate(value){if(!value)return 'Not yet';const d=new Date(value);return Number.isNaN(d.valueOf())?value:d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});}
function chipClass(record){return record.relationship_level==='Direct / warm'?'direct':'';}

function channelButton(channel,index){
  const button=document.createElement('button');
  button.className='channel-button'+(state.channel===channel.channel_id?' active':'');button.dataset.channel=channel.channel_id;
  button.innerHTML=`<span class="channel-dot" style="--channel:${COLORS[index%COLORS.length]}"></span><span class="channel-name">${esc(channel.channel)}</span><span class="channel-count">${channel.count}</span>`;
  button.addEventListener('click',()=>{state.channel=state.channel===channel.channel_id?'':channel.channel_id;render();window.scrollTo({top:0,behavior:'smooth'})});return button;
}

function populateFilters(){
  const unique=key=>[...new Set(effectiveRecords().map(r=>r[key]).filter(Boolean))].sort();
  unique('relationship_level').forEach(value=>$('relationshipFilter').insertAdjacentHTML('beforeend',`<option>${esc(value)}</option>`));
  STATUSES.forEach(value=>$('statusFilter').insertAdjacentHTML('beforeend',`<option>${esc(value)}</option>`));
  unique('owner').forEach(value=>$('ownerFilter').insertAdjacentHTML('beforeend',`<option>${esc(value)}</option>`));
}

function filtered(){
  const q=state.query.trim().toLowerCase();
  return effectiveRecords().filter(record=>{
    if(state.channel&&record.channel_id!==state.channel)return false;if(state.relationship&&record.relationship_level!==state.relationship)return false;
    if(state.priority&&record.priority!==state.priority)return false;if(state.status&&record.status!==state.status)return false;if(state.owner&&record.owner!==state.owner)return false;
    if(!q)return true;return ['name','channel','relationship','partner_signal','best_angle','public_contact','section','next_action','owner'].some(key=>String(record[key]||'').toLowerCase().includes(q));
  });
}

function renderStats(){
  const records=effectiveRecords();
  $('statRecords').textContent=records.length;
  $('statActive').textContent=records.filter(r=>['Qualified','Drafting','Ready for review','Approved'].includes(r.status)).length;
  $('statDrafts').textContent=records.filter(r=>r.draft?.body?.trim()).length;
  $('statReview').textContent=records.filter(r=>r.draft?.approval==='Ready for review').length;
  $('statDnc').textContent=records.filter(r=>r.do_not_contact).length;
}

function render(){
  $('channelList').replaceChildren(...state.base.channels.map(channelButton));renderStats();
  const rows=filtered();const currentChannel=state.base.channels.find(c=>c.channel_id===state.channel);
  $('resultTitle').textContent=currentChannel?currentChannel.channel:state.query?'Search results':'All channels';
  $('resultEyebrow').textContent=currentChannel?currentChannel.channel_type||'Channel view':'Full relationship base';
  $('resultCount').textContent=`${rows.length} ${rows.length===1?'record':'records'}`;$('clearSearch').classList.toggle('visible',Boolean(state.query));
  if(!rows.length){$('records').innerHTML='<div class="empty">No records match these filters.</div>';return;}
  $('records').innerHTML=rows.map(record=>`
    <button class="record" data-id="${esc(record.contact_id)}" aria-label="Open ${esc(record.name)} workspace">
      <div><h3 class="record-name">${esc(record.name)}</h3><div class="record-meta"><span class="chip ${record.priority.toLowerCase()}">${esc(record.priority)}</span><span class="chip ${chipClass(record)}">${esc(record.relationship_level)}</span>${record.do_not_contact?'<span class="chip dnc">Do not contact</span>':''}</div></div>
      <div><div class="record-label">${esc(record.channel)}</div><div class="record-status"><span class="status-dot"></span>${esc(record.status)}</div></div>
      <div><div class="record-label">Next action</div><div class="record-copy">${esc(excerpt(record.next_action||record.best_angle||'Qualify the relationship before drafting.'))}</div></div>
      <div class="record-arrow" aria-hidden="true">›</div>
    </button>`).join('');
  $('records').querySelectorAll('.record').forEach(button=>button.addEventListener('click',()=>openDrawer(button.dataset.id)));
}

function route(label,value,kind='url'){
  const url=kind==='email'?(firstEmail(value)?`mailto:${firstEmail(value)}`:firstUrl(value)):firstUrl(value);
  if(!value)return `<div class="route-note"><strong>${esc(label)}</strong><span>Not listed</span></div>`;
  if(!url)return `<div class="route-note"><strong>${esc(label)}</strong><span>${esc(value)}</span></div>`;
  return `<a class="route" href="${esc(url)}" target="_blank" rel="noopener"><span>${esc(label)}</span><span>↗</span></a>`;
}

function source(record){
  const value=record.evidence||record.source_urls.join(' | ');const url=firstUrl(value);let domain='';
  if(url){try{domain=new URL(url).hostname.replace(/^www\./,'')}catch{}}
  return `${url?`<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener"><span>Open source · ${esc(domain)}</span><span>↗</span></a>`:`<p class="dossier-text">${esc(value||`Source record: ${record.source_file}`)}</p>`}`;
}

function layer(id,title,hint,content,open=false){return `<section class="layer${open?' open':''}" data-layer="${id}"><button class="layer-toggle" type="button" aria-expanded="${open}"><span class="layer-plus">${open?'−':'+'}</span><span class="layer-title">${esc(title)}</span><span class="layer-hint">${esc(hint)}</span></button><div class="layer-panel">${content}</div></section>`;}
function eventList(record){
  const events=[...(record.activity||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  if(!events.length)return '<div class="blank-state">No working history yet. The verified source record remains unchanged underneath.</div>';
  return `<div class="history">${events.map(event=>`<div class="event"><time>${esc(formatDate(event.created_at))}</time><div><strong>${esc(event.type)}</strong><p>${esc(event.summary)}</p></div></div>`).join('')}</div>`;
}

function drawerMarkup(record){
  const relationship=`<p class="dossier-text">${esc(record.relationship||'No relationship statement has been captured yet.')}</p><div class="subsection"><div class="sub-label">Evidence</div>${source(record)}</div><div class="subsection"><div class="sub-label">Caution and boundary</div><p class="dossier-text">${esc(record.caution||'Use only the documented relationship. Do not imply an introduction, endorsement, or result that is not recorded.')}</p></div>`;
  const routes=`<div class="route-grid">${route('Website',record.website)}${route('LinkedIn',record.linkedin)}${route('Instagram',record.instagram)}${route('Contact',record.public_contact,'email')}</div>`;
  const opportunity=`<div class="sub-label">Partner and affiliate signal</div><p class="dossier-text">${esc(record.partner_signal||'No public partner signal has been captured yet.')}</p><div class="subsection"><div class="sub-label">Best opening</div><p class="dossier-text">${esc(record.best_angle||'Qualify the relationship and current activity before drafting.')}</p></div>`;
  const workflow=`<form id="workflowForm"><div class="form-grid"><div class="field"><label for="workflowStatus">Status</label><select id="workflowStatus">${optionList(STATUSES,record.status)}</select></div><div class="field"><label for="workflowPriority">Priority</label><select id="workflowPriority">${optionList(['P1','P2','P3'],record.priority)}</select></div><div class="field"><label for="workflowOwner">Owner</label><input id="workflowOwner" value="${esc(record.owner||'')}" placeholder="Assign an owner"></div><div class="field"><label for="workflowLast">Last contacted</label><input id="workflowLast" type="date" value="${esc(record.last_contacted||'')}"></div><div class="field full"><label for="workflowNext">Next action</label><textarea id="workflowNext" placeholder="What should happen next?">${esc(record.next_action||record.best_angle||'')}</textarea></div><div class="field full"><label class="check-row"><input id="workflowDnc" type="checkbox"${record.do_not_contact?' checked':''}><span><strong>Do not contact</strong><br>Hold all drafting and outreach until this is explicitly cleared.</span></label></div></div><div class="actions"><button class="button" type="submit">Save workflow</button><span class="save-note">Adds an audit entry</span></div></form>`;
  const notes=`<form id="noteForm"><div class="field"><label for="noteText">Add an internal note</label><textarea id="noteText" placeholder="Context, research, decision, or follow-up detail"></textarea></div><div class="actions"><button class="button" type="submit">Add note</button></div></form>${eventList(record)}`;
  const draft=record.do_not_contact
    ? '<div class="no-send">Drafting is held because this record is marked Do not contact. Clear that workflow hold first, then return here to draft.</div>'
    : `<form id="draftForm"><div class="form-grid"><div class="field full"><label for="draftSubject">Subject or opener</label><input id="draftSubject" value="${esc(record.draft.subject||'')}" placeholder="Internal draft title or email subject"></div><div class="field full"><label for="draftBody">Draft</label><textarea id="draftBody" style="min-height:170px" placeholder="Draft the relationship-specific outreach here. Nothing sends from this page.">${esc(record.draft.body||'')}</textarea></div><div class="field full"><label for="draftApproval">Approval state</label><select id="draftApproval">${optionList(APPROVALS,record.draft.approval||'Not drafted')}</select></div></div><div class="actions"><button class="button" type="submit">Save draft</button></div><div class="no-send">No send action is connected. Even an approved draft stays here until a separate, explicit send approval workflow exists.</div></form>`;
  return `<div class="eyebrow">${esc(record.channel)} · ${esc(record.section||record.channel_type)}</div><h2 class="contact-title" id="drawerTitle">${esc(record.name)}</h2><div class="drawer-chips"><span class="chip ${record.priority.toLowerCase()}">${esc(record.priority)}</span><span class="chip ${chipClass(record)}">${esc(record.relationship_level)}</span><span class="chip">${esc(record.status)}</span>${record.do_not_contact?'<span class="chip dnc">Do not contact</span>':''}</div><div class="working-summary"><div><span>Owner</span><strong>${esc(record.owner||'Unassigned')}</strong></div><div><span>Last touch</span><strong>${esc(formatDate(record.last_contacted))}</strong></div><div><span>Approval</span><strong>${esc(record.draft.approval||'Not drafted')}</strong></div></div>${layer('relationship','Relationship','Evidence + boundary',relationship,true)}${layer('routes','Public routes','Website · LinkedIn · Instagram',routes)}${layer('opportunity','Opportunity','Partner signal + opening',opportunity)}${layer('workflow','Workflow','Status · owner · next action',workflow)}${layer('notes','Notes & history',`${record.activity.length} entries`,notes)}${layer('draft','Draft & approval',record.draft.approval||'Not drafted',draft)}`;
}

function bindDrawer(record){
  document.querySelectorAll('.layer-toggle').forEach(button=>button.addEventListener('click',()=>{const parent=button.closest('.layer');const open=parent.classList.toggle('open');button.setAttribute('aria-expanded',String(open));button.querySelector('.layer-plus').textContent=open?'−':'+';}));
  $('workflowForm').addEventListener('submit',event=>{event.preventDefault();saveWorkflow(record.contact_id)});
  $('noteForm').addEventListener('submit',event=>{event.preventDefault();saveNote(record.contact_id)});
  if($('draftForm'))$('draftForm').addEventListener('submit',event=>{event.preventDefault();saveDraft(record.contact_id)});
}

function upsert(id,patch,event){
  const current=operation(id);const activity=[...(current.activity||[])];if(event)activity.push({id:uid('event'),created_at:now(),...event});
  state.operations.records[id]={...current,...patch,activity,updated_at:now()};persist();render();openDrawer(id,false);
}
function saveWorkflow(id){
  const patch={status:$('workflowStatus').value,priority:$('workflowPriority').value,owner:$('workflowOwner').value.trim(),last_contacted:$('workflowLast').value,next_action:$('workflowNext').value.trim(),do_not_contact:$('workflowDnc').checked};
  const summary=`Status: ${patch.status}. Owner: ${patch.owner||'Unassigned'}. Next: ${patch.next_action||'Not set'}.`;
  upsert(id,patch,{type:'Workflow updated',summary});toast('Workflow saved');
}
function saveNote(id){
  const text=$('noteText').value.trim();if(!text){toast('Write a note first');return;}const current=operation(id);const notes=[...(current.notes||[]),{id:uid('note'),text,created_at:now()}];
  upsert(id,{notes},{type:'Internal note',summary:text});toast('Note added');
}
function saveDraft(id){
  const draft={subject:$('draftSubject').value.trim(),body:$('draftBody').value.trim(),approval:$('draftApproval').value,updated_at:now()};
  upsert(id,{draft},{type:'Draft saved',summary:`Approval state: ${draft.approval}. Nothing sent.`});toast('Draft saved, nothing sent');
}

function openDrawer(id,pushHash=true){
  const record=recordById(id);if(!record)return;state.selectedId=id;$('drawerContext').textContent=`${record.status} · ${record.owner||'Unassigned'}`;$('drawerBody').innerHTML=drawerMarkup(record);bindDrawer(record);
  $('drawer').classList.add('open');$('backdrop').classList.add('open');$('drawer').setAttribute('aria-hidden','false');document.body.classList.add('drawer-open');
  if(pushHash)history.replaceState(null,'',`#${encodeURIComponent(id)}`);setTimeout(()=>$('drawerClose').focus(),40);
}
function closeDrawer(clearHash=true){$('drawer').classList.remove('open');$('backdrop').classList.remove('open');$('drawer').setAttribute('aria-hidden','true');document.body.classList.remove('drawer-open');state.selectedId=null;if(clearHash)history.replaceState(null,'',location.pathname+location.search)}

async function init(){
  const response=await fetch(DATA_URL);if(!response.ok)throw new Error('Could not load the relationship base.');state.base=await response.json();state.operations=loadOperations();populateFilters();render();
  const hash=decodeURIComponent(location.hash.slice(1));if(hash)openDrawer(hash,false);
}

$('search').addEventListener('input',event=>{state.query=event.target.value;render()});$('clearSearch').addEventListener('click',()=>{state.query='';$('search').value='';$('search').focus();render()});
$('relationshipFilter').addEventListener('change',event=>{state.relationship=event.target.value;render()});$('priorityFilter').addEventListener('change',event=>{state.priority=event.target.value;render()});$('statusFilter').addEventListener('change',event=>{state.status=event.target.value;render()});$('ownerFilter').addEventListener('change',event=>{state.owner=event.target.value;render()});
$('drawerClose').addEventListener('click',()=>closeDrawer());$('backdrop').addEventListener('click',()=>closeDrawer());document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.selectedId)closeDrawer()});window.addEventListener('hashchange',()=>{const hash=decodeURIComponent(location.hash.slice(1));if(hash)openDrawer(hash,false);else closeDrawer(false)});
init().catch(error=>{$('records').innerHTML=`<div class="empty">${esc(error.message)}</div>`});
