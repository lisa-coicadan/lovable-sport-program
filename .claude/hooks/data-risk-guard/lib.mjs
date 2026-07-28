/**
 * Data-risk guard — shared library.
 *
 * Two hook entry points share this file:
 *   - guard-edit.mjs      (PreToolUse: Edit|Write|MultiEdit)
 *   - guard-push-pre.mjs  (PreToolUse: Bash, only `git push`)
 *   - guard-push-post.mjs (PostToolUse: Bash, only `git push`)
 *
 * Scope: src/lib/storage.ts, src/lib/types.ts, or any touched file whose
 * diff mentions "migrat" (case-insensitive) — matching CLAUDE.md's own
 * description of where AppData/SessionLog's shape and the localStorage
 * migration/format logic actually live. This is intentionally narrower than
 * "every file that references AppData", since that type is imported by
 * almost every component — only the two files that define/persist the
 * shape carry real format risk.
 *
 * Risk detection is regex-based pattern matching over the touched text, not
 * an AST parse or an LLM judgement — same philosophy as the impeccable
 * hook's detector. It can misfire on unusual formatting; when in doubt it
 * favors flagging (a false "ask" is an extra click, a missed real risk is
 * not).
 *
 * The `ask` permission decision hands control to the actual Claude Code
 * permission prompt — a real human has to click through it, not just Claude
 * asserting confirmation. The push gate (pending.json) is *not* scoped to a
 * single session: a risky edit made in one session should still gate a push
 * attempted in a later session, since the underlying risk to the data on
 * disk hasn't changed. It only clears once a `git push` actually succeeds
 * after being explicitly approved (see guard-push-post.mjs).
 */

import fs from 'node:fs';
import path from 'node:path';

const STATE_DIRNAME = path.join('.claude', 'hooks', 'data-risk-guard', 'state');

