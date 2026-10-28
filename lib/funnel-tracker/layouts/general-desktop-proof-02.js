'use strict';

const parse5 = require('parse5');

// Supersedes the first proof composition inside the saved Desktop hero only.
// Historical users supplied by Michael. Minutes are rounded from 3,494,789,
// calculated as recorded play events multiplied by canonical track lengths.
// Apple US listing id6764863619 showed 5.0 on October 27, 2026.
const metadata = Object.freeze({
  id:'general-desktop-proof-02',title:'App Store and listener laurels',
  family:'lander',variant:'g',sectionId:'LG-01',view:'desktop',
});

const css = `
  .channel-lander .ah2-hero .zfm-hero-proof{
    position:absolute;z-index:3;top:54px;left:calc(50% + 55px);width:310px;
    box-sizing:border-box;display:flex;flex-direction:column;align-items:center;
    color:#382b31;text-align:center;font-family:Switzer,Arial,sans-serif;
  }
  .channel-lander .ah2-hero .zfm-proof-seal{
    position:relative;display:flex;flex-direction:column;align-items:center;
    justify-content:center;width:276px;height:184px;color:inherit;text-decoration:none;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__laurels{
    position:absolute;inset:0;width:100%;height:100%;color:#785f69;pointer-events:none;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__stars{
    display:flex;gap:4px;align-items:center;margin:0 0 8px;color:#9c2450;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__stars svg{display:block;width:16px;height:16px;fill:currentColor}
  .channel-lander .ah2-hero .zfm-proof-seal__rating{
    display:block;margin:0;color:#382b31;font:500 76px/.9 var(--serif);
    letter-spacing:-.045em;font-variant-numeric:lining-nums;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__store{
    display:flex;align-items:center;justify-content:center;gap:5px;margin:15px 0 0;
    color:#382b31;font:500 15px/1.2 Switzer,Arial,sans-serif;letter-spacing:-.015em;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__apple{display:block;width:15px;height:18px;fill:currentColor}
  .channel-lander .ah2-hero .zfm-proof-seal__caption{
    margin:6px 0 0;color:#69555f;font:400 11px/1.2 Switzer,Arial,sans-serif;
    letter-spacing:.025em;
  }
  .channel-lander .ah2-hero .zfm-proof-seal:hover .zfm-proof-seal__store{text-decoration:underline;text-underline-offset:4px}
  .channel-lander .ah2-hero .zfm-proof-seal:focus-visible{outline:2px solid #9c2450;outline-offset:5px;border-radius:3px}
  .channel-lander .ah2-hero .zfm-proof-listeners{
    display:grid;grid-template-columns:1fr 1fr;gap:18px;width:100%;margin-top:32px;
  }
  .channel-lander .ah2-hero .zfm-proof-listeners__item{display:flex;flex-direction:column;align-items:center;margin:0}
  .channel-lander .ah2-hero .zfm-proof-listeners__value{
    display:block;margin:0;color:#382b31;font:500 38px/1 var(--serif);
    letter-spacing:-.045em;font-variant-numeric:lining-nums;white-space:nowrap;
  }
  .channel-lander .ah2-hero .zfm-proof-listeners__approx{font-size:.47em;vertical-align:.1em;letter-spacing:0;margin-right:2px}
  .channel-lander .ah2-hero .zfm-proof-listeners__label{
    margin:9px 0 0;color:#69555f;font:400 13px/1.35 Switzer,Arial,sans-serif;letter-spacing:0;
  }
  @media(min-width:700px){
    .channel-lander .ah2-hero .ah2-music-stage .ah2-phone-device,
    .channel-lander .ah2-hero .ah2-music-stage::before{left:calc(50% - 148px)}
  }
  @media(min-width:700px) and (max-width:1099px){
    .channel-lander .ah2-hero .zfm-hero-proof{left:calc(50% + 30px);width:290px;top:42px}
    .channel-lander .ah2-hero .ah2-music-stage .ah2-phone-device,
    .channel-lander .ah2-hero .ah2-music-stage::before{left:calc(50% - 140px)}
    .channel-lander .ah2-hero .zfm-proof-listeners{gap:12px}
    .channel-lander .ah2-hero .zfm-proof-listeners__value{font-size:35px}
  }
  @media(max-width:699px){.channel-lander .ah2-hero .zfm-hero-proof{display:none}}
`;

function nodes(node) { return [node,...(node.childNodes || []).flatMap(nodes)]; }
function attr(node,name) { return node.attrs?.find(item=>item.name===name)?.value; }
function hasClass(node,name) { return String(attr(node,'class') || '').split(/\s+/).includes(name); }
function remove(node) { node.parentNode.childNodes=node.parentNode.childNodes.filter(item=>item!==node); }

