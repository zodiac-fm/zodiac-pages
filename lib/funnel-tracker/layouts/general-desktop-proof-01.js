'use strict';

const parse5 = require('parse5');

// Frozen design recipe. Figures are a review proposal, never a simulated live counter.
// Users: Michael confirmed 2026-10-27 that the total includes the earlier platform.
// Estimate: 209,380 mapped audio_played events times full-track lengths = 3,494,789 minutes.
// Snapshot 2026-10-28 01:30 UTC. Assumes full-track plays; not measured playback time.
// Rating: Apple US listing id6764863619, 5.0 from 3 ratings, checked 2026-10-27.
const metadata = Object.freeze({
  id:'general-desktop-proof-01',title:'Proof beside the phone',
  family:'lander',variant:'g',sectionId:'LG-01',view:'desktop',
});

const css = `
  .channel-lander .ah2-hero .zfm-hero-proof{
    position:absolute;z-index:3;top:20px;left:calc(50% + 84px);width:238px;
    box-sizing:border-box;display:flex;flex-direction:column;gap:0;
    color:#20201e;text-align:left;font-family:Switzer,Arial,sans-serif;
  }
  .channel-lander .ah2-hero .zfm-hero-proof__item{display:block;margin:0;padding:18px 0 20px;border-top:1px solid rgba(90,48,66,.2)}
  .channel-lander .ah2-hero .zfm-hero-proof__item:first-child{padding-top:0;border-top:0}
  .channel-lander .ah2-hero .zfm-hero-proof__value{display:block;margin:0;color:#282124;font:600 42px/1.08 Switzer,Arial,sans-serif;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
  .channel-lander .ah2-hero .zfm-hero-proof__label{display:block;margin:7px 0 0;color:#5d4f55;font:400 15px/1.4 Switzer,Arial,sans-serif;letter-spacing:0}
  .channel-lander .ah2-hero .zfm-hero-proof__rating{display:flex;align-items:baseline;gap:8px;margin:0;color:#282124;font:600 36px/1.1 Switzer,Arial,sans-serif;letter-spacing:-.03em}
  .channel-lander .ah2-hero .zfm-hero-proof__outof{font:400 15px/1.4 Switzer,Arial,sans-serif;color:#5d4f55;letter-spacing:0}
  .channel-lander .ah2-hero .zfm-hero-proof__stars{display:block;margin:9px 0 0;color:#9c2450;font:400 15px/1 Switzer,Arial,sans-serif;letter-spacing:3px}
  .channel-lander .ah2-hero .zfm-hero-proof__store{display:inline-block;margin-top:8px;color:#5d4f55;font:400 12px/1.5 Switzer,Arial,sans-serif;text-decoration:underline;text-decoration-color:#bfa4af;text-underline-offset:3px;letter-spacing:0}
  .channel-lander .ah2-hero .zfm-hero-proof__store:focus-visible{outline:2px solid #6521c9;outline-offset:4px}
  @media(min-width:700px){
    .channel-lander .ah2-hero .ah2-music-stage .ah2-phone-device,.channel-lander .ah2-hero .ah2-music-stage::before{left:calc(50% - 126px)}
  }
  @media(min-width:700px) and (max-width:1099px){
    .channel-lander .ah2-hero .zfm-hero-proof{left:calc(50% + 80px);width:min(238px,calc(50% - 108px));top:20px}
    .channel-lander .ah2-hero .ah2-music-stage .ah2-phone-device,.channel-lander .ah2-hero .ah2-music-stage::before{left:calc(50% - 100px)}
    .channel-lander .ah2-hero .zfm-hero-proof__value{font-size:clamp(29px,3.9vw,43px)}
    .channel-lander .ah2-hero .zfm-hero-proof__label{font-size:14px}
    .channel-lander .ah2-hero .zfm-hero-proof__item{padding-top:20px;padding-bottom:21px}
  }
  @media(max-width:699px){.channel-lander .ah2-hero .zfm-hero-proof{display:none}}
`;

function nodes(node) { return [node,...(node.childNodes || []).flatMap(nodes)]; }
function attr(node,name) { return node.attrs?.find(item=>item.name===name)?.value; }
function hasClass(node,name) { return String(attr(node,'class') || '').split(/\s+/).includes(name); }

function transform(html) {
  if(typeof html !== 'string') throw Error('Prepared design needs saved HTML.');
  const document = parse5.parse(html);
  const heroes = nodes(document).filter(node=>attr(node,'data-funnel-section-id') === 'LG-01');
  if(heroes.length !== 1) throw Error('The General phone hero could not be found exactly once.');
  const hero = heroes[0];
  const stage = nodes(hero).find(node=>hasClass(node,'ah2-music-stage'));
  if(!stage || !nodes(stage).some(node=>hasClass(node,'ah2-phone-device'))) throw Error('The saved phone layout is different.');
  if(nodes(hero).some(node=>hasClass(node,'zfm-hero-proof'))) throw Error('This proof design is already on this variation.');
  const fragment = parse5.parseFragment(stage,`<aside class="zfm-hero-proof" aria-label="Zodiac listening and App Store proof">
    <div class="zfm-hero-proof__item"><p class="zfm-hero-proof__value"><funnel-copy>15,000+</funnel-copy></p><p class="zfm-hero-proof__label"><funnel-copy>users</funnel-copy></p></div>
    <div class="zfm-hero-proof__item"><p class="zfm-hero-proof__value"><funnel-copy>3.4M+</funnel-copy></p><p class="zfm-hero-proof__label" title="Estimate: recorded plays multiplied by full-track length. Assumes full-track plays. Snapshot October 27, 2026."><funnel-copy>estimated minutes listened</funnel-copy></p></div>
    <div class="zfm-hero-proof__item"><p class="zfm-hero-proof__rating"><funnel-copy>5.0</funnel-copy><span class="zfm-hero-proof__outof"><funnel-copy>out of 5</funnel-copy></span></p><span class="zfm-hero-proof__stars" aria-hidden="true">★★★★★</span><a class="zfm-hero-proof__store" href="https://apps.apple.com/us/app/zodiacfm/id6764863619" target="_blank" rel="noopener"><funnel-copy>US App Store · 3 ratings</funnel-copy></a></div>
  </aside>`);
  for(const node of fragment.childNodes){node.parentNode=stage;stage.childNodes.push(node);}
  const style = parse5.parseFragment(hero,`<style data-funnel-prepared-layout="${metadata.id}">${css}</style>`).childNodes[0];
  style.parentNode=hero;hero.childNodes.push(style);
  return parse5.serialize(document);
}

module.exports = {metadata,transform};
