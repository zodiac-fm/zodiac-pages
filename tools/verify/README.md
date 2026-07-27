# verify — visual-verification camera

Mechanical lane, no model judgment. Takes real screenshots and video of a page
running in actual Chrome, so you have proof of what a page looks like instead
of a guess. Built for scroll-film / mobile-first pages but works on anything.

**Scope:** this kit COMPLEMENTS the vault's canonical `code/see.py` — it does
not replace it. `see.py` (true-viewport stamped screenshot) remains the
mandatory gate named in the vault workflows before showing Michael any design.
This kit adds what see.py doesn't do: the scroll-smoothness (jank) gate, the
collision sweep contact sheet, the scroll-through teaser video, and the
strict `?jump`/`__ready` dev-contract harness for new builds.

## Setup

Needs installed on this machine: **Google Chrome** and **ffmpeg** (already present
at `/Applications/Google Chrome.app` and on PATH respectively — override the
Chrome path with `CHROME_PATH=/path/to/chrome` if it's somewhere else).

```
cd tools/verify
npm i
```

That installs `puppeteer-core` into `node_modules`. Puppeteer-core does not
bundle its own Chromium — it drives your real installed Chrome, which is what
lets it see pages the same way a phone/browser would (host preview panes throttle
hidden tabs and freeze animations; this path is immune to that).

## Commands

All commands take a URL — point them at anything running on localhost or a
public page.

### shot — desktop screenshot
```
node verify.js shot http://localhost:8317/funnel/mcewen-edit/03-results-30-calculated-profile.html out.png
```
Optional width/height args after `out.png` (defaults 1440x900).

### mshot — phone-viewport screenshot
```
node verify.js mshot http://localhost:8317/funnel/mcewen-edit/03-results-30-calculated-profile.html out-mobile.png
```
Fixed at 390x844, DPR2, touch-emulated — the real target viewport for a
mobile-first build.

### jank — scroll-through smoothness test
```
node verify.js jank http://localhost:8317/funnel/mcewen-edit/03-results-30-calculated-profile.html --mobile
```
Scrolls the page programmatically and reports frame-time p95/max. `--mobile`
throttles the CPU 4x to approximate mid-range hardware instead of judging on
an M-series Mac. Prints PASS or JANK and exits non-zero on failure.

### sweep — contact sheet of evenly spaced scroll positions
```
node verify.js sweep http://localhost:8317/funnel/mcewen-edit/03-results-30-calculated-profile.html out/sweep 10
```
Takes `count` (default 10) screenshots at evenly spaced scroll positions, then
tiles them into `out/sweep/contact-sheet.png` with visible padding/margin
between tiles (`tile=CxR:padding=12:margin=12:color=0x333333`) so adjacent
screenshots can never read as one continuous, overlapping image — each frame
is clearly its own tile. One glance shows the whole page's scroll journey.

### teaser — 9:16 scroll-through video
```
node verify.js teaser http://localhost:8317/funnel/mcewen-edit/03-results-30-calculated-profile.html teaser.mp4 12
```
The `seconds` argument sets the pace:
- **~12s** = promo pace (Reels/TikTok speed, fast eased scroll)
- **40–60s** = readable pace (slow enough a human could actually read the copy while it plays)

Optional 5th arg `endFraction` (0–1, default 1) stops the scroll short of the
footer if you want to end on a specific "money shot" instead of the bottom of
the page.

## RELAXED mode

By default this harness refuses to capture anything until the page signals
`window.__ready === true` (the "dev contract," below) — it will error out
rather than hand you a screenshot of a half-loaded page.

Most **live/shipped pages were never built with that contract**, so testing
them normally would just fail. Set `RELAXED=1` to relax the wait: it still
waits up to 12s for `__ready`, but if the signal never comes it prints a
warning and proceeds anyway instead of throwing.

```
RELAXED=1 node verify.js sweep http://localhost:8317/some/live-page.html out/sweep 10
```

**Use RELAXED=1 to audit existing/shipped pages. Never retrofit the dev
contract onto a live page just to satisfy this tool — the contract below is
for NEW builds only.**

## The dev contract (paste into NEW builds only)

Add this script block right before `</body>` on any **new** page you want to
verify strictly (without RELAXED=1). It gives the harness two things: a
`?jump=<scrollY>` query param that pre-scrolls the page before it's captured,
and a `window.__ready` flag the harness waits on so it never screenshots a
page mid-load or mid-animation.

```html
<script>
/* DEV CONTRACT — for verify.js tooling. Implements: ?jump=<y> pre-scroll,
   and window.__ready signal. */
(function () {
  var params = new URLSearchParams(location.search);
  var jumpParam = params.get('jump');
  var jumpY = jumpParam !== null ? parseInt(jumpParam, 10) : null;
  if (jumpY !== null && !isNaN(jumpY)) {
    history.scrollRestoration = 'manual';
  }

  function settleAndSignalReady() {
    function doJumpThenReady() {
      if (jumpY !== null && !isNaN(jumpY)) {
        window.scrollTo(0, jumpY);
        // force a scroll event / rAF tick after the jump before signaling ready
        window.dispatchEvent(new Event('scroll'));
        requestAnimationFrame(function () {
          setTimeout(function () { window.__ready = true; }, 500);
        });
      } else {
        setTimeout(function () { window.__ready = true; }, 500);
      }
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(doJumpThenReady);
    } else {
      doJumpThenReady();
    }
  }

  if (document.readyState === 'complete') {
    settleAndSignalReady();
  } else {
    window.addEventListener('load', settleAndSignalReady);
  }
})();
</script>
```

**Rule of thumb:** new builds get the contract baked in from the start and get
verified strictly (no `RELAXED=1`). Live/shipped pages that predate this tool
are audited with `RELAXED=1` and are never edited just to add the contract.

## phone-shell.sh

A separate, unrelated helper: writes a `phone.html` studio-style iPhone frame
around a site for quick desktop preview.

```
./phone-shell.sh /path/to/site-dir http://localhost:8317/some/page.html "Preview title"
open /path/to/site-dir/phone.html
```
