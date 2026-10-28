'use strict';

const parse5 = require('parse5');
const approvedGeneral = require('./general-desktop-proof-03');

const APP_STORE_URL='https://apps.apple.com/us/app/zodiacfm/id6764863619';
const CATEGORIES=Object.freeze({
  m:Object.freeze({sectionId:'LM-01'}),
  a:Object.freeze({sectionId:'LA-01'}),
});

function nodes(node) { return [node,...(node.childNodes || []).flatMap(nodes)]; }
function attr(node,name) { return node.attrs?.find(item=>item.name===name)?.value ?? null; }
function setAttr(node,name,value) {
  const existing=(node.attrs || []).find(item=>item.name===name);
  if(existing)existing.value=value;
  else (node.attrs ||= []).push({name,value});
}
function exactSection(document,sectionId) {
  const matches=nodes(document).filter(node=>attr(node,'data-funnel-section-id')===sectionId);
  if(matches.length!==1)throw Error(`The ${sectionId} phone hero could not be found exactly once.`);
  return matches[0];
}
function multiset(document,name) {
  const result=new Map();
  for(const value of nodes(document).map(node=>attr(node,name)).filter(value=>value!==null)) {
    result.set(value,(result.get(value) || 0)+1);
  }
  return result;
}
function assertSameMultiset(before,after,label) {
  if(before.size!==after.size || [...before].some(([key,value])=>after.get(key)!==value)) {
    throw Error(`Prepared design changed an existing ${label}.`);
  }
}
function assertHrefAddOnly(before,after) {
  const expected=new Map(before);
  expected.set(APP_STORE_URL,(expected.get(APP_STORE_URL) || 0)+1);
  assertSameMultiset(expected,after,'link');
}

function createCategoryProofTransform(metadata) {
  const category=CATEGORIES[metadata?.variant];
  if(!category || metadata.family!=='lander' || metadata.view!=='desktop'
      || metadata.sectionId!==category.sectionId || metadata.id===approvedGeneral.metadata.id) {
    throw Error('Prepared category design metadata is invalid.');
  }
  return function transform(html) {
    if(typeof html!=='string')throw Error('Prepared design needs saved HTML.');
    const input=parse5.parse(html);
    const hero=exactSection(input,metadata.sectionId);
    if(nodes(input).some(node=>attr(node,'data-funnel-section-id')==='LG-01')) {
      throw Error('Prepared category design found an unexpected General hero.');
    }
    if(nodes(hero).some(node=>attr(node,'data-funnel-prepared-layout')===metadata.id)) {
      throw Error('This proof design is already on this variation.');
    }
    const ids=multiset(input,'id');
    const editIds=multiset(input,'data-funnel-edit-id');
    const hrefs=multiset(input,'href');

    setAttr(hero,'data-funnel-section-id','LG-01');
    const transformed=parse5.parse(approvedGeneral.transform(parse5.serialize(input)));
    const transformedHero=exactSection(transformed,'LG-01');
    setAttr(transformedHero,'data-funnel-section-id',metadata.sectionId);
    const styles=nodes(transformedHero).filter(
      node=>attr(node,'data-funnel-prepared-layout')===approvedGeneral.metadata.id,
    );
    if(styles.length!==1)throw Error('Prepared category design marker is unavailable.');
    setAttr(styles[0],'data-funnel-prepared-layout',metadata.id);
    exactSection(transformed,metadata.sectionId);
    if(nodes(transformed).some(node=>attr(node,'data-funnel-section-id')==='LG-01'
        || attr(node,'data-funnel-prepared-layout')===approvedGeneral.metadata.id)) {
      throw Error('Prepared category design retained a General marker.');
    }
    assertSameMultiset(ids,multiset(transformed,'id'),'DOM id');
    assertSameMultiset(editIds,multiset(transformed,'data-funnel-edit-id'),'edit id');
    assertHrefAddOnly(hrefs,multiset(transformed,'href'));
    return parse5.serialize(transformed);
  };
}

module.exports={createCategoryProofTransform};
