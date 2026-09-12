# Issue #3 setup

Issue #3 now covers only TMDB and Gemini. It explicitly excludes Cloud Functions,
Express/Vultr, Blaze, ElevenLabs, and any other server-side component.

## Already prepared

- The Firebase JavaScript SDK is installed.
- `lib/gemini.ts` initializes Firebase AI Logic with the Gemini Developer API
  backend and pins `gemini-3.5-flash`. It sits beside `lib/firebase.ts` from #2.
- `/api-check` is a development-only screen for one manual TMDB request and one
  manual Gemini request. It never runs automatically.
- The TMDB read bearer stays in ignored `.env` for local scripts, under either
  `TMDB_BEARER` or `TMDB_READ_ACCESS_TOKEN`. The dev screen accepts the token at
  runtime so the credential is never compiled into the client bundle.
- `scripts/scan-client-secrets.mjs` compares the real local credential against an
  exported client without printing it.

## Setup for another Firebase project

1. Open the [Firebase AI Logic console](https://console.firebase.google.com/project/moviematch-hackwestx/ailogic)
   for `moviematch-hackwestx`.
2. Click **Get started** and select **Gemini Developer API**. Keep the Firebase
   project on the Spark plan; do not select the Vertex AI backend.
3. Complete the wizard. If Firebase requires App Check setup, follow the wizard's
   development-provider instructions and record what it asks for.
4. Populate the public Firebase web config in ignored `.env`. No Gemini key is
   needed by this app. Share private credentials outside Git and chat.

No further TMDB account work is needed: the saved v4 API Read Access Token has
already returned 20 results from `/discover/movie`.
The curation script from issue #4 reads `TMDB_READ_ACCESS_TOKEN` while issue #3's
contract names `TMDB_BEARER`. They are the same v4 token, so both scripts here
accept either name and a `.env` filled in for one issue works for the other.

## Verification

After AI Logic is enabled, run this once from the repository root:

```sh
node --env-file=.env scripts/check-issue-3.mjs --gemini
```

For the acceptance criterion that the calls work from the app, start Expo, open
`/api-check`, paste the TMDB read token into the masked development field, and run
both checks. Clear the token field after the test. Do not put it in an
`EXPO_PUBLIC_*` variable.

Export and scan the client:

```sh
npx expo export --platform android --output-dir dist/issue-3-android
node --env-file=.env scripts/scan-client-secrets.mjs dist/issue-3-android
```

This issue does not require deployment. The full six-step demo path and physical
device behavior belong to later issues and are not claimed verified here.

## Verified on September 12, 2026

- Both development-screen buttons were exercised in the browser: TMDB returned
  20 discover results; Gemini returned the expected JSON through Firebase AI Logic.
- Browser verification temporarily used `web.output: single` and moved the
  Firebase Hosting `public/index.html` placeholder aside. Both were restored:
  the default static web setup has a Worklets SSR error and the placeholder
  conflicts with Expo's HTML root. This branch does not claim to fix Expo Web.
- The test bearer was supplied at runtime by a temporary loopback-only fixture,
  then cleared. Neither that fixture nor its credential is part of this branch.
- TypeScript and Android export pass; exact-value scanning of the final Android
  export found no private credentials. Public Firebase web config is expected.
- ESLint is not installed or configured by the base project; lint was not run.
- Physical-device UI, trailer playback, and the full demo path remain unverified.

AI Logic worked after the owner switched App Check to monitoring-only. This
branch does not initialize an App Check provider; enforced projects need one
before these calls can succeed. No Firebase console settings are changed by code.
