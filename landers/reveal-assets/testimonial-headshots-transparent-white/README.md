# testimonial-headshots-transparent-white/

Transparent-background (alpha PNG) cutout headshots used in the reveal-lander
testimonial sections. Each file is a person; there is exactly one clean-named
canonical file per person in current use. This is the "place on white" export
added 2026-07-24 per `brand/testimonial-photo-treatment.md` (workspace repo)
— the same locked treatment/geometry as every other field, exported with no
color field so it sits directly on a white page.

## Naming convention

- **Clean name** (e.g. `hilary-dimassimo.png`) = the current, approved,
  live-referenced version.
- **`--pre-repair-YYYY-MM-DD` suffix** = the exact prior live bytes, preserved
  when that person's photo was repaired/reshipped on that date. Never
  referenced by any page — audit/rollback only. Never delete.
- **`_archive/` subfolder** = confirmed-unreferenced files (none currently in
  this folder — every file here is either live-referenced or an intentional
  preserved prior).

## Current status (checked 2026-07-25)

All 13 clean-named files are live-referenced. The 3 priors —
`david-mcewen--pre-repair-2026-07-25.png`, `paul-tribe--pre-repair-2026-07-25.png`,
`hilary-dimassimo--pre-repair-2026-07-25.png` — are correctly unreferenced by
design (see below).

## Regenerating a headshot

Source of truth for the July 2026 "set v6" repair run:
`tmp/transparent-headshots/set-v6/MANIFEST.md` in the workspace repo (also
documents `hilary-proposal/MANIFEST.md`, a held-not-shipped alternative crown
fix — do not ship without a fresh Michael GO). The reusable pipeline script is
`code/standardize_headshot.py` (workspace repo).

Note on `hilary-dimassimo--pre-repair-2026-07-25.png`: the MANIFEST flags that
this file's shipped bytes don't fully match its own documented build script
from the prior ("v5") ship — RGB differs beyond the claimed alpha-only crown
fix. Not re-investigated as part of this hygiene pass (out of scope); flagged
here so a future audit can find it. The file itself is untouched and
unreferenced, exactly as it should be.
