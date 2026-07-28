#!/usr/bin/env node
/**
 * Data-risk guard — PreToolUse entry point for Edit|Write|MultiEdit.
 *
 * Out of scope files: exits immediately, no output, no overhead.
 * In-scope, level nul/mineur: logs an audit trace, allows silently.
 * In-scope, level reel: logs an audit trace, records a pending push-gate
 * entry, and asks for explicit human confirmation via the real Claude Code
 * permission prompt (not just Claude asserting it's fine).
 */

import {
  readStdinJson,
  resolveProjectDir,
  extractOldNew,
  isInScope,
  evaluateRisk,
  formatReasonForEdit,
  appendAudit,
  addPendingEntry,
} from './lib.mjs';

async function main() {
  const event = await readStdinJson();
  if (!event || !['Edit', 'Write', 'MultiEdit'].includes(event.tool_name)) return;

  const input = event.tool_input || {};
  const filePath = input.file_path;
  if (!filePath) return;

  const projectDir = resolveProjectDir(event);
  const { oldText, newText } = extractOldNew(event.tool_name, input);
  const scope = isInScope({ filePath, oldText, newText, projectDir });
  if (!scope.inScope) return;

  const { level, rules } = evaluateRisk({ oldText, newText, isStorageFile: scope.isStorageFile });
  const timestamp = new Date().toISOString();

  appendAudit(projectDir, {
    kind: 'edit',
    timestamp,
    session_id: event.session_id,
    tool: event.tool_name,
    file: scope.relPath,
    level,
    rules: rules.map(r => r.id),
  });

  if (level !== 'reel') return;

  addPendingEntry(projectDir, {
    file: scope.relPath,
    level,
    rules: rules.map(r => ({ id: r.id, message: r.message })),
    timestamp,
    session_id: event.session_id,
  });

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: formatReasonForEdit({ file: scope.relPath, level, rules }),
    },
  }));
}

main()
  .catch(() => {}) // never break the turn on an unexpected hook bug
  .finally(() => process.exit(0));
