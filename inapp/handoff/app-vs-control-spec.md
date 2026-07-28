# Immersions + Playlist: staging vs the D/E control — exact deltas and fixes

**Compared 2026-07-27.** Control: https://zodiac-pages.vercel.app/inapp/app-D (Immersions) and
`/inapp/app-E?tab=favs` (Playlist). Staging: `develop` @ PR #761, rendered signed-in at 375×812.
Balance/Progress deliberately excluded — still in flight.

Staging files referenced: `src/components/audio/TrackWaveform.tsx`,
`src/components/audio/AudioTrackCard.tsx`, `src/components/immersions/ImmersionsBackground.tsx`,
`src/components/immersions/immersions-wash.ts`, `src/components/immersions/CategoryTabs.tsx`,
`src/lib/audio/waveformShape.ts`, `src/lib/visuals/categoryColors.ts`,
`src/components/favorites/FavoritesGrid.tsx`.

What Abbas already got right and must not be touched: the four category inks are the approved
wheel values, the play-button gradients are wheel core→deep, and all headline/description/descriptor
copy is verbatim. The gaps below are visual, not structural.

---

## A. IMMERSIONS

### A1. Waveforms are invented, not the songs *(the big one — see Part C)*
- **Now:** `waveformShape.ts` seeds bar heights from a hash of the track slug — "no assets or audio
  analysis required". Every wave is fiction; two songs that sound nothing alike can look alike.
- **Control:** every bar is measured from the actual audio file.
- **Fix:** ship `waveform-bars.json` (in this folder) and replace `getWaveformBars()` with a lookup.
  Part C has the full algorithm, the drop-in function, and how to regenerate when songs change.

### A2. Waveform is pastel, not vivid
- **Now:** unplayed bars are `lightCategoryTone(ink, mix = 0.78)` — ink mixed 78% toward white, so
  Core reads as pale lavender on white. One flat colour, no depth.
- **Control:** each bar is a **vertical gradient** from `c2` (top) to `c1` (bottom), drawn as two
  stacked layers — a translucent peak halo at `fill-opacity .38` plus a solid RMS core — and the
  whole SVG carries a band-coloured glow:
  ```css
  filter: drop-shadow(0 1px 4px  color-mix(in srgb, var(--c1) 60%, transparent))
          drop-shadow(0 3px 18px color-mix(in srgb, var(--c1) 38%, transparent));
  ```
- **Fix:** in `TrackWaveform.tsx`, define a `<linearGradient x1=0 y1=0 x2=0 y2=1>` (`c2`→`c1`) in
  `<defs>`, fill the base `<g>` with it instead of `baseFill`, render the halo/core pair per bar, and
  put the drop-shadow filter on the wrapper. **Gradient ids must be static per (category, slug)** —
  see the iOS warning in C4.

### A3. The played state is a flat fill — the Filament is missing
- **Now:** played bars are the same shape clipped and filled solid `categoryInk`.
- **Control:** played bars burn **white-hot** — a per-bar gradient `#FFFFFF → #FFFFFF @95% (55%) → c2`
  — inside the band-coloured glow. It reads as light travelling through the wave.
- **Fix:** add a second gradient (`lg-{category}-{slug}`) with those three stops and set it as the
  played layer's fill instead of the solid ink.

### A4. The playhead is a stick — the Comet is missing
- **Now:** an absolutely-positioned 3×30px ink bar with a white ring.
- **Control:** the **Comet** — a white-hot bubble trailing ten particles of light that fade to nothing.
  This exists specifically so quiet passages stay legible: when bars are 1px tall, the filament is
  invisible and the comet is the only position signal. Exact geometry, ready to paste, in **C3**.
- **Fix:** replace the `showThumb` span with the comet. It can stay outside the SVG as DOM elements or
  move inside; if inside, obey C4.

### A5. The ground is a flat wash, not the aurora
- **Now:** `immersions-wash.ts` builds one `linear-gradient(180deg …)` of category ink at
  14% → 6% → 2% → 0% by 48% of page height; `ImmersionsBackground` dims it while audio plays.
- **Control:** three blurred radial blobs drifting slowly, which is what gives the page depth:
  ```css
  #aurora i  { position:absolute; width:130%; aspect-ratio:1; border-radius:50%; filter:blur(72px); }
  #aurora .b1{ background:var(--c1);    top:-34%; left:-52%;            opacity:.15; animation:dr1 26s ease-in-out infinite alternate }
  #aurora .b2{ background:var(--c2);    bottom:-52%; right:-50%;        opacity:.13; animation:dr2 32s ease-in-out infinite alternate }
  #aurora .b3{ background:var(--csoft); top:44%; left:66%; width:92%;   opacity:.11; animation:dr3 40s ease-in-out infinite alternate }
  ```
  Each `dr*` keyframe is a slow `translate3d` of ±4–8% — nothing more.
- **Fix:** swap the linear gradient for these three layers inside `ImmersionsBackground`, keep the
  existing cross-fade on category change, keep the play-state brightening. Honour
  `prefers-reduced-motion` by freezing the drift (already handled there).

