// Parses freeform session notes into a structured workout. The first non-blank line is
// always the session name. One exercise per line after that, order is flexible
// ("Nom : SxR", "Nom SxR", "SxR Nom"). Weight is only recognized when followed by "kg".
// "+" joins two exercises into a superset; if the second clause has only one number,
// it's read as reps and inherits the set count from the first (sets are always shared
// across a superset pair, matching the app's superset model). A lone "Nx" (no second
// number) is read as sets with reps left unknown (0, to fill in manually); a lone "xN"
// (no leading number) is read as reps with sets left unknown. Lines that don't match any
// pattern are excluded and returned as `unrecognizedLines` instead of being guessed.
// Bracketed fragments like "[ ]" or "[x]" (common checklist copy-paste artifacts) are
// stripped from every line before parsing.

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
const FULL_SETS_REPS_RE = /(\d+)\s*[x×]\s*(\d+)/i;
const SETS_ONLY_RE = /(\d+)\s*[x×](?!\s*\d)/i; // e.g. "4x tractions" — reps unknown
const REPS_ONLY_RE = /(?<!\d)[x×]\s*(\d+)/i; // e.g. "x12 tractions" — sets unknown
const BULLET_RE = /^[-*•]\s*/;
const BRACKETS_RE = /\[[^\]]*\]/g;
const EDGE_PUNCT_RE = /^[:\-–]+|[:\-–]+$/g;

// Strips bullet markers and bracketed fragments (checklist copy-paste artifacts like
// "[ ]" or "[x]") from a raw line, and collapses the resulting whitespace.
function stripArtifacts(rawLine: string): string {
  return rawLine
    .replace(BULLET_RE, '')
    .replace(BRACKETS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  const fullMatch = rest.match(FULL_SETS_REPS_RE);
  if (fullMatch && fullMatch.index !== undefined) {
    sets = parseInt(fullMatch[1], 10);
    reps = parseInt(fullMatch[2], 10);
    rest = (rest.slice(0, fullMatch.index) + rest.slice(fullMatch.index + fullMatch[0].length)).trim();
  } else {
    const setsOnlyMatch = rest.match(SETS_ONLY_RE);
    if (setsOnlyMatch && setsOnlyMatch.index !== undefined) {
      sets = parseInt(setsOnlyMatch[1], 10);
      rest = (rest.slice(0, setsOnlyMatch.index) + rest.slice(setsOnlyMatch.index + setsOnlyMatch[0].length)).trim();
    } else {
      const repsOnlyMatch = rest.match(REPS_ONLY_RE);
      if (repsOnlyMatch && repsOnlyMatch.index !== undefined) {
        reps = parseInt(repsOnlyMatch[1], 10);
        rest = (rest.slice(0, repsOnlyMatch.index) + rest.slice(repsOnlyMatch.index + repsOnlyMatch[0].length)).trim();
      }
    }
  }

  const name = rest.replace(EDGE_PUNCT_RE, '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return { name, sets, reps, weight };
}

function parseLine(line: string): ParsedExercise[] | null {
  if (!line) return null;

  const plusIndex = line.indexOf('+');
  if (plusIndex !== -1) {
    const a = parseClause(line.slice(0, plusIndex));
    if (!a || (a.sets === undefined && a.reps === undefined)) return null;

    const rightRaw = line.slice(plusIndex + 1);
    let b: Clause | null = null;
    if (FULL_SETS_REPS_RE.test(rightRaw)) {
      b = parseClause(rightRaw);
      if (b) b.sets = a.sets; // sets are always shared across the superset pair
    } else {
      const repsMatch = rightRaw.match(/[x×]?\s*(\d+)/i);
      if (repsMatch && repsMatch.index !== undefined) {
        const name = (rightRaw.slice(0, repsMatch.index) + rightRaw.slice(repsMatch.index + repsMatch[0].length))
          .replace(EDGE_PUNCT_RE, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (name) b = { name, sets: a.sets, reps: parseInt(repsMatch[1], 10) };
      }
    }
    if (!b) return null;

    const groupId = `notes-${Math.random().toString(36).slice(2, 10)}`;
    return [
      { name: a.name, sets: a.sets ?? 0, reps: a.reps ?? 0, weight: a.weight, supersetGroupId: groupId, supersetRole: 'A' },
      { name: b.name, sets: b.sets ?? 0, reps: b.reps ?? 0, weight: b.weight, supersetGroupId: groupId, supersetRole: 'B' },
    ];
  }

  const clause = parseClause(line);
  if (!clause || (clause.sets === undefined && clause.reps === undefined)) return null;
  return [{ name: clause.name, sets: clause.sets ?? 0, reps: clause.reps ?? 0, weight: clause.weight }];
}

const SESSION_LABEL_RE = /^s[ée]ance\s*\d*\s*:?\s*/i;

export function parseSessionNotes(text: string): ParseNotesResult {
  const lines = text
    .split('\n')
    .map(stripArtifacts)
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return { sessionName: null, exercises: [], unrecognizedLines: [] };
  }

  const [firstLine, ...rest] = lines;
  const sessionName = firstLine.replace(SESSION_LABEL_RE, '').trim() || firstLine;

  const exercises: ParsedExercise[] = [];
  const unrecognizedLines: string[] = [];
  for (const line of rest) {
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
  `Une ligne par exercice, possibilité de l'écrire comme\n\n` +
  `  Développé couché : 3x8\n` +
  `  3x8 développé couché\n` +
  `  Développé militaire 4x12 à 10kg\n` +
  `  3x12 Développé militaire+ 10 Élévations latérales\n\n` +
  `(le "+" permet de créer un superset)\n\n` +
  `La première ligne doit être le nom de la séance\n\n` +
  `Une ligne non reconnue n'est pas incluse et reste éditable à la main`;
