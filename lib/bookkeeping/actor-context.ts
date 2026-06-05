import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Transaction-scoped actor context for journal-entry commits.
 *
 * Carries WHO is relaying a commit (api_key | user | agent_chat | cron | …)
 * from the approval entry points (MCP approve tool, web approve routes) down
 * to commitEntry() without threading a parameter through every pending-
 * operation executor and entry-generator in between. commitEntry() reads it
 * as a fallback and forwards it to the commit_journal_entry RPC, which stamps
 * journal_entries.committed_actor_* and the audit_log COMMIT row
 * (migration 20260619120000).
 *
 * Outside a runWithActor() scope getActor() returns undefined and the RPC
 * params stay NULL — byte-identical to pre-attribution behaviour. Keep this
 * tightly scoped to the commit path; it is not a general-purpose request
 * context.
 */
export interface CommitActor {
  /** Matches the journal_entries.committed_actor_type CHECK constraint. */
  type: 'user' | 'api_key' | 'mcp_oauth' | 'cron' | 'system' | 'agent_chat'
  /** Human-readable credential label, e.g. the API key name. */
  label?: string
}

const actorStorage = new AsyncLocalStorage<CommitActor>()

/** Run fn with the given actor visible to getActor() across awaits. */
export function runWithActor<T>(actor: CommitActor, fn: () => Promise<T>): Promise<T> {
  return actorStorage.run(actor, fn)
}

/** The actor for the current async execution scope, if any. */
export function getActor(): CommitActor | undefined {
  return actorStorage.getStore()
}
