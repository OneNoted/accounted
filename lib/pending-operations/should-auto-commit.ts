/**
 * Decide whether a freshly-staged pending_operation should be auto-committed
 * by a trusted agent without human approval.
 *
 * Defense-in-depth: high-risk operations (period close, year-end, send_invoice,
 * etc.) are NEVER auto-committed regardless of company settings or actor
 * trust — that gate lives in risk-tiers.ts and is checked here before any
 * config lookup.
 *
 * Trust hierarchy:
 *   - 'user' actors are humans clicking in the UI; auto-commit doesn't apply
 *     (the click IS the approval)
 *   - 'api_key' / 'mcp_oauth' actors are agents; eligible for auto-commit if
 *     the company opts in and the op is low-risk
 *   - 'cron' actors are system tasks; always auto-commit (they have no
 *     human in the loop by design)
 *
 * Monetary threshold:
 *   When `agent_auto_commit_max_amount` is set, any low-risk op with a
 *   preview/payload amount above the threshold falls back to human approval.
 *   The amount is read from the preview_data — callers should put it under
 *   `amount` or `total` for the gate to find it. Missing amount → not blocked
 *   by the threshold (safe for ops like create_customer where there's no
 *   single dollar value).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isHighRisk, getRiskLevel, type RiskLevel } from './risk-tiers'

export type AutoCommitActorType = 'user' | 'api_key' | 'mcp_oauth' | 'cron'

export interface AutoCommitInput {
  operationType: string
  actorType: AutoCommitActorType
  /** Optional monetary amount to check against agent_auto_commit_max_amount. */
  amount?: number | null
}

export interface AutoCommitDecision {
  eligible: boolean
  reason: string
  risk_level: RiskLevel
}

/**
 * Cheap pure-logic check that doesn't hit the DB. Used to short-circuit
 * obvious "no" cases before reading company_settings.
 */
function precheck(input: AutoCommitInput): AutoCommitDecision | null {
  const risk = getRiskLevel(input.operationType)

  if (isHighRisk(input.operationType)) {
    return {
      eligible: false,
      reason: `Operation "${input.operationType}" is high-risk and never auto-committed.`,
      risk_level: risk,
    }
  }

  if (input.actorType === 'user') {
    return {
      eligible: false,
      reason: 'User actors approve via the UI; auto-commit does not apply.',
      risk_level: risk,
    }
  }

  // Cron actors auto-commit non-high-risk regardless of company config.
  // Resolved here so we don't read company_settings unnecessarily.
  if (input.actorType === 'cron') {
    return {
      eligible: true,
      reason: 'Cron actor: auto-commit allowed for non-high-risk ops.',
      risk_level: risk,
    }
  }

  // For api_key/mcp_oauth: only low-risk is auto-committable in this phase.
  // Reject medium-risk before the company_settings lookup so callers don't pay
  // for a DB read that can't succeed.
  if (risk !== 'low') {
    return {
      eligible: false,
      reason: 'Only low-risk operations are auto-committable in the current phase.',
      risk_level: risk,
    }
  }

  return null
}

export async function shouldAutoCommit(
  supabase: SupabaseClient,
  companyId: string,
  input: AutoCommitInput
): Promise<AutoCommitDecision> {
  const pre = precheck(input)
  if (pre) return pre

  const risk = getRiskLevel(input.operationType)

  // api_key / mcp_oauth + low-risk: gated by company opt-in and threshold.
  const { data: settings, error } = await supabase
    .from('company_settings')
    .select('agent_auto_commit_enabled, agent_auto_commit_max_amount')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error || !settings) {
    return {
      eligible: false,
      reason: 'Could not read company settings; defaulting to human approval.',
      risk_level: risk,
    }
  }

  if (!settings.agent_auto_commit_enabled) {
    return {
      eligible: false,
      reason: 'Company has not opted in to agent auto-commit.',
      risk_level: risk,
    }
  }

  const max = settings.agent_auto_commit_max_amount
  const amount = input.amount
  if (max != null && amount != null && Math.abs(amount) > Number(max)) {
    return {
      eligible: false,
      reason: `Amount ${amount} exceeds company auto-commit threshold ${max}.`,
      risk_level: risk,
    }
  }

  return {
    eligible: true,
    reason: 'Low-risk op, trusted actor, company opted in, amount within limit.',
    risk_level: risk,
  }
}
