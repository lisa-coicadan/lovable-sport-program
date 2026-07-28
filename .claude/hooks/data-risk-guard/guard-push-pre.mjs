#!/usr/bin/env node
/**
 * Data-risk guard — PreToolUse entry point for Bash, gates `git push` only.
 *
 * If no risky edit is pending, allows silently. If one is pending (from
 * this session or an earlier one — see lib.mjs), asks for explicit human
 * confirmation before the push proceeds, recapping every flagged file and
 * criterion plus the JSON export reminder.
 */

import {
  readStdinJson,
  resolveProjectDir,
  isGitPushCommand,
  readPending,
  formatReasonForPush,
  appendAudit,
} from './lib.mjs';

async function main() {
  const event = await readStdinJson();
  if (!event || event.tool_name !== 'Bash') return;

  const command = (event.tool_input && event.tool_input.command) || '';
  if (!isGitPushCommand(command)) return;

  const projectDir = resolveProjectDir(event);
  const pending = readPending(projectDir);
  const timestamp = new Date().toISOString();

  if (!pending || !pending.entries || pending.entries.length === 0) {
    appendAudit(projectDir, { kind: 'push-pre-allow', timestamp, session_id: event.session_id, command });
    return;
  }

  appendAudit(projectDir, {
    kind: 'push-pre-ask',
    timestamp,
    session_id: event.session_id,
    command,
    files: [...new Set(pending.entries.map(e => e.file))],
  });

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: formatReasonForPush(pending),
    },
  }));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
