#!/usr/bin/env node
'use strict';

// Run from any repository. Credentials stay in the process environment.
const fs = require('node:fs/promises');
const ENDPOINT = 'https://zodiac-pages.vercel.app/api/funnel-tracker';
const PRODUCTION_ENDPOINT = 'https://zodiac-pages.vercel.app/api/funnel-production';
const REVIEW_ENDPOINT = 'https://zodiac-pages.vercel.app/api/funnel-review';

async function run(args, {token = process.env.FUNNEL_TRACKER_TOKEN, fetcher = fetch, output = console.log} = {}) {
  const [command, sectionId, file] = args;
  if (!['list', 'show', 'draft', 'pages', 'working', 'edit-text'].includes(command)) {
    throw new Error('Use list, show SECTION, draft SECTION /path/to/revision.json, or pages [FAMILY] [VARIANT]. Sign in to the tracker and create a temporary Hermes connection first.');
  }
  if (typeof token !== 'string' || !token || /\s/.test(token)) {
    throw new Error('Set FUNNEL_TRACKER_TOKEN in your private Hermes environment. Create it from your signed-in company account in the tracker.');
  }
  async function request(body, endpoint = ENDPOINT) {
    const response = await fetcher(endpoint, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: {Authorization: `Bearer ${token}`, ...(body ? {'Content-Type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The tracker returned an unreadable response. No save was confirmed.'); }
    if (!response.ok) {
      if (response.status === 401) throw new Error('This connection has expired or is invalid. Sign in to the tracker and create a new temporary Hermes connection.');
      if (response.status === 409) throw new Error('The shared records changed. Run show again, compare the new revision, and update expectedRevision before saving.');
      throw new Error(result.error?.message || 'The tracker could not confirm this request.');
    }
    return result;
  }
  if (command === 'working' || command === 'edit-text') {
    if (!/^draft-(?:lander-[gam]|results-[gam]|bc|join-(?:paid|free))$/.test(sectionId || '')) {
      throw new Error('Choose a working page such as draft-lander-g, draft-results-a, draft-bc, or draft-join-paid.');
    }
    if (command === 'working') {
      if (args.length !== 2) throw new Error('Use working PAGE.');
      const result = await request(null, REVIEW_ENDPOINT+'?action=draft&pageKey='+encodeURIComponent(sectionId));
      output(JSON.stringify({user:result.user,draft:result.draft}, null, 2));
      return;
    }
    if (args.length !== 3 || !file) throw new Error('Use edit-text PAGE /path/to/edit.json.');
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 48 * 1024) throw new Error('Use an edit JSON file smaller than 48 KB.');
    let edit;
    try { edit = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new Error('The edit file must contain valid JSON.'); }
    if (!edit || typeof edit.expectedRevision !== 'string' || !edit.expectedRevision
        || typeof edit.sectionId !== 'string' || typeof edit.editId !== 'string'
        || typeof edit.value !== 'string' || !edit.value.trim()) {
      throw new Error('Include sectionId, editId, expectedRevision and replacement value from the working page metadata.');
    }
    const material = {...(edit.note ? {note:edit.note} : {}), ...(edit.exampleUrl ? {exampleUrl:edit.exampleUrl} : {})};
    const result = await request({pageKey:sectionId,sectionId:edit.sectionId,editId:edit.editId,
      expectedRevision:edit.expectedRevision,operation:{type:'text',value:edit.value},material}, REVIEW_ENDPOINT+'?action=draft-edit');
    output(JSON.stringify({saved:true,user:result.user,draft:result.draft}, null, 2));
    return;
  }
  if (command === 'pages') {
    if (args.length > 3) throw new Error('Use pages [FAMILY] [VARIANT].');
    const family = sectionId || null;
    const variant = file || null;
    if ((family && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(family)) || (variant && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(variant))) {
      throw new Error('Use an identifier-style FAMILY or VARIANT filter.');
    }
    const result = await request(null, PRODUCTION_ENDPOINT);
    if (!Array.isArray(result.targets)) throw new Error('The production tracker returned incomplete page records.');
    const targets = result.targets.filter(target =>
      (!family || target.family === family) && (!variant || target.variant === variant)
    );
    output(JSON.stringify({user:result.user, status:result.status, targets}, null, 2));
    return;
  }
  if (command === 'list') {
    if (args.length !== 1) throw new Error('Use list without extra arguments.');
    const result = await request();
    output(JSON.stringify({revision: result.revision, user: result.user, sections: result.data.sections.map(s => ({id:s.id,name:s.name,family:s.family,variant:s.variant,latestVersion:s.versions.at(-1).number,liveVersionId:s.live?.versionId || null}))}, null, 2));
    return;
  }
  if (!sectionId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(sectionId)) throw new Error('Choose a section identifier from list.');
  if (command === 'show') {
    if (args.length !== 2) throw new Error('Use show SECTION.');
    const result = await request();
    const section = result.data.sections.find(s => s.id === sectionId);
    if (!section) throw new Error('That section was not found. Use list for available sections.');
    output(JSON.stringify({expectedRevision:result.revision,section,events:result.data.events.filter(e=>e.sectionId===sectionId)}, null, 2));
    return;
  }
  if (args.length !== 3 || !file) throw new Error('Use draft SECTION /path/to/revision.json.');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 48 * 1024) throw new Error('Use a revision JSON file smaller than 48 KB.');
  let input;
  try { input = JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new Error('The revision file must contain valid JSON.'); }
  if (!input || typeof input.expectedRevision !== 'string' || !input.expectedRevision) throw new Error('Include expectedRevision from show so a newer change cannot be overwritten.');
  const payload = {summary:input.summary,content:input.content,previewUrl:input.previewUrl,...(input.repositoryRef ? {repositoryRef:input.repositoryRef} : {})};
  const result = await request({action:'revision',sectionId,expectedRevision:input.expectedRevision,payload});
  output(JSON.stringify({saved:true,revision:result.revision,event:result.event,user:result.user}, null, 2));
}

if (require.main === module) run(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {run};
