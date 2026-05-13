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

interface NormalizationRule {
  canonical: string; // canonical name when equipment is BARBELL (or default for the lift)
  prTracked: boolean; // PR is tracked for the barbell variant only
  keywords: string[];
  // If equipment qualifier detected, output `${baseLabel} ${equipmentLabel}`.
  baseLabel: string;
}

const RULES: NormalizationRule[] = [
  {
    canonical: 'Squat',
    baseLabel: 'Squat',
    prTracked: true,
    keywords: ['squat', '5/3/1 squat', '531 squat', 'back squat', 'front squat'],
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

export function normalizeExerciseName(name: string): string {
  if (!name) return name;
  const c = clean(name);
  const rule = matchRule(c);
  if (!rule) return name.trim();

  const eq = detectEquipment(c);
  // No equipment qualifier OR explicit barbell -> canonical
  if (!eq || eq.key === 'barre') return rule.canonical;
  // Other equipment: keep distinct, e.g. "Développé couché haltères"
  return `${rule.baseLabel} ${eq.label}`;
}

export function isPrTracked(name: string): boolean {
  // Only the canonical (barbell / weighted) variant counts as a PR
  return PR_TRACKED_CANONICAL.includes(normalizeExerciseName(name));
}

// Back-compat export
export const PR_TRACKED_EXERCISES = PR_TRACKED_CANONICAL;
