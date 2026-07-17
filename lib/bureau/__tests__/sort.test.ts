import { describe, it, expect } from 'vitest'
import { compareBureauClients, urgencyRank } from '../sort'
import { bureauRowStatus, type BureauClientRow, type BureauDeadline } from '../types'
import type { WorklistCounts } from '@/lib/worklist'

function makeCounts(total: number): WorklistCounts {
  return {
    counts: {
      book_transaction: total,
      inbox_document: 0,
      suggested_match: 0,
      supplier_invoice_approval: 0,
      verifikat_missing_document: 0,
      overdue_invoice: 0,
      deadline_action: 0,
      pending_operations: 0,
    },
    total,
  }
}

function makeDeadline(overrides: Partial<BureauDeadline> = {}): BureauDeadline {
  return {
    id: 'd-1',
    title: 'Momsdeklaration',
    dueDate: '2026-07-12',
    status: 'upcoming',
    isOverdue: false,
    taxDeadlineType: null,
    ...overrides,
  }
}

function makeRow(overrides: Partial<BureauClientRow> = {}): BureauClientRow {
  return {
    companyId: 'company-1',
    name: 'Test AB',
    orgNumber: null,
    entityType: 'aktiebolag',
    role: 'admin',
    worklist: makeCounts(0),
    nextDeadline: null,
    periodStatus: null,
    ...overrides,
  }
}

describe('bureauRowStatus', () => {
  it('overdue deadline beats zero counts', () => {
    const row = makeRow({
      worklist: makeCounts(0),
      nextDeadline: makeDeadline({ status: 'overdue', isOverdue: true }),
    })
    expect(bureauRowStatus(row)).toBe('forsenad')
  })

  it('action_needed deadline maps to nara_deadline', () => {
    const row = makeRow({ nextDeadline: makeDeadline({ status: 'action_needed' }) })
    expect(bureauRowStatus(row)).toBe('nara_deadline')
  })

  it('open work with only an upcoming deadline is pagar', () => {
    const row = makeRow({ worklist: makeCounts(3), nextDeadline: makeDeadline() })
    expect(bureauRowStatus(row)).toBe('pagar')
  })

  it('no work and no urgent deadline is klart', () => {
    expect(bureauRowStatus(makeRow())).toBe('klart')
  })

  it('unresolved counts without deadlines read klart-neutral (renders as dash, not zero)', () => {
    expect(bureauRowStatus(makeRow({ worklist: null }))).toBe('klart')
  })
})

describe('urgencyRank', () => {
  it('ranks overdue < action_needed < rest', () => {
    expect(urgencyRank(makeRow({ nextDeadline: makeDeadline({ isOverdue: true }) }))).toBe(0)
    expect(urgencyRank(makeRow({ nextDeadline: makeDeadline({ status: 'action_needed' }) }))).toBe(1)
    expect(urgencyRank(makeRow({ nextDeadline: makeDeadline() }))).toBe(2)
    expect(urgencyRank(makeRow())).toBe(2)
  })
})

describe('compareBureauClients', () => {
  it('sorts by urgency rank first', () => {
    const overdue = makeRow({
      companyId: 'a',
      nextDeadline: makeDeadline({ isOverdue: true }),
    })
    const actionNeeded = makeRow({
      companyId: 'b',
      nextDeadline: makeDeadline({ status: 'action_needed' }),
      worklist: makeCounts(99),
    })
    const quiet = makeRow({ companyId: 'c', worklist: makeCounts(100) })

    const sorted = [quiet, actionNeeded, overdue].sort(compareBureauClients)
    expect(sorted.map((r) => r.companyId)).toEqual(['a', 'b', 'c'])
  })

  it('within an urgent rank, oldest deadline first, then most work', () => {
    const older = makeRow({
      companyId: 'older',
      nextDeadline: makeDeadline({ isOverdue: true, dueDate: '2026-06-01' }),
    })
    const newerBusy = makeRow({
      companyId: 'newer-busy',
      nextDeadline: makeDeadline({ isOverdue: true, dueDate: '2026-07-01' }),
      worklist: makeCounts(9),
    })
    const newerQuiet = makeRow({
      companyId: 'newer-quiet',
      nextDeadline: makeDeadline({ isOverdue: true, dueDate: '2026-07-01' }),
      worklist: makeCounts(1),
    })

    const sorted = [newerQuiet, newerBusy, older].sort(compareBureauClients)
    expect(sorted.map((r) => r.companyId)).toEqual(['older', 'newer-busy', 'newer-quiet'])
  })

  it('within the calm rank, most work first', () => {
    const busy = makeRow({ companyId: 'busy', worklist: makeCounts(7) })
    const quiet = makeRow({ companyId: 'quiet', worklist: makeCounts(1) })
    expect([quiet, busy].sort(compareBureauClients).map((r) => r.companyId)).toEqual([
      'busy',
      'quiet',
    ])
  })

  it('unresolved counts sink below a clean zero', () => {
    const failed = makeRow({ companyId: 'failed', worklist: null })
    const clean = makeRow({ companyId: 'clean', worklist: makeCounts(0) })
    expect([failed, clean].sort(compareBureauClients).map((r) => r.companyId)).toEqual([
      'clean',
      'failed',
    ])
  })

  it('ties break on Swedish-locale name, then companyId for stability', () => {
    const angen = makeRow({ companyId: 'x', name: 'Ängen AB' })
    const beta = makeRow({ companyId: 'y', name: 'Beta AB' })
    expect([angen, beta].sort(compareBureauClients).map((r) => r.name)).toEqual([
      'Beta AB',
      'Ängen AB',
    ])

    const twinA = makeRow({ companyId: 'a', name: 'Samma AB' })
    const twinB = makeRow({ companyId: 'b', name: 'Samma AB' })
    expect([twinB, twinA].sort(compareBureauClients).map((r) => r.companyId)).toEqual(['a', 'b'])
  })
})
