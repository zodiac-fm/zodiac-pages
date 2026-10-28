'use strict';

const parse5=require('parse5');
const srini01=require('./general-desktop-srini-01');

const metadata=Object.freeze({
  id:'general-desktop-srini-02',
  title:'Srini photo and byline above the quote',
  family:'lander',variant:'g',sectionId:'LG-02',view:'desktop',
});

function nodes(node){return[node,...(node.childNodes||[]).flatMap(nodes)];}
function attr(node,name){return node.attrs?.find(item=>item.name===name)?.value ?? null;}
function setAttr(node,name,value){const item=node.attrs?.find(entry=>entry.name===name);if(item)item.value=value;else(node.attrs||(node.attrs=[])).push({name,value});}
function hasClass(node,name){return String(attr(node,'class')||'').split(/\s+/).includes(name);}
function exact(items,message){if(items.length!==1)throw Error(message);return items[0];}
function multiset(values){const result=new Map();for(const value of values)result.set(value,(result.get(value)||0)+1);return result;}
function same(left,right){return left.size===right.size&&[...left].every(([key,value])=>right.get(key)===value);}
function protectedState(section){
  return {
    ids:multiset(nodes(section).map(node=>attr(node,'id')).filter(value=>value!==null)),
    editIds:multiset(nodes(section).map(node=>attr(node,'data-funnel-edit-id')).filter(value=>value!==null)),
    hrefs:multiset(nodes(section).map(node=>attr(node,'href')).filter(value=>value!==null)),
    images:multiset(nodes(section).map(node=>attr(node,'src')).filter(value=>value!==null)),
    text:multiset(nodes(section).filter(node=>node.nodeName==='#text').map(node=>node.value)),
  };
}
function assertProtected(before,after){
  if(!same(before.ids,after.ids)||!same(before.editIds,after.editIds)
      ||!same(before.hrefs,after.hrefs)||!same(before.images,after.images)
      ||!same(before.text,after.text))throw Error('Prepared Srini correction changed protected source content.');
}
function assertSourceSets(before,after){
  if(!same(before.ids,after.ids)||!same(before.editIds,after.editIds)
      ||!same(before.hrefs,after.hrefs)||!same(before.images,after.images)) {
    throw Error('Prepared Srini correction changed protected source content.');
  }
}
function semanticNodes(section){
  const figure=exact(nodes(section).filter(node=>node.tagName==='figure'&&hasClass(node,'source-quote')),
    'The General source quote figure could not be found exactly once.');
  const direct=(figure.childNodes||[]).filter(node=>typeof node.tagName==='string');
  const quote=exact(direct.filter(node=>node.tagName==='blockquote'),
    'The General source quote text could not be found exactly once.');
  const author=exact(direct.filter(node=>node.tagName==='figcaption'&&hasClass(node,'source-author')),
    'The General source quote attribution could not be found exactly once.');
  const heading=exact(nodes(section).filter(node=>node.tagName==='h2'),
    'The General source quote heading could not be found exactly once.');
  const headingCopy=exact(nodes(heading).filter(node=>node.tagName==='funnel-copy'),
    'The General source quote heading copy could not be found exactly once.');
  const paragraphs=(quote.childNodes||[]).filter(node=>node.tagName==='p');
  if(paragraphs.length!==2)throw Error('The General source quote paragraphs could not be found exactly.');
  const quoteCopies=paragraphs.map(paragraph=>exact(nodes(paragraph).filter(node=>node.tagName==='funnel-copy'),
    'The General source quote paragraph copy could not be found exactly once.'));
  const authorSmall=exact(nodes(author).filter(node=>node.tagName==='small'),
    'The General source quote byline could not be found exactly once.');
  const authorCopy=exact(nodes(authorSmall).filter(node=>node.tagName==='funnel-copy'),
    'The General source quote byline copy could not be found exactly once.');
  const portrait=exact(nodes(author).filter(node=>node.tagName==='img'&&hasClass(node,'portrait')),
    'The General source quote portrait could not be found exactly once.');
  const jump=exact(nodes(section).filter(node=>hasClass(node,'ah2-offer-jump')),
    'The General source quote offer jump could not be found exactly once.');
  const jumpCopies=nodes(jump).filter(node=>node.tagName==='funnel-copy');
  if(jumpCopies.length!==4)throw Error('The General source quote offer copy could not be found exactly.');
  const allCopies=nodes(section).filter(node=>node.tagName==='funnel-copy');
  if(allCopies.length!==8)throw Error('The General source quote editable copy could not be found exactly.');
  return {figure,direct,quote,author,headingCopy,quoteCopies,authorCopy,portrait,jumpCopies};
}
function assignSemanticIds(parts){
  const copies=[parts.headingCopy,...parts.quoteCopies,parts.authorCopy,...parts.jumpCopies];
  copies.forEach((node,index)=>setAttr(node,'data-funnel-edit-id',`LG-02-text-${String(index+1).padStart(3,'0')}`));
  setAttr(parts.portrait,'data-funnel-edit-id','LG-02-image-001');
}

function transform(html){
  if(typeof html!=='string')throw Error('Prepared design needs saved HTML.');
  let document=parse5.parse(html);
  let section=exact(nodes(document).filter(node=>attr(node,'data-funnel-section-id')==='LG-02'),
    'The General source quote could not be found exactly once.');
  const before=protectedState(section);
  if(nodes(section).some(node=>attr(node,'data-funnel-prepared-layout')===metadata.id)) {
    throw Error('This corrected Srini design is already on this variation.');
  }
  let parts=semanticNodes(section);
  const oldStyles=nodes(section).filter(node=>attr(node,'data-funnel-prepared-layout')===srini01.metadata.id);
  if(oldStyles.length===0) {
    if(parts.direct.indexOf(parts.quote)>parts.direct.indexOf(parts.author)) {
      throw Error('The General source quote order is not safe to prepare.');
    }
    document=parse5.parse(srini01.transform(html));
    section=exact(nodes(document).filter(node=>attr(node,'data-funnel-section-id')==='LG-02'),
      'The prepared General source quote could not be found exactly once.');
    parts=semanticNodes(section);
  } else {
    if(oldStyles.length!==1||parts.direct.indexOf(parts.author)>parts.direct.indexOf(parts.quote)) {
      throw Error('The existing General source quote design is not safe to correct.');
    }
  }
  const prepared=protectedState(section);
  assertSourceSets(before,prepared);
  const style=exact(nodes(section).filter(node=>attr(node,'data-funnel-prepared-layout')===srini01.metadata.id),
    'The General source quote design style could not be found exactly once.');
  setAttr(style,'data-funnel-prepared-layout',metadata.id);
  assignSemanticIds(parts);
  assertProtected(prepared,protectedState(section));
  return parse5.serialize(document);
}

module.exports={metadata,transform};
