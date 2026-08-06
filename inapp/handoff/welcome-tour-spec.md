# Welcome Tour — Developer Specification
**Source:** `/Users/michaellovitch/zodiac-pages/inapp/welcome-3q.html` (1557 lines, version badge `W-3q`)
**Dependency:** `balance-engine.js` (same directory, loaded via `<script src="balance-engine.js">` in `<head>`)
**Live:** `https://zodiac-pages.vercel.app/inapp/welcome-3q.html`

---

## 1. Tour structure

### Screen order (from `var ORDER` in JS)

| # | id | Internal name | ORDER value |
|---|---|---|---|
| 1 | `s1` | Welcome | 1 |
| 2 | `s1b` | How to Use | 2 |
| 3 | `s1c` | Rhonda Britten proof / tour gate | 3 |
| 4 | `s2` | Immersions lesson (5 reps) | 4 |
| 5 | `s3` | Playlist lesson (2 reps) | 5 |
| 6 | `s5` | Balance Meter lesson (6 reps) | 6 |
| 7 | `s6` | Keys / Your Bands + Barbara | 7 |
| 8 | `s7a` | Your Bands (four frequencies) | 8 |
| 9 | `s7b` | Four Ways Clarity Arrives | 9 |
| 10 | `s8` | Add to Home Screen | 10 |

There is **no `s4`**. All ten live in the DOM simultaneously as `.scr` panels; `show(id)` toggles `.off-l` (translateX(-40px), opacity 0, pointer-events none) on lower-ORDER screens and `.off-r` (translateX(+40px)) on higher-ORDER screens. Transition: `transform .45s ease, opacity .45s ease`; disabled under `prefers-reduced-motion`.

### Forward navigation

| From | Control | Handler | To |
|---|---|---|---|
| s1 | `#startBtn` "Start the tour" | `stopHero(); show('s1b')` | s1b |
| s1b | `#nextHow` "Next" | `show('s1c')` | s1c |
| s1c | `#tourBtn` "Take the Tour" | `show('s2'); setTell()` | s2 |
| s2 | **no button** — auto-advance | when all 5 reps done: `setTimeout(→ show('s3'); enter3(), 900)` | s3 |
| s3 | **no button** — auto-advance | when both reps done: `setTimeout(→ show('s5'); enter5(), 900)` | s5 |
| s5 | **no button** — auto-advance | when all 6 reps done: `setTimeout(→ show('s6'), 2000)` | s6 |
| s6 | `#nextBtn6` "Next: Your Bands ›" | `show('s7a')` | s7a |
| s7a | `#nextBtn7a` "Next ›" | `show('s7b')` | s7b |
| s7b | `#nextBtn7b` "One Last Step ›" | `show('s8')` | s8 |
| s8 | `.cta8` "Add to Home Screen" | `onclick="return false"` — **inert** | — |

### Back navigation

Every screen except s1 has `<a class="backb" href="#" data-back="…">‹ Back</a>` in `.chrome`. The generic delegate reads `b.closest('.scr').id` and branches:

```
s1b  → restartHero(); show('s1')
s2   → stepBack2()
s3   → stepBack3()
s5   → stepBack5()
s6   → done5.balnow=false; s5Adv=false; show('s5'); setTell5()
else → show(b.dataset.back)     // s1c→s1b, s7a→s6, s7b→s7a, s8→s7b
```

`stepBack2()`: undoes the last completed rep in `REPS` (`lastDone`), re-renders; when none remain → `show('s1c')`.
`stepBack3()`: undoes last `REPS3` rep via `undo3()`; when none remain → `s2Adv=false; done.order=false; show('s2'); setTell()`.
`stepBack5()`: undoes last `REPS5` rep via `undo5()`; when none remain → `s3Adv=false; done3.drag=false; show('s3'); setTell3()`.

Note the declared `data-back` values on s2 (`s1`), s3 (`s2`), s5 (`s3`), s6 (`s5`) are overridden by the branches and never used.

### Skip

`<a class="skip" href="#" data-skip>Skip tour</a>` appears on s1, s1b, s1c, s2, s3, s5, s6, s7a, s7b — **not on s8**. Handler: `window.location.href='app-D.html'`.

### Deep links

```js
if(['#playlist','#balance','#keys','#bands','#install'].indexOf(location.hash)>=0){ … }
```

| Hash | Lands on | Pre-seeded state |
|---|---|---|
| `#playlist` | **s3** | `stopHero()`; all 5 `done` reps true, `s2Adv=true`, `setTell()`; `enter3()` (hearts all songs, builds fav rows). s3 reps **not** done. |
| `#balance` | **s5** | above + all `done3` true, `s3Adv=true`; `enter5()` (builds bal rows). s5 reps **not** done. |
| `#keys` | **s6** | above + Starseed appended (`balAppend(BALSTAGED,false,true)`), `quiet-success` unchecked, `elysian-surge`/`kindred-spirits`/`starseed` checked, all `done5` true, `s5Adv=true`. |
| `#bands` | **s7a** | same seeding as `#keys`. |
| `#install` | **s8** | same seeding as `#keys`. |

---

## 2. Per-screen spec

Entity legend used below: `‹` = `&#8249;`, `›` = `&#8250;`, `✓` = `&#10003;`, `✕` = `&#10005;`, `◉` = `&#9673;`, `♥` = `&#9829;`, `♡` = `&#9825;`, `♫` = `&#9835;`, `·` = `&middot;`, `−` = `&minus;`, `→` = `&rarr;`, `…` = `&hellip;`, curly quotes are `&ldquo;/&rdquo;/&rsquo;`.

---

### Screen 1 — `#s1` Welcome

**Copy, reading order**
1. Chrome right: `Skip tour`
2. `.tick` (34×3px violet gradient rule, no text)
3. H2: `Welcome to Zodiac.fm`
4. `.subtitle`: `The Sound of You`
5. Family strip (aria-hidden): `Core` / `Love` / `Vitality` / `Abundance`
6. CTA: `Start the tour`
7. Testimonial blockquote: `“Zodiac.fm provides another pathway into self-awareness. By becoming more coherent with themselves, people make clearer decisions, relate more authentically, and experience greater presence.”`
8. `Srini Pillay, M.D.` / small: `Harvard-trained psychiatrist, brain-imaging researcher`

**Layout (top→bottom):** `.chrome` (empty `<span>` left, Skip right) → `.head` with inline `style="padding-top:14px"` → `.hero` containing a full-width inline SVG `.herowave` (`viewBox="0 0 320 26"`, `preserveAspectRatio="none"`, height 122px; 88px under `max-height:760px`) → `.famstrip` (4 items, `justify-content:space-between`, colored dot `i` + label) → `.sp1` spacer → `.ctawrap` (`margin-top:26px`) → `.sp2` spacer → `.tm` testimonial (72×72px `border-radius:16px` image left, serif italic quote right) → `.sp3` spacer. Head/hero/CTA are left-aligned; CTA is centered horizontally.

**Interactive behavior**
- The hero waveform + aurora **breathe through all four families**: `famPaint()` rewrites the two `#hg` `<stop stop-color>` values and the aurora's `--c1/--c2/--csoft`, cycling `FAM=['core','love','vitality','abundance']` every **2600 ms** via `setInterval`. `#aurora` carries `.vivid` (b1 opacity .32, b2 .46, b3 .40). Suppressed entirely if `prefers-reduced-motion: reduce`.
- `#hg stop{transition:stop-color 1.3s ease}`; `#aurora i{transition:background 1.4s ease}`.
- Only tappable elements: `Start the tour`, `Skip tour`.
- Returning here from s1b calls `restartHero()`, which restarts the interval and re-adds `.vivid`.

**Forward bar:** `.next` **white pill** — `background:#fff`, `border:1px solid var(--hair)` (`#ddd3c4`), `color:var(--violet)` (`#6521c9`), `padding:16px 46px`, `border-radius:999px`, `font-size:14px; font-weight:700; letter-spacing:.08em; text-transform:uppercase`, `box-shadow:0 2px 12px rgba(26,22,32,.09)`, `:active{transform:scale(.96)}`. Label markup is `Start the tour`; CSS uppercases it to **START THE TOUR**.

