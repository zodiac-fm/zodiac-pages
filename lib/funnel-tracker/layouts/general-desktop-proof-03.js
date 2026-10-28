'use strict';

const parse5 = require('parse5');
const previous = require('./general-desktop-proof-02');

const metadata = Object.freeze({
  id:'general-desktop-proof-03',title:'Stacked proof with official App Store artwork',
  family:'lander',variant:'g',sectionId:'LG-01',view:'desktop',
});
const APP_STORE_BADGE='https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg';

const css=`
  .channel-lander .ah2-hero .zfm-hero-proof{
    position:absolute;z-index:3;top:12px;left:calc(50% + 58px);width:280px;
    box-sizing:border-box;display:flex;flex-direction:column;align-items:center;
    color:#382b31;text-align:center;font-family:Switzer,Arial,sans-serif;
  }
  .channel-lander .ah2-hero .zfm-proof-seal{
    position:relative;display:flex;flex-direction:column;align-items:center;
    justify-content:center;width:252px;color:inherit;text-decoration:none;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__rating-group{
    position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;
    width:252px;height:144px;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__laurels{
    position:absolute;inset:0;width:100%;height:100%;color:#785f69;pointer-events:none;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__stars{
    display:flex;gap:4px;align-items:center;margin:0 0 6px;color:#9c2450;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__stars svg{display:block;width:15px;height:15px;fill:currentColor}
  .channel-lander .ah2-hero .zfm-proof-seal__rating{
    display:block;margin:0;color:#382b31;font:500 56px/.98 Switzer,Arial,sans-serif;
    letter-spacing:-.045em;font-variant-numeric:lining-nums tabular-nums;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__store{
    display:flex;align-items:center;justify-content:center;margin:12px 0 0;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__badge{
    display:block;width:120px;height:40px;max-width:none;object-fit:contain;
  }
  .channel-lander .ah2-hero .zfm-proof-seal__caption{
    margin:7px 0 0;color:#69555f;font:400 11px/1.2 Switzer,Arial,sans-serif;letter-spacing:.015em;
  }
  .channel-lander .ah2-hero .zfm-proof-seal:focus-visible{outline:2px solid #9c2450;outline-offset:5px;border-radius:3px}
  .channel-lander .ah2-hero .zfm-proof-listeners{
    display:flex;flex-direction:column;align-items:center;gap:19px;
    width:100%;margin:14px 0 0;padding:0;list-style:none;
  }
  .channel-lander .ah2-hero .zfm-proof-listeners__item{
    display:flex;flex-direction:column;align-items:center;width:100%;margin:0;padding:0;
  }
  .channel-lander .ah2-hero .zfm-proof-listeners__value{
    display:block;margin:0;color:#382b31;font:500 34px/1.08 Switzer,Arial,sans-serif;
    letter-spacing:-.045em;font-variant-numeric:lining-nums tabular-nums;white-space:nowrap;
  }
  .channel-lander .ah2-hero .zfm-proof-listeners__label{
    margin:5px 0 0;color:#69555f;font:400 13px/1.35 Switzer,Arial,sans-serif;letter-spacing:0;
  }
  .channel-lander .ah2-hero .zfm-proof-listeners__source{
    margin:5px 0 0;color:#69555f;font:400 10px/1.35 Switzer,Arial,sans-serif;letter-spacing:.015em;
  }
  @media(min-width:700px){
    .channel-lander .ah2-hero .ah2-music-stage .ah2-phone-device,
    .channel-lander .ah2-hero .ah2-music-stage::before{left:calc(50% - 140px)}
  }
  @media(min-width:700px) and (max-width:1099px){
    .channel-lander .ah2-hero .zfm-hero-proof{left:calc(50% + 30px);width:270px;top:10px}
    .channel-lander .ah2-hero .ah2-music-stage .ah2-phone-device,
    .channel-lander .ah2-hero .ah2-music-stage::before{left:calc(50% - 136px)}
  }
  @media(max-width:699px){.channel-lander .ah2-hero .zfm-hero-proof{display:none}}
`;

