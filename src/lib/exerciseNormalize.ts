// Normalize exercise names so variants map to a canonical name.
// IMPORTANT: equipment variants (barre, haltère, smith, machine, poulie, élastique)
// are NOT merged together because the loads are not comparable.
// Only the BARBELL variant maps to the PR-tracked canonical name.

interface EquipmentDetection {
  key: 'barre' | 'haltere' | 'smith' | 'machine' | 'poulie' | 'elastique' | 'unilateral';
  label: string;
  keywords: string[];
}

const EQUIPMENT: EquipmentDetection[] = [
  { key: 'haltere', label: 'haltères', keywords: ['haltere', 'halteres', 'dumbbell', 'db', 'hltr'] },
  { key: 'smith', label: 'Smith', keywords: ['smith', 'smith machine'] },
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
    canonical: 'Hack Squat',
    baseLabel: 'Hack Squat',
    prTracked: false,
    keywords: ['hack squat'],
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
    canonical: 'RDL',
    baseLabel: 'RDL',
    prTracked: false,
    keywords: ['rdl', 'romanian deadlift', 'souleve roumain', 'souleve de terre roumain'],
  },
];

export const PR_TRACKED_CANONICAL = [
  'Tractions lestées',
  'Dips lestés',
  'Squat',
  'Développé couché',
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
