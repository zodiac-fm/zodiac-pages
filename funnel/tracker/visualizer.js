// Funnel visualizer tab: draws each funnel and shows a step when it is clicked. Viewing only, with no numbers and no editing.
// The funnels themselves load from the private tracker store after company sign-in. None of their wording lives in this file.
(()=>{
  const $=id=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const txt=s=>esc(s).replace(/\[\[(.+?)\]\]/g,'<span class="slot">$1</span>');
  const root=$('visualizer-workspace'),toggle=document.querySelector('.main-toggle');
  let signedIn=false,funnels=null,loading=false,F=null,byId={},selected=null,pages=null,pagesLoading=null,shotView='mobile';

  const params=()=>new URL(location.href).searchParams;
  const isVisualizer=()=>params().get('tab')==='visualizer';

  function push(changes,replace){
    const url=new URL(location.href);
    for(const [key,value] of Object.entries(changes)){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}
    history[replace?'replaceState':'pushState'](null,'',url);
    route();
  }

  function showShell(on){
    document.body.classList.toggle('visualizer',on);
    root.hidden=!on;
    toggle.querySelectorAll('[data-main]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.main==='visualizer')===on)));
    if(!on){document.body.classList.remove('vz-open');const side=$('vz-side');if(side)side.hidden=true;}
  }

  async function load(){
    if(funnels||loading)return;
    loading=true;
    root.innerHTML='<p class="vz-state" role="status">Loading funnels…</p>';
    try{
      const response=await fetch('/api/funnel-review?action=visualizer',{credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw new Error(String(response.status));
      funnels=(await response.json()).funnels||[];
    }catch{
      root.innerHTML='<p class="vz-state" role="alert">The funnels could not load.<button type="button" id="vz-retry">Try again</button></p>';
      loading=false;
      $('vz-retry').onclick=load;
      return;
    }
    loading=false;
    route();
  }

  const pos=s=>'left:'+s.x+'px;top:'+s.y+'px;width:'+s.w+'px;height:'+s.h+'px';
  function nodeHtml(s,placed){
    const label='<span class="t">'+txt(s.title)+'</span><span class="s">'+txt(s.sub||'')+'</span>';
    const style=placed?' style="'+pos(s)+'"':'';
    if(s.kind==='answer')return '<div class="vz-node answer" data-node="'+esc(s.id)+'"'+style+'>'+label+'</div>';
    return '<button type="button" class="vz-node '+esc(s.kind)+'" data-step="'+esc(s.id)+'" data-node="'+esc(s.id)+'"'+style+'>'+label+'</button>';
  }

  // Lines are drawn from where each step sits, so a moved step would redraw on its own.
  function edgePath(a,b,o={}){
    if(o.side){const y=a.y+a.h/2;return 'M'+(a.x+a.w)+' '+y+' L'+(b.x-6)+' '+(b.y+b.h/2);}
    const x1=a.x+a.w/2+(o.fx||0)*a.w/2,y1=a.y+a.h,x2=b.x+b.w/2+(o.tx||0)*b.w/2,y2=b.y-6;
    if(o.bus)return 'M'+x1+' '+y1+' L'+x1+' '+(o.bus-10)+' C'+x1+' '+(o.bus+22)+' '+x2+' '+(y2-30)+' '+x2+' '+y2;
    const m=(y2-y1)*.5;
    return 'M'+x1+' '+y1+' C'+x1+' '+(y1+m)+' '+x2+' '+(y2-m)+' '+x2+' '+y2;
  }

  function draw(){
    const marker=(id,color)=>'<marker id="'+id+'" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="'+color+'" stroke-width="1.4"/></marker>';
    const edges=F.edges.map((e,i)=>'<path class="vz-edge" data-i="'+i+'" marker-end="url(#vz-arr)" d="'+edgePath(byId[e[0]],byId[e[1]],e[2])+'"/>').join('');
    // Funnels sharing a channel get one tab in the top row, and a second row to choose between them.
    const group=f=>f.channel||f.id;
    const tops=funnels.filter((f,i)=>funnels.findIndex(x=>group(x)===group(f))===i);
    const peers=funnels.filter(f=>group(f)===group(F));
    const tab=(f,label,on)=>'<button type="button" data-funnel="'+esc(f.id)+'"'+(on?' class="selected" aria-current="page"':'')+'>'+esc(label)+'</button>';
    root.innerHTML=
      '<nav class="family-tabs vz-funnels" aria-label="Funnels">'+tops.map(f=>tab(f,f.channelName||f.name,group(f)===group(F))).join('')+'</nav>'+
      (peers.length>1?'<nav class="production-variants vz-variants" aria-label="'+esc(F.channelName||F.name)+' funnels">'+peers.map(f=>tab(f,f.name,f===F)).join('')+'</nav>':'')+
      '<div class="vz-intro"><h2>'+esc(F.channelName?F.channelName+' · '+F.name:F.name)+'</h2><p>'+esc(F.sub||'')+'</p></div>'+
      '<div class="vz-layout"><div class="vz-mapwrap" id="vz-mapwrap">'+
        '<div class="vz-fit" id="vz-fit"><div class="vz-canvas" id="vz-canvas" style="width:'+F.width+'px;height:'+F.height+'px">'+
          '<svg width="'+F.width+'" height="'+F.height+'" aria-hidden="true"><defs>'+marker('vz-arr','#a9a9a2')+marker('vz-arron','#222220')+'</defs>'+edges+'</svg>'+
          F.steps.map(s=>nodeHtml(s,true)).join('')+
          (F.labels||[]).map(l=>'<div class="vz-label" style="left:'+l.x+'px;top:'+l.y+'px;width:'+l.w+'px">'+esc(l.text)+'</div>').join('')+
        '</div></div>'+
        '<div class="vz-stack">'+(F.stack||[F.steps.map(s=>s.id)]).map(g=>'<div class="vz-group">'+g.map(id=>nodeHtml(byId[id],false)).join('')+'</div>').join('')+'</div>'+
      '</div></div>'+
      '<aside class="vz-side" id="vz-side" aria-label="Step" hidden></aside>'+
      '<div class="vz-rules">'+(F.rules&&F.rules.length?'<h3>Rules on every path</h3><ul>'+F.rules.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul>':'')+(F.source?'<p class="vz-source">'+esc(F.source)+'</p>':'')+'</div>';
    fit();
  }

  // The step panel starts below the page header, so the toggle and account button stay reachable while it is open.
  function placeSide(){
    const side=$('vz-side');if(!side)return;
    side.style.top=innerWidth>820?Math.max(0,document.querySelector('header').getBoundingClientRect().bottom)+'px':'';
  }

  // Shrinks the whole map to fit the width available, and never grows it past full size.
  function fit(){
    placeSide();
    const wrap=$('vz-mapwrap');if(!wrap||!F)return;
    const cs=getComputedStyle(wrap),avail=wrap.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
    if(avail<=0)return;
    const s=Math.min(1,avail/F.width);
    $('vz-canvas').style.transform='scale('+s+')';
    $('vz-fit').style.width=(F.width*s)+'px';$('vz-fit').style.height=(F.height*s)+'px';
  }

  // A button with no single next step, like Continue to cancel, depends on the answer, so it doesn't jump anywhere.
  const btn=b=>b.to?'<button type="button" class="vz-b '+esc(b.style)+(b.full?' full':'')+'" data-go="'+esc(b.to)+'">'+esc(b.label)+'</button>':'<span class="vz-b '+esc(b.style)+'">'+esc(b.label)+'</span>';
  function block(b){
    switch(b.t){
      case 'title':return '<div class="h">'+(b.x?'<i style="color:#dc2626">✕</i>':b.plain?'':'<i style="color:#ea580c">⚠</i>')+'<span>'+txt(b.text)+'</span></div>';
      case 'p':return '<p>'+txt(b.text)+'</p>';
      case 'strong':return '<p style="font-weight:500">'+txt(b.text)+'</p>';
      case 'label':return '<div class="l">'+txt(b.text)+'</div>';
      case 'small':return '<p class="sm">'+txt(b.text)+'</p>';
      case 'area':return '<div class="area">'+txt(b.text)+'</div>';
      case 'radios':return b.items.map(r=>r.to?'<button type="button" class="r" data-go="'+esc(r.to)+'">'+txt(r.text)+'</button>':'<div class="r">'+txt(r.text)+'</div>').join('');
      case 'facts':return '<div class="facts">'+(b.head?'<div class="fh">'+txt(b.head)+'</div>':'')+b.lines.map(l=>'<div>'+txt(l)+'</div>').join('')+'</div>';
      case 'offer':return '<div class="box">'+b.blocks.map(block).join('')+'</div>';
      case 'btn':return btn(b);
      case 'row':return '<div class="btnrow">'+b.btns.map(btn).join('')+'</div>';
    }
    return '';
  }
  function panel(s){
    let h='<div class="vz-sidehead"><h2 id="vz-sideh" tabindex="-1">'+txt(s.title)+'</h2><button type="button" class="vz-x" id="vz-close" aria-label="Close this step">✕</button></div>';
    if(s.who)h+='<p class="vz-who">'+txt(s.who)+'</p>';
    if(s.screen){
      h+='<div class="vz-shot">'+s.screen.map(block).join('')+'</div>';
      if(JSON.stringify(s.screen).includes('[['))h+='<p class="vz-note">Underlined words fill in from the member\'s own plan.</p>';
    }
    if(s.toast)h+='<h3>The message they see</h3><div class="vz-toast"><b>'+txt(s.toast.title)+'</b>'+txt(s.toast.text)+'</div>';
    if(s.choices)h+='<h3>Where each choice goes</h3><ul>'+s.choices.map(c=>'<li><button type="button" class="vz-jump" data-go="'+esc(c.to)+'">'+txt(c.text)+'</button></li>').join('')+'</ul>';
    if(s.variants)h+='<h3>How the wording changes by plan</h3><ul class="vz-plain">'+s.variants.map(v=>'<li>'+txt(v)+'</li>').join('')+'</ul>';
    if(s.notes)h+='<h3>What happens</h3><ul class="vz-plain">'+s.notes.map(v=>'<li>'+txt(v)+'</li>').join('')+'</ul>';
    if(s.page){
      const links=(s.page.links||[]).filter(l=>safeUrl(l.url));
      if(links.length)h+='<div class="vz-links">'+links.map(l=>'<a href="'+esc(safeUrl(l.url))+'" target="_blank" rel="noopener">'+esc(l.label)+' ↗</a>').join('')+'</div>';
      if(s.page.linkNote)h+='<p class="vz-note">'+esc(s.page.linkNote)+'</p>';
      h+='<h3>The saved page</h3><div id="vz-saved"></div>';
    }
    return h;
  }

  const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}};
  const day=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'America/Denver'}).format(new Date(value));

  // The same private records and saved screenshots the Page history tab reads, fetched once per sign-in.
  function loadPages(){
    if(pages)return Promise.resolve(pages);
    if(!pagesLoading)pagesLoading=fetch('/api/funnel-production',{credentials:'same-origin',cache:'no-store'}).then(async response=>{
      if(!response.ok)throw new Error(String(response.status));
      const records=await response.json();
      pages=new Map((records.targets||[]).map(t=>[t.id,t]));
      return pages;
    }).finally(()=>{pagesLoading=null;});
    return pagesLoading;
  }
  function savedPage(s){
    const box=$('vz-saved');if(!box)return;
    box.innerHTML='<p class="vz-note" role="status">Loading the saved page…</p>';
    loadPages().then(map=>{if(box.isConnected&&selected===s.id)drawSaved(box,s,map);}).catch(()=>{
      if(box.isConnected)box.innerHTML='<p class="vz-note" role="alert">Page history could not load. <button type="button" class="vz-retry" id="vz-retry-page">Try again</button></p>';
    });
  }
  function drawSaved(box,s,map){
    const note=s.page.note?'<p class="vz-caption">'+esc(s.page.note)+'</p>':'';
    const views=[['mobile','Phone'],['desktop','Computer']].filter(([v])=>map.get(s.page[v])?.currentArchiveId);
    if(!views.length){box.innerHTML='<p class="vz-note">Page history has no saved screenshot of this step yet.</p>';return;}
    const view=views.some(([v])=>v===shotView)?shotView:views[0][0];
    const target=map.get(s.page[view]),archive=target.archives?.find(a=>a.id===target.currentArchiveId);
    if(!archive){box.innerHTML='<p class="vz-note">Page history has no saved screenshot of this step yet.</p>';return;}
    const source='/api/funnel-production?'+new URLSearchParams({targetId:target.id,archiveId:archive.id});
    const checked=target.status==='current'&&target.lastCheckedAt?' No change found at the last check, '+day(target.lastCheckedAt)+'.':target.status==='error'?' The last check failed.':'';
    box.innerHTML=
      (views.length>1?'<div class="vz-views" role="group" aria-label="Page size">'+views.map(([v,label])=>'<button type="button" data-shot="'+v+'" aria-pressed="'+(v===view)+'">'+label+'</button>').join('')+'</div>':'')+
      note+
      '<p class="vz-note">Saved '+day(archive.createdAt)+'.'+checked+' <a href="'+esc(source)+'" target="_blank" rel="noopener">Open full size ↗</a></p>'+
      '<img class="vz-pic" alt="'+esc(s.title+', saved '+day(archive.createdAt))+'">';
    const image=box.querySelector('img');
    image.onerror=()=>{image.replaceWith(Object.assign(document.createElement('p'),{className:'vz-note',textContent:'The picture could not load. Open it full size to try again.'}));};
    if(window.FunnelArchiveImages)window.FunnelArchiveImages.attach(image,source);
    else image.src=source;
  }
  // An answer isn't a screen, so going to one lands on the screen it leads to.
  function resolve(id){const s=byId[id];if(s&&s.kind==='answer'){const e=F.edges.find(x=>x[0]===id);return e?resolve(e[1]):null;}return s?id:null;}

  function select(id,focus){
    selected=id;
    const near=new Set(id?[id]:[]);
    root.querySelectorAll('.vz-edge').forEach(p=>{
      const e=F.edges[+p.dataset.i],hit=id&&(e[0]===id||e[1]===id);
      if(hit){near.add(e[0]);near.add(e[1]);}
      p.classList.toggle('on',!!hit);p.setAttribute('marker-end',hit?'url(#vz-arron)':'url(#vz-arr)');
    });
    $('vz-canvas').classList.toggle('dim',!!id);
    root.querySelectorAll('[data-node]').forEach(n=>{n.classList.toggle('sel',n.dataset.node===id);n.classList.toggle('near',near.has(n.dataset.node));});
    document.body.classList.toggle('vz-open',!!id);
    const side=$('vz-side');
    if(id){side.hidden=false;side.innerHTML=panel(byId[id]);side.scrollTop=0;if(byId[id].page)savedPage(byId[id]);if(focus)$('vz-sideh').focus({preventScroll:true});}
    else side.hidden=true;
    fit();
  }

  function route(){
    if(!signedIn)return;
    const on=isVisualizer();
    showShell(on);
    if(!on)return;
    if(!funnels){load();return;}
    if(!funnels.length){root.innerHTML='<p class="vz-state">No funnels have been added yet.</p>';return;}
    const p=params(),next=funnels.find(f=>f.id===p.get('funnel'))||funnels[0];
    if(next!==F||!$('vz-canvas')){F=next;byId={};F.steps.forEach(s=>{byId[s.id]=s;});draw();}
    const step=p.get('step');
    select(step&&byId[step]?resolve(step):null,!!step);
  }

  toggle.addEventListener('click',e=>{
    const b=e.target.closest('[data-main]');if(!b)return;
    if(b.dataset.main==='visualizer')push({tab:'visualizer'});
    else push({tab:null,funnel:null,step:null});
  });
  root.addEventListener('click',e=>{
    const t=e.target.closest('[data-step],[data-go],[data-funnel],[data-shot],#vz-retry-page,#vz-close');if(!t)return;
    if(t.id==='vz-close')return push({step:null});
    if(t.id==='vz-retry-page')return savedPage(byId[selected]);
    if(t.dataset.shot){
      shotView=t.dataset.shot;
      drawSaved($('vz-saved'),byId[selected],pages);
      $('vz-saved').querySelector('[data-shot="'+shotView+'"]')?.focus({preventScroll:true});
      return;
    }
    if(t.dataset.funnel)return push({funnel:t.dataset.funnel,step:null});
    const id=resolve(t.dataset.step||t.dataset.go);
    if(id)push({funnel:F.id,step:id});
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!selected||!isVisualizer())return;
    const id=selected;push({step:null});
    root.querySelector('.vz-fit [data-step="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
  });
  addEventListener('popstate',route);
  addEventListener('resize',fit);
  addEventListener('scroll',placeSide,{passive:true});
  document.addEventListener('tracker:ready',()=>{signedIn=true;toggle.hidden=false;route();});
  document.addEventListener('tracker:signed-out',()=>{signedIn=false;funnels=null;F=null;byId={};selected=null;pages=null;toggle.hidden=true;root.innerHTML='';showShell(false);});
})();
