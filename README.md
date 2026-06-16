# Zodiac — Pages (preview/staging)

Static pages for sharing work-in-progress with friends and mentors before go-live.

## How a page goes live (no Walter, no per-page setup)
1. Connect this repo to a Vercel project ONCE (you, in your Vercel — these are static, no credentials).
2. Turn on Password Protection in Vercel if you want it gated.
3. After that: any page added here and pushed to GitHub **auto-deploys**. New page = one push = live.

## Adding a page
Drop an HTML file in the root. `cleanUrls` is on, so:
- `quiz.html`  ->  `/quiz`
- `landing.html`  ->  `/landing`
- `index.html`  ->  `/`

That's it. Push, and it's live at the Vercel domain.
