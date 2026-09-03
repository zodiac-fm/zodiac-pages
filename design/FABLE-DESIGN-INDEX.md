# FABLE DESIGN INDEX

This is the ONE index Codex reads to know what Fable design has built. Nothing else in this
room is addressed to Codex. A Sonnet worker keeps this file current and updates it at every
page lock, at zero Fable and zero Michael cost. The URL root is https://zodiac-pages.vercel.app
and directory paths are slashless: `site/styleguide.html` is live at `/site/styleguide`.
Founded 2026-09-02. Companion log: `working/fable-design-learning-log-v1.md` in the vault.

## Permanent reference surfaces

These two URLs are always current. Versions live behind them and are internal.

- `site/styleguide.html` -> https://zodiac-pages.vercel.app/site/styleguide
- `site/styleguide-library.html` -> https://zodiac-pages.vercel.app/site/styleguide-library

Versioned copies present on disk (internal, not the reference URL):
`site/styleguide-7-6-library.html`, `site/styleguide-8-0-library.html`,
`site/styleguide-8-1-library.html`, `site/Iris/styleguide.html`,
`site/Iris/styleguide-library.html`.

## Current design surfaces

Everything below existed before the Fable design room opened on 2026-09-02. Status is
PRE-ROOM: built under the old arrangement, lock state not established by this index. Do not
read PRE-ROOM as approved and do not read it as rejected.

- `design/` — design system source: `tokens.json`, `zodiac.css`, `color-system.html`,
  `style-guide.html`, `gradients.html`, `family.html`, `gallery.html`, `anchor.html`,
  `favorites.html`, `verified.html`, `page-template.html`, `app-strategy.html`,
  `app-implications.html`. Status: PRE-ROOM.
- `site/` — the marketing site direction line, 58 files. Direction families `site-d1-*`
  through `site-d4-*`, the D4-E sun page (`site-d4-e-sun-h5` through `-h8`), D4-L and its
  colour-pop and neutral-ground studies, home studies (`home-light-*`, `home-warm-*`,
  `home-aurora-01`, `home-chart-01`, colour-pop world/treatment pairs with their own token
  CSS), review boards `r27-board` through `r34-board`, `eval-board-1`, `cc-pilot-board`,
  `layout-width-01`, `listen-01`. Status: PRE-ROOM.
- `inapp/` — the in-app prototype family, ~240 files. `inapp/app.html` is the canonical
  prototype; `A-2`, `B2`, `C-2`..`C-4`, the `app-A*` welcome and onboarding series, the
  `app-B-*` series, and the `_balance-*` studies sit beside it. Status: PRE-ROOM.
- `landers/` — 123 landing pages, including the `reveal-01`..`reveal-41` series, the
  `mcewen-*` set, and `landers/reveal-assets`. Status: PRE-ROOM.
- `explorations/` — 43 exploration pages: `design-directions.html` and its dated copy,
  `style-guide.html` and its dated copy, `direction-cosmos`, `direction-intimate`,
  `direction-gallery`, `how-color-works`, `color-wheel-check`, `song-shapes`, `rays-fine`,
  `rays-music`, plus `explorations/shots` and `explorations/assets`. Status: PRE-ROOM.
- `results/` — 34 results-screen studies. Status: PRE-ROOM.
- `proof/` — testimonial map surfaces `testimonial-map.html` and `-01`..`-06`, plus
  `proof/assets`. Status: PRE-ROOM.
- `links/index.html` — the links page, with `links/history`. Status: PRE-ROOM.
- `quiz/`, `funnel/`, `email-system/`, `media-buying/`, `projects/`, `reach-out/`,
  `references/`, `directory/`, `sunbackground-test/`, `waveform-project/`, `tools/`,
  `archive-cuts/` — supporting surfaces, not part of the current design line.
  Status: PRE-ROOM.
- `index.html` — repo root page. Status: PRE-ROOM.

## Fable design room pages

Nothing locked yet. The room opened 2026-09-02.

Each future lock appends exactly one row in this format:

`- <YYYY-MM-DD> | <page label> | <repo path> | <live URL> | LOCKED|WORKING | spec: <path> | log entry: <id>`

## Rules

1. Every page and asset is labeled and versioned. No unlabeled file enters this index.
2. Never overwrite a locked version. A change means a new version file beside it.
3. New work files into the LATEST version. A stale pointer is a bug, fixed on sight.
4. This index is updated at every lock, in the same worker turn as the lock.
5. Every row cross-references its learning log entry id in
   `working/fable-design-learning-log-v1.md`. A row without an id is incomplete.
