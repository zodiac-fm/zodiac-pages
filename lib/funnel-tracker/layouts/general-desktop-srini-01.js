'use strict';

const parse5=require('parse5');

const metadata=Object.freeze({
  id:'general-desktop-srini-01',
  title:'Srini photo and byline above the quote',
  family:'lander',variant:'g',sectionId:'LG-02',view:'desktop',
});

const css=`
  @media(min-width:700px){
    [data-funnel-section-id="LG-02"].source-band{padding-block:48px 64px}
    [data-funnel-section-id="LG-02"] .source-quote{padding-top:24px}
    [data-funnel-section-id="LG-02"] .source-author{
      display:grid;grid-template-columns:160px minmax(0,1fr);align-items:center;gap:24px;
      margin:0 0 28px;padding:0;border:0;
    }
    [data-funnel-section-id="LG-02"] .source-author .portrait{width:160px}
  }
`;

function nodes(node){return[node,...(node.childNodes||[]).flatMap(nodes)];}
function attr(node,name){return node.attrs?.find(item=>item.name===name)?.value ?? null;}
function hasClass(node,name){return String(attr(node,'class')||'').split(/\s+/).includes(name);}
function exact(items,message){if(items.length!==1)throw Error(message);return items[0];}
function multiset(root,name){const result=new Map();for(const value of nodes(root).map(node=>attr(node,name)).filter(value=>value!==null))result.set(value,(result.get(value)||0)+1);return result;}
function same(left,right){return left.size===right.size&&[...left].every(([key,value])=>right.get(key)===value);}

function transform(html){
  if(typeof html!=='string')throw Error('Prepared design needs saved HTML.');
  const document=parse5.parse(html);
  const section=exact(nodes(document).filter(node=>attr(node,'data-funnel-section-id')==='LG-02'),
    'The General source quote could not be found exactly once.');
  if(nodes(section).some(node=>attr(node,'data-funnel-prepared-layout')===metadata.id)) {
    throw Error('This Srini design is already on this variation.');
  }
  const before={
    ids:multiset(section,'id'),editIds:multiset(section,'data-funnel-edit-id'),
    hrefs:multiset(section,'href'),images:multiset(section,'src'),
  };
  const figure=exact(nodes(section).filter(node=>node.tagName==='figure'&&hasClass(node,'source-quote')),
    'The General source quote figure could not be found exactly once.');
  const directElements=(figure.childNodes||[]).filter(node=>typeof node.tagName==='string');
  const quote=exact(directElements.filter(node=>node.tagName==='blockquote'),
    'The General source quote text could not be found exactly once.');
  const author=exact(directElements.filter(node=>node.tagName==='figcaption'&&hasClass(node,'source-author')),
    'The General source quote attribution could not be found exactly once.');
  const quoteIndex=figure.childNodes.indexOf(quote),authorIndex=figure.childNodes.indexOf(author);
  figure.childNodes[quoteIndex]=author;
  figure.childNodes[authorIndex]=quote;
  const style=parse5.parseFragment(section,`<style data-funnel-prepared-layout="${metadata.id}">${css}</style>`).childNodes[0];
  style.parentNode=section;
  section.childNodes.push(style);
  const after={
    ids:multiset(section,'id'),editIds:multiset(section,'data-funnel-edit-id'),
    hrefs:multiset(section,'href'),images:multiset(section,'src'),
  };
  if(!same(before.ids,after.ids)||!same(before.editIds,after.editIds)
      ||!same(before.hrefs,after.hrefs)||!same(before.images,after.images)) {
    throw Error('Prepared Srini design changed protected source content.');
  }
  return parse5.serialize(document);
}

module.exports={metadata,transform};
