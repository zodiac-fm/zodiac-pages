'use strict';

const CATEGORIES = [
  {variant:'g',category:'general',name:'General',slug:'lg'},
  {variant:'m',category:'manifesting',name:'Manifestation',slug:'lm'},
  {variant:'a',category:'astrology',name:'Astrology and Human Design',slug:'la'},
];
const EXPECTED_OFFERS = {
  paid:'20% Off · One Time Offer · 7-Day Trial. Try Zodiac for 7 Days.',
  affiliate:'20% Off · Courtesy of David Mcewen · Free 7-Day Trial.',
  direct:'Offer depends on the arrival channel. Capture uses a fresh visit without saved attribution.',
};
const TARGETS = CATEGORIES.flatMap(c=>[
  ...['direct','paid','affiliate'].map(channel=>({
    id:`lander-${c.variant}-${channel}`,family:'lander',variant:c.variant,category:c.category,channel,
    label:`${c.name} lander`,stage:'production',
    productionUrl:`https://zodiac.fm/${c.slug}${channel==='paid'?'?coupon=FACEBOOK20':channel==='affiliate'?'?inf_affid=14085':''}`,
    sourceRepo:'zodiac-fm/zodiac-website',
    snapshotPath:`https://zodiac.fm/api/funnel-snapshot?category=${c.category}&channel=${channel}`,
    captureKind:'public',expectedOffer:EXPECTED_OFFERS[channel],
    reportedLive:{reportedAt:'2026-10-26',shippedOn:'2026-10-25',source:'Michael',note:'Michael reports the sticky Reveal bar is live on all three landers. This report does not confirm an exact section revision.'},
  })),
  ...['paid','affiliate'].map(channel=>({
    id:`results-${c.variant}-${channel}`,family:'results',variant:c.variant,category:c.category,channel,
    label:`${c.name} Results`,stage:'production',
    productionUrl:`https://app.zodiac.fm/frequency?category=${c.category}&coupon=${channel==='paid'?'FACEBOOK20':'MCEWEN&affiliate=David%20McEwen'}`,
    sourceRepo:'zodiac-fm/zodiac-app',
    snapshotPath:`https://app.zodiac.fm/api/funnel-snapshot?category=${c.category}&channel=${channel}`,
    captureKind:'sample-profile',expectedOffer:EXPECTED_OFFERS[channel],
  })),
]);
TARGETS.push({
  id:'corporate-home',family:'corporate',variant:'home',category:'home',channel:'direct',
  label:'Corporate homepage',stage:'production',productionUrl:'https://zodiac.fm/',
  sourceRepo:'zodiac-fm/zodiac-website',snapshotPath:null,captureKind:'public-site',expectedOffer:null,
});

const DRAFTS = [
  {id:'draft-lander-g',family:'lander',variant:'g',category:'general',label:'General · Lander',sourceVersion:'General 13',productionUrl:'https://zodiac-pages.vercel.app/landers/general-spiritual-13'},
  {id:'draft-lander-m',family:'lander',variant:'m',category:'manifesting',label:'Manifestation · Lander',sourceVersion:'Manifestation 11',productionUrl:'https://zodiac-pages.vercel.app/landers/manifestation-11'},
  {id:'draft-lander-a',family:'lander',variant:'a',category:'astrology',label:'Astrology and Human Design · Lander',sourceVersion:'Astrology hero 2',referenceUrl:'https://zodiac-pages.vercel.app/landers/a/hero-2#try',productionUrl:'https://zodiac-pages.vercel.app/landers/a/hero-2'},
  {id:'draft-results-g',family:'results',variant:'g',category:'general',label:'General · Results',sourceVersion:'General affiliate 09',productionUrl:'https://zodiac-pages.vercel.app/funnel/general/results-affiliate-09?affiliate=David%20McEwen'},
  {id:'draft-results-m',family:'results',variant:'m',category:'manifesting',label:'Manifestation · Results',sourceVersion:'Manifestation affiliate 07',productionUrl:'https://zodiac-pages.vercel.app/funnel/general/results-manifesting-affiliate-07?affiliate=David%20McEwen'},
  {id:'draft-results-a',family:'results',variant:'a',category:'astrology',label:'Astrology and Human Design · Results',sourceVersion:'Astrology affiliate 08',productionUrl:'https://zodiac-pages.vercel.app/funnel/general/results-astrology-affiliate-08?affiliate=David%20McEwen'},
  {id:'draft-bc',family:'bc',variant:'shared',category:'shared',label:'Accepted Birth Chart 01',productionUrl:'https://zodiac-pages.vercel.app/site/birth-chart-01'},
  {id:'draft-join-paid',family:'join',variant:'paid',category:'paid',label:'Paid Join 04',productionUrl:'https://zodiac-pages.vercel.app/funnel/join/join-paid-04'},
  {id:'draft-join-free',family:'join',variant:'free',category:'free',label:'Free Join 04',productionUrl:'https://zodiac-pages.vercel.app/funnel/join/join-free-04'},
];
for(const draft of DRAFTS)TARGETS.push({...draft,channel:'draft',stage:'draft',sourceRepo:'zodiac-fm/zodiac-pages',snapshotPath:null,captureKind:'draft',expectedOffer:null});

const VARIATION_KEY = /^(draft-(?:lander-[gma]|results-[gma]|bc|join-(?:paid|free)))--variation-([0-9a-f]{8}-[0-9a-f-]{27,36})$/i;

function variationBaseId(id){
  return typeof id==='string'?(id.match(VARIATION_KEY)?.[1]||null):null;
}
function variationPageKey(basePageKey,variationId){
  const base=TARGETS.find(target=>target.id===basePageKey&&target.stage==='draft');
  if(!base||typeof variationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(variationId))return null;
  return `${basePageKey}--variation-${variationId.toLowerCase()}`;
}
function getTarget(id){
  const exact=TARGETS.find(target=>target.id===id);
  if(exact)return exact;
  const baseId=variationBaseId(id);
  const base=baseId?TARGETS.find(target=>target.id===baseId&&target.stage==='draft'):null;
  return base?{...base,id,variationOf:base.id,label:`${base.label} · Variation`}:null;
}
function pairedLiveTargets(pageKey){
  const draft=getTarget(pageKey);
  return draft?.stage==='draft'?TARGETS.filter(target=>target.stage==='production'&&target.family===draft.family&&target.variant===draft.variant):[];
}
module.exports={CATEGORIES,TARGETS,getTarget,pairedLiveTargets,variationBaseId,variationPageKey};
