import { ExerciseEquipment, EQUIPMENT_LABELS } from './types';

// Normalize exercise names so variants map to a canonical name.
// IMPORTANT: equipment variants (barre, haltère, smith, machine, poulie, élastique)
// are NOT merged together because the loads are not comparable.
// Only the BARBELL variant maps to the PR-tracked canonical name.

interface EquipmentDetection {
  key: 'barre' | 'haltere' | 'smith' | 'machine' | 'poulie' | 'elastique' | 'assiste' | 'unilateral';
  label: string;
  keywords: string[];
}

const EQUIPMENT: EquipmentDetection[] = [
  { key: 'haltere', label: 'haltères', keywords: ['haltere', 'halteres', 'dumbbell', 'db', 'hltr'] },
  { key: 'smith', label: 'Smith', keywords: ['smith', 'smith machine'] },
  // Machine-assisted (e.g. assisted pull-up/dip machine) — distinct from "machine" above,
  // and from "elastique" (band-assisted): tractions/dips have both an elastic-band and a
  // dedicated assisted-machine variant, with different load characteristics.
  { key: 'assiste', label: 'assisté', keywords: ['assiste', 'assistee', 'assistes', 'assistees', 'assisted'] },
  { key: 'machine', label: 'machine', keywords: ['machine', 'guide', 'hammer'] },
  { key: 'poulie', label: 'poulie', keywords: ['poulie', 'cable', 'cables'] },
  { key: 'elastique', label: 'élastique', keywords: ['elastique', 'band', 'bands'] },
  { key: 'barre', label: 'barre', keywords: ['barre', 'barbell', 'bb'] },
];

// General word-abbreviation dictionary, applied to ANY exercise name (not just the
// canonical lifts below) so common shorthand and full spellings converge to the same
// grouping key for stats/history — e.g. "dev militaire" and "Développé militaire" become
// the same exercise. Keys are matched against already-`clean()`ed tokens (lowercase,
// accents stripped), values are the nicely-accented canonical spelling. Grow this list
// as new abbreviations come up — equipment words (haltère, barre, poulie...) don't need
// an entry here, they're already handled by EQUIPMENT above.
const WORD_CANONICAL: Record<string, string> = {
  dev: 'développé', dvpe: 'développé', dc: 'développé', developpe: 'développé',
  mil: 'militaire', milit: 'militaire',
  lat: 'latérale', later: 'latérale', laterale: 'latérale', laterales: 'latérales', lats: 'latérales',
  uni: 'unilatéral', unilat: 'unilatéral', unilateral: 'unilatéral', unilaterale: 'unilatérale',
  trac: 'traction',
  ext: 'extension',
  sdt: 'soulevé de terre',
  ohp: 'overhead press',
};

// Expands abbreviation tokens, word by word, on the ORIGINAL (accent/case-preserving)
// text — only tokens that match a WORD_CANONICAL key get replaced (with the dictionary's
// accented spelling); every other token keeps its original accents/case untouched.
// Returns whether any token actually changed.
function expandAbbreviations(original: string): { text: string; changed: boolean } {
  let changed = false;
  const tokens = original.split(/\s+/).map(tok => {
    const canonical = WORD_CANONICAL[clean(tok)];
    if (canonical) { changed = true; return canonical; }
    return tok;
  });
  return { text: tokens.join(' '), changed };
}

// Finds an equipment keyword among the (already whitespace-split) ORIGINAL tokens by
// comparing their cleaned forms — so it works regardless of accents/case in the input.
// Handles multi-word keywords (e.g. "smith machine") as a token window.
function findEquipmentSpan(tokens: string[]): { eq: EquipmentDetection; start: number; end: number } | null {
  const cleanedTokens = tokens.map(clean);
  for (const eq of EQUIPMENT) {
    for (const kw of eq.keywords) {
      const kwTokens = kw.split(' ');
      for (let i = 0; i <= cleanedTokens.length - kwTokens.length; i++) {
        if (cleanedTokens.slice(i, i + kwTokens.length).join(' ') === kwTokens.join(' ')) {
          return { eq, start: i, end: i + kwTokens.length };
        }
      }
    }
  }
  return null;
}

