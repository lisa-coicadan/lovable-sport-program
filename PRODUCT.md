# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Lisa — the builder and primary/power user. She trains hybrid strength + calisthenics at the gym, defines her own training methods and programs inside the app (5/3/1 cycles, Cluster sets, EMOM, freeform sessions), and drives the product's evolution directly from her own day-to-day usage.

A small circle of training friends also use the app actively today, each on their own phone. There are no accounts: every friend installs the PWA on their own device, and `localStorage` isolation per device/browser is what keeps everyone's data separate — this is a real, currently-used pattern, not just an architectural possibility held in reserve.

Both groups use the app in the same situation: standing at the gym, phone in hand, needing to log a set or check a plan in a few seconds, sometimes with no signal.

## Product Purpose

A mobile-first PWA that logs hybrid training sessions — loaded lifts and bodyweight/calisthenics work in the same workout — and automates programmed progressive overload (5/3/1-style strength cycles, Cluster sets, EMOM) so the lifter doesn't have to hand-track Training Max increments, week position, or load percentages. Success is a tool she and her training friends can open at the gym, log a session in seconds, and trust to carry forward the right numbers automatically.

## Positioning

What an app like Hevy or Strong can't credibly offer, and what keeps Lisa building her own instead:

- **Every training method lives in one app.** 5/3/1, Cluster, EMOM, and fully freeform sessions are all first-class, with automatic load calculation from a single Training Max per exercise — not bolted-on templates or a "premium program" tier.
- **Both a calendar and a statistics view of the same data**, not just one or the other — chronological history and analytical trends (volume, RPE, frequency, PRs) over the same underlying sessions.
- **Total freedom in building sessions** — supersets, custom exercises, reordering, mixing methods within one workout — rather than being boxed into a vendor's session model.
- **She owns the data format outright.** Local JSON, hers to export/import/read, with no proprietary lock-in from a third-party vendor.
- **Iteration speed she controls.** A new training rule or method can be specified and shipped in a prompt, without waiting on someone else's product roadmap.
- **Zero cost, zero subscription** — no paywall gating strength-cycle automation or analytics.
- **Fully local-first**: no data ever leaves the device to a third-party server.

## Operating Context

- Used standing at the gym, mid-session, needing to log a set or check the plan in a few seconds — sometimes offline.
- Installed as a PWA on each user's own phone (iOS home screen for Lisa); opened far more often as an installed app than as a browser tab.
- A live session (active timer, checked sets, entered loads) must survive switching tabs to check stats or the calendar mid-workout — session state persistence across tabs is a real, load-bearing behavior, not a nice-to-have.
- Deployment: pushing to `main` alone does not update the live site — a separate explicit "Publish" step in Lovable is required, so a push and a live update are not the same event.
- No backend, no accounts, ever (a deliberate, standing decision) — multi-device sync for one identity would be a distinct future project, not an incremental change.

## Capabilities and Constraints

- Superset engine: two exercises share a set count while keeping independent load/progression history.
- Fuzzy exercise-name normalization groups spelling variants (`RDL`, `rdl`, `RDL barbell`, …) under one analytics entity.
- Strength-cycle automation: detects the end of a 5/3/1 cycle and auto-increments Training Max (+2.5 kg default, configurable), resetting to week 1.
- Theoretical 1RM via the Epley formula; a new PR is only logged when the calculated 1RM beats the previous historical max.
- PR detection: current best per lift, plus a "most recent records" view across all lifts with dynamic "days ago" tracking.
- Cumulative tonnage chart, filterable by session type, compared directly against the previous session of the same type.
- Training-frequency tracking (4 weeks / 16 weeks / all-time), including zero-session weeks, for an honest read of consistency.
- Non-blocking rest-timer beep via the Web Audio API, layered over ongoing music/podcasts without interrupting playback (iOS-compatible).
- Local-first storage (`localStorage`, single JSON blob) with manual JSON export/import as the only backup path — there is no automatic cloud backup.
- Constraint: any change touching the stored data shape or migration logic must not risk a real user's already-logged sessions.

## Brand Commitments

- App name/wordmark: **"Lisa Muscu"** (PWA title), stylized as **muscu** (quiet, technical) / **lisa** (the identity mark) in-product; also referred to as **"musculisa"** in shareable session-summary images. Repo/legacy name "Strength & Calisthenics Tracker" / "FitTrack" still appears in older build artifacts and should not be treated as current.
- Voice: French, first-person casual/direct, written the way Lisa talks to herself mid-workout ("Séance terminée !", "Comment tu t'es sentie ?") — not corporate or coach-performative.

## Evidence on Hand

- `README.md` — a real, maintained case-study writeup of the product's purpose, feature set, and build history since March 2026.
- `screenshots/` — real product screenshots on disk (`calendar.png`, `squat-cycle.png`, `session-complete.png`, `supersets-config.png`, `stats-volume-rpe.png`, `stats-records.png`), usable as genuine evidence, not placeholders.
- No testimonials, case studies, press, or third-party proof exist, and none should be fabricated — this is a personal/small-circle tool, not a marketed product.

## Product Principles

1. **Gym-speed first.** Every flow is judged by whether it survives being used one-handed, mid-set, sometimes offline, in a few seconds.
2. **Automate the arithmetic, never the judgment.** Training Max, load percentages, and week position are computed for her; what to lift and how hard is always her call.
3. **One data model, two lenses.** Calendar (chronological) and Stats (analytical) are two views over the same sessions — never a reason to duplicate or fork the underlying log.
4. **Her data, her format, forever.** Local-first and exportable is not a technical detail — it's the reason this tool exists instead of a mainstream app.
5. **Every training method is a first-class citizen.** 5/3/1, Cluster, EMOM, and freeform sessions all deserve the same quality of automatic load calculation and history tracking — none is a bolted-on afterthought.