export async function readStdinJson() {
  try {
    if (process.stdin.isTTY) return null;
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function resolveProjectDir(event) {
  return process.env.CLAUDE_PROJECT_DIR || (event && event.cwd) || process.cwd();
}

export function extractOldNew(toolName, input) {
  if (toolName === 'Edit') {
    return { oldText: input.old_string || '', newText: input.new_string || '' };
  }
  if (toolName === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    return {
      oldText: edits.map(e => e.old_string || '').join('\n'),
      newText: edits.map(e => e.new_string || '').join('\n'),
    };
  }
  if (toolName === 'Write') {
    let oldText = '';
    try {
      oldText = fs.readFileSync(input.file_path, 'utf-8');
    } catch {
      // New file — nothing to diff against.
    }
    return { oldText, newText: input.content || '' };
  }
  return { oldText: '', newText: '' };
}

export function isInScope({ filePath, oldText, newText, projectDir }) {
  if (!filePath) return { inScope: false };
  // macOS can hand back accented paths (this project's dir has "é" in
  // "génie") in either NFC or NFD form depending on the source (getcwd vs a
  // shell-built string) — normalize before comparing or path.relative()
  // treats visually-identical paths as unrelated and emits "../.." noise.
  const rel = path.relative(projectDir.normalize('NFC'), filePath.normalize('NFC')).replace(/\\/g, '/');
  if (rel.endsWith('src/lib/storage.ts')) return { inScope: true, isStorageFile: true, relPath: rel };
  if (rel.endsWith('src/lib/types.ts')) return { inScope: true, isStorageFile: false, relPath: rel };
  // The "migrat" fallback is meant to catch migration *code* living outside
  // those two files, not prose that merely talks about migration (e.g. this
  // hook's own doc comments, CLAUDE.md) — restrict it to app source files,
  // and exclude the hook's own tooling directory (recursively self-flagging
  // its own "migration" doc comments would just be noise).
  if (
    /\.(ts|tsx|js|jsx|mjs)$/.test(rel) &&
    !rel.startsWith('.claude/') &&
    (/migrat/i.test(oldText) || /migrat/i.test(newText))
  ) {
    return { inScope: true, isStorageFile: false, relPath: rel };
  }
  return { inScope: false };
}

// Heuristic field extractor for TS interface/type bodies: `name?: type;`.
// Not an AST parse — will also pick up look-alike lines outside interfaces
// (e.g. object literal keys). Acceptable for storage.ts/types.ts, which are
// mostly interface bodies and narrow migration functions.
function extractFields(text) {
  const fields = new Map();
  const re = /(?:^|\n)[ \t]*([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;\n{]+);?/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, optMark, type] = m;
    fields.set(name, { optional: !!optMark, type: type.trim() });
  }
  return fields;
}

function extractStorageKey(text) {
  const m = text.match(/STORAGE_KEY\s*=\s*['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

export function evaluateRisk({ oldText, newText, isStorageFile }) {
  const rules = [];
  const oldFields = extractFields(oldText);
  const newFields = extractFields(newText);

  for (const [name, oldMeta] of oldFields) {
    if (!newFields.has(name)) {
      rules.push({
        id: 'champ-supprime',
        message: `Le champ "${name}" (présent avant) n'apparaît plus dans le nouveau code — perte potentielle d'un champ existant dans les données déjà stockées.`,
      });
      continue;
    }
    const newMeta = newFields.get(name);
    if (oldMeta.optional && !newMeta.optional) {
      rules.push({
        id: 'optionnel-devenu-obligatoire',
        message: `Le champ "${name}" passe d'optionnel à obligatoire — les données déjà stockées qui ne l'ont pas encore rempliraient un champ requis manquant.`,
      });
    }
    if (oldMeta.type !== newMeta.type) {
      rules.push({
        id: 'type-modifie',
        message: `Le type du champ "${name}" change ("${oldMeta.type}" → "${newMeta.type}") — les valeurs déjà stockées dans l'ancien format pourraient ne plus correspondre.`,
      });
    }
  }

  if (isStorageFile) {
    const oldKey = extractStorageKey(oldText);
    const newKey = extractStorageKey(newText);
    if (oldKey && newKey && oldKey !== newKey) {
      rules.push({
        id: 'cle-storage-modifiee',
        message: `La clé localStorage change ("${oldKey}" → "${newKey}") — l'app ne relira plus les données existantes stockées sous l'ancienne clé.`,
      });
    }
    if (/migrat/i.test(oldText) || /migrat/i.test(newText)) {
      rules.push({
        id: 'logique-migration-touchee',
        message: `La modification touche du code de migration (mot "migrat" détecté dans storage.ts) — c'est le mécanisme qui relit les anciennes données ; une erreur ici peut casser leur chargement.`,
      });
    }
    if (/JSON\.(parse|stringify)\s*\(/.test(oldText) || /JSON\.(parse|stringify)\s*\(/.test(newText)) {
      rules.push({
        id: 'parse-serialize-touche',
        message: `La modification touche un appel JSON.parse/JSON.stringify — c'est le point de (dé)sérialisation des données stockées.`,
      });
    }
  } else if (/migrat/i.test(oldText) || /migrat/i.test(newText)) {
    rules.push({
      id: 'mention-migration',
      message: `Le mot "migrat" apparaît dans la modification — probablement lié au format des données stockées.`,
    });
  }

  if (rules.length > 0) {
    return { level: 'reel', rules };
  }

  const addedFields = [...newFields.keys()].filter(n => !oldFields.has(n));
  const addedAllOptional = addedFields.length > 0 && addedFields.every(n => newFields.get(n).optional);
  if (addedAllOptional) {
    return {
      level: 'mineur',
      rules: [{
        id: 'ajout-champ-optionnel',
        message: `Seul(s) champ(s) optionnel(s) ajouté(s) (${addedFields.join(', ')}) — aucun champ existant supprimé ni modifié.`,
      }],
    };
  }

  return {
    level: 'nul',
    rules: [{
      id: 'aucun-motif-detecte',
      message: `Fichier dans la portée du hook, mais aucun changement de structure de champ, de clé de stockage ou de logique de migration détecté dans le texte modifié.`,
    }],
  };
}

export function formatReasonForEdit({ file, level, rules }) {
  const lines = [];
  lines.push(`⚠️ Risque ${level === 'reel' ? 'RÉEL' : level} détecté sur ${file} (fichier de schéma/format des données).`);
  lines.push('');
  lines.push('Critères déclenchés :');
  for (const r of rules) lines.push(`- ${r.message}`);
  lines.push('');
  lines.push("Avant de continuer : exporte un JSON de sauvegarde depuis Réglages (bouton export) si ce n'est pas déjà fait.");
  lines.push("Le push (git push) sera aussi bloqué séparément tant que ce changement n'aura pas été explicitement confirmé.");
  return lines.join('\n');
}

export function formatReasonForPush(pending) {
  const files = [...new Set(pending.entries.map(e => e.file))];
  const lines = [];
  lines.push('⚠️ Ce push contient au moins une modification jugée à risque réel pour le format des données stockées :');
  lines.push('');
  for (const file of files) {
    lines.push(`Fichier : ${file}`);
    const seen = new Set();
    for (const e of pending.entries.filter(x => x.file === file)) {
      for (const r of e.rules) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        lines.push(`  - ${r.message}`);
      }
    }
  }
  lines.push('');
  lines.push('As-tu exporté un JSON de sauvegarde depuis Réglages avant de pousser ? Si oui, tu peux confirmer ce push.');
  return lines.join('\n');
}

export function isGitPushCommand(command) {
  return typeof command === 'string' && /\bgit\s+push\b/.test(command);
}

// `--dry-run`/`-n` push output still contains a "->" ref line, which would
// otherwise look like a real success to looksLikeSuccessfulPush() — nothing
// actually reached the remote, so the pending gate must not clear.
export function isDryRunPush(command) {
  return typeof command === 'string' && /\bgit\s+push\b.*(--dry-run|\s-n\b)/.test(command);
}

// Heuristic only — Bash tool_response doesn't reliably expose a numeric exit
// code across Claude Code versions, so this reads stdout/stderr for common
// git success/failure markers. Ambiguous output is treated as "not
// confirmed successful" so the flag stays pending rather than clearing on a
// guess.
export function looksLikeSuccessfulPush(response) {
  const text = `${response.stdout || ''}\n${response.stderr || ''}`;
  if (/\b(rejected|failed to push|fatal:|error:|permission denied|non-fast-forward|could not read|authentication failed)\b/i.test(text)) {
    return false;
  }
  if (/everything up-to-date/i.test(text)) return true;
  if (/->/.test(text)) return true;
  return false;
}

function stateDir(projectDir) {
  const dir = path.join(projectDir, STATE_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pendingPath(projectDir) {
  return path.join(stateDir(projectDir), 'pending.json');
}

function auditPath(projectDir) {
  return path.join(stateDir(projectDir), 'audit.log.jsonl');
}

export function appendAudit(projectDir, entry) {
  try {
    fs.appendFileSync(auditPath(projectDir), JSON.stringify(entry) + '\n');
  } catch {
    // Never break the turn on a logging failure.
  }
}

export function readPending(projectDir) {
  try {
    return JSON.parse(fs.readFileSync(pendingPath(projectDir), 'utf-8'));
  } catch {
    return null;
  }
}

export function addPendingEntry(projectDir, entry) {
  const existing = readPending(projectDir) || { entries: [] };
  existing.entries.push(entry);
  existing.updatedAt = entry.timestamp;
  existing.createdAt = existing.createdAt || entry.timestamp;
  try {
    fs.writeFileSync(pendingPath(projectDir), JSON.stringify(existing, null, 2));
  } catch {
    // Best effort — worst case the push gate doesn't persist this entry.
  }
}

export function clearPending(projectDir) {
  try {
    if (fs.existsSync(pendingPath(projectDir))) {
      fs.unlinkSync(pendingPath(projectDir));
      return true;
    }
  } catch {
    // Best effort.
  }
  return false;
}