interface NormalizationRule {
  canonical: string; // canonical name when equipment is BARBELL (or default for the lift)
  prTracked: boolean; // PR is tracked for the barbell variant only
  keywords: string[];
  // If equipment qualifier detected, output `${baseLabel} ${equipmentLabel}`.
  baseLabel: string;
}

const RULES: NormalizationRule[] = [
  // Isolated Squat variants — each is its own analytical entity, NEVER merged with Squat.
  // Order matters: more specific patterns (bulgarian, split, front, hack, goblet) must
  // match BEFORE the plain "squat" rule below, otherwise a generic keyword would win.
  {
    canonical: 'Bulgarian Split Squat',
    baseLabel: 'Bulgarian Split Squat',
    prTracked: false,
    keywords: ['bulgarian split squat', 'bulgarian squat', 'squat bulgare'],
  },
  {
    canonical: 'Split Squat',
    baseLabel: 'Split Squat',
    prTracked: false,
    keywords: ['split squat'],
  },
  {
    canonical: 'Front Squat',
    baseLabel: 'Front Squat',
    prTracked: false,
    keywords: ['front squat', 'squat avant'],
  },
  {
    // Isolated from bilateral Leg press / Hack Squat, same principle as the other Squat
    // variants above — one leg at a time isn't comparable load-wise. Must come BEFORE the
    // Hack Squat rule below: "single leg press" contains "leg press" as a bounded
    // substring and would otherwise match that rule's keyword first.
    canonical: 'Leg press unilatéral',
    baseLabel: 'Leg press unilatéral',
    prTracked: false,
    keywords: ['single leg press', 'single press', 'leg press unilateral', 'leg press unilatéral'],
  },
  {
    canonical: 'Hack Squat',
    baseLabel: 'Hack Squat',
    prTracked: false,
    // Squat pendulum machine lands here too — it's a fixed-path machine squat like hack
    // squat, its loads aren't comparable to free-weight Squat despite the shared name.
    // Leg press too — she logs it interchangeably with hack squat (whichever machine is
    // free at the gym), originally under the combined exercise name "Hack squat ou leg
    // press"; renaming a session's exercise to just "Leg press" must still land in the
    // same bucket, or its history silently looks empty.
    keywords: ['hack squat', 'squat pendule', 'pendulum squat', 'leg press', 'legpress', 'presse a cuisses', 'presse cuisses'],
  },
  {
    canonical: 'Goblet Squat',
    baseLabel: 'Goblet Squat',
    prTracked: false,
    keywords: ['goblet squat', 'squat goblet'],
  },
  {
    canonical: 'Squat',
    baseLabel: 'Squat',
    prTracked: true,
    keywords: ['squat', '5/3/1 squat', '531 squat', 'back squat'],
  },
  {
    canonical: 'Développé couché',
    baseLabel: 'Développé couché',
    prTracked: true,
    keywords: [
      'developpe couche', 'dev couche', 'dc', 'bench', 'bench press',
    ],
  },
  {
    canonical: 'Tractions lestées',
    baseLabel: 'Tractions',
    prTracked: true,
    keywords: ['traction', 'tractions', 'pull up', 'pullup', 'pull-up'],
  },
  {
    canonical: 'Dips lestés',
    baseLabel: 'Dips',
    prTracked: true,
    keywords: ['dip', 'dips'],
  },
  {
    // Bodyweight-optional like tractions/dips (see bodyweightTonnageFraction below), but
    // not part of PR_TRACKED_CANONICAL/no France record data exists for it — it still gets
    // the Force/1RM-test/vrai-1RM feature set via strengthStandards.ts's separate
    // FORCE_ELIGIBLE_MOVEMENTS list, just without the record-de-France comparison.
    canonical: 'Muscle up',
    baseLabel: 'Muscle up',
    prTracked: false,
    keywords: ['muscle up', 'muscleup', 'mu'],
  },
  {
    canonical: 'Pompes',
    baseLabel: 'Pompes',
    prTracked: false,
    keywords: ['pompe', 'pompes', 'push up', 'pushup', 'push-up'],
  },
  {
    canonical: 'RDL',
    baseLabel: 'RDL',
    prTracked: false,
    keywords: ['rdl', 'romanian deadlift', 'souleve roumain', 'souleve de terre roumain'],
  },
  // Must come AFTER 'RDL' above: "soulevé de terre roumain" also contains "soulevé de
  // terre" as a bounded substring, so RDL needs first refusal or every RDL set would be
  // miscounted as a plain deadlift.
  {
    canonical: 'Soulevé de terre',
    baseLabel: 'Soulevé de terre',
    prTracked: true,
    keywords: ['soulevé de terre', 'souleve de terre', 'deadlift', 'sdt'],
  },
];

