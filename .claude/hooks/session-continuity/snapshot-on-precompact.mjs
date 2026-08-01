#!/usr/bin/env node
/**
 * Session continuity — PreCompact entry point.
 *
 * Avant qu'un /compact (manuel ou auto) n'écrase l'historique par un résumé,
 * on relit le transcript de LA session en cours pour reconstruire l'état de
 * la todo list (TaskCreate/TaskUpdate — cet environnement n'utilise pas
 * TodoWrite) et on capture le git status. Le résultat est écrit dans
 * state/last-tasks.json, relu ensuite par restore-on-compact.mjs (SessionStart,
 * matcher "compact") qui est le seul des deux hooks dont le stdout revient
 * réellement dans la conversation — PreCompact ne peut, lui, qu'écrire un
 * fichier. Best-effort, ne bloque jamais la compaction.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

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

async function reconstructTasks(transcriptPath) {
  const tasks = new Map(); // id -> { subject, status }
  let nextId = 1;

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return [];

  const rl = readline.createInterface({
    input: fs.createReadStream(transcriptPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || block.type !== 'tool_use') continue;

      if (block.name === 'TaskCreate') {
        const id = String(nextId++);
        tasks.set(id, {
          subject: block.input?.subject || '(sans titre)',
          status: 'pending',
        });
      } else if (block.name === 'TaskUpdate') {
        const id = block.input?.taskId != null ? String(block.input.taskId) : null;
        const status = block.input?.status;
        if (id && tasks.has(id) && status) {
          tasks.get(id).status = status;
        }
      }
    }
  }

  return [...tasks.values()].filter((t) => t.status !== 'completed');
}

function captureGitStatus(projectDir) {
  try {
    const out = execSync('git status --short', { cwd: projectDir, encoding: 'utf-8' });
    return out.trim();
  } catch {
    return '';
  }
}

async function main() {
  const event = await readStdinJson();
  if (!event) return;

  const projectDir = resolveProjectDir(event);
  const stateDir = path.join(projectDir, '.claude', 'hooks', 'session-continuity', 'state');
  const statePath = path.join(stateDir, 'last-tasks.json');

  const pendingTasks = await reconstructTasks(event.transcript_path);
  const gitStatus = captureGitStatus(projectDir);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    sessionId: event.session_id || null,
    trigger: event.trigger || null,
    pendingTasks,
    gitStatus,
  };

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(snapshot, null, 2));
  } catch {
    // Best effort — un échec ici ne doit jamais bloquer la compaction.
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
