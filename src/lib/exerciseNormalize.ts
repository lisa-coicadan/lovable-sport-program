// Normalize exercise names so variants map to a canonical name.
// Used for stats, PRs, and progression comparisons.

interface NormalizationRule {
  canonical: string;
  keywords: string[]; // any keyword match (lowercased, accents stripped) maps to canonical
}

const RULES: NormalizationRule[] = [
  {
    canonical: 'Squat',
    keywords: ['squat', '5/3/1 squat', '531 squat'],
  },
  {
    canonical: 'Développé couché',
    keywords: [
      'developpe couche', 'developpe-couche', 'dev couche', 'dc',
      'bench', 'bench press', 'developpe couche barre', 'developpe couche haltere',
    ],
  },
  {
    canonical: 'Tractions lestées',
    keywords: [
      'traction', 'tractions', 'traction lestee', 'tractions lestees',
      'pull up', 'pullup', 'pull-up', 'weighted pull up',
    ],
  },
  {
    canonical: 'Dips lestés',
    keywords: ['dip', 'dips', 'dips lestes', 'dip leste', 'weighted dip'],
  },
  {
    canonical: 'RDL',
    keywords: ['rdl', 'romanian deadlift', 'rdl barre', 'rdl haltere', 'soulevé roumain', 'souleve roumain'],
  },
];

// Exercises tracked for PRs (canonical names only)
export const PR_TRACKED_EXERCISES = [
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
    .replace(/[^a-z0-9+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeExerciseName(name: string): string {
  if (!name) return name;
  const c = clean(name);
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const ck = clean(kw);
      // word-boundary-ish match: exact, contains, or starts-with
      if (c === ck || c.includes(ck) || ck.includes(c)) {
        return rule.canonical;
      }
    }
  }
  // Return original (preserve user-provided casing) when no rule matches
  return name.trim();
}

export function isPrTracked(name: string): boolean {
  return PR_TRACKED_EXERCISES.includes(normalizeExerciseName(name));
}
