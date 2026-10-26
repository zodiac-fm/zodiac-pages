# Use the funnel tracker from Hermes

Open https://zodiac-pages.vercel.app/funnel/tracker and sign in with your own Zodiac.fm company account. Open your account button, choose **Create temporary connection**, and copy the token into your private Hermes environment as `FUNNEL_TRACKER_TOKEN`.

The connection lasts one hour. It can read section records and working-page metadata, and edit text on existing private working pages under your verified company name. A company user uploads images, creates working copies and confirms customer publication in the tracker.

## Edit a working page

Open the page once in the tracker to create its shared working copy. The page is labelled DRAFT and has the same section codes as the tracker. Read its current editable text and history:

```sh
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs working draft-lander-g
```

Use a returned text entry's sectionId and editId, together with the draft's current revision. Prepare a local edit file:

```json
{
  "sectionId": "LG-01",
  "editId": "copy an existing text editId from working",
  "expectedRevision": "copy the exact current draft revision",
  "value": "The replacement words",
  "note": "Optional context for Walter"
}
```

```sh
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs edit-text draft-lander-g /path/to/edit.json
```

This changes the actual shared working page and saves its previous HTML, editor and date. It preserves surrounding layout. A conflict requires reading the latest working draft and comparing the changes before retrying. Customer pages are published through the normal repository process, then confirmed in the tracker.

Working page keys are draft-lander-g, draft-lander-a, draft-lander-m, draft-results-g, draft-results-a, draft-results-m, draft-bc, draft-join-paid and draft-join-free. Private HTML, images and publication confirmation require a company browser session.

## Read source records and page monitoring

The helper runs with Node.js 20 or newer from any repository. Use the helper in the company `zodiac-pages` checkout:

```sh
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs list
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs show LG-01
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs pages
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs pages lander g
```

`pages` reads the production-monitor records only. It returns the registered pages, their latest status, source commit and fingerprints, and archive metadata. You can optionally filter by `FAMILY` and then `VARIANT`. It cannot capture a screenshot, open an archived image, run a production check, register a page, or confirm production.

`show` returns the section history and an `expectedRevision`. Keep that value with your proposed change. It prevents saving over someone else's newer work.

To save a draft, prepare a local JSON file:

```json
{
  "expectedRevision": "copy the exact value returned by show",
  "summary": "Describe what changed",
  "content": "The complete requirements for this section",
  "previewUrl": "https://your-versioned-preview.example/section",
  "repositoryRef": {
    "repository": "zodiac-fm/your-repository",
    "commit": "the full 40 character Git commit identifier",
    "path": "src/pages/lander.tsx"
  }
}
```

`repositoryRef` and its `path` are optional. Any company repository can be referenced. The tracker records the supplied commit reference. It does not check repository permissions, confirm the commit exists, watch GitHub, or establish that a deployment is live.

```sh
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs draft LG-01 /path/to/revision.json
```

If another person saved first, read the section again and compare before updating `expectedRevision`. When the connection expires, create a new one from your company account.

Keep the token out of chat, source files, commits and command arguments. The helper reads it only from the process environment and sends it only to the hosted tracker.