---

### Screen 2 — `#s1b` How to Use Zodiac.fm

**Copy, reading order**
1. `‹ Back` … `Skip tour`
2. H2: `How to Use Zodiac.fm`
3. Lede: `Zodiac is a weekly ritual, starting every Monday.`
4. Card 1 label: `Your Weekly Target`
5. Stat tile A: `63+` / `minutes a week,` `<br>` `9 a day on average`
6. Stat tile B: `15%` / `in each frequency,` `<br>` `every week`
7. Caption: `The more you listen in balance, the more profound your results. The average user listens over **40 minutes a day**.` (bold on "40 minutes a day")
8. Card 2 label: `Ideal Listening Devices`
9. Good chips: `✓ Headphones` · `✓ Quality speaker $75+` · `✓ Your car`
10. Bad chips: `✕ Phone speakers` · `✕ Computer speakers`
11. `Stay still, move around, listen while you drive… It is up to you.` (serif italic, 17.5px)
12. Button: `Next`

**Layout:** top-anchored, left-aligned. `.head` (padding-top:2px) → `.howcard` (`margin-top:22px`) containing `.how-lab` + `.wstats` (two flex-1 `.wstat` tiles) + `.howcap` → second `.howcard` with two `.sndrow`s of `.sndchip`s (`.sndrow.bad` mutes them) → `.howfree` → `.gap` → centered `.nextwrap` → 18px spacer. `#s1b{overflow-y:auto}`; heavy compression tier at `max-height:740px` (h2 → 23px, chips/bullets shrink).

**Interactive:** only Back / Skip / Next. Nothing else is tappable.

**Forward bar:** `.next` white pill, label `Next` (renders **NEXT**), sized down on this screen: `#s1b .next{padding:13px 40px;font-size:13px}`.

---

### Screen 3 — `#s1c` Listen and Come Back Home

**Copy, reading order**
1. `‹ Back` … `Skip tour`
2. H2: `Listen and Come Back Home`
3. Blockquote: `“These aren’t just pretty sounds or generic meditation tracks. This is your cosmic blueprint translated into frequency. If you’re tired of living out of tune with yourself, this is your invitation home.”`
4. `Rhonda Britten` / small: `Author of “Fearless Living,” Emmy Award-Winner`
5. Button: `Take the Tour`

**Layout:** `.head` → `.rcard` **centered hero card** (white, `border-radius:20px`, `padding:26px 22px 22px`, `box-shadow:0 10px 30px rgba(26,22,32,.07)`, flex column, `align-items:center`) with an 84×84px circular photo (`object-position:center 22%`, `filter:grayscale(1) contrast(1.05)`), then serif-italic 18.5px quote, then attribution → `.gap` → centered `.ctawrap` → 26px spacer.

Note: the CSS blocks `#s1c .tm{…}` (84×84 image, 22px quote, breathing card) exist but **s1c contains no `.tm` element** — it uses `.rcard`. Those rules are dead.

**Interactive:** Back / Skip / Take the Tour only.

**Forward bar:** `.next` white pill, label `Take the Tour` (**TAKE THE TOUR**).

---

### Screen 4 — `#s2` Immersions lesson (5 reps)

**Static markup copy**
1. `‹ Back` — `.dots#dots` (5 `<i>`) — `Skip tour`
2. `.viewlabel`: `Immersions View`
3. `#tell` (initial, immediately overwritten by `setTell()`): `Tap the Card “Quiet Success” to Play the Song`
4. `#coachTop`: `&nbsp;`
5. Pills: `Core` `Love` `Vitality` `Abundance`
6. `#rows` — three song rows built by `buildRows()`
7. Bottom `#nav` becomes visible: `♫ Immersions` / `◉ My Zodiac` / `♡ Playlist`

