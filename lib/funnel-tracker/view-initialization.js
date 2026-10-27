'use strict';

const {DraftStoreConflictError,draftStore, publicDraft} = require('./draft-store');
const {reviewStore} = require('./review-store');
const {blobStore} = require('./blob-store');
const {
  BC_CAPTURE_VERSION,BC_COMPARISON_VERSION,JOIN_COMPARISON_VERSION,fetchVerifiedLiveViews,
} = require('./live-source');
const {getTarget} = require('./production-catalog');

// A software source refresh is distinct from a company member's copy/image edit.
const SOURCE_EDITOR = Object.freeze({
  sub:'funnel-tracker-live-source',email:'tracker@zodiac.fm',name:'Zodiac tracker',
});

async function initializeWorkingViews({pageKey,expectedRevision,tokenProvider,view='desktop',editor=SOURCE_EDITOR,
  drafts=draftStore,review=reviewStore,tracker=blobStore,fetchViews=fetchVerifiedLiveViews}={}) {
  const target=getTarget(pageKey);
  if(!target||target.stage!=='draft'||target.variationOf
    ||!(expectedRevision===null
      ||/^draftrev_[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(expectedRevision||''))) {
    throw new Error('invalid_view_initialization_request');
  }
  const current=await drafts.getDraft(pageKey);
  if((current.draft&&current.draft.currentRevisionId!==expectedRevision)
    ||(!current.draft&&expectedRevision!==null)){
    throw new DraftStoreConflictError('working_page_changed');
  }
  // Repeated calls are safe, but a saved change must never be replaced by a refresh.
  if(current.draft?.views){
    const latest=current.draft.revisions.at(-1);
    const ready=['desktop','mobile'].every(view=>{
      const evidence=latest?.views?.[view]?.sourceEvidence;
      return current.draft.family==='bc'
        ? evidence?.comparisonVersion===BC_COMPARISON_VERSION
          && evidence?.captureVersion===BC_CAPTURE_VERSION
        : current.draft.family==='join'
          ? evidence?.comparisonVersion===JOIN_COMPARISON_VERSION
          : true;
    });
    if(ready||!['bc','join'].includes(current.draft.family)){
      return {pageKey,initialized:false,draft:publicDraft(current.draft,{view})};
    }
  }
  const [map,sections]=await Promise.all([review.readMap(),tracker.read()]);
  const sectionNames=Object.fromEntries(sections.data.sections.map(section=>[section.id,section.name]));
  const source=await fetchViews(pageKey,{referenceMap:map.data,sectionNames,tokenProvider});
  const saved=await drafts.initializeViews({pageKey,expectedRevision,sources:source.sources,
    sectionNames:{...sectionNames,...(source.sectionNames||{})},editor,
    allowLegacyEvidenceUpgrade:Boolean(current.draft?.views
      && ['bc','join'].includes(current.draft.family))});
  return {pageKey,initialized:true,draft:publicDraft(saved.draft,{view})};
}

module.exports={SOURCE_EDITOR,initializeWorkingViews};