### A6. Cream base is the wrong cream
- **Now:** `APP_BACKGROUND = '#fbf8f3'`. **Control:** `#F6F1E8`. Theirs is lighter and cooler; side by
  side the app looks washed out.
- **Fix:** one constant in `categoryColors.ts`.

### A7. Category pills — unselected still look like buttons
- **Now:** unselected pills are grey filled capsules.
- **Control** (amended 2026-07-27 because coloured/bubbled pills were hard to read):
  ```css
  .pill    { flex:1 1 0; text-align:center; border:none; background:transparent;
             color:#2A2530; font-weight:700; font-size:12px; padding:8px 2px; box-shadow:none }
  .pill.on { background:#fff; color:var(--categoryInk); box-shadow:0 1px 5px rgba(0,0,0,.13) }
  ```
  Unselected = bold charcoal text on the ground, no bubble. Selected = white capsule, ink text.
- **Fix:** `CategoryTabs.tsx`.

### A8. Frequency is missing from the card label
- **Now:** bottom-left reads `● Core`. **Control:** `● Core · 422 Hz` — dot and text in category ink,
  the numeral in Switzer (never the serif). Adopted 2026-07-27; it balances the row against the
  minutes on the right.
- **Fix:** `AudioTrackCard.tsx`, the category row — append `· {hz} Hz` from the user's frequency for
  that category.

### A9. Playing card gets an ink border
- **Now:** `isCurrentTrack` swaps the card border to `var(--card-ink)`, so a coloured rectangle frames
  the row. **Control:** the playing row is marked by filament + comet + glow only; the border never
  changes. Two markers compete.
- **Fix:** drop the conditional border; keep the neutral `#efe6d6`.

### A10. Play affordance is a chip, not a triangle
- **Now:** an 18px circle tinted `ink14` around the play glyph. **Control:** a bare ink triangle,
  no container. Minor, but it is the one that makes the row feel like an app rather than a web list.

### A11. Queue checkbox is charcoal when checked
- **Now:** checked = `#2A2530` fill. **Control:** checked = the row's category ink, so selection reads
  as "this band". Unchecked border matches.

---

## B. PLAYLIST

### B1. No per-band tinted cards *(the defining difference)*
- **Now:** every playlist row is the same white card as Immersions, so a mixed playlist reads as one
  undifferentiated list.
- **Control:** each card carries a radial wash in its own band, which is how you see at a glance that
  the playlist spans four frequencies:
  ```css
  --playlist-wash: color-mix(in srgb, {c2} 45%, {csoft});
  background: radial-gradient(160% 150% at 100% -30%, var(--playlist-wash) 0%, #fff 88%);
  ```
  `c2`/`csoft` per band: Core `#A737C8`/`#D2C8FF` · Love `#CF4090`/`#FFBDC3` ·
  Vitality `#FFC251`/`#FFC392` · Abundance `#46D99A`/`#8FE1BE`.
  Card metrics: `padding: 11px 0`, `margin-bottom: 18px`.
- **Fix:** `FavoritesGrid.tsx` / `AudioTrackCard.tsx` — set the wash from the row's category when the
  card renders in playlist context.

### B2. Reorder affordance is loud
- **Now:** a permanent 6-dot grip on every row plus a "drag to reorder" pill.
- **Control:** hold the row itself to reorder; no persistent grip. If a visible affordance is wanted for
  discoverability, it should be the quiet ⇕ glyph on the right, not a grip column on the left.

### B3. Everything in section A applies here too
A1–A4 (waves, filament, comet), A8 (Hz label), A9 (border), A11 (checkbox) are the same component and
must land on both pages. In the control both lists share one renderer — worth doing the same.

### B4. Already correct
Guide card sits at the bottom of the list ✔ · heart/download top-right ✔ · descriptors row ✔ ·
minutes bottom-right ✔.

---

## C. THE VISUAL ALGORITHM — how a song becomes its picture

Three layers: the **shape** (computed once, offline, from the audio), the **paint** (gradients +
glow), and the **playing state** (filament + comet).

### C1. Shape — offline, from the real audio

Source of truth for audio is the **`immersions` Supabase bucket** (`Song/Song--NNNHz.mp3`), not any
local copy. Any Hz variant of a song gives the same shape; the control uses 422 Hz.