export const PR_TRACKED_CANONICAL = [
  'Tractions lestées',
  'Dips lestés',
  'Squat',
  'Développé couché',
  'Soulevé de terre',
];

function clean(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Accent/case-insensitive fold for free-text search matching (e.g. StatsTab's "rechercher
// un exercice") \u2014 lighter than `clean` above (no punctuation stripping, so "d\u00e9velopp\u00e9
// couch\u00e9" and "developpe couche" both fold to the same "developpe couche" but multi-word
// spacing/punctuation is otherwise left alone, which is all a substring search needs).
export function foldAccents(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function detectEquipment(cleaned: string): EquipmentDetection | null {
  for (const eq of EQUIPMENT) {
    for (const kw of eq.keywords) {
      const re = new RegExp(`(^|[ -])${kw}([ -]|$)`);
      if (re.test(cleaned)) return eq;
    }
  }
  return null;
}

function matchRule(cleaned: string): NormalizationRule | null {
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const ck = clean(kw);
      const re = new RegExp(`(^|[ -])${ck}([ -]|$)`);
      if (re.test(cleaned) || cleaned === ck) return rule;
    }
  }
  return null;
}

// Sentence case: capitalize the first letter, lowercase the rest — matches the
// convention used by the canonical lifts (e.g. "Développé couché"). Accents are
// preserved (JS's toLowerCase/toUpperCase don't strip them).
function sentenceCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function normalizeExerciseName(name: string): string {
  if (!name) return name;
  const trimmed = name.trim();
  const c = clean(trimmed);
  const rule = matchRule(c);

  if (rule) {
    const eq = detectEquipment(c);
    // No equipment qualifier OR explicit barbell -> canonical
    if (!eq || eq.key === 'barre') return rule.canonical;
    // Other equipment: keep distinct, e.g. "Développé couché haltères"
    return `${rule.baseLabel} ${eq.label}`;
  }

  // Not one of the canonical/PR-tracked lifts. Only rewrite the name if an abbreviation
  // or an equipment variant was actually detected — otherwise preserve exactly what was
  // typed (just case-normalized) so unrelated exercise names are never altered. Works
  // token by token on the ORIGINAL text so untouched words keep their original accents.
  const tokens = trimmed.split(/\s+/);
  const eqSpan = findEquipmentSpan(tokens);
  const remainingTokens = eqSpan ? [...tokens.slice(0, eqSpan.start), ...tokens.slice(eqSpan.end)] : tokens;
  const { text: expanded, changed } = expandAbbreviations(remainingTokens.join(' '));

  if (!eqSpan && !changed) return sentenceCase(trimmed);

  const base = sentenceCase(expanded);
  if (!eqSpan || eqSpan.eq.key === 'barre') return base;
  return `${base} ${eqSpan.eq.label}`;
}

export function isPrTracked(name: string): boolean {
  // Only the canonical (barbell / weighted) variant counts as a PR
  return PR_TRACKED_CANONICAL.includes(normalizeExerciseName(name));
}

// Back-compat export
export const PR_TRACKED_EXERCISES = PR_TRACKED_CANONICAL;

// French sub-group label for each equipment variant, for grouping in the history view
// (e.g. "Développé couché" as a group, with "à la barre" / "aux haltères" / ... as
// sub-exercises). Distinct from the PR-tracking convention above, where the barbell
// variant has no suffix — here every detected variant, barbell included, gets an
// explicit label so they can be shown as siblings without merging their loads.
const EQUIPMENT_VARIANT_LABEL: Record<EquipmentDetection['key'], string> = {
  barre: 'à la barre',
  haltere: 'aux haltères',
  smith: 'à la Smith',
  machine: 'à la machine',
  poulie: 'à la poulie',
  elastique: "à l'élastique",
  assiste: 'assisté',
  unilateral: 'unilatéral',
};

// Splits a raw exercise name into its equipment-agnostic base name and, if an equipment
// keyword was detected, a sub-group label for that variant (null otherwise). Used to
// group equipment variants of the same exercise together in the UI (history view)
// without merging their tracked loads — see EQUIPMENT/normalizeExerciseName above.
export function splitEquipmentVariant(name: string): { base: string; variantLabel: string | null } {
  if (!name) return { base: name, variantLabel: null };
  const tokens = name.trim().split(/\s+/);
  const eqSpan = findEquipmentSpan(tokens);
  if (!eqSpan) return { base: normalizeExerciseName(name), variantLabel: null };

  const withoutEquipment = [...tokens.slice(0, eqSpan.start), ...tokens.slice(eqSpan.end)].join(' ');
  return {
    base: normalizeExerciseName(withoutEquipment || name),
    variantLabel: EQUIPMENT_VARIANT_LABEL[eqSpan.eq.key] ?? eqSpan.eq.label,
  };
}

// Resolves the variant (equipment + unilatéral) a logged set actually used — the
// structured SetLog.equipment/unilateral fields when present (stamped from the exercise
// template at logging time, editable retroactively per past session), falling back to
// parsing the exercise name's text (splitEquipmentVariant) for sets logged before those
// fields existed. This is the single source of truth for grouping history/PRs by variant —
// NOT the exercise template's CURRENT value, which can drift from what a past session
// actually used.
export function resolveSetVariant(set: { exerciseName: string; equipment?: ExerciseEquipment; unilateral?: boolean }): { equipmentLabel: string | null; unilateral: boolean } {
  if (set.equipment !== undefined || set.unilateral !== undefined) {
    return {
      equipmentLabel: set.equipment ? EQUIPMENT_LABELS[set.equipment] : null,
      unilateral: !!set.unilateral,
    };
  }
  const { variantLabel } = splitEquipmentVariant(set.exerciseName);
  return { equipmentLabel: variantLabel, unilateral: false };
}

// Fraction of bodyweight actually moved by one rep, for exercises where `weight` is
// logged as an ADDITION to (or, negative, an assistance against) bodyweight rather than
// the total load — used by tonnage.ts to turn `weight` into a real kg figure. Tractions/
// dips/muscle-ups move the full body (1); push-ups only load ~65% of bodyweight
// (hands/toes lever, the rest is on the toes) per standard biomechanics estimates.
// Everything else logs `weight` as the total load already, so it contributes 0 extra.
export function bodyweightTonnageFraction(name: string): number {
  const base = splitEquipmentVariant(name).base;
  if (base === 'Tractions lestées' || base === 'Dips lestés' || base === 'Muscle up') return 1;
  if (base === 'Pompes') return 0.65;
  return 0;
}

// Tractions/dips/pompes are meaningfully loggable at 0kg (bodyweight only) or even a
// negative weight (assisted via band or machine) — unlike every other exercise, where a
// weight of 0 just means "not filled in yet" and would pollute history/records if
// counted. Callers use this to decide whether a completed set should count regardless of
// its weight value (this family) or whether weight > 0 is still required (everything
// else).
export function isBodyweightOptionalExercise(name: string): boolean {
  return bodyweightTonnageFraction(name) > 0;
}

// A bare "+10 kg" or "-5 kg" doesn't say what it's relative to — for tractions/dips lestés
// (and any other bodyweight-optional exercise), this makes the "poids du corps" baseline
// explicit: "pdc +10 kg" (weighted), "pdc -5 kg" (assisted), or plain "pdc" for a strict
// bodyweight rep (weight === 0). Every other exercise is unaffected (`${weight} kg`).
export function formatWeightDisplay(weight: number, exerciseName: string): string {
  return formatWeightDisplayFor(weight, isBodyweightOptionalExercise(exerciseName));
}

// Same as formatWeightDisplay, for callers that already have the bodyweight-optional flag
// on hand (e.g. ExerciseHistory's VariantSection, scoped to one exercise for its whole
// render) and would otherwise have to re-derive it from a name on every call.
export function formatWeightDisplayFor(weight: number, bodyweightOptional: boolean): string {
  if (!bodyweightOptional) return `${weight} kg`;
  if (weight === 0) return 'pdc';
  return `pdc ${weight > 0 ? '+' : '-'}${Math.abs(weight)} kg`;
}