function laurels() {
  // Original vector ornament. Each side is one curved stem with alternating leaves.
  const leaf='M0 0C-8-1-16-9-16-19C-6-18 1-10 0 0Z';
  const leaves=[
    [81,162,-36],[65,151,-24],[52,137,-13],[42,119,0],
    [36,99,14],[36,78,29],[42,58,45],[52,40,63],
    [67,147,93],[54,130,104],[46,111,114],[43,90,128],
    [46,69,143],[54,51,160],[63,35,178],
  ].map(([x,y,rotation])=>`<path d="${leaf}" transform="translate(${x} ${y}) rotate(${rotation})"/>`).join('');
  const side=`<path d="M88 169C34 141 20 80 61 26" fill="none" stroke="currentColor" stroke-width="1.2"/>${leaves}`;
  return `<svg class="zfm-proof-seal__laurels" viewBox="0 0 300 192" fill="currentColor" aria-hidden="true">${side}<g transform="translate(300 0) scale(-1 1)">${side}</g></svg>`;
}

function stars() {
  const star='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 1.2 2.72 5.5 6.07.88-4.4 4.3 1.04 6.06L10 15.08l-5.43 2.86 1.04-6.06-4.4-4.3 6.07-.88Z"/></svg>';
  return `<span class="zfm-proof-seal__stars" aria-hidden="true">${star.repeat(5)}</span>`;
}

function transform(html) {
  if(typeof html !== 'string') throw Error('Prepared design needs saved HTML.');
  const document=parse5.parse(html);
  const heroes=nodes(document).filter(node=>attr(node,'data-funnel-section-id')==='LG-01');
  if(heroes.length!==1) throw Error('The General phone hero could not be found exactly once.');
  const hero=heroes[0];
  const stage=nodes(hero).find(node=>hasClass(node,'ah2-music-stage'));
  if(!stage || !nodes(stage).some(node=>hasClass(node,'ah2-phone-device'))) throw Error('The saved phone layout is different.');
  if(nodes(hero).some(node=>attr(node,'data-funnel-prepared-layout')===metadata.id)) throw Error('This proof design is already on this variation.');
  for(const node of nodes(hero).filter(node=>hasClass(node,'zfm-hero-proof') || attr(node,'data-funnel-prepared-layout')==='general-desktop-proof-01')) remove(node);
  const fragment=parse5.parseFragment(stage,`<aside class="zfm-hero-proof" aria-label="App Store rating and listening totals">
    <a class="zfm-proof-seal" href="https://apps.apple.com/us/app/zodiacfm/id6764863619" target="_blank" rel="noopener" aria-label="5.0 out of 5 on the App Store">
      ${laurels()}${stars()}
      <p class="zfm-proof-seal__rating"><funnel-copy>5.0</funnel-copy></p>
      <p class="zfm-proof-seal__store"><svg class="zfm-proof-seal__apple" viewBox="7 5 24 30" aria-hidden="true"><path d="M26.6 20.7c0-3.6 3-5.4 3.1-5.5a6.5 6.5 0 0 0-5.1-2.7c-2.2-.2-4.2 1.3-5.3 1.3-1.1 0-2.8-1.3-4.6-1.2a6.8 6.8 0 0 0-5.7 3.5c-2.5 4.2-.6 10.4 1.7 13.8 1.2 1.6 2.5 3.4 4.3 3.3 1.7-.1 2.4-1.1 4.5-1.1 2 0 2.7 1.1 4.5 1.1 1.9 0 3.1-1.7 4.2-3.3a15 15 0 0 0 1.9-3.9 5.9 5.9 0 0 1-3.5-5.3Zm-3.4-10.5a5.9 5.9 0 0 0 1.4-4.1 6.1 6.1 0 0 0-3.9 2 5.7 5.7 0 0 0-1.5 4c1.5.1 3-.7 4-1.9Z"/></svg><funnel-copy>App Store</funnel-copy></p>
      <p class="zfm-proof-seal__caption"><funnel-copy>Listener rating</funnel-copy></p>
    </a>
    <div class="zfm-proof-listeners">
      <div class="zfm-proof-listeners__item"><p class="zfm-proof-listeners__value"><funnel-copy>15,000+</funnel-copy></p><p class="zfm-proof-listeners__label"><funnel-copy>users</funnel-copy></p></div>
      <div class="zfm-proof-listeners__item" title="Listening minutes calculated from recorded plays multiplied by track lengths, rounded to 3.4 million. Assumes full-track plays."><p class="zfm-proof-listeners__value"><span class="zfm-proof-listeners__approx" aria-label="approximately">≈</span><funnel-copy>3.4M</funnel-copy></p><p class="zfm-proof-listeners__label"><funnel-copy>minutes listened</funnel-copy></p></div>
    </div>
  </aside>`);
  for(const node of fragment.childNodes){node.parentNode=stage;stage.childNodes.push(node);}
  const style=parse5.parseFragment(hero,`<style data-funnel-prepared-layout="${metadata.id}">${css}</style>`).childNodes[0];
  style.parentNode=hero;hero.childNodes.push(style);
  return parse5.serialize(document);
}

module.exports={metadata,transform};
