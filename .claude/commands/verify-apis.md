---
description: Re-verify the volatile external facts the plan depends on (model names, SDKs, free-tier limits)
allowed-tools: Bash, Read, Edit, WebFetch, WebSearch, mcp__context7
---

`PLAN.md` ends with an explicit verification note: Gemini model names and the
MLH coupon mechanics were checked against 2026 sources but both move quickly. This command re-checks them. Run it at the start of the build,
and again before the demo.

Check each of these and report **current value vs. what the plan assumes**:

| What | Plan assumes | How to check |
|---|---|---|
| Gemini model string | `gemini-3.5-flash` | context7 `/googleapis/js-genai` or ai.google.dev models page. `gemini-2.0-flash` is shut down; 1.x 404s. |
| Gemini JS SDK | `@google/genai` (not `@google/generative-ai`) | `npm view @google/genai version` |
| Gemini free tier | ~1,500 req/day, 15 RPM | ai.google.dev/pricing |
| Structured output | `responseMimeType` + `responseSchema` in `config` | context7 |
| Expo audio module | `expo-audio`, audio session only (`expo-av` is deprecated) | context7 `/expo/expo` |
| Expo SDK | 52+ | `npx expo --version`, docs.expo.dev |
| Swipe / video libs | `rn-swiper-list`, `react-native-youtube-iframe` | `npm view <pkg> version`, check Expo-Go compatibility |
| Firebase AI Logic | GA; free on Spark via the **Gemini Developer API** backend (Vertex backend needs Blaze); App Check enforcement Nov 2 2026 | firebase.google.com/docs/ai-logic |
| TMDB | free non-commercial, ~40–50 req/s, attribution required | developer.themoviedb.org |

Prefer **context7** for SDK shapes and npm for versions. Use the web only for
pricing and free-tier pages that context7 won't have.

Report as a table with a ✅ / ⚠️ / ❌ per row. For anything that has drifted:
1. say what changed and what breaks,
2. name the issue numbers affected,
3. propose the edit to `PLAN.md` / `AGENTS.md` — **ask before making it**, since
   the plan is a shared artifact the whole team reads.

If everything matches, say so in one line. Don't pad it.
