---
name: verification
description: Use after any code change touching multiple files or multiple features of this workout-tracker app (WorkoutTab, storage.ts, types.ts, a lib/*.ts calculation module, or several components at once) — run this to confirm nothing broke before calling the task done. Also use once per calendar day as a standing full check even without a trigger, and after any change to src/lib/*.ts (calculation logic: 531, cluster, emom, dropset, weightRounding, trainingMax, cardio) regardless of size. Do NOT use for a single-line copy/style tweak, an isolated one-file fix, or purely non-UI changes (docs, hooks, tooling) — those don't need this.
user-invocable: true
allowed-tools:
  - Bash(npx tsc -p tsconfig.app.json*)
  - Bash(npm test*)
  - Bash(npm run build*)
  - Bash(node .claude/skills/verification/scripts/*)
---

Confirms a code change didn't break the app, at a cost proportional to the change's size — cheap commands always, a full scripted walkthrough only when it's actually warranted.

## 1. Decide: full pass or light pass

Run the **full pass** if any of these is true:
- the change touched `src/lib/*.ts` (any calculation module), `storage.ts`, `types.ts`, or `WorkoutTab.tsx`
- the change touched 3+ files, or spans more than one tab/feature
- `.claude/skills/verification/state/last-full-run.txt` is missing or doesn't contain today's date (`date -u +%Y-%m-%d`)

Otherwise run the **light pass**. When in doubt, prefer the light pass — the full pass is the expensive one.

## 2. Always: the three fast commands

Run regardless of pass type, in this order, and stop to fix before continuing on any failure:

```bash
npx tsc -p tsconfig.app.json --noEmit
npm test
npm run build
```

Do not substitute `npm run lint` or a root `tsc --noEmit` — per [CLAUDE.md](../../../CLAUDE.md), both are configured permissively on this project and silently miss real type errors.

## 3. Light pass

After the three commands pass: pick **one** random item from the checklist in [reference.md](reference.md) (technique or screen) and manually re-verify just that one in the browser preview. Report pass/fail in 1-2 sentences. This is the default for everyday edits — keep it cheap.

## 4. Full pass

1. Generate the test fixture (4 weeks, all techniques, mixed cardio/strength — see [reference.md](reference.md) for exactly what it contains):
   ```bash
   node .claude/skills/verification/scripts/generate-fixture.mjs .claude/skills/verification/state/fixture.json
   ```
2. Open the app preview (`app-muscu-dev`, port 8080), inject the fixture into `localStorage` under the app's storage key and reload — see reference.md for the exact snippet.
3. Walk the full checklist in [reference.md](reference.md) §Checklist complet — every technique (531, cluster, EMOM, drop set, AMRAP, assisté/négatif, superset) and every screen (Calendrier, Séance, recap, Stats/records/graphiques, noms de programme, chrono, Réglages).
4. Watch the console/network the whole time (`read_console_messages`, `onlyErrors: true`) — a silent console error is a failure even if the UI looks fine.
5. Clear the injected fixture from `localStorage` when done (real data must never be left overwritten in a shared preview browser).
6. Record today's date in `state/last-full-run.txt`.

## 5. Reporting

Report a short pass/fail summary (what ran, what broke if anything) — not raw command output. On any failure, stop and fix before reporting done; don't report partial success as success.
