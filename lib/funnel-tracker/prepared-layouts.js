'use strict';

const DEFINITIONS = Object.freeze([
  Object.freeze({
    id:'general-desktop-srini-01',
    title:'Srini photo and byline above the quote',
    family:'lander',
    variant:'g',
    sectionId:'LG-02',
    view:'desktop',
    load:() => require('./layouts/general-desktop-srini-01'),
  }),
  Object.freeze({
    id:'manifestation-desktop-proof-01',
    title:'Stacked proof with official App Store artwork',
    family:'lander',
    variant:'m',
    sectionId:'LM-01',
    view:'desktop',
    load:() => require('./layouts/manifestation-desktop-proof-01'),
  }),
  Object.freeze({
    id:'astrology-desktop-proof-01',
    title:'Stacked proof with official App Store artwork',
    family:'lander',
    variant:'a',
    sectionId:'LA-01',
    view:'desktop',
    load:() => require('./layouts/astrology-desktop-proof-01'),
  }),
  Object.freeze({
    id:'general-desktop-proof-03',
    title:'Stacked proof with official App Store artwork',
    family:'lander',
    variant:'g',
    sectionId:'LG-01',
    view:'desktop',
    load:() => require('./layouts/general-desktop-proof-03'),
  }),
  Object.freeze({
    id:'general-desktop-proof-02',
    title:'App Store and listener laurels',
    family:'lander',
    variant:'g',
    sectionId:'LG-01',
    view:'desktop',
    load:() => require('./layouts/general-desktop-proof-02'),
  }),
  Object.freeze({
    id:'general-desktop-proof-01',
    title:'Proof beside the phone',
    family:'lander',
    variant:'g',
    sectionId:'LG-01',
    view:'desktop',
    load:() => require('./layouts/general-desktop-proof-01'),
  }),
]);

function publicMetadata(definition) {
  const {id,title,family,variant,sectionId,view} = definition;
  return {id,title,family,variant,sectionId,view};
}

function listPreparedLayouts() {
  return DEFINITIONS.map(publicMetadata);
}

function preparedLayoutMetadata(id) {
  const definition = DEFINITIONS.find(item => item.id === id);
  return definition ? publicMetadata(definition) : null;
}

function getPreparedLayout(id) {
  const definition = DEFINITIONS.find(item => item.id === id);
  if (!definition) return null;
  const implementation = definition.load();
  const metadata = implementation?.metadata;
  const expected = publicMetadata(definition);
  if (!implementation || typeof implementation.transform !== 'function'
      || !metadata || Object.keys(metadata).sort().join(',') !== Object.keys(expected).sort().join(',')
      || Object.entries(expected).some(([key,value]) => metadata[key] !== value)) {
    throw new Error(`Prepared layout ${definition.id} is not available.`);
  }
  return {...expected, transform:implementation.transform};
}

module.exports = {
  getPreparedLayout,
  listPreparedLayouts,
  preparedLayoutMetadata,
};
