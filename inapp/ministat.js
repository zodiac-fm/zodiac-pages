/* Mini status by the logo — the SHARED DEFAULT for every app prototype.
   Include once per page: <script src="ministat.js"></script>
   It self-styles and self-installs into every .top header (Time state + 4 balance dots),
   so any prototype (or a future clone) shows it automatically. Idempotent.
   Tap routes to the in-app Progress tab if the page has one (showTab + #progress),
   otherwise to the standalone /inapp/progress page. Add #behind to preview the off-track state. */
(function(){
  if(window.__ministatLoaded) return; window.__ministatLoaded = true;

  var CSS =
    ".ministat{margin-left:auto;margin-right:12px;display:grid;grid-template-columns:auto 44px;column-gap:7px;row-gap:5px;align-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent}"
    +".ms-lbl{font-size:9.5px;font-weight:600;color:#8a8390;letter-spacing:.03em;justify-self:start}"
    +".ms-ind{justify-self:start;display:inline-flex;align-items:center}"
    +".ms-txt{font-size:9.5px;font-weight:700;color:#0A7A52;letter-spacing:.02em;font-style:normal;line-height:1;white-space:nowrap}"
    +".ms-txt.low{color:#B90044}"
    +".ms-dots{display:inline-flex;gap:4px;width:44px}"
    +".ms-dots i{width:8px;height:8px;border-radius:50%;background:#0A7A52;display:inline-flex;align-items:center;justify-content:center;font-style:normal}"
    +".ms-dots i.low{background:#B90044;color:#fff;font-size:7px;font-weight:800;line-height:1}";
  if(!document.getElementById('ministat-css')){
    var st = document.createElement('style'); st.id = 'ministat-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Static demo data (Vitality is the one under the 15% line -> red-minus dot).
  var MS = { vals:{core:28, love:22, vitality:11, abundance:39}, MIN:15 };

  function render(el){
    var behind = location.hash.indexOf('behind') >= 0;
    var dots = '';
    ['core','love','vitality','abundance'].forEach(function(k){
      var low = MS.vals[k] < MS.MIN;
      dots += '<i class="'+(low?'low':'')+'">'+(low?'−':'')+'</i>';
    });
    el.innerHTML =
      '<span class="ms-lbl">Time:</span>'
      +'<span class="ms-ind"><i class="ms-txt'+(behind?' low':'')+'">'+(behind?'Not on track':'On track')+'</i></span>'
      +'<span class="ms-lbl">Balance:</span>'
      +'<span class="ms-ind ms-dots">'+dots+'</span>';
  }

  function tap(){
    if(typeof window.showTab === 'function' && document.getElementById('progress')){ window.showTab('progress'); }
    else { location.href = 'progress'; }
  }

  function install(){
    document.querySelectorAll('.top').forEach(function(top){
      var ms = top.querySelector('.ministat');
      if(!ms){
        ms = document.createElement('div'); ms.className = 'ministat';
        ms.addEventListener('click', tap);
        var ham = top.querySelector('.ham');
        if(ham){ top.insertBefore(ms, ham); } else { top.appendChild(ms); }
      }
      render(ms);
    });
  }

  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', install); }
  else { install(); }
  window.addEventListener('hashchange', install);
})();
