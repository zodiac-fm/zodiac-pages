'use strict';

const {createCategorySriniTransform}=require('./lander-srini-category-adapter');

const metadata=Object.freeze({
  id:'astrology-desktop-srini-01',
  title:'Barbara photo and byline above the quote',
  family:'lander',variant:'a',sectionId:'LA-02',view:'desktop',
});

module.exports={metadata,transform:createCategorySriniTransform(metadata)};
