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

  // ---- how many MORE seconds of a short frequency are needed to clear the floor.
  //      Adding time raises that frequency AND the total, so it is not just
  //      "fill the gap". Adding S seconds clears when (x + S)/(T + S) >= p, i.e.
  //         S >= (pT - x) / (1 - p)
  //      deficitSec = pT - x (seconds short of the floor at the current total). ----
  function neededSec(deficitSec, floor) {
    floor = floor != null ? floor : FLOOR;
    return deficitSec > 0 ? deficitSec / (1 - floor) : 0;
  }

  // ---- pick the REAL songs to add, using each candidate's EXACT length.
  //      Returns the set of available songs whose exact lengths sum to at least
  //      `need`, with the LEAST overshoot (tie: fewest songs). This lands on the
  //      tightest honest answer ("add these one or two") and names them, instead
  //      of guessing an average song length.
  //      available: [{slug?, name?, freq?, sec}] candidate songs (exact seconds). ----
  function bestAdditions(need, available) {
    var pool = (available || []).filter(function (s) { return s && (s.sec || 0) > 0; });
    if (need <= 0) return { songs: [], count: 0, addedSec: 0, cleared: true };
    // small catalogs per frequency -> exact search; guard against a huge pool.
    if (pool.length > 18) {
      var asc = pool.slice().sort(function (a, b) { return a.sec - b.sec; }), pick = [], sum = 0;
      for (var i = 0; i < asc.length && sum < need; i++) { pick.push(asc[i]); sum += asc[i].sec; }
      return { songs: pick, count: pick.length, addedSec: sum, cleared: sum >= need };
    }
    var best = null, n = pool.length;
    for (var mask = 1; mask < (1 << n); mask++) {
      var s = 0, songs = [];
      for (var b = 0; b < n; b++) if (mask & (1 << b)) { s += pool[b].sec; songs.push(pool[b]); }
      if (s >= need && (!best || s < best.addedSec || (s === best.addedSec && songs.length < best.count)))
        best = { songs: songs, count: songs.length, addedSec: s, cleared: true };
    }
    if (best) return best;
    var all = pool.reduce(function (a, x) { return a + x.sec; }, 0);
    return { songs: pool.slice(), count: pool.length, addedSec: all, cleared: false }; // catalog can't clear it
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

    // 4) recommendation: neediest frequency + the real songs to add (exact lengths).
    //    available = catalog songs of that frequency; caller can pre-filter out
    //    songs already queued so it never suggests a duplicate.
    var catalog = input.catalog || [];
    res.shortfalls.forEach(function (sf) {
      var avail = catalog.filter(function (s) { return s && s.freq === sf.freq; });
      sf.neededSec = neededSec(sf.deficitSec, floor);
      var pick = bestAdditions(sf.neededSec, avail);
      sf.suggest = pick.songs;        // the actual songs, each with its exact sec
      sf.songsToAdd = pick.count;     // how many that is
      sf.addsSec = pick.addedSec;     // exact minutes those songs add
      sf.canClear = pick.cleared;     // false if the catalog can't get this freq to 15%
    });
    res.primary = res.shortfalls[0] || null;

    res.window = window;
    res.played = played;   // week-to-date before the projection, handy for UIs
    return res;
  }

  // ---- the WHOLE fix at once. Because filling one frequency shrinks the others'
  //      share, short frequencies must be solved together or a razor-tight fill
  //      pushes a neighbor back under. This walks the neediest frequency, adds the
  //      smallest REAL song that clears it (with slack, so it survives later adds),
  //      recomputes the whole pie, and repeats until every frequency holds >=15%.
  //      Returns the exact list of songs to add. Never suggests the same song twice. ----
  function plan(input) {
    input = input || {};
    var freqs = input.freqs || FREQS;
    var floor = input.floor != null ? input.floor : FLOOR;
    var window = input.window !== undefined ? input.window
      : weekWindow(input.now != null ? input.now : Date.now());
    var played = timeUnderFrequency(input.events, window, freqs);
    var proj = {}; freqs.forEach(function (f) { proj[f] = played[f]; });
    (input.projection || []).forEach(function (p) { if (p && p.freq in proj) proj[p.freq] += (p.sec || 0); });
    var catalog = input.catalog || [];
    var used = {};
    (input.projection || []).forEach(function (p) { if (p && p.slug) used[p.freq + '|' + p.slug] = true; });
    var additions = [], guard = 0;
    while (guard++ < 500) {
      var res = balanceOf(proj, { floor: floor, freqs: freqs });
      if (res.empty || res.balanced) break;
      var sf = res.shortfalls[0];
      var avail = catalog.filter(function (s) { return s && s.freq === sf.freq && !used[sf.freq + '|' + (s.slug || s.name)]; });
      if (!avail.length) break; // the catalog can't lift this frequency to the floor
      var need = neededSec(sf.deficitSec, floor);
      var asc = avail.slice().sort(function (a, b) { return a.sec - b.sec; });
      var pick = null;
      for (var i = 0; i < asc.length; i++) { if (asc[i].sec >= need) { pick = asc[i]; break; } }
      if (!pick) pick = asc[asc.length - 1]; // none clears it alone -> take the longest, loop again
      used[sf.freq + '|' + (pick.slug || pick.name)] = true;
      additions.push(pick);
      proj[sf.freq] += pick.sec;
    }
    var fin = balanceOf(proj, { floor: floor, freqs: freqs });
    return { additions: additions, balanced: fin.balanced, byFreq: fin.byFreq, total: fin.total };
  }

  return {
    FREQS: FREQS, FLOOR: FLOOR,
    toSec: toSec, weekWindow: weekWindow,
    timeUnderFrequency: timeUnderFrequency, balanceOf: balanceOf,
    neededSec: neededSec, bestAdditions: bestAdditions, compute: compute, plan: plan
  };
});
