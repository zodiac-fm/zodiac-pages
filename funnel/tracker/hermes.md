# Use the funnel tracker from Hermes

Open https://zodiac-pages.vercel.app/funnel/tracker and sign in with your own Zodiac.fm company account. Open your account button, choose **Create temporary connection**, and copy the token into your private Hermes environment as `FUNNEL_TRACKER_TOKEN`.

The connection lasts one hour. It can read sections and save drafts under your verified company name. A company user confirms live versions in the tracker.

The helper runs with Node.js 20 or newer from any repository. Use the helper in the company `zodiac-pages` checkout:

```sh
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs list
node /path/to/zodiac-pages/funnel/tracker/hermes.cjs show LG-01
```

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
