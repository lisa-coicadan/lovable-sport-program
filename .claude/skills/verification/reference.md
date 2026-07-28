# Verification — reference

Detail backing [SKILL.md](SKILL.md). Load this only when running the full pass, or the light pass's random item needs more context than the one-liner below gives.

## The fixture

`scripts/generate-fixture.mjs` builds a complete, valid `AppData` object (see `src/lib/types.ts`) — no network, no LLM reasoning needed to construct it, just run the script. It's deterministic (dates computed from "today", no randomness) so a failure is reproducible.

Contents:
- **4 workout types** across 4 weeks of history (16 strength sessions + 8 cardio sessions), oldest→newest with a mild weekly progression on weight:
  - **Squat** — 5/3/1 (`ex-squat`), TM 92.5kg, cycle 2 week 3 (the 5/3/1 "week" scheme itself, not deload)
  - **Push** — Développé couché in **cluster** mode (`ex-bench`, defaults left unset — exercises the fallback path), Dips lestés with a **drop set** config (`ex-dips`), and Développé militaire + Élévations latérales as a **superset** pair (`ex-ohp`/`ex-lat-raise`, shared `supersetGroupId`)
  - **Pull** — Tractions lestées (`ex-pullup`, `amrap: true`) with weight progressing session-to-session from **assisted/négatif** (-10kg) → bodyweight (0) → **weighted** (+5kg), exercising the exact assisted-toggle regression fixed in commit `dc135e5`; Rowing barre in **EMOM** mode (`ex-row`, defaults left unset)
  - **Legs** — plain Soulevé de terre (for strength-standards comparison) + Fentes (`unilateral: true`, display-only attribute)
- `gender`/`heightCm` set so the France-records comparison (`strengthStandards.ts`) has something to compare against for Squat/Développé couché/Soulevé de terre
- `bodyWeightLogs`, `programs` (one program, "Programme Vérif"), `cardioSessions` mixing "Course à pied" (with distance, for pace) and "Natation" (duration-only)

To inject it into the running app:
```js
// paste the file's contents in place of <JSON>:
localStorage.setItem('fitness-tracker-data', '<JSON as a single-quoted JS string>');
location.reload();
```
The storage key must match `STORAGE_KEY` in `src/lib/storage.ts` (currently `fitness-tracker-data`) — if that ever changes, this snippet and the key above both need updating. `loadData()` merges onto `DEFAULT_APP_DATA` and swallows parse errors, so a structurally-valid fixture always loads cleanly even if a field is missing.

**Always clear it after the pass** (`localStorage.removeItem('fitness-tracker-data')`) — the preview browser may be shared with another concurrent session, and this must never be confused with or leak into real device data.

To regenerate without seeding the browser (e.g. to inspect the JSON): `node scripts/generate-fixture.mjs -` prints to stdout instead of writing a file.

## Checklist complet (full pass)

Each item names what to do and what "correct" looks like. Any console error during any step is a failure regardless of what the UI shows.

1. **Calendrier** — the 4 weeks of seeded sessions appear, strength and cardio both visible.
2. **531 (Squat)** — starting a session shows "Semaine 3 — 5/3/1", weights 70/77.5/87.5kg (75/85/95% of TM 92.5, rounded to 2.5kg), last set reps shown as "1+". Edge cases worth spot-checking: week 4 must show the **deload** scheme (40/50/60%, all reps "5", no "+"), and finishing a week-4 session should roll `currentWeek` back to 1 and `currentCycle` +1 with `trainingMax` incremented (+2.5kg default).
3. **Cluster (Développé couché)** — session shows the cluster mini-series structure even though `numSeries`/`miniSeries` were left unset on the fixture (defaults from `cluster.ts` must apply: 4 series × 2×90%).
4. **EMOM (Rowing)** — the EMOM timer UI (`EmomTimer.tsx`) renders with defaults applied (10min, 2 reps/min, %TM from the duration/reps formula, clamped 40-90%) since the fixture also left those fields unset.
5. **Drop set (Dips lestés)** — the anchor set plus its 2 cascaded stages display, weight decreasing ~15%/stage from the **anchor**, not compounding stage-over-stage. Editing the anchor's weight mid-session should recompute both stages from the new anchor.
6. **AMRAP (Tractions lestées, set 4)** — no pre-filled rep target on that set; whatever's typed is what's logged.
7. **Assisté/négatif (Tractions lestées)** — typing a `-` prefix on the weight field toggles assisted mode; confirm it still works from a starting value of exactly 0kg (this exact case was broken and fixed in a recent commit — see `git log --oneline | grep assisté`).
8. **Superset (Développé militaire / Élévations latérales)** — both exercises show the same set count and stay in sync when a set is added/removed on either side.
9. **Chrono** — global session timer starts on session start; the rest timer starts, counts down, can be dragged to adjust, and the finish doesn't throw a console error (audio can't be verified by ear here — absence of console errors is the bar).
10. **Recap / SessionSummary** — finishing a session shows PR detection (theoretical 1RM via Epley, `calculate1RM` in `types.ts`) only when it actually beats history, and the share-image `<canvas>` generates without a console error (this is the exact class of bug documented in CLAUDE.md's "Image de séance partagée" section — colors read via `getComputedStyle`, `hsl(... / alpha)` not `hsla(...,alpha)`).
11. **Stats — records** — Squat/Développé couché/Rowing personal records show with correct theoretical 1RM and "il y a N jours".
12. **Stats — graphiques** — tonnage chart renders across the 4 seeded weeks, filterable by session type; cardio pace/duration comparison renders for both "Course à pied" (has distance → pace shown) and "Natation" (no distance → duration-only, no pace).
13. **Stats — barèmes France** — Squat/Développé couché/Soulevé de terre show a comparison against `strengthStandards.ts` reference rows (needs `gender`/`heightCm`, both set on the fixture).
14. **Noms de programme** — "Programme Vérif" shows consistently on Calendrier session cards, the recap, and Stats — this exercises `resolveProgramName`'s live-resolution (not just the frozen `programName` snapshot).
15. **Historique par exercice** (Réglages → un exercice) — range filters (4/16 semaines/tout) return the seeded sessions for at least one exercise from each technique.
16. **Réglages** — exercise config screens open for at least one exercise of each method type without crashing; JSON export produces a non-empty file.

## Random item pool (light pass)

Pick uniformly at random from: items 2, 3, 4, 5, 6, 7, 8, 9, 10, 12 above (skip the setup-only items 1/13/14/15/16 for the light pass — they rarely regress in isolation).
