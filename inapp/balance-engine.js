/* ============================================================================
   Zodiac balance-engine  ·  time under frequency + in balance
   ----------------------------------------------------------------------------
   ONE engine for every view. Seconds in, facts out. No DOM, no copy, no styling.
   Works in the browser (window.ZBalance) and in Node (module.exports) for tests.

   The two primitives that everything composes from:
     timeUnderFrequency(events, window)  ->  seconds per frequency in a window
     balanceOf(secondsByFreq)            ->  shares + which cleared the 15% floor

   Every screen is those two applied to different inputs:
     Progress (what happened):   compute({ events, window })
     Playlist (what-if):         compute({ events, window, projection: checkedSongs })
     Any window / over time:     pass any {start,end}, or loop weeks for a trend.

   Rules (all configurable, these are the defaults):
     - measured by TIME (seconds), never song count
     - floor = 15% per frequency, within the window
     - balanced = every frequency clears the floor
     - the week starts Monday, local time
     - four frequencies: core, love, vitality, abundance (list is not hardcoded
       anywhere but here, so a 5th is a one-line change)
     - songs will be added: the engine holds NO song data. It reads whatever
       catalog/events you hand it, so new songs are just new rows.
   ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZBalance = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var FREQS = ['core', 'love', 'vitality', 'abundance'];
  var FLOOR = 0.15;
  var DAY = 86400000;

  // ---- duration -> seconds. Accepts a number (already seconds) or the card
  //      strings we already show: "9 min", "1 hour", "1.5 hours", "90 sec". ----
  function toSec(d) {
    if (typeof d === 'number') return Math.round(d);
    if (!d) return 0;
    var s = String(d).toLowerCase(), n = parseFloat(s) || 0;
    if (/hour|hr/.test(s)) return Math.round(n * 3600);
    if (/sec/.test(s)) return Math.round(n);
    return Math.round(n * 60); // default unit is minutes
  }

  // ---- the current week [start, end), week starts Monday, local time ----
  function weekWindow(nowMs) {
    var now = new Date(nowMs);
    var mondayOffset = (now.getDay() + 6) % 7;         // Mon=0 ... Sun=6
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 0, 0, 0, 0);
    return { start: start.getTime(), end: start.getTime() + 7 * DAY };
  }

  // ---- seconds per frequency from a listening record, optionally windowed ----
  //      events: [{ freq, sec, at? }]   at = ms timestamp; omit at to always count.
  function timeUnderFrequency(events, window, freqs) {
    freqs = freqs || FREQS;
    var t = {}; freqs.forEach(function (f) { t[f] = 0; });
    (events || []).forEach(function (e) {
      if (!e || !(e.freq in t)) return;
      if (window && e.at != null && (e.at < window.start || e.at >= window.end)) return;
      t[e.freq] += (e.sec || 0);
    });
    return t;
  }

  // ---- balance facts from a per-frequency seconds map ----
  function balanceOf(secByFreq, opts) {
    opts = opts || {};
    var floor = opts.floor != null ? opts.floor : FLOOR;
    var freqs = opts.freqs || FREQS;
    var total = freqs.reduce(function (a, f) { return a + (secByFreq[f] || 0); }, 0);
    var byFreq = {};
    freqs.forEach(function (f) {
      var sec = secByFreq[f] || 0;
      var share = total > 0 ? sec / total : 0;
      byFreq[f] = { sec: sec, share: share, meetsFloor: total > 0 && share >= floor };
    });
    var balanced = total > 0 && freqs.every(function (f) { return byFreq[f].meetsFloor; });
    var shortfalls = freqs
      .filter(function (f) { return total > 0 && byFreq[f].share < floor; })
      .map(function (f) { return { freq: f, share: byFreq[f].share, deficitSec: floor * total - byFreq[f].sec }; })
      .sort(function (a, b) { return a.share - b.share; }); // neediest first
    return { total: total, byFreq: byFreq, balanced: balanced, empty: total === 0, shortfalls: shortfalls, floor: floor, freqs: freqs };
  }

  // ---- how many songs of a short frequency to add to clear the floor.
  //      Adding a song raises that frequency AND the total, so it is not just
  //      "fill the gap". Solve (x + kL) / (T + kL) >= p  for k:
  //         k >= (pT - x) / (L * (1 - p))
  //      deficitSec = pT - x (seconds short of the floor at the current total).
  //      songLenSec  = a representative length for that frequency. ----
  function songsToAdd(deficitSec, songLenSec, floor) {
    floor = floor != null ? floor : FLOOR;
    if (deficitSec <= 0) return 0;
    if (!songLenSec || songLenSec <= 0) return null; // length unknown -> "add a song", no number
    return Math.max(1, Math.ceil(deficitSec / (songLenSec * (1 - floor))));
  }

  // ---- representative song length per frequency = MEDIAN of the catalog for
  //      that frequency (robust to a lone 1-hour track skewing an average). ----
  function repLenByFreq(catalog, freqs) {
    freqs = freqs || FREQS;
    var buckets = {}; freqs.forEach(function (f) { buckets[f] = []; });
    (catalog || []).forEach(function (s) { if (s && s.freq in buckets) buckets[s.freq].push(s.sec || 0); });
    var out = {};
    freqs.forEach(function (f) {
      var a = buckets[f].slice().sort(function (x, y) { return x - y; });
      out[f] = a.length ? a[Math.floor((a.length - 1) / 2)] : 0;
    });
    return out;
  }

  // ---- the single call a view makes ----
  //   input = {
  //     events,      // the person's listening record: [{freq, sec, at}]
  //     window,      // {start,end}; omit for the current week; pass null for all-time
  //     projection,  // optional: the checked playlist [{freq, sec}] (what-if)
  //     catalog,     // optional: [{freq, sec}] so it can say how many to add
  //     now, floor, freqs
  //   }
  function compute(input) {
    input = input || {};
    var freqs = input.freqs || FREQS;
    var floor = input.floor != null ? input.floor : FLOOR;
    var window = input.window !== undefined ? input.window
      : weekWindow(input.now != null ? input.now : Date.now());

    // 1) time under frequency actually listened, inside the window
    var played = timeUnderFrequency(input.events, window, freqs);

    // 2) project the checked playlist on top (playlist view). No projection = pure retrospective (progress view).
    var proj = {}; freqs.forEach(function (f) { proj[f] = played[f]; });
    (input.projection || []).forEach(function (p) { if (p && p.freq in proj) proj[p.freq] += (p.sec || 0); });

    // 3) balance facts on the projected totals
    var res = balanceOf(proj, { floor: floor, freqs: freqs });

    // 4) recommendation: neediest frequency + how many songs to add
    var rep = repLenByFreq(input.catalog, freqs);
    res.shortfalls.forEach(function (sf) { sf.songsToAdd = songsToAdd(sf.deficitSec, rep[sf.freq], floor); });
    res.primary = res.shortfalls[0] || null;

    res.window = window;
    res.played = played;   // week-to-date before the projection, handy for UIs
    return res;
  }

  return {
    FREQS: FREQS, FLOOR: FLOOR,
    toSec: toSec, weekWindow: weekWindow,
    timeUnderFrequency: timeUnderFrequency, balanceOf: balanceOf,
    songsToAdd: songsToAdd, repLenByFreq: repLenByFreq, compute: compute
  };
});
