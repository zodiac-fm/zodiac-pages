'use strict';

const {draftStore, publicDraft} = require('./draft-store');
const {reviewStore} = require('./review-store');
const {blobStore} = require('./blob-store');
const {fetchVerifiedLiveViews} = require('./live-source');
const {getTarget} = require('./production-catalog');

// A software source refresh is distinct from a company member's copy/image edit.
const SOURCE_EDITOR = Object.freeze({
  sub:'funnel-tracker-live-source',email:'tracker@zodiac.fm',name:'Zodiac tracker',
});

async function initializeWorkingViews({pageKey,expectedRevision,tokenProvider,
  drafts=draftStore,review=reviewStore,tracker=blobStore,fetchViews=fetchVerifiedLiveViews}={}) {
  const target=getTarget(pageKey);
  if(!target||target.stage!=='draft'||target.variationOf
    ||!/^draftrev_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(expectedRevision||'')) {
    throw new Error('invalid_view_initialization_request');
  }
  const current=await drafts.getDraft(pageKey);
  if(!current.draft)throw new Error('working_page_not_found');
  // Repeated calls are safe, but a saved change must never be replaced by a refresh.
  if(current.draft.views)return {pageKey,initialized:false,draft:publicDraft(current.draft)};
  if(current.draft.currentRevisionId!==expectedRevision)throw new Error('working_page_changed');
  const [map,sections]=await Promise.all([review.readMap(),tracker.read()]);
  const sectionNames=Object.fromEntries(sections.data.sections.map(section=>[section.id,section.name]));
  const source=await fetchViews(pageKey,{referenceMap:map.data,sectionNames,tokenProvider});
  const saved=await drafts.initializeViews({pageKey,expectedRevision,sources:source.sources,
    sectionNames:{...sectionNames,...(source.sectionNames||{})},editor:SOURCE_EDITOR});
  return {pageKey,initialized:true,draft:publicDraft(saved.draft)};
}

module.exports={SOURCE_EDITOR,initializeWorkingViews};