**Row content** (per `SONGS`, all three rendered in the *currently selected* category's colors):

| Name | dur | bubbles |
|---|---|---|
| Quiet Success | 3 min | `RESET · CALM · DE-STRESS · UNWIND · GROUND` |
| Kindred Spirits | 5 min | `ENERGY · HAPPY · BRIGHT · FLOW · MOTIVATE` |
| Elysian Surge | 5 min | `ENERGY · MOTIVATE · BUILD · DRIVE · FLOW` |

Row anatomy (grid `28px minmax(0,1fr) 22px`): checkbox `.qbox` | [play triangle / pause bars] + title + 3-bar EQ + `.sic` (download arrow SVG, heart glyph) / waveform SVG / bubbles / `.botrow` = `● {Label} · {hz} Hz` + duration | drag grip (6-dot SVG). Band line reads `Core · 422 Hz`, `Love · 432 Hz`, `Vitality · 579 Hz`, `Abundance · 611 Hz`.

**The 5 reps** (`REPS=['play','cat','heart','dl','order']`), headline text = `pre` + `<span class="cmd">` + `cmd`:

| Rep | Headline (verbatim, rendered) | Cue target (`.hint`) | Dimmed | Completion condition |
|---|---|---|---|---|
| `play` | `Tap the Card “Quiet Success” to **Play the Song**` | row[0] (`.row.hint`) | rows 1–2 | tapping any row that was not already `.playing` |
| `cat` | `Very Nice! Now Tap “Love” to **Switch Frequencies**` | `.pill[data-cat="love"]` with `--hintc:#B90044`, `--hintbg:#FFBDC380` | all other pills + all rows | `setCat()` to a category ≠ previous |
| `heart` | `Perfect. Tap the ♡ to **Add to the Playlist**` (heart in `<span class="glyph">`, `font-size:.68em`) | `.heart` inside `playingRow()` | all other rows | heart toggled **on** |
| `dl` | `Amazing! **Tap the Arrow to Download**` | `.dl` inside `playingRow()` | all other rows | download toggled **on** |
| `order` | `Smooth! **Hold and Drag to Reorder**` | `playingRow()` (whole row) | none | pointer drag > 14px that changes the row's index |

`playingRow()` = `document.querySelector('#rows .row.playing') || document.querySelector('#rows .row')`.

**Other live behavior on this screen**
- `.qbox` toggles freely and writes `SSTATE[slug].q` — never advances a rep.
- Tapping `.grip` returns early (no play toggle).
- Tapping an already-playing row un-plays it (all rows get `.playing` removed, and since `was===true` none is re-added).
- Category switch rebuilds rows, recolors waveform gradient stops, band label, `--rowink`, the aurora `--c1/--c2/--csoft`, and `#stage --cink`; the previously playing slug is restored.
- Bottom nav: tapping `#navMyz` or `#navPl` (the non-`.on` items) writes their `data-navmsg` into `#coachTop`: `My Zodiac holds your frequencies. The tour gets there.` / `Playlist is the next lesson.` `#navImm` is `.on navblink` here and returns early. (`#navImm`'s message `Immersions is the library. You just mastered it.` is therefore unreachable on s2 and reachable on s3/s5.)
- Dots: `#dots i` get `.did` for completed reps and `.now` for the live rep.

**Blink/pulse cues**
- `.row.hint` → `@keyframes rowblink2` 1.05s infinite (border `#efe6d6` → `var(--violet)`, `box-shadow:0 0 0 2px var(--violet), 0 6px 22px rgba(101,33,201,.30)`), plus the row's `.wave` gets `@keyframes waveripple` 1.6s (`scaleY(1) → scaleY(1.22)`).
- `.pill.hint` → `pillblink3` 1.05s (2px ring in `--hintc`, background `--hintbg`, `scale(1.05)`).
- `.sic .heart.hint`/`.dl.hint` → `iconblink2` 1.05s (color → violet, 3px halo, `scale(1.18)`).
- `.dimmed` → `opacity:.32; filter:saturate(.6)`, 0.4s transition.
- `#nav .on.navblink` → `navblink2` 1.1s (`#1A1620` → violet, `scale(1.18)`).
- All animations replaced by static rings under `prefers-reduced-motion`.

**Forward bar: none.** Completing all 5 reps auto-advances after 900 ms.

---

### Screen 5 — `#s3` Playlist lesson (2 reps)

**Static markup copy**
1. `‹ Back` — `.dots#dots3` (2 `<i>`) — `Skip tour`
2. `.viewlabel`: `Playlist View`
3. `#tell3` static (overwritten by `setTell3()` on entry): `Great! Playlist Tab: Tap “Select All” to Queue All Songs` — **note the capital-A "Select All" here; the JS-rendered version uses lowercase "Select all"**
4. `#coachTop3`: `&nbsp;`
5. `.zbal` Frequency Balance Meter bar: four tokens (`Core`/`Love`/`Vitality`/`Abundance` + amount) + chevron button
6. `.zbal-panel` (folds open on tap): `Frequency Balance Meter` / `**Your goal:** At least 63 minutes this week, with all four frequencies green.` / ordered list:
   - `Keep all four frequencies at 15% or more each week. This means you have **Frequency Balance**.`
   - `If all four category numbers above are **green**, completing every checked song will bring your week into **Frequency Balance**.`
   - `Out of songs? Go to **Immersions** and tap ♥ to add more to this list.`
7. `.barrow`: `.selall` = checkbox + label `Select all` (flips to `Clear` when ≥1 checked) | `.qall` = play-triangle SVG + `Play All` + `#qn3` count suffix ` (n)`
8. `#favRows` — three rows, hearts forced on, each in its **own** family color per `FAVCATS`: quiet-success→core, kindred-spirits→love, elysian-surge→vitality
9. `.zbal-pop` bubble (hidden) with `#zbalPopMsg` + `✕` close

**Layout:** top-anchored. `.coach-head` (viewlabel + h2 + coachTop) → `#stage3` (meter bar, barrow, rows) → `.gap`. `#s3` reserves `padding-bottom: env(safe-area-inset-bottom) + 70px` for the pinned `#nav`. At `max-height:820px` the `.bubs` line is hidden and rows/waves compress.

**Entry:** `enter3()` runs once — sets `SSTATE[slug].heart=true` for all three songs, calls `buildFavs()`, then `setTell3()`.

**The 2 reps** (`REPS3=['selall','qcheck']`; a `drag` rep exists in the code path but is not in `REPS3` — see §3):

| Rep | Headline | Cue target | Dimmed | Completion |
|---|---|---|---|---|
| `selall` | `Nice! “Select all” to **Queue All Songs**` | `#selall` (`.selall.hint` → `selblink2`) | all rows | tapping `#selall` when **nothing** was checked (`if(!any)complete3('selall')`) |
| `qcheck` | `Easy! Tap the Checkbox to **Remove “Kindred Spirits” from Queue**` | `.row[data-slug="kindred-spirits"] .qbox` (`qboxblink2`) | all other rows | unchecking that specific box **while `done3.selall` is true** |

**Live meter (real `ZBalance` output, nothing hardcoded)**
`zbalRender()` calls `ZBalance.compute({events:[], window:null, projection:<checked songs>, catalog:[]})`. Each token renders `{Label}` + either `−{ceil(neededSec/60)}m` in `#B90044` or `+{floor((sec − 0.15·total)/60)}m` in `#0A7A52`, plus:
- `+` (`.zbal-add`) when that frequency is short **and** an unchecked song of that frequency exists;
- `−` (`.zbal-min`) when that frequency is over **and** a checked song of that frequency exists.

With nothing checked (total = 0) all four render `+0m` green with no `+`/`−`. After `Select all`: Core `+1m`, Love `+3m`, Vitality `+3m`, Abundance `−3m` (no `+` — no Abundance song in the playlist).

**Other live behavior**
- `.zbal-chevbtn` toggles `.zbal.open` (fold-down goal panel); tapping the panel body closes it.
- `.zbal-min` unchecks that frequency's **largest** checked song. `.zbal-add` runs `ZBalance.bestAdditions(neededSec, avail)` and checks the winning set; if `!pick.cleared` it raises the bubble.
- Tapping a red token that has no addable song raises the bubble: `Not enough **{Label}** songs in your list to get there. Go to **Immersions → {Label}** and tap ♥ to heart more songs.` Auto-hides after **8000 ms**; also closes on `✕` or any outside click (capture-phase listener).
- Tapping a `.heart` → `#coachTop3` says: `That would remove it from your Playlist. Keep it for the lesson.` (the heart is **not** toggled).
- `.dl` toggles freely. `.grip` returns early. Tapping a row body toggles `.playing`.
- `Play All`: plays the first **checked** row; with nothing checked, `#coachTop3` says `Queue a song first. Checked songs play.`
- Drag-to-reorder is wired and functional; it calls `complete3('drag')` when the index changes (see §3 — `'drag'` is not a real rep).
- `#navImm` and `#navMyz` write their `data-navmsg` into `#coachTop3`; `#navPl` is `.on navblink` here.

**Forward bar: none.** Both reps done → 900 ms → s5.

---

### Screen 6 — `#s5` Balance Meter lesson (6 reps)

**Static markup copy**
1. `‹ Back` — `.dots#dots5` (6 `<i>`) — `Skip tour`
2. `.viewlabel`: `Playlist View`
3. `#tell5` static: `Great! Check “Elysian Surge” and Watch Vitality Turn Green`
4. `#coachTop5`: `&nbsp;`
5. Corner strip `#ms5` (right-aligned): `Week:` + `{played total}` + button `Balance Now›`
6. `.zbal#zbal5` meter bar (four tokens + chevron)
7. `.zbal-panel`: `Frequency Balance Meter` / `**Your goal:** At least 63 minutes this week, with all four frequencies green.` / **one** list item: `Keep all four frequencies at 15% or more each week. This means you have **Frequency Balance**.`
8. `#balRows` — rows in DOM order `quiet-success` (Core), `elysian-surge` (Vitality), `kindred-spirits` (Love); `Starseed` (Abundance) is injected mid-lesson at index 1
9. `.zbal-pop#zbalPop5` bubble

**Starseed row data:** `{name:'Starseed', slug:'starseed', dur:'9 min', b:['MEDITATE','DEEP','DREAMY','CALM','UNWIND']}`, category `abundance`, band line `Abundance · 611 Hz`. Its waveform rect data is assigned at runtime into `WAVES['starseed']`.

**The 6 reps** (`REPS5=['check','plus','minus','stuck','newsong','balnow']`):

| Rep | Headline | Cue target | Dimmed | Completion |
|---|---|---|---|---|
| `check` | `Great! Check “Elysian Surge” and **Watch Vitality Turn Green**` | `.row[data-slug="elysian-surge"] .qbox` | all other rows | any `.qbox` tap after which `balRes.byFreq.vitality.meetsFloor` |
| `plus` | `Perfect! **Tap the + on Love to Add a Song**` | `#zbalToks5 .zbal-t[data-freq="love"] .zbal-add` | all rows | tapping that `+` and `balRes.byFreq.love.meetsFloor` afterwards |
| `minus` | `Wow! Core Has Plenty: **Tap Its − to Trim One**` | `…[data-freq="core"] .zbal-min` | all rows | tapping Core's `−` while `rep5cur()==='minus'` |
| `stuck` | `Great! Abundance Is Stuck: **Tap the Red Number**` | `…[data-freq="abundance"]` (whole token) | all rows | tapping the short Abundance token when it has no addable song → bubble shows → `complete5('stuck')`, then after **900 ms** `balAppend(BALSTAGED, true, true)` slides Starseed in |
| `newsong` | `Remember the ♥? We Hearted “Starseed” for You: **Check It**` (heart in `.glyph`) | `.row[data-slug="starseed"] .qbox` | all other rows | checkbox tap after which `balRes.balanced` |
| `balnow` | `All Four Green! Next Time, **Just Tap Balance Now**` | `#ms5 .ms-balnow` | none | tapping `Balance Now›` |

All reps complete → `#tell5` becomes `Already balanced! Next week, one tap does this whole job for you.` and after **2000 ms** `show('s6')`.

**Praise pulses on completion** (`pulseAmt(freq)` = `@keyframes mspulse .85s ease-in-out 2`, `scale(1)→scale(1.55)`):
`check`→Vitality amount, `plus`→Love, `minus`→Core, `newsong`→Abundance. `balnow` and `stuck` pulse nothing. Every `complete5()` also closes the goal panel (`z5.classList.remove('open')`).

**Rep skipping (`rep5ready`)** — a rep whose teachable state no longer exists is silently marked done:
```js
if(rep==='check')  return !balRes.byFreq.vitality.meetsFloor && balHasRow('vitality',false);
if(rep==='plus')   return !balRes.byFreq.love.meetsFloor     && balHasRow('love',false);
if(rep==='minus')  return  balRes.byFreq.core.meetsFloor     && balHasRow('core',true);
if(rep==='newsong')return !balRes.balanced;
return true;                       // 'stuck' and 'balnow' are always "ready"
```
Loop guard: `while(rep && guard++<8 && !rep5ready(rep)){done5[rep]=true; rep=rep5cur();}`

**Corner strip (`#ms5`) rendering**
```js
'<span class="ms-lbl">Week:</span><span class="ms-ind"><i class="ms-txt'+(balRes.balanced?'':' low')+'">'
  + balFmtTotal(balPlayed.total) + '</i></span>'
  + '<button class="ms-balnow" type="button">Balance Now<i>&#8250;</i></button>'
```
The **number** is the played week (never moves); the **color** tracks the *projected* week, so it flips `#B90044` → `#0A7A52` at the all-green moment. The in-file comment calls this "the one deliberate deviation" from app-D, which colors from the played week.

Tapping the strip anywhere other than `Balance Now` calls `pulseWeek()` (same `mspulse` animation on `.ms-txt`) and navigates nowhere. Tapping `Balance Now` out of turn also does nothing but `setTell5()` (`tryComplete5` returns false).

**Other live behavior:** identical `.heart` guard message (`That would remove it from your Playlist. Keep it for the lesson.`), `.dl` toggle, row `.playing` toggle, drag-to-reorder (functional, completes no rep), bubble copy and 8000 ms auto-hide identical to s3.

**Forward bar: none.**

---

### Screen 7 — `#s6` Keys

**Copy, reading order**
1. `‹ Back` … `Skip tour`
2. H2 (inline `style="font-size:29px"`): `Congratulations! You Now Have the Keys to Zodiac.fm`
3. `.keysub` (serif italic 21px): `Saving the best for last…`
4. `.bc-eyebrow`: `A Zodiac.fm Discovery`
5. `.bc-title` (serif 30px): `Your Bands`
6. `.bc-myz`: `**Read about YOUR Bands in My Zodiac ◉.** This is also where you check on your overall time, your balance, what to expect, and so much more.`
7. Blockquote: `“Understanding alone isn’t transformation. It must be felt. Zodiac core frequencies translate this unique imprint into sound, bypassing the mind and speaking directly to the body.”`
8. `Barbara Ditlow` / small: `Human Design Master Practitioner, endorsed by Ra Uru Hu` (with `&nbsp;` between "Ra", "Uru", "Hu")
9. Bar: `Next: Your Bands ›`

**Layout:** `.head` → `.bandcard` (white, centered text, `border-radius:18px`) → `.rcard` **centered hero card** (`#s6 .rcard{margin:auto 0}`, 84×84 circular grayscale photo) → `.lastbar` → 16px spacer. `#s6{overflow-y:auto}`; two compression tiers at 760px and 740px.

**Interactive:** Back / Skip / the bar only.

**Forward bar:** `.lastbar` — **filled violet full-width pill**: `background:var(--violet)` (`#6521c9`), `color:#fff`, `padding:16px 20px`, `border-radius:999px`, `font-size:14px; font-weight:700; letter-spacing:.08em; text-transform:uppercase`, `box-shadow:0 10px 26px rgba(101,33,201,.35)`, `:active{transform:scale(.97)}`. Renders **NEXT: YOUR BANDS ›**.

---

### Screen 8 — `#s7a` Your Bands

**Copy, reading order**
1. `‹ Back` … `Skip tour`
2. H2: `Your Bands`
3. `.keysub`: `How you process each signal.`
4. `.bxlede`: `**A frequency tells you what the signal is. Your band shows how you process it.** That turns a number into an internal compass for all four:`
5. `**Core:** how you process who you are and your life’s purpose.` (dot + bold in `#6521C9`)
6. `**Love:** how you understand who you connect with and how, in romance and every relationship.` (`#B90044`)
7. `**Vitality:** how you sense what feeds your lifeforce and what drains it.` (`#C25500`)
8. `**Abundance:** how you judge which opportunities to take, and when.` (`#0A7A52`)
9. Blockquote: `“Without doing anything but listening, I become a different person. I shift into the version of me I actually want to be. I can tap into different frequencies based on what I need.”`
10. `Joey Vaillancourt` / small: `VP of Marketing, BiOptimizers`
11. Bar: `Next ›`

**Layout:** `.head` → `.bxcard` (white, left-aligned, `border-radius:18px`) with `.frows` → `.tm` **row card** (`#s7a .tm` restyled as a white bordered card, 72×72 `border-radius:16px` image left, serif italic 15px quote right) → `.gap` → `.lastbar` → 16px spacer. `#s7a{overflow-y:auto}`.

**Interactive:** Back / Skip / bar only.

**Forward bar:** `.lastbar` violet pill, **NEXT ›**.

---

### Screen 9 — `#s7b` Four Ways Clarity Arrives

**Copy, reading order**
1. `‹ Back` … `Skip tour`
2. H2: `Four Ways Clarity Arrives`
3. `.keysub`: `Every frequency sits on one spectrum.`
4. Spectrum ticks: `250` `425` `600` `775` `950 Hz`
5. `Feel it` — `Root / Belly` `250 to 425 Hz` — `Clarity through grounding.`
6. `Do it` — `Solar Plexus` `425 to 600 Hz` — `Clarity through drive and action.`
7. `Say it` — `Throat` `600 to 775 Hz` — `Clarity through articulation.`
8. `See it` — `Crown` `775 to 950 Hz` — `Clarity through perspective and systems.`
9. `.bxnote`: `These are not levels: everyone uses all four, and none is higher. Read the full story of YOUR bands in **My Zodiac ◉**.`
10. Blockquote: `“I’m just finishing my first week and I can’t begin to explain how different I feel compared to just 5 days ago. I feel like ME.”`
11. `Amber Hedrick` / small: `Zodiac.fm member`
12. Bar: `One Last Step ›`

**Layout:** `.head` → `.bxcard` containing `.spec` (4 flex segments, `background:#E9E2FA`, 12px tall, `border-radius:7px`, 2px gaps) + `.spectick` + `.brows` (each: 60px-wide violet verb chip on `#EFECFF`, then bold band name + gray Hz + gray descriptor) + `.bxnote` → `.tm` row card (44×44 image, 13.5px quote) → `.gap` → `.lastbar` → 16px spacer. `#s7b{overflow-y:auto}`.

**Interactive:** Back / Skip / bar only.

**Forward bar:** `.lastbar` violet pill, **ONE LAST STEP ›**.

---

### Screen 10 — `#s8` Add to Home Screen

**Copy, reading order**
1. `‹ Back` (no Skip)
2. H2: `Add Zodiac.fm to Your Home Screen`
3. `.lede`: `This will provide you with the app’s full functionality. Do NOT skip. This is important!`
4. CTA: `Add to Home Screen`
5. `Questions? support@zodiac.fm` (mailto link)

**Layout:** `.head` (padding-top:14px) → `.sp1` → centered `.ctawrap` → `.sp2` → centered `.support8` → 34px spacer.

**Interactive:** Back only. The CTA is `onclick="return false"` — **inert in the prototype**. The email link is live (`mailto:support@zodiac.fm`).

**Forward bar:** `.cta8` — **filled violet pill**: `background:var(--violet)`, `color:#fff`, `padding:17px 44px`, `border-radius:999px`, `font-size:14px; font-weight:700; letter-spacing:.08em; text-transform:uppercase`, `box-shadow:0 10px 26px rgba(101,33,201,.35)`. Renders **ADD TO HOME SCREEN**.

---

## 3. Global interaction logic

### State variables

```
// screen
ORDER = {s1:1,s1b:2,s1c:3,s2:4,s3:5,s5:6,s6:7,s7a:8,s7b:9,s8:10}

// s2 (Immersions)
catKey        = 'core'                        // active pill
SSTATE[slug]  = {heart:false, dl:false, q:false}
ORDERARR      = [slug…]                       // row order
done          = {play:false,cat:false,heart:false,dl:false,order:false}
REPS          = ['play','cat','heart','dl','order']
s2Adv         = false                         // auto-advance latch

// s3 (Playlist)
FAVCATS  = {'quiet-success':'core','kindred-spirits':'love','elysian-surge':'vitality'}
FAVORDER = [slug…]
QST[slug]= false                              // queued/checked
done3    = {selall:false, qcheck:false}
REPS3    = ['selall','qcheck']
s3Init, s3Adv = false

// s5 (Balance)
BALWEEK   = {core:1920, love:420, vitality:420, abundance:300}   // seconds
BALEVENTS = [{freq,sec}×4]
BALROWS   = [{core,quiet-success},{vitality,elysian-surge},{love,kindred-spirits}]
BALSTAGED = {cat:'abundance', slug:'starseed'}
done5     = {check,plus,minus,stuck,newsong,balnow : false}
REPS5     = ['check','plus','minus','stuck','newsong','balnow']
balRes, balPlayed = null                      // last ZBalance.compute results
bal5Init, s5Adv = false

// hero
FAM=['core','love','vitality','abundance']; fi=0; heroTimer=null; reduce2=<prefers-reduced-motion>
```

### The rep/lesson engine (one pattern, three instances)

```
setTell{,3,5}():
  clearGuides()                        # strip every .hint and .dimmed in scope
  aux.innerHTML = '&nbsp;'             # clear the cue line
  (s5 only) balRender()                # recompute the meter before deciding
  rep = first r in REPS where !done[r]  # null when all complete
  (s5 only) while rep && guard<8 && !rep5ready(rep): done5[rep]=true; rep = next
  paint dots: .did for done, .now for rep
  if rep == null:
      if !sAdv: sAdv = true; setTimeout(→ show(nextScreen) [+ enterN()], DELAY); 
      (s5 also writes "Already balanced! Next week, one tap does this whole job for you.")
      return
  tell.innerHTML = CMDS[rep].pre + '<span class="cmd">' + CMDS[rep].cmd + '</span>'
  t = target element for rep
  dim(every element except the rep's context)
  t.classList.add('hint')

complete{,3,5}(rep):
  if done[rep]: return                 # EARLY RETURN — idempotent
  done[rep] = true
  (s5 only) close the goal panel
  setTell()                            # praise for rep N opens instruction N+1
  (s5 only) pulseAmt(freq) for check/plus/minus/newsong
```

Auto-advance delays: s2→s3 **900 ms**, s3→s5 **900 ms**, s5→s6 **2000 ms**.

`tryComplete5(rep)` (s5 only): `if(rep5cur()===rep){complete5(rep);return true;} setTell5(); return false;` — a control tapped out of turn still performs its real job but never advances the lesson.

### Cue-text (`say/say3/say5`) logic

Three writers, one per screen, into `#coachTop`, `#coachTop3`, `#coachTop5`. `say5` also resets `c.className=''` (dropping `.intro`). Every `setTell*()` blanks the line to `&nbsp;` first. The line is written only by:
- the nav `data-navmsg` handler, routed by `onScr()`: `onScr('s5')?say5:(onScr('s3')?say3:say)`;
- the heart guard on s3/s5;
- the empty-queue guard on `Play All` (s3).

### Back chain

```
lastDone(reps, flags) → last r in reps order where flags[r]      # else null

stepBack2: undo one done rep (no state repair needed) → setTell(); else show('s1c')
stepBack3: undo3(last) then setTell3(); else s2Adv=false; done.order=false; show('s2'); setTell()
   undo3('selall') → uncheck every .qbox, QST all false, updSel()
   undo3('qcheck') → re-check kindred-spirits, updSel()
stepBack5: undo5(last) then setTell5(); else s3Adv=false; done3.drag=false; show('s3'); setTell3()
   undo5('check')   → uncheck elysian-surge
   undo5('plus')    → uncheck kindred-spirits
   undo5('minus')   → re-check quiet-success
   undo5('stuck')   → hide pop5, remove the Starseed row
   undo5('newsong') → uncheck Starseed
s6 back: done5.balnow=false; s5Adv=false; show('s5'); setTell5()
```

### Scroll behavior

`show()` does **not** reset scroll position on any screen. Scroll is a safety valve only: `.scr{overflow-y:auto;-webkit-overflow-scrolling:touch}` globally, re-asserted for `#s1b,#s1c,#s6,#s7a,#s7b`. `.scr>*{flex-shrink:0}` prevents iOS from compressing children into overlap; `.gap`, `.sp1`, `.sp2`, `.sp3` are the flex absorbers. `html,body{overflow:hidden}`.

### Drag-to-reorder (all three row lists)

Identical handler shape. `pointerdown` on a `.row` arms it; `pointermove` past **14px** sets `dragging`, adds `.dragging` and applies `translateY(dy) scale(1.02)`; `pointerup` measures the dragged row's midpoint against every sibling's midpoint, inserts before the first sibling whose midpoint is below it (else appends), rebuilds the order array, and sets a `suppressClick` latch so the follow-up click is swallowed.

### Ambiguities / dead code worth quoting

1. **`complete3('drag')` targets a rep that does not exist.** In the s3 pointerup:
   ```js
   if(after!==before)complete3('drag');else setTell3();
   ```
   `REPS3` is `['selall','qcheck']` and `done3` is `{selall:false,qcheck:false}`. So a reorder sets `done3.drag=true` (a new key), which `rep3()` never reads. Net effect: reordering only re-runs `setTell3()`. `stepBack5()` also clears `done3.drag=false`. The comment above `done3` says the drag rep "is cut — they already know from Immersions"; this is the leftover.
2. **`toast()` is defined and never called.** `#toast` and `#toast.showing` CSS ship but nothing invokes them. The comment calls it "the Almost toast".
3. **`#nextBtn{color:var(--ink)}`** — there is no element with `id="nextBtn"` (only `nextBtn6/7a/7b`, which are `.lastbar`). So all `.next` pills render violet text, not ink.
4. **`#navImm`'s message is unreachable where it makes sense.** `data-navmsg="Immersions is the library. You just mastered it."` fires only when `#navImm` is not `.on`, i.e. on s3/s5.
5. **`complete5('newsong')` inside the `+` handler** — the `zbal-add` branch can complete `newsong` (`if(rep5cur()==='newsong'&&balRes.balanced)`), meaning the Starseed rep can be satisfied by the bar's `+` rather than the checkbox.
6. **`res3` on s3** is captured but only read by the `.zbal-add` handler; if `zbalRender()` has not run, `res3` is null and `+` is a no-op.

### Prototype-only behavior (NOT part of the spec)

- `<span class="letter">W-3q</span>` — version badge, absolutely positioned `top:46px; right:12px`, 11px, `opacity:.7`, white on `var(--rule)` border.
- `#frame` — fixed phone-sized card: `width:min(420px,100vw); height:min(880px,100dvh)`. At `min-width:440px` it gains `border-radius:30px`, `box-shadow:0 30px 80px rgba(0,0,0,.22)` and a hairline border; page background `#e7e2d8`. At `max-width:439px` it goes edge-to-edge and `body` switches to `align-items:flex-start`.
- `Skip tour` → hard `window.location.href='app-D.html'` (relative prototype file).
- `.cta8` on s8 is `onclick="return false"` — no real Add-to-Home-Screen flow.
- `#nav` is a fake bottom tab bar for the lesson screens only (`.navvis` on s2/s3/s5); tabs never navigate.
- Fonts load from Google Fonts + Fontshare CDNs (`preconnect` + two stylesheets).

---

## 4. Design tokens actually used

### CSS custom properties (`:root`)

| Token | Value | Used for |
|---|---|---|
| `--cream` | `#F6F1E8` | `#frame` background; `.zbal-popx` background |
| `--ink` | `#1a1620` | body text color, `.coach-head h2`, `#narr`(dead), `.how-ul b`, `.done-item`(dead), `.tm .who`, `.rcard .who`, `.bc-title`, `.trow`(dead), `.bxlede b`, `.brow .bl b` |
| `--body` | `#2b2533` | `.lede`, `.lede2`, `.bridge`(dead), `.subtitle` is ink; `.keysub`, `.bxlede`, `.frow p`, `.howcap`, `.howmore`, `.bxnote`, `.bc-myz`, `#coachTop5.intro`, `.howfree` |
| `--mut` | `#756e79` | `.chrome a`, `.tm .who small`, `.viewlabel`, `.wkcap`, `.wstat span`, `.spectick`, `.bhz`, `.brow .bl p`, `.support8`, `#coachTop` (final rule) |
| `--rule` | `#eadfce` | `.letter` border, `.trow+.trow` border-top (dead) |
| `--hair` | `#ddd3c4` | `.next` border, `.tm` border-top, `.chip` border, `.step` border, `.bc-cta` border (dead) |
| `--violet` | `#6521c9` | the single accent — `.tick` gradient start, `#narr .hg`, `.next` text, `#coach .ok`, `.stepeyebrow`, `.step.now`, `.dots i.did`, all `.hint` rings, `.bc-eyebrow`, `.wstat b`, `.sndchip`, `.how-ul li::before`, `.bverb`, `.myzico` in `.bxnote`, `.lastbar` bg, `.cta8` bg, `.support8 a`, `.wkd.on` |
| `--violet-deep` | `#38007a` | declared on `.coach-head h2` at line 201 — **fully overridden** by the later `.coach-head h2{color:var(--ink)}` at line 230. Effectively unused. |
| `--serif` | `"Cormorant Garamond",Georgia,serif` | see fonts below |
| `--sans` | `"Switzer",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif` | default family on `html,body` |

Aurora scope vars, set inline on `#aurora` and rewritten at runtime: `--c1`, `--c2`, `--csoft`. Row scope: `--rowink` (per-row, = the category's `cink`). Hint scope: `--hintc`, `--hintbg` (pill blink), `--tink` (meter token blink), `--fc` (frequency dot/bold on s7a).

### Category palette (`var CATS`)

| Key | label | c1 | c2 | cink | csoft | hz |
|---|---|---|---|---|---|---|
| core | Core | `#6521C9` | `#A737C8` | `#6521C9` | `#D2C8FF` | `422` |
| love | Love | `#B90044` | `#CF4090` | `#B90044` | `#FFBDC3` | `432` |
| vitality | Vitality | `#FF9112` | `#FFC251` | `#C25500` | `#FFC392` | `579` |
| abundance | Abundance | `#12A56E` | `#46D99A` | `#0A7A52` | `#8FE1BE` | `611` |

`#stage` carries `--c1:#6521C9; --c2:#A737C8; --cink:#6521C9; --csoft:#D2C8FF` as its literal defaults. The `#hg` hero gradient literal stops are `#6521C9` → `#A737C8`.

### Every other applied hex

| Hex | Where |
|---|---|
| `#e7e2d8` | page background behind `#frame` |
| `#9a55d7` | `.tick` gradient end |
| `#6a6470` | `.letter` text, `.step .num` text, `.zbal-ol li` text |
| `#2A2530` | `.pill` text, `.qall` bg + border, `.zbal-ol .ph`, `.zbal-pop .ph`, `.zbal-add/.zbal-min` glyph |
| `#efe6d6` | `.row` border, `.done-item` border, `.howcard`/`.bandcard`/`.bxcard`/`.rcard`/`.tcard`/`.trow`-card border |
| `#c2bdc7` | `.qbox` border, `.sic .dl` idle, `.grip`, `.legend .lgbox` border |
| `#948f9a` | `.qbox.on` border, `.qbox.dash` border |
| `#1A1620` | `.qbox.on::after` check stroke, `.qbox.dash::after` bar, `.dl.on`, `.wave-dur`, `.chip.done`, `#nav>div.on`, `.step.did`, `.dots` navblink base, `#toast` bg, `.ms-balnow` |
| `#aaa3b2` | `.sic .heart` idle |
| `#8a8390` | `.bub`, `.chip`, `.step`, `.legend`, `.lgbox` glyph, `.ms-lbl`, `.tipcard` legend |
| `#cfc8ba` | `.sep` (bubble separator dot) |
| `#a8a2ad` | `.tiphead`, `.lggrip`, `.lgdlh` (dead) |
| `#c9c0b1` | `.chip.done` border, `.step.did` border |
| `#9a95a0` | `#nav>div` idle |
| `#e7dfd2` | `.step .num` background |
| `#d9d1c3` | `.dots i` idle |
| `#9a93a0` | `.zbal-t` label, `.wkd`, `.sndrow.bad .sndchip` |
| `#B90044` | `.zbal-t .amt` (short), `.ms-txt.low`, Love family dot/bold |
| `#0A7A52` | `.zbal-t .amt.plus`, `.ms-txt`, `.zbal-ol b.g`, Abundance family dot/bold |
| `#C25500` | Vitality family dot on `.famstrip` and `.frow` |
| `#eadfce` | `.zbal-chevbtn` border, `.zbal-pop` border |
| `#55505c` | chevron SVG stroke |
| `#8a8290` | `.zbal-sub` |
| `#3a3542` | `.zbal-ol b`, `.zbal-pop` text |
| `#63616F` | `.zbal-popx` glyph |
| `#d9cfc0` | `.zbal-add/.zbal-min` border |
| `#EFE6D6` | `#nav` border-top |
| `#FBF8F3` | `.wstat` bg, `.bxnote` bg |
| `#f0e8d9` | `.wstat` border, `.bxnote` border |
| `#EFECFF` | `.sndchip` bg, `.bverb` bg, `.wkd.on` bg |
| `#F1EDE4` | `.sndrow.bad .sndchip` bg |
| `#e6ddce` | `.wkd` border (dead) |
| `#E9E2FA` | `.spec i` segments |
| `#fff` | `.pill.on`, `.row`, `.done-item`, `#nav`, `.step.now/.did`, `.dots i.now`, `.zbal-chevbtn`, `.zbal-pop`, `.zbal-add/.min`, `.next`, `.bc-cta`, `.howcard`, `.bandcard`, `.rcard`, `.bxcard`, `.wkd`, `#toast` text, `.lastbar` text, `.cta8` text |

### Fonts

**Cormorant Garamond** (`--serif`, Google Fonts, `ital,wght@0,500;0,600;1,500`) is used **only** on:
`.head h2` (600, 34px), `.coach-head h2` (700, 30px), `.subtitle` (italic 500, 27px), `.tm blockquote` (italic 500, 21px), `.rcard blockquote` (italic 500, 18.5px), `.keysub` (italic 500, 21px), `.bc-title` (600, 30px), `.how-lab` (600, 19px), `.howfree` (italic, 17.5px), `.trow blockquote` (dead).

**Switzer** (`--sans`, Fontshare, 400/500/600/700) is the body default and is **explicitly re-asserted** where a serif ancestor would otherwise win: `.wave-title h3`, `.tm .who`, `.trow .who`, `.rcard .who`, `.zbal-ttl`, `.wstat b`, `.ms-balnow` (font shorthand `700 9.5px/1 'Switzer'`).

**Numbers rule:** every numeral is sans. `.wstat b` (`63+`, `15%`) is 27px Switzer 700 in violet with `font-variant-numeric:lining-nums`. `.zbal-t .amt` uses `font-variant-numeric:tabular-nums`, `font-weight:800`. `.spectick` and `.bhz` use `lining-nums`. `.wave-dur` and `.ms-txt` are plain Switzer.

### Radii

`3px` (`.qbox`) · `3.5px` (`.legend .lgbox`) · `7px` (`.spec`) · `8px` (`.ms-balnow.hint`, `.zbal-t`) · `9px` (`.letter`) · `10px` (`.selall`, `.trow img`, `.ministat`, `.bxnote`) · `12px` (`.step`, `.wstat`) · `13px` (`.sndchip`) · `14px` (`.row`, `.done-item`, `.tipcard`, `.zbal`, `.zbal-pop`, `.hint` default) · `16px` (`.qall`, `.howcard`, `#s1c/.s7 .tm`) · `18px` (`.bandcard`, `.bxcard`, `.tcard`, `#s1c .tm img`) · `20px` (`.rcard`) · `22px` (`.bandimg`, dead) · `30px` (`#frame`, desktop only) · `999px` (`.next`, `.chip`, `.lastbar`, `.cta8`, `#toast`) · `50%` (`.tm img` original, `.fam i`, `.fdot2`, `.wkd`, `.rcard img`, `.zbal-chevbtn`, `.zbal-add/.min`, `.zbal-popx`, `#finger`, `.step .num`, `.dots i`).

### Shadows

```
#frame (desktop)   0 30px 80px rgba(0,0,0,.22)
.pill.on           0 1px 5px rgba(0,0,0,.13)
.row.playing       0 0 0 1px var(--rowink), 0 4px 18px rgba(0,0,0,.04)
.row.dragging      0 12px 28px rgba(26,22,32,.20)
.next / .bc-cta    0 2px 12px rgba(26,22,32,.09)
.step.now          0 2px 10px rgba(101,33,201,.18)
.zbal-chevbtn      0 1px 4px rgba(0,0,0,.06)
.zbal-pop          0 12px 32px rgba(26,22,32,.16)
.zbal-add/.min     0 1px 3px rgba(0,0,0,.06)
#toast             0 10px 28px rgba(26,22,32,.30)
.bandcard/.rcard/.bxcard  0 10px 30px rgba(26,22,32,.07)
.bandimg           0 10px 30px rgba(26,22,32,.10)
.howcard / #s1c .tm       0 6px 20px rgba(26,22,32,.05)
.lastbar / .cta8   0 10px 26px rgba(101,33,201,.35)
#finger            0 4px 14px rgba(56,0,122,.35)
```

### Spacing patterns worth naming

- **Screen gutter:** `padding:0 22px calc(env(safe-area-inset-bottom,0px) + 16px)` on every `.scr`.
- **Nav reserve:** `#s2`, `#s3`, `#s5` add `padding-bottom: calc(env(safe-area-inset-bottom,0px) + 70px)`.
- **The spacer ladder:** `.gap{flex:1 1 0}`, `.sp1{flex:1 1 0;max-height:56px}`, `.sp2{flex:1.2 1 0;max-height:110px}`, `.sp3{flex:1.5 1 0}` — flex absorbers so nothing ever compresses on iOS.
- **Row rhythm:** `.row{padding:10px 10px;margin-bottom:9px}` baseline; `9px/8px` inside lessons; `8px/7px` at `max-height:820px`.
- **Height compression tiers:** `max-height:820px`, `max-height:760px`, `max-height:740px` — three cascading tiers that shrink headlines, rows, waves, testimonial images and CTA padding so the iPhone-mini floor (375×812) never clips a CTA.
- **The CTA law** (comment, line 483): "a CTA can never be cut off — these screens always scroll if content ever exceeds the viewport" → `#s1b,#s1c,#s6,#s7a,#s7b{overflow-y:auto}`.

### Focus states

**None defined.** There is no `:focus`, `:focus-visible`, or `outline` rule anywhere in the file. `*{-webkit-tap-highlight-color:transparent}` removes the mobile tap flash globally, and `.ministat` / `.ms-balnow` repeat it. Only `:active{transform:scale(.96)}` (`.next`, `.bc-cta`, `.cta8`), `scale(.97)` (`.lastbar`) and `scale(.95)` (`.qall`) exist. **This is an accessibility gap a real build must fill.**

### Declared-but-unused / overridden CSS

- `--violet-deep` (`#38007a`) — assigned, then overridden; never renders.
- Dead rule blocks with no matching markup: `#pane`, `#pane.gone`, `#pane2`, `#pane2.show`, `#finger` (+ `@keyframes ripple`), `#narr`, `.bridge` (except the `#s5 .bridge` sizing, which also has no element), `.donelist`, `.done-item`, `.letter-anchor`, `.tipcard`/`.tiphead`/`.tiplab`/`.tipchev`, `.legend`/`.legend4`/`.lgline`/`.lgico`/`.lggrip`/`.lgdlh`, `.chips`/`.chip`, `.steps`/`.step`, `.wk`/`.wkd`/`.wkcap`, `.bandimg`, `.tcard`/`.trow`, `.bc-cta`, `.howmore`, `.stepeyebrow`, `.lede2`, `#coach`, `.next.dim`, `#nextBtn`, `#toast` (element exists, never shown).
- Superseded keyframes still in the file: `hintpulse`, `hintpulse2`, `rowblink`, `pillblink`, `pillblink2`, `iconblink`, `navblink`, `selblink`, `qallblink`, `qboxblink`, `balblink`, `tokblink`. The live set is `rowblink2`, `pillblink3`, `iconblink2`, `selblink2`, `qboxblink2`, `balblink2`, `tokblink2`, `pmblink`, `navblink2`, `waveripple`, `mspulse`, `rowslide`, `dr1/dr2/dr3`.
- `.cmd` is retired to a no-op: `/* W-3m: the violet underline-for-emphasis is retired */ .cmd{border-bottom:none;padding-bottom:0}`. The `<span class="cmd">` wrapper still exists in every headline but carries no visual weight — commands read in the headline's own type.

---

## 5. Assets

Base: `https://zodiac-pages.vercel.app/inapp/`

| Path (relative to `/inapp/`) | Element | Live URL |
|---|---|---|
| `balance-engine.js` | `<script src>` in `<head>` — the one balance source | `https://zodiac-pages.vercel.app/inapp/balance-engine.js` |
| `app-assets-welcome/srini-pillay.png` | `#s1 .tm img`, `alt="Srini Pillay"` | `https://zodiac-pages.vercel.app/inapp/app-assets-welcome/srini-pillay.png` |
| `app-assets-welcome/rhonda-britten.jpg` | `#s1c .rcard img`, `alt="Rhonda Britten"` | `https://zodiac-pages.vercel.app/inapp/app-assets-welcome/rhonda-britten.jpg` |
| `app-assets-welcome/barbara-ditlow.png` | `#s6 .rcard img`, `alt="Barbara Ditlow"` | `https://zodiac-pages.vercel.app/inapp/app-assets-welcome/barbara-ditlow.png` |
| `app-assets-welcome/joey-vaillancourt.png` | `#s7a .tm img`, `alt="Joey Vaillancourt"` | `https://zodiac-pages.vercel.app/inapp/app-assets-welcome/joey-vaillancourt.png` |
| `app-assets-welcome/amber-hedrick.png` | `#s7b .tm img`, `alt="Amber Hedrick"` | `https://zodiac-pages.vercel.app/inapp/app-assets-welcome/amber-hedrick.png` |
| `app-D.html` | navigation target of every `Skip tour` link | `https://zodiac-pages.vercel.app/inapp/app-D.html` |

**External (CDN):**
- `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap`
- `https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap`

**No audio is referenced.** Play/pause is purely visual state (`.row.playing`) — no `<audio>` element, no `.mp3` path, no Web Audio. Waveforms are **inline SVG rects**, not image files. `WAVES` (line 794) maps `quiet-success`, `kindred-spirits`, `elysian-surge`; `WAVES['starseed']` is assigned at line 1256. Each is ~120 pairs of `<rect>` in a `viewBox="0 0 320 26"` space, drawn with a per-row vertical linear gradient (`c2` top → `c1` bottom) whose id is `wg-{slug}` (s2), `wgf-{slug}` (s3) or `wgb-{slug}` (s5). The hero uses a horizontal gradient `#hg`.

**Present in the folder but NOT referenced by this file:** `bands-key.png`, `debra-silverman.png`, `jennifer-k-hill.png`, `ken-hoffman.png`, `my-zodiac-weekly-balance.png`, `playlist-balancer-open.png`, `todd-shipman.png`. (The `.bandimg` CSS suggests `bands-key.png` was once used; the W-3k comment names Todd, whose screen was cut.)

---

## 6. Hardcoded demo data and scaffolding

### Numbers a real app must compute or fetch

| Value | Where it appears | Note |
|---|---|---|
| `63+` / `minutes a week, 9 a day on average` | `#s1b` stat tile A | Target derived from 15%×4 balance math; "9 a day" is 63÷7 rounded down |
| `15%` / `in each frequency, every week` | `#s1b` stat tile B | Matches `ZBalance.FLOOR = 0.15` |
| `The average user listens over **40 minutes a day**.` | `#s1b .howcap` | Population stat — must be sourced/refreshed |
| `Quality speaker $75+` | `#s1b` device chip | Fixed price point |
| `At least 63 minutes this week` | `.zbal-sub` on **both** `#s3` and `#s5` goal panels | Duplicated string; single-source it |
| `Keep all four frequencies at 15% or more each week.` | `.zbal-ol` on `#s3` and `#s5` | Duplicated |
| `SONGS[]` — Quiet Success 3 min, Kindred Spirits 5 min, Elysian Surge 5 min, plus bubble word lists | `var SONGS` line 795 | Demo catalog |
| `BALSONGS['starseed']` — Starseed, 9 min, `MEDITATE/DEEP/DREAMY/CALM/UNWIND` | line 1257 | Demo catalog |
| `CATS[*].hz` — 422 / 432 / 579 / 611 | rendered into every `.wave-band` | Placeholder representative Hz per family, not the member's real values |
| `FAVCATS` mapping (quiet-success→core, kindred-spirits→love, elysian-surge→vitality) | line 1019 | Forced so the lesson's balance math works |
| `BALWEEK = {core:32m, love:7m, vitality:7m, abundance:5m}` → **51 minutes played** | line 1246 | The seeded "week so far". The corner strip renders `51m`. |
| `BALROWS` / `BALSTAGED` | lines 1263–1264 | The pre-built playlist and the song the tour hearts for you |
| Spectrum band boundaries `250 / 425 / 600 / 775 / 950 Hz` | `#s7b .spectick` and `.bhz` | Product canon, but hardcoded here |

**Everything the meter shows is engine-computed, not hardcoded.** Both `zbalRender()` (s3) and `balRender()` (s5) call `ZBalance.compute(...)` and derive `−Xm` from `sf.neededSec` and `+Xm` from `Math.floor((byFreq[f].sec − 0.15·total)/60)`. Only the seed inputs above are fixed.

**Stale comment — flag for the ticket.** Line 1332 states:
```
/* corner strip: … The NUMBER is the played week (64 minutes, it never moves …) */
```
`BALWEEK` sums to **51 minutes** (1920+420+420+300 = 3060 s), so `balFmtTotal(balPlayed.total)` renders `51m`, not `64m`. The seed comment at line 1240 correctly says "51 minutes played". The `64m` in the comment is left over from an earlier seed (it also says "+ by Love adds Kindred (64m week)" — that one *is* the projected total after the `plus` rep, 51+3+5+5 = 64).

### Prototype-only chrome — NOT part of the spec

1. `<span class="letter">W-3q</span>` version badge and its `.letter` rules.
2. `#frame` desktop card (fixed 420×880, 30px radius, drop shadow, `#e7e2d8` page background) and the `@media (min-width:440px)` / `(max-width:439px)` split. A real app is full-bleed.
3. `Skip tour` → `app-D.html` hard link.
4. `.cta8` `onclick="return false"` (no real install flow); the real build needs the iOS/Android A2HS path.
5. `#nav` fake tab bar and its `data-navmsg` acknowledgements — in the real app these are live routes.
6. `#toast` element + `toast()` function: dead code.
7. All the superseded `W-3a…W-3q` CSS layers and orphan keyframes listed in §4.
8. The `#hg` hero family cycle (`setInterval` 2600 ms) is a marketing flourish, not app behavior.
9. Comment references to `app-D.html:NNNN` line numbers throughout — provenance notes for the prototype, not instructions.

---

## 7. Testimonial / proof inventory

| # | Screen | Name | Title line | Quote (verbatim) | Image | Treatment |
|---|---|---|---|---|---|---|
| 1 | `#s1` | **Srini Pillay, M.D.** | `Harvard-trained psychiatrist, brain-imaging researcher` | `“Zodiac.fm provides another pathway into self-awareness. By becoming more coherent with themselves, people make clearer decisions, relate more authentically, and experience greater presence.”` | `app-assets-welcome/srini-pillay.png` | `.tm` **row card, transparent** — 72×72px `border-radius:16px` image left, serif italic 21px quote right, separated from the screen by a `1px solid var(--hair)` top rule. Left-aligned. Sits below the CTA at the very bottom of the screen. |
| 2 | `#s1c` | **Rhonda Britten** | `Author of “Fearless Living,” Emmy Award-Winner` | `“These aren’t just pretty sounds or generic meditation tracks. This is your cosmic blueprint translated into frequency. If you’re tired of living out of tune with yourself, this is your invitation home.”` | `app-assets-welcome/rhonda-britten.jpg` | `.rcard` **centered hero card** — white, `border-radius:20px`, `padding:26px 22px 22px`, `box-shadow:0 10px 30px rgba(26,22,32,.07)`; 84×84px **circular** photo, `object-position:center 22%`, `filter:grayscale(1) contrast(1.05)`; serif italic 18.5px quote centered; attribution centered. This screen is *only* the testimonial + CTA. |
| 3 | `#s6` | **Barbara Ditlow** | `Human Design Master Practitioner, endorsed by Ra Uru Hu` (non-breaking spaces in "Ra Uru Hu") | `“Understanding alone isn’t transformation. It must be felt. Zodiac core frequencies translate this unique imprint into sound, bypassing the mind and speaking directly to the body.”` | `app-assets-welcome/barbara-ditlow.png` | `.rcard` **centered hero card**, same as Rhonda, plus `#s6 .rcard{margin:auto 0}` so it vertically centers in the leftover space. Comment: "Barbara as the same centered hero moment as Rhonda (SS C13)". |
| 4 | `#s7a` | **Joey Vaillancourt** | `VP of Marketing, BiOptimizers` | `“Without doing anything but listening, I become a different person. I shift into the version of me I actually want to be. I can tap into different frequencies based on what I need.”` | `app-assets-welcome/joey-vaillancourt.png` | `.tm` **restyled as a white breathing card** (`#s7a .tm`): `background:#fff`, `border:1px solid #efe6d6`, `border-radius:16px`, `padding:11px 13px`, `box-shadow:0 6px 20px rgba(26,22,32,.05)`, `gap:11px`. 72×72px `border-radius:16px` image left, serif italic **15px** quote right. |
| 5 | `#s7b` | **Amber Hedrick** | `Zodiac.fm member` | `“I’m just finishing my first week and I can’t begin to explain how different I feel compared to just 5 days ago. I feel like ME.”` | `app-assets-welcome/amber-hedrick.png` | Same white breathing card, further compressed: `#s7b .tm blockquote{font-size:13.5px;line-height:1.3}`, `#s7b .tm img{width:44px;height:44px}`. |

**Non-testimonial proof elements**
- `#s1 .famstrip` — the four named frequency families with their canonical dots, established before any copy claim.
- `#s1b` stat tiles — `63+` and `15%` as the weekly contract.
- `#s6 .bandcard` — eyebrow `A Zodiac.fm Discovery` + `Your Bands`, framed as proprietary.
- `#s7b .bxnote` — the anti-hierarchy guard: `These are not levels: everyone uses all four, and none is higher.`

**Titled people appear first in the run** (Srini → Rhonda → Barbara → Joey), with the member testimonial (Amber) last.