/* Self-test for balance-engine.js — run: node balance-engine.test.js
   Real prototype song lengths, real scenarios. Suggestions use EXACT song
   lengths and name real songs (no average/median guessing). */
var Z = require('./balance-engine.js');
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '   got: ' + extra : '')); }
}
var M = 60; // seconds per minute

// --- catalog: every song exists in all four frequencies (same music, diff Hz),
//     each with its EXACT length. ---
var SONGS = [
  ['quiet-success', 'Quiet Success', 3*M], ['kindred', 'Kindred Spirits', 5*M],
  ['elysian', 'Elysian Surge', 5*M], ['starseed', 'Starseed', 9*M],
  ['astrolith', 'Astrolith', 9*M], ['cosmic-drift', 'Cosmic Drift', 25*M],
  ['galactic', 'Galactic Deep', 60*M]
];
var catalog = [];
Z.FREQS.forEach(function (f) {
  SONGS.forEach(function (s) { catalog.push({ slug: s[0], name: s[1], freq: f, sec: s[2] }); });
});

// fixed "now" = Thursday 2026-07-09 (week started Monday 2026-07-06) -> deterministic
var NOW = new Date(2026, 6, 9, 12, 0, 0, 0).getTime();
var DAY = 86400000;
function shares(r) { var o = {}; r.freqs.forEach(function (f) { o[f] = Math.round(r.byFreq[f].share*100) + '%'; }); return o; }
function applySuggest(sf) { return sf.suggest.map(function (s) { return { freq: sf.freq, sec: s.sec }; }); }

console.log('\n1) toSec parses the card strings');
ok('9 min -> 540', Z.toSec('9 min') === 540, Z.toSec('9 min'));
ok('1 hour -> 3600', Z.toSec('1 hour') === 3600, Z.toSec('1 hour'));

console.log('\n2) PROGRESS view — the week that happened (no projection), exact totals');
var events = [
  { freq: 'core', sec: 40*M, at: NOW - 1*DAY },
  { freq: 'love', sec: 40*M, at: NOW - 1*DAY },
  { freq: 'vitality', sec: 5*M, at: NOW - 2*DAY },
  { freq: 'abundance', sec: 5*M, at: NOW - 2*DAY },
  { freq: 'vitality', sec: 60*M, at: NOW - 8*DAY } // LAST week -> excluded from this week
];
var wk = Z.compute({ events: events, catalog: catalog, now: NOW });
ok('last-week event excluded (vitality = 5 min exactly)', wk.played.vitality === 5*M, wk.played.vitality);
ok('total = 90 min exactly', wk.total === 90*M, wk.total);
ok('not balanced', wk.balanced === false);
ok('neediest is vitality', wk.primary && wk.primary.freq === 'vitality', wk.primary && wk.primary.freq);

console.log('\n3) SUGGESTION uses exact lengths + names real songs');
ok('needs 10.0 more Vitality-minutes (600s) to clear 15%', Math.round(wk.primary.neededSec) === 600, Math.round(wk.primary.neededSec));
ok('suggests real, named songs', wk.primary.suggest.every(function (s) { return s.name && s.sec > 0; }),
   wk.primary.suggest.map(function (s) { return s.name + '(' + s.sec/M + 'm)'; }).join(' + '));
ok('tightest fit = two 5-min songs, 600s added exactly', wk.primary.addsSec === 600 && wk.primary.songsToAdd === 2,
   wk.primary.songsToAdd + ' songs / ' + wk.primary.addsSec + 's');
// apply the exact suggestion and confirm Vitality clears the floor
var afterVit = Z.compute({ events: events, catalog: catalog, now: NOW, projection: applySuggest(wk.primary) });
ok('applying the suggested songs clears Vitality (>=15%)', afterVit.byFreq.vitality.meetsFloor === true, Math.round(afterVit.byFreq.vitality.share*1000)/10 + '%');

console.log('\n4) plan() — solve ALL short frequencies together (survives the cascade)');
ok('single-freq neediest after a tight Vitality fill is Abundance', afterVit.primary && afterVit.primary.freq === 'abundance', afterVit.primary && afterVit.primary.freq);
var p = Z.plan({ events: events, catalog: catalog, now: NOW });
function shares2(r) { var o = {}; Z.FREQS.forEach(function (f) { o[f] = Math.round(r.byFreq[f].share*100) + '%'; }); return o; }
ok('the joint plan actually reaches balance', p.balanced === true, JSON.stringify(shares2(p)));
ok('and it is a short list (<= 3 songs), named', p.additions.length <= 3 && p.additions.every(function (s) { return s.name; }),
   p.additions.map(function (s) { return s.freq + ':' + s.name + '(' + s.sec/M + 'm)'; }).join(' + '));

console.log('\n5) PLAYLIST view — a checked playlist flips the state live');
var projected = Z.compute({
  events: events, catalog: catalog, now: NOW,
  projection: [{ freq: 'vitality', sec: 18*M }, { freq: 'abundance', sec: 18*M }]
});
ok('checked playlist makes the week balanced', projected.balanced === true, JSON.stringify(shares(projected)));

console.log('\n6) bestAdditions picks least-overshoot exact set directly');
var b = Z.bestAdditions(600, catalog.filter(function (s) { return s.freq === 'vitality'; }));
ok('600s need -> exactly 600s of real songs', b.addedSec === 600 && b.cleared === true, b.addedSec);
var b2 = Z.bestAdditions(200, catalog.filter(function (s) { return s.freq === 'vitality'; }));
ok('200s need -> one 3-min song (180s is short, next real fit 300s)', b2.addedSec === 300 && b2.count === 1, b2.addedSec + '/' + b2.count);

console.log('\n7) empty state — nothing played, nothing queued, no crash');
var empty = Z.compute({ events: [], catalog: catalog, now: NOW });
ok('empty flagged, not balanced', empty.empty === true && empty.balanced === false);

console.log('\n8) all-time window (window:null) counts every event exactly');
var allTime = Z.compute({ events: events, catalog: catalog, now: NOW, window: null });
ok('all-time includes last week (vitality 65 min)', allTime.played.vitality === 65*M, allTime.played.vitality);

console.log('\n----------------------------------------');
console.log(fail === 0 ? ('ALL ' + pass + ' CHECKS PASS') : (fail + ' FAILED, ' + pass + ' passed'));
console.log('----------------------------------------\n');
process.exit(fail === 0 ? 0 : 1);
