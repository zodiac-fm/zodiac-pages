/* Self-test for balance-engine.js — run: node balance-engine.test.js
   Uses real prototype song lengths and real scenarios (progress week, playlist
   projection, "how many to add", the cascade, window filtering, empty state). */
var Z = require('./balance-engine.js');
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
}
var M = 60; // seconds per minute

// --- catalog: every song exists in all four frequencies (same music, diff Hz) ---
var LENS = { 'quiet-success': 3*M, 'kindred': 5*M, 'elysian': 5*M, 'starseed': 9*M,
             'astrolith': 9*M, 'cosmic-drift': 25*M, 'galactic': 60*M };
var catalog = [];
Z.FREQS.forEach(function (f) {
  Object.keys(LENS).forEach(function (s) { catalog.push({ freq: f, sec: LENS[s] }); });
});

// fixed "now" = Thursday 2026-07-09 (week started Monday 2026-07-06), so tests are deterministic
var NOW = new Date(2026, 6, 9, 12, 0, 0, 0).getTime();
var DAY = 86400000;

console.log('\n1) toSec parses the card strings');
ok('9 min -> 540', Z.toSec('9 min') === 540, Z.toSec('9 min'));
ok('1 hour -> 3600', Z.toSec('1 hour') === 3600, Z.toSec('1 hour'));
ok('number passthrough', Z.toSec(300) === 300);

console.log('\n2) PROGRESS view — the week that happened (no projection)');
// listened this week: heavy Core + Love, thin Vitality + Abundance
var events = [
  { freq: 'core', sec: 40*M, at: NOW - 1*DAY },
  { freq: 'love', sec: 40*M, at: NOW - 1*DAY },
  { freq: 'vitality', sec: 5*M, at: NOW - 2*DAY },
  { freq: 'abundance', sec: 5*M, at: NOW - 2*DAY },
  { freq: 'vitality', sec: 60*M, at: NOW - 8*DAY } // LAST week -> must be excluded
];
var wk = Z.compute({ events: events, catalog: catalog, now: NOW });
ok('last-week event excluded (vitality stays 5 min)', wk.played.vitality === 5*M, wk.played.vitality);
ok('total = 90 min', wk.total === 90*M, wk.total);
ok('core share 44.4%', Math.abs(wk.byFreq.core.share - 0.4444) < 0.001, wk.byFreq.core.share);
ok('not balanced', wk.balanced === false);
ok('neediest is vitality', wk.primary && wk.primary.freq === 'vitality', wk.primary && wk.primary.freq);

console.log('\n3) "how many to add" — and it actually clears the floor');
var need = wk.primary.songsToAdd;
ok('recommends adding 2 vitality', need === 2, need);
// simulate the user adding that many median-length vitality songs (9 min each)
var repVit = Z.repLenByFreq(catalog).vitality;
ok('representative vitality length = 9 min (median, not the 1-hr avg)', repVit === 9*M, repVit);
var afterVit = Z.compute({
  events: events, catalog: catalog, now: NOW,
  projection: [{ freq: 'vitality', sec: repVit }, { freq: 'vitality', sec: repVit }]
});
ok('vitality now clears 15%', afterVit.byFreq.vitality.share >= 0.15, afterVit.byFreq.vitality.share);

console.log('\n4) the cascade — fixing one reveals the next neediest');
ok('now the neediest is abundance', afterVit.primary && afterVit.primary.freq === 'abundance', afterVit.primary && afterVit.primary.freq);
var addAb = afterVit.primary.songsToAdd;
var afterBoth = Z.compute({
  events: events, catalog: catalog, now: NOW,
  projection: [
    { freq: 'vitality', sec: repVit }, { freq: 'vitality', sec: repVit },
    { freq: 'abundance', sec: 9*M * addAb }
  ]
});
ok('adding both brings the week into balance', afterBoth.balanced === true, JSON.stringify(shares(afterBoth)));

console.log('\n5) PLAYLIST view — projection flips the state live');
var projected = Z.compute({
  events: events, catalog: catalog, now: NOW,
  projection: [{ freq: 'vitality', sec: 18*M }, { freq: 'abundance', sec: 18*M }]
});
ok('checked playlist makes the week balanced', projected.balanced === true, JSON.stringify(shares(projected)));

console.log('\n6) empty state — nothing played, nothing queued');
var empty = Z.compute({ events: [], catalog: catalog, now: NOW });
ok('empty flagged, not balanced, no crash', empty.empty === true && empty.balanced === false);

console.log('\n7) all-time window (window:null) counts every event');
var allTime = Z.compute({ events: events, catalog: catalog, now: NOW, window: null });
ok('all-time includes last week (vitality 65 min)', allTime.played.vitality === 65*M, allTime.played.vitality);

function shares(r) { var o = {}; r.freqs.forEach(function (f) { o[f] = Math.round(r.byFreq[f].share*100) + '%'; }); return o; }

console.log('\n----------------------------------------');
console.log(fail === 0 ? ('ALL ' + pass + ' CHECKS PASS') : (fail + ' FAILED, ' + pass + ' passed'));
console.log('----------------------------------------\n');
process.exit(fail === 0 ? 0 : 1);
