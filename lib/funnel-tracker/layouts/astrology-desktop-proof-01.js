'use strict';

const {createCategoryProofTransform}=require('./lander-proof-category-adapter');

const metadata=Object.freeze({
  id:'astrology-desktop-proof-01',
  title:'Stacked proof with official App Store artwork',
  family:'lander',variant:'a',sectionId:'LA-01',view:'desktop',
});

module.exports={metadata,transform:createCategoryProofTransform(metadata)};
