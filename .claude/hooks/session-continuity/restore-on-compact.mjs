#!/usr/bin/env node
/**
 * Session continuity — SessionStart entry point (matcher "compact" uniquement).
 *
 * Contrairement à PreCompact, le stdout d'un hook SessionStart est bien
 * réinjecté dans la conversation (via hookSpecificOutput.additionalContext).
 * On relit ici l'instantané écrit juste avant par snapshot-on-precompact.mjs
 * pour redonner à Claude, immédiatement après le résumé, la todo list encore
 * ouverte et les fichiers non commités — l'info la plus susceptible de se
 * diluer dans un résumé de conversation longue. Best-effort, silencieux si
 * rien à restaurer.
 */

import fs from 'node:fs';
import path from 'node:path';

async function readStdinJson() {
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

function resolveProjectDir(event) {
  return process.env.CLAUDE_PROJECT_DIR || (event && event.cwd) || process.cwd();
}

function formatContext(snapshot) {
  const parts = [];

  if (snapshot.pendingTasks?.length) {
    const lines = snapshot.pendingTasks.map(
      (t) => `- [${t.status}] ${t.subject}`
    );
    parts.push(`Tâches en cours avant le résumé :\n${lines.join('\n')}`);
  }

  if (snapshot.gitStatus) {
    parts.push(`Fichiers non commités avant le résumé :\n${snapshot.gitStatus}`);
  }

  if (!parts.length) return null;

  return (
    `[Continuité post-/compact] ${parts.join('\n\n')}\n\n` +
    `Ceci est un rappel automatique de l'état juste avant le résumé — vérifie que c'est toujours à jour avant d'agir dessus.`
  );
}

async function main() {
  const event = await readStdinJson();
  if (!event || event.source !== 'compact') return;

  const projectDir = resolveProjectDir(event);
  const statePath = path.join(
    projectDir,
    '.claude',
    'hooks',
    'session-continuity',
    'state',
    'last-tasks.json'
  );

  if (!fs.existsSync(statePath)) return;

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return;
  }

  const additionalContext = formatContext(snapshot);
  if (!additionalContext) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    })
  );
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
