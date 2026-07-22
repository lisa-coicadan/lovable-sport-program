// Parses freeform session notes into a structured workout. One exercise per line, order
// is flexible ("Nom : SxR", "Nom SxR", "SxR Nom"). Weight is only recognized when
// followed by "kg". "+" joins two exercises into a superset; if the second clause has
// only one number, it's read as reps and inherits the set count from the first (sets are
// always shared across a superset pair, matching the app's superset model). Lines that
// don't match any pattern are returned as `unrecognizedLines` instead of being guessed.

export interface ParsedExercise {
  name: string;
  sets: number;
  reps: number;
  weight?: number;
  supersetGroupId?: string;
  supersetRole?: 'A' | 'B';
}

export interface ParseNotesResult {
  sessionName: string | null;
  exercises: ParsedExercise[];
  unrecognizedLines: string[];
}

interface Clause {
  name: string;
  sets?: number;
  reps?: number;
  weight?: number;
}

const WEIGHT_RE = /(?:@|à)?\s*(\d+(?:[.,]\d+)?)\s*kg\b/i;
const SETS_REPS_RE = /(\d+)\s*[x×]\s*(\d+)/i;
const BULLET_RE = /^[-*•]\s*/;
const EDGE_PUNCT_RE = /^[:\-–]+|[:\-–]+$/g;

function parseClause(raw: string): Clause | null {
  let rest = raw.trim();

  let weight: number | undefined;
  const weightMatch = rest.match(WEIGHT_RE);
  if (weightMatch && weightMatch.index !== undefined) {
    weight = parseFloat(weightMatch[1].replace(',', '.'));
    rest = (rest.slice(0, weightMatch.index) + rest.slice(weightMatch.index + weightMatch[0].length)).trim();
  }

  let sets: number | undefined;
  let reps: number | undefined;
  const setsRepsMatch = rest.match(SETS_REPS_RE);
  if (setsRepsMatch && setsRepsMatch.index !== undefined) {
    sets = parseInt(setsRepsMatch[1], 10);
    reps = parseInt(setsRepsMatch[2], 10);
    rest = (rest.slice(0, setsRepsMatch.index) + rest.slice(setsRepsMatch.index + setsRepsMatch[0].length)).trim();
  }

  const name = rest.replace(EDGE_PUNCT_RE, '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return { name, sets, reps, weight };
}

function parseLine(rawLine: string): ParsedExercise[] | null {
  const line = rawLine.trim().replace(BULLET_RE, '');
  if (!line) return null;

  const plusIndex = line.indexOf('+');
  if (plusIndex !== -1) {
    const a = parseClause(line.slice(0, plusIndex));
    if (!a || a.sets === undefined || a.reps === undefined) return null;

    const rightRaw = line.slice(plusIndex + 1);
    let b: Clause | null = null;
    if (SETS_REPS_RE.test(rightRaw)) {
      b = parseClause(rightRaw);
      if (b) b.sets = a.sets; // sets are always shared across the superset pair
    } else {
      const repsMatch = rightRaw.match(/(\d+)/);
      if (repsMatch) {
        const name = rightRaw
          .replace(repsMatch[0], '')
          .replace(EDGE_PUNCT_RE, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (name) b = { name, sets: a.sets, reps: parseInt(repsMatch[1], 10) };
      }
    }
    if (!b || b.reps === undefined || b.sets === undefined) return null;

    const groupId = `notes-${Math.random().toString(36).slice(2, 10)}`;
    return [
      { name: a.name, sets: a.sets, reps: a.reps, weight: a.weight, supersetGroupId: groupId, supersetRole: 'A' },
      { name: b.name, sets: b.sets, reps: b.reps, weight: b.weight, supersetGroupId: groupId, supersetRole: 'B' },
    ];
  }

  const clause = parseClause(line);
  if (!clause || clause.sets === undefined || clause.reps === undefined) return null;
  return [{ name: clause.name, sets: clause.sets, reps: clause.reps, weight: clause.weight }];
}

const SESSION_LABEL_RE = /^s[ée]ance\s*\d*\s*:?\s*/i;

export function parseSessionNotes(text: string): ParseNotesResult {
  const lines = text.split('\n');
  let sessionName: string | null = null;
  let firstContentLineSeen = false;
  const exercises: ParsedExercise[] = [];
  const unrecognizedLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!firstContentLineSeen) {
      firstContentLineSeen = true;
      const asExercise = parseLine(line);
      if (asExercise) {
        exercises.push(...asExercise);
      } else {
        sessionName = line.replace(SESSION_LABEL_RE, '').trim() || line;
      }
      continue;
    }

    const parsed = parseLine(line);
    if (parsed) {
      exercises.push(...parsed);
    } else {
      unrecognizedLines.push(line);
    }
  }

  return { sessionName, exercises, unrecognizedLines };
}

// Help text shown in the UI next to the notes input.
export const NOTES_SYNTAX_HELP =
  `Une ligne par exercice, ordre libre :\n` +
  `  Développé couché : 3x8\n` +
  `  3x8 développé couché\n` +
  `  Développé militaire 4x12 @10kg   (poids reconnu seulement si suivi de "kg")\n` +
  `  Overhead press 3x12 + Élévations latérales 10   ("+" = superset, un seul chiffre = reps, séries communes)\n\n` +
  `La première ligne (si ce n'est pas elle-même un exercice) devient le nom de la séance.\n` +
  `Une ligne non reconnue reste éditable à la main, jamais devinée au hasard.`;
