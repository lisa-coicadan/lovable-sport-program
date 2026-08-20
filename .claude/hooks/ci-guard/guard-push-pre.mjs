#!/usr/bin/env node
/**
 * CI guard — PreToolUse entry point for Bash, gates `git push` only.
 *
 * This repo pushes straight to `main` with no Pull Request, so GitHub
 * Actions CI (.github/workflows/ci.yml) can only report a failure *after*
 * the push already happened — it can't block it. This hook runs the same
 * blocking checks (typecheck + tests) locally, before the push leaves the
 * machine, and denies the push outright if either fails.
 *
 * Lint is deliberately excluded: src/components/ui/ (vendored shadcn) carries
 * pre-existing lint errors that are a known baseline, not real regressions
 * (see CLAUDE.md's "UI" section) — gating on lint would block every push on
 * unrelated noise. CI still runs it, non-blocking, for visibility.
 */

import { execSync } from 'node:child_process';

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

function isGitPushCommand(command) {
  return typeof command === 'string' && /\bgit\s+push\b/.test(command);
}

function run(cmd, cwd) {
  try {
    execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
    return { ok: true };
  } catch (err) {
    const output = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
    // Keep the tail: for tsc/vitest the actionable summary (error count,
    // failing test names) is at the end of the output, not the top.
    return { ok: false, output: output.slice(-4000) };
  }
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

async function main() {
  const event = await readStdinJson();
  if (!event || event.tool_name !== 'Bash') return;

  const command = (event.tool_input && event.tool_input.command) || '';
  if (!isGitPushCommand(command)) return;

  const projectDir = process.env.CLAUDE_PROJECT_DIR || (event && event.cwd) || process.cwd();

  const tsc = run('npx tsc -p tsconfig.app.json --noEmit', projectDir);
  if (!tsc.ok) {
    deny(`⛔ Push bloqué : erreurs de typage (tsc -p tsconfig.app.json --noEmit).\n\n${tsc.output}\n\nCorrige les erreurs ci-dessus puis retente le push.`);
    return;
  }

  const test = run('npm test', projectDir);
  if (!test.ok) {
    deny(`⛔ Push bloqué : des tests échouent (npm test).\n\n${test.output}\n\nCorrige les tests ci-dessus puis retente le push.`);
    return;
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