function nodes(node) { return [node,...(node.childNodes || []).flatMap(nodes)]; }
function attr(node,name) { return node.attrs?.find(item=>item.name===name)?.value; }
function hasClass(node,name) { return String(attr(node,'class') || '').split(/\s+/).includes(name); }
function remove(node) { node.parentNode.childNodes=node.parentNode.childNodes.filter(item=>item!==node); }
function replace(node,markup) {
  const parent=node.parentNode,index=parent.childNodes.indexOf(node);
  const replacements=parse5.parseFragment(parent,markup).childNodes;
  for(const item of replacements)item.parentNode=parent;
  parent.childNodes.splice(index,1,...replacements);
}

function transform(html) {
  if(typeof html!=='string')throw Error('Prepared design needs saved HTML.');
  const input=parse5.parse(html);
  const heroes=nodes(input).filter(node=>attr(node,'data-funnel-section-id')==='LG-01');
  if(heroes.length!==1)throw Error('The General phone hero could not be found exactly once.');
  const hero=heroes[0];
  if(nodes(hero).some(node=>attr(node,'data-funnel-prepared-layout')===metadata.id))throw Error('This proof design is already on this variation.');
  for(const node of nodes(hero).filter(node=>hasClass(node,'zfm-hero-proof')
    || ['general-desktop-proof-01','general-desktop-proof-02'].includes(attr(node,'data-funnel-prepared-layout'))))remove(node);
  // Reuse the unchanged accepted laurel artwork, five stars and phone positioning base.
  const document=parse5.parse(previous.transform(parse5.serialize(input)));
  const proof=nodes(document).find(node=>hasClass(node,'zfm-hero-proof'));
  replace(nodes(proof).find(node=>hasClass(node,'zfm-proof-seal__store')),
    `<p class="zfm-proof-seal__store"><img class="zfm-proof-seal__badge" src="${APP_STORE_BADGE}" width="120" height="40" alt="Download on the App Store" loading="eager" decoding="async"></p>`);
  const seal=nodes(proof).find(node=>hasClass(node,'zfm-proof-seal'));
  const group=parse5.parseFragment(seal,'<div class="zfm-proof-seal__rating-group"></div>').childNodes[0];
  for(const className of ['zfm-proof-seal__laurels','zfm-proof-seal__stars','zfm-proof-seal__rating','zfm-proof-seal__caption']){
    const node=nodes(seal).find(item=>hasClass(item,className));
    if(className==='zfm-proof-seal__caption')nodes(node).find(item=>item.nodeName==='#text').value='App Store rating';
    node.parentNode=group;group.childNodes.push(node);
  }
  const badge=nodes(seal).find(node=>hasClass(node,'zfm-proof-seal__store'));
  group.parentNode=seal;badge.parentNode=seal;seal.childNodes=[group,badge];
  replace(nodes(proof).find(node=>hasClass(node,'zfm-proof-listeners')),`<ul class="zfm-proof-listeners" aria-label="Listener proof">
    <li class="zfm-proof-listeners__item"><p class="zfm-proof-listeners__value"><funnel-copy>15,000+</funnel-copy></p><p class="zfm-proof-listeners__label"><funnel-copy>users</funnel-copy></p></li>
    <li class="zfm-proof-listeners__item" title="Listening minutes calculated from recorded plays multiplied by full-track lengths, rounded down to 3.4 million."><p class="zfm-proof-listeners__value"><funnel-copy>3.4M+</funnel-copy></p><p class="zfm-proof-listeners__label"><funnel-copy>minutes listened</funnel-copy></p></li>
    <li class="zfm-proof-listeners__item" title="98.6% of completers in Zodiac's internal 52-week study would recommend Zodiac. 300 people started and 278 completed. Participant reports, not guaranteed outcomes."><p class="zfm-proof-listeners__value"><funnel-copy>98.6%</funnel-copy></p><p class="zfm-proof-listeners__label"><funnel-copy>would recommend to a friend</funnel-copy></p><p class="zfm-proof-listeners__source"><funnel-copy>52-week internal study · completers</funnel-copy></p></li>
  </ul>`);
  const style=nodes(document).find(node=>attr(node,'data-funnel-prepared-layout')==='general-desktop-proof-02');
  replace(style,`<style data-funnel-prepared-layout="${metadata.id}">${css}</style>`);
  return parse5.serialize(document);
}

module.exports={metadata,transform};
