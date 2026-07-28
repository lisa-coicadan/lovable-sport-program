#!/usr/bin/env node
/**
 * Data-risk guard — PostToolUse entry point for Bash, only `git push`.
 *
 * Fires after a push actually ran (i.e. it was allowed — approved via the
 * guard-push-pre.mjs prompt, or there was nothing pending). If the push
 * looks like it succeeded, clears the pending push-gate so unrelated future
 * pushes aren't asked again. On an ambiguous or failed push, leaves the gate
 * in place so the next attempt re-asks.
 */

import {
  readStdinJson,
  resolveProjectDir,
  isGitPushCommand,
  isDryRunPush,
  looksLikeSuccessfulPush,
  clearPending,
  appendAudit,
} from './lib.mjs';

async function main() {
  const event = await readStdinJson();
  if (!event || event.tool_name !== 'Bash') return;

  const command = (event.tool_input && event.tool_input.command) || '';
  if (!isGitPushCommand(command)) return;

  const projectDir = resolveProjectDir(event);
  const timestamp = new Date().toISOString();
  const response = event.tool_response || {};

  if (isDryRunPush(command)) {
    appendAudit(projectDir, { kind: 'push-post-dry-run-kept-pending', timestamp, session_id: event.session_id, command });
    return;
  }

  if (looksLikeSuccessfulPush(response)) {
    const cleared = clearPending(projectDir);
    if (cleared) {
      appendAudit(projectDir, { kind: 'push-post-cleared', timestamp, session_id: event.session_id, command });
    }
  } else {
    appendAudit(projectDir, { kind: 'push-post-kept-pending', timestamp, session_id: event.session_id, command });
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
