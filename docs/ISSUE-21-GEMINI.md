# Gemini group compromise (#21)

The module and tests are implemented. Integration with match detection (#17)
and the reveal screen (#10) is deferred until those implementations exist.

## Contract

`src/lib/gemini.ts` exports `Compromise` and
`groupCompromise(members: Member[], catalog: Movie[]): Promise<Compromise | null>`.
It uses the existing Firebase AI Logic configuration in `lib/gemini.ts`, the
Gemini Developer API backend, and pinned `gemini-3.5-flash`. No API keys or new
dependencies are added. The existing smoke-test model is unchanged.

The prompt sends member display names (or Guest labels), known liked/disliked
titles, and candidates with genres, keywords, and catalog streaming providers.
UIDs are not sent. Vetoed candidates are excluded before generation and checked
again when validating the response. Unknown IDs, mismatched titles, malformed
JSON, missing IDs, overlong explanations, and incorrect watch-line endings are
rejected. Invalid runner-up titles are omitted.

The explanation is limited to 45 words and 320 characters, measured on the
explanation alone — the mandatory watch line is excluded, so a film with many
providers still has room for the trade-off. Its ending must match the catalog's
provider line, which lists at most four providers (the same cap the card uses);
absent providers produce “Check local streaming availability.” Provider data is only as current as the supplied
catalog. The prompt requires a named, evidence-based trade-off; semantic truth
and actual screen fit still require review, not just schema validation.

`COMPROMISE_SCHEMA` exports the JSON schema for #29's pitch slide. Firebase uses
the equivalent Schema helpers, with runner_up the only optional property.
tmdb_id is required at generation time because validation matches it against
the catalog and rejects a response that omits it.

## Integration when #17 lands

Use its algorithmic winner selector instead of implementing another ranking
algorithm in this module:

```ts
import { createGroupCompromise, generateCompromiseText } from './gemini';
import { detectMatch } from './match';

const compromise = createGroupCompromise({
  generate: generateCompromiseText,
  fallback: detectMatch,
});
```

Create this service once, call it at match detection, and persist the validated
pick and why together in the match document. All devices should render that
document. Do not independently choose a Gemini film on every device or attach
its explanation to a different algorithmic film.

After an invalid response, an injected fallback winner is checked against the
catalog and vetoes. Gemini then receives one explanation-only request with
that exact winner fixed. If that fails, return null; the caller keeps its
algorithmic result without invented AI text. Until #17 is connected, the default
groupCompromise is wired to `algorithmicWinner` — a deterministic stand-in that
picks the un-vetoed candidate the most members liked — so a rejected response
still reaches the reveal with explained text. Replace it with #17's selector.

Identical concurrent requests are coalesced. Up to 32 validated results are
cached in memory by the complete prompt (group preferences and catalog), so
an identical repeat works offline during that process. Failed responses are
not cached. This is not persistent offline storage. Each SDK request has a
12-second timeout; HTTP 429 gets at most two retries after 500/1000 ms.

## Validation

Run `npm run typecheck` and `node node_modules/jest/bin/jest.js --runInBand`.
Tests cover validation, vetoes, fixed-winner fallback, cache isolation, request
coalescing, schema configuration, and rate-limit handling.

A live request using the actual module and Firebase SDK selected Inception
(27205) from a five-film catalog and explained Alex's action preference versus
Sam's comedy/drama preference. Only Firebase initialization was adapted for
Node; the generation and validation functions were the production module.
This does not verify the mobile UI or the two-device demo. No reveal component
or match persistence has been changed. ESLint is not configured in the repo.

SDK reference: https://firebase.google.com/docs/ai-logic/generate-structured-output
