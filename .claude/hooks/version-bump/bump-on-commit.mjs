#!/usr/bin/env node
/**
 * Version bump — PreToolUse entry point for Bash, triggers on `git commit` only.
 *
 * Auto-increments package.json's MINOR version (X.Y.0 -> X.(Y+1).0) and stages
 * it, so every commit carries a bumped version — the app displays "vX.Y" in
 * the Séance tab, letting the user check which build a friend's phone is
 * actually running. If "version" is already part of the staged diff (a
 * deliberate manual bump, e.g. resetting to (X+1).0.0 for a big change), this
 * is left untouched — never double-bumped. Silent auto-fix, never blocks the
 * commit (no permissionDecision — unlike data-risk-guard, there's no risk to
 * gate here).
 */

import { execSync } from 'node:child_process';
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

function isGitCommitCommand(command) {
  return typeof command === 'string' && /\bgit\s+commit\b/.test(command);
}

function versionAlreadyStaged(projectDir) {
  try {
    const diff = execSync('git diff --cached -- package.json', { cwd: projectDir, encoding: 'utf-8' });
    return /"version"\s*:/.test(diff);
  } catch {
    return false;
  }
}

function bumpMinor(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const [major = 0, minor = 0] = String(pkg.version || '0.0.0')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  pkg.version = `${major}.${minor + 1}.0`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  execSync('git add package.json', { cwd: projectDir });
}

async function main() {
  const event = await readStdinJson();
  if (!event || event.tool_name !== 'Bash') return;

  const command = (event.tool_input && event.tool_input.command) || '';
  if (!isGitCommitCommand(command)) return;

  const projectDir = resolveProjectDir(event);
  if (versionAlreadyStaged(projectDir)) return;

  try {
    bumpMinor(projectDir);
  } catch {
    // Best effort — un échec ici ne doit jamais bloquer le commit.
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
