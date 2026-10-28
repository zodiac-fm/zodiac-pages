'use strict';

const parse5=require('parse5');

const CATEGORIES=Object.freeze({
  m:Object.freeze({sectionId:'LM-02'}),
  a:Object.freeze({sectionId:'LA-02'}),
});

const css=sectionId=>`
  @media(min-width:700px){
    [data-funnel-section-id="${sectionId}"].source-band{padding-block:48px 64px}
    [data-funnel-section-id="${sectionId}"] .source-quote{padding-top:24px}
    [data-funnel-section-id="${sectionId}"] .source-author{
      display:grid;grid-template-columns:160px minmax(0,1fr);align-items:center;gap:24px;
      margin:0 0 28px;padding:0;border:0;
    }
    [data-funnel-section-id="${sectionId}"] .source-author .portrait{width:160px}
  }
`;

function nodes(node){return[node,...(node.childNodes||[]).flatMap(nodes)];}
function attr(node,name){return node.attrs?.find(item=>item.name===name)?.value ?? null;}
function hasClass(node,name){return String(attr(node,'class')||'').split(/\s+/).includes(name);}
function exact(items,message){if(items.length!==1)throw Error(message);return items[0];}
function multiset(values){const result=new Map();for(const value of values)result.set(value,(result.get(value)||0)+1);return result;}
function same(left,right){return left.size===right.size&&[...left].every(([key,value])=>right.get(key)===value);}
function insideStyle(node){for(let parent=node.parentNode;parent;parent=parent.parentNode)if(parent.tagName==='style')return true;return false;}
function protectedState(section){
  return {
    ids:multiset(nodes(section).map(node=>attr(node,'id')).filter(value=>value!==null)),
    editIds:multiset(nodes(section).map(node=>attr(node,'data-funnel-edit-id')).filter(value=>value!==null)),
    hrefs:multiset(nodes(section).map(node=>attr(node,'href')).filter(value=>value!==null)),
    images:multiset(nodes(section).map(node=>attr(node,'src')).filter(value=>value!==null)),
    text:multiset(nodes(section).filter(node=>node.nodeName==='#text'&&!insideStyle(node)).map(node=>node.value)),
  };
}
function assertProtected(before,after){
  if(!same(before.ids,after.ids)||!same(before.editIds,after.editIds)
      ||!same(before.hrefs,after.hrefs)||!same(before.images,after.images)
      ||!same(before.text,after.text))throw Error('Prepared category quote changed protected source content.');
}

function createCategorySriniTransform(metadata){
  const category=CATEGORIES[metadata?.variant];
  if(!category||metadata.family!=='lander'||metadata.view!=='desktop'
      ||metadata.sectionId!==category.sectionId)throw Error('Prepared category quote metadata is invalid.');
  return function transform(html){
    if(typeof html!=='string')throw Error('Prepared design needs saved HTML.');
    const document=parse5.parse(html);
    const section=exact(nodes(document).filter(node=>attr(node,'data-funnel-section-id')===category.sectionId),
      `The ${category.sectionId} source quote could not be found exactly once.`);
    if(nodes(section).some(node=>attr(node,'data-funnel-prepared-layout')===metadata.id)) {
      throw Error('This portrait and byline design is already on this page.');
    }
    const before=protectedState(section);
    const figure=exact(nodes(section).filter(node=>node.tagName==='figure'&&hasClass(node,'source-quote')),
      `The ${category.sectionId} source quote figure could not be found exactly once.`);
    const direct=(figure.childNodes||[]).filter(node=>typeof node.tagName==='string');
    const quote=exact(direct.filter(node=>node.tagName==='blockquote'),
      `The ${category.sectionId} quote could not be found exactly once.`);
    const author=exact(direct.filter(node=>node.tagName==='figcaption'&&hasClass(node,'source-author')),
      `The ${category.sectionId} attribution could not be found exactly once.`);
    if(direct.indexOf(quote)>direct.indexOf(author))throw Error('The category source quote order is not safe to prepare.');
    const quoteIndex=figure.childNodes.indexOf(quote),authorIndex=figure.childNodes.indexOf(author);
    figure.childNodes[quoteIndex]=author;
    figure.childNodes[authorIndex]=quote;
    const style=parse5.parseFragment(section,
      `<style data-funnel-prepared-layout="${metadata.id}">${css(category.sectionId)}</style>`).childNodes[0];
    style.parentNode=section;
    section.childNodes.push(style);
    assertProtected(before,protectedState(section));
    return parse5.serialize(document);
  };
}

module.exports={createCategorySriniTransform};