```python
# 1. decode to mono 8 kHz signed 16-bit PCM
#    ffmpeg -i Song--422Hz.mp3 -ac 1 -ar 8000 -f s16le song.raw
W, H       = 320, 26          # SVG viewBox
BAR, GAP   = 2.2, 0.9         # bar width, gap
N          = int(W // (BAR + GAP))   # = 103 bars

# 2. per window of len(samples)//N, three measurements — kept separate on purpose
top[k] = p99(positive samples in window)    # 99th percentile, NOT max: ignores clicks
bot[k] = p99(-negative samples in window)   # measured independently -> asymmetry
rms[k] = sqrt(mean(sample^2))               # the body of the sound

# 3. piecewise stretch, applied to each of the three series
#    Real music sits in a narrow loudness band; a linear map makes every song look the same.
def piecewise_stretch(v, curve=1.3):
    lo, knee, hi = pct(v,5), pct(v,35), pct(v,97)
    quiet zone (v <= knee): 0.30 * ((v-lo)/(knee-lo)) ** 0.8    # quiet detail EXPANDED
    loud  zone (v >  knee): 0.30 + 0.70 * ((v-knee)/(hi-knee)) ** 1.3
    clamp to [0.02, 1.0]

# 4. local contrast: v = mean(window±7) + (v - mean) * 1.5   -> neighbouring bars separate

# 5. emit two rects per bar
#    halo: y = H/2 - top*H/2, height = (top+bot)*H/2, rx 1.1, fill-opacity .38
#    core: height = min(top+bot-0.5, rms*H*0.8), centred at H/2 - height*(top/(top+bot))
```

Why each step matters: **p99** kills transient spikes that would flatten everything else;
**independent top/bottom** is what makes a song asymmetric and individual; the **quiet-zone
sub-range** is why Starseed's near-silent passages still show texture; **local contrast** stops
long ambient stretches turning into a solid bar.

**Delivered ready to use:** `waveform-bars.json` in this folder — all 7 songs × 103 bars, each bar
`[top, bottom, rms]` normalised 0–1. Drop-in replacement:

```ts
import BARS from '@/data/waveform-bars.json';
export function getWaveformBars(slug: string) {
  return BARS[slug] ?? SYNTHETIC_FALLBACK(slug);   // keep the old generator as the fallback
}
```

Regenerate when a song changes or a new one lands — script: `code/staging_see.py`'s sibling
`gen_asym_waves.py` (vault). It is deterministic: same audio in, same picture out.

### C2. Paint

```
per bar, halo rect: fill = url(#wg-{Category}-{slug}) , fill-opacity .38
per bar, core rect: fill = url(#wg-{Category}-{slug})
<linearGradient id="wg-{Category}-{slug}" x1=0 y1=0 x2=0 y2=1>
  <stop offset="0%"   stop-color="{c2}"/>     <!-- lighter band tone on top -->
  <stop offset="100%" stop-color="{c1}"/>     <!-- vivid band tone at the base -->
</linearGradient>
wrapper filter: drop-shadow(0 1px 4px  color-mix(in srgb, {c1} 60%, transparent))
                drop-shadow(0 3px 18px color-mix(in srgb, {c1} 38%, transparent))
```

### C3. Playing state

**Filament** — every bar behind the playhead swaps fill to:
```
<linearGradient id="lg-{Category}-{slug}" x1=0 y1=0 x2=0 y2=1>
  <stop offset="0%"   stop-color="#FFFFFF"/>
  <stop offset="55%"  stop-color="#FFFFFF" stop-opacity=".95"/>
  <stop offset="100%" stop-color="{c2}"/>
</linearGradient>
```

**Comet** — the playhead, drawn at `x = 320 · progress`, `cy = 13`:
```js
// ten trailing particles, then the head — no gradients, no drawn line
for (let i = 10; i >= 1; i--) {
  const t = i / 11, x = xEnd - i * 4.2;          // 4.2px spacing
  if (x < 0) continue;
  circle(x, 13, 3.4 - 2.4 * t, '#FFFFFF', 0.92 * Math.pow(1 - t, 1.6));  // light core
  circle(x, 13, 5.2 - 3.2 * t, c2,        0.26 * (1 - t));               // band halo
}
circle(xEnd, 13, 6.5, c2, 0.30);   // glow
circle(xEnd, 13, 3.4, c1, 1);      // ring
circle(xEnd, 13, 1.7, '#FFFFFF', 1);  // white-hot centre
```
Repaint on `timeupdate`, `play`, `pause`; clear on `ended`. On pause the comet holds position.

### C4. Two hard rules learned the expensive way

1. **Never create SVG gradients dynamically at paint time.** iOS Safari fails to resolve a
   just-created `url(#id)` and paints the shape **solid black** — it cost us a full iteration where a
   "fade-out tail" rendered as a black bar on iPhone and looked fine in desktop Chrome. Declare
   gradients in `<defs>` at render time with **static ids**, or use plain fills. The comet in C3 is
   deliberately gradient-free.
2. **Numerals are always Switzer, never the serif** — Hz values, minutes, tone numbers.

---

## D. Suggested order

1. `waveform-bars.json` + the `getWaveformBars` swap — biggest truth gain, smallest diff (A1).
2. Wave paint: gradient + halo/core + glow (A2), filament (A3), comet (A4).
3. Playlist band washes (B1) — the page reads completely differently after this.
4. Cream (A6), pills (A7), Hz label (A8), border (A9), checkbox (A11).
5. Aurora ground (A5) — most involved, biggest atmosphere payoff.
6. Reorder affordance (B2), play triangle (A10).

Anything ambiguous: the control page is the spec. Open `/inapp/app-D` and `/inapp/app-E?tab=favs`
and read the rendered result — `prototype=spec` is the standing law.
