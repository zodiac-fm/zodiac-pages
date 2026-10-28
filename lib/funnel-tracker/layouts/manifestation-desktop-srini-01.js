'use strict';

const {createCategorySriniTransform}=require('./lander-srini-category-adapter');

const metadata=Object.freeze({
  id:'manifestation-desktop-srini-01',
  title:'Jennifer photo and byline above the quote',
  family:'lander',variant:'m',sectionId:'LM-02',view:'desktop',
});

module.exports={metadata,transform:createCategorySriniTransform(metadata)};
