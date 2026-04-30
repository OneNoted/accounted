import { describe, it, expect, vi } from 'vitest'
import { shouldAutoCommit } from '../should-auto-commit'

function mockSettingsClient(settings: { agent_auto_commit_enabled?: boolean; agent_auto_commit_max_amount?: number | null } | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue(
            settings === null
              ? { data: null, error: null }
              : { data: settings, error: null }
          ),
        }),
      }),
    }),
  } as never
}

describe('shouldAutoCommit', () => {
  it('rejects high-risk ops regardless of any other config', async () => {
    const supabase = mockSettingsClient({ agent_auto_commit_enabled: true })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'send_invoice',
      actorType: 'api_key',
    })
    expect(decision.eligible).toBe(false)
    expect(decision.risk_level).toBe('high')
    expect(decision.reason).toContain('high-risk')
  })

  it('rejects user actors (they approve via UI)', async () => {
    const supabase = mockSettingsClient({ agent_auto_commit_enabled: true })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'user',
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toContain('approve via the UI')
  })

  it('rejects when company has not opted in', async () => {
    const supabase = mockSettingsClient({ agent_auto_commit_enabled: false })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toContain('not opted in')
  })

  it('rejects medium-risk ops in current phase', async () => {
    const supabase = mockSettingsClient({ agent_auto_commit_enabled: true })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'categorize_transaction',
      actorType: 'api_key',
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toContain('low-risk')
  })

  it('approves low-risk ops from api_key with company opt-in', async () => {
    const supabase = mockSettingsClient({ agent_auto_commit_enabled: true })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
    })
    expect(decision.eligible).toBe(true)
    expect(decision.risk_level).toBe('low')
  })

  it('blocks low-risk op when amount exceeds threshold', async () => {
    const supabase = mockSettingsClient({
      agent_auto_commit_enabled: true,
      agent_auto_commit_max_amount: 1000,
    })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
      amount: 5000,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toContain('exceeds')
  })

  it('approves low-risk op when amount within threshold', async () => {
    const supabase = mockSettingsClient({
      agent_auto_commit_enabled: true,
      agent_auto_commit_max_amount: 1000,
    })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
      amount: 500,
    })
    expect(decision.eligible).toBe(true)
  })

  it('approves low-risk op when amount missing (no threshold check applies)', async () => {
    const supabase = mockSettingsClient({
      agent_auto_commit_enabled: true,
      agent_auto_commit_max_amount: 1000,
    })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
      // amount intentionally undefined
    })
    expect(decision.eligible).toBe(true)
  })

  it('cron actors auto-commit non-high-risk without DB lookup', async () => {
    const supabase = mockSettingsClient(null)
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'cron',
    })
    expect(decision.eligible).toBe(true)
    expect(decision.reason).toContain('Cron')
  })

  it('cron actors still rejected for high-risk ops', async () => {
    const supabase = mockSettingsClient(null)
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'send_invoice',
      actorType: 'cron',
    })
    expect(decision.eligible).toBe(false)
  })

  it('falls back to human approval when settings missing', async () => {
    const supabase = mockSettingsClient(null)
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toContain('Could not read company settings')
  })

  it('treats negative amounts (refunds) by absolute value', async () => {
    const supabase = mockSettingsClient({
      agent_auto_commit_enabled: true,
      agent_auto_commit_max_amount: 1000,
    })
    const decision = await shouldAutoCommit(supabase, 'company-1', {
      operationType: 'create_customer',
      actorType: 'api_key',
      amount: -5000,
    })
    expect(decision.eligible).toBe(false)
    expect(decision.reason).toContain('exceeds')
  })
})
