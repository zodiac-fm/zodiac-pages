# landers/reveal-assets/ — testimonial photo assets

This folder holds the photo-of-a-person assets used across `landers/*.html`
testimonial sections (plus a few non-people UI assets — `img-images_blob-*.png`
— which this README does not cover).

## Naming convention

- **Clean name, no suffix** (e.g. `img-images_testimonials_<slug>-d2c.png`) =
  the current, approved, live-referenced version. If a page links a testimonial
  photo, it links the clean-named file.
- **`--pre-repair-YYYY-MM-DD` suffix** = the exact prior live bytes, preserved
  when a photo was repaired/reshipped on that date. Never referenced by any
  page — kept only for audit/rollback. Never delete these.
- **`_archive/` subfolder** = confirmed-unreferenced files (checked by grep
  across every `.html`/`.css`/`.js` in the repo before moving). Old
  intermediates superseded by a clean-named canonical file. Never delete —
  moved here instead of left loose in the working folder.

## Regenerating a headshot

The locked recipe and every rule (approved field colors, credential-line
requirement, per-person waivers) live in the workspace canon doc
`brand/testimonial-photo-treatment.md` — read that first. `-d2c` on this site
specifically MEANS the greige `#EAE4DA` field variant (re-fielded in place
2026-07-11); it is not an arbitrary suffix.

The reusable pipeline script is `code/standardize_headshot.py` (workspace
repo): `python3 code/standardize_headshot.py <photo> <outdir> --all-fields`
writes all four color fields plus the transparent RGBA export in one pass.

Source of truth for the July 2026 "set v6" repair run specifically
(david-mcewen, paul-tribe, hilary-dimassimo): `tmp/transparent-headshots/set-v6/MANIFEST.md`
in the workspace repo. Regenerate the greige `-d2c.png` composite from the
same approved RGB/alpha rather than re-generating from scratch — see the
MANIFEST for the exact process used per person.

## A second legacy naming family lives here too — do not assume it's stray

Several people (barbara-ditlow, katie-wells, leanne-ely, todd-shipman) also
have `-d2.png`, `-d2b.png`, and `-d2-lg.jpg` variants, plus a bare `.jpg`.
These are NOT duplicate intermediates of the canonical `-d2c.png` — they are
live-referenced by the `landers/photo-1.html` through `photo-6.html`
treatment-comparison pages (and, for `leanne-ely-d2-lg.jpg`, also by several
`mcewen-1x.html` pages). **Grep the exact filename across the whole repo
before touching anything in this folder** — a file that looks like an old
duplicate may be a live reference from a page outside `landers/reveal-assets/`
callers you weren't looking at.

## Archived 2026-07-25 (asset-hygiene pass)

Moved to `_archive/` after confirming zero references anywhere in the repo:

- `img-images_testimonials_david-mcewen.jpg` (900x900) — pre-`-d2c` bare jpg,
  superseded by `img-images_testimonials_david-mcewen-d2c.png`.
- `img-images_testimonials_barbara-ditlow-d2-lg.jpg` (800x800) — barbara-ditlow's
  live pages (`photo-3.html`, `photo-4.html`) reference `-d2.png` directly, not
  a `-d2-lg.jpg`, so this sibling was never linked.

## Flagged, not touched (ambiguous — Fable's call)

Thirteen `-d2c.png` files are the ONLY version of that person's photo and are
currently referenced by zero pages: `anja-zibert`, `dr-jill-white`,
`dr-pedram-shojai`, `ellen-grimaldi`, `jennifer-rodriguez`, `jesse-elder`,
`kevin-knabe`, `maryellen-tribby`, `nate-anaez-zeleznick`, `neda-fakhr`,
`rachel-wayte`, `sanela-estrella`, `yun-rhee`. These are not stale duplicates
of a live asset (there's nothing else to compare them to) — they read as
treated-and-filed testimonial photos waiting for page placement (see
`brand/testimonial-photo-treatment.md` line 38, e.g. Ellen Grimaldi: "photo
received, treated, filed" 2026-07-20), not hygiene debt. Left in place rather
than archived. Cross-check `winners/testimonials.md` Status column before
placing any of them — treatment ≠ publish permission.
