import { NextResponse } from 'next/server'
import { withRouteContext } from '@/lib/api/with-route-context'
import { getErrorMessage as getUserErrorMessage } from '@/lib/errors/get-error-message'

/**
 * POST /api/deadlines/[id]/complete
 * Set the completion status of a deadline.
 *
 * The body is optional. When it carries a boolean `is_completed` the route sets
 * exactly that state; a caller that sends nothing (or an unparseable body)
 * keeps the original toggle behaviour.
 *
 * Honouring an explicit state is what makes the "Ångra" affordance an undo
 * rather than a second toggle: the click has to be idempotent, because the row
 * can already have been un-ticked in another tab or by an MCP agent between the
 * toast appearing and the click landing, and a blind toggle would then
 * re-complete a Skatteverket deadline the user was trying to put back on the
 * list. It also makes the caller's own confirmation truthful: the client picks
 * its toast from the state it asked for, so the server must not silently
 * persist the opposite.
 */
export const POST = withRouteContext<{ params: Promise<{ id: string }> }>(
  'deadline.toggle_complete',
  async (request, ctx, { params }) => {
    const { id } = await params
    const { supabase, companyId } = ctx

    const body: unknown = await request.json().catch(() => null)
    const requestedState =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { is_completed?: unknown }).is_completed === 'boolean'
        ? (body as { is_completed: boolean }).is_completed
        : null

    // First, get current deadline state
    const { data: existing, error: fetchError } = await supabase
      .from('deadlines')
      .select('is_completed')
      .eq('id', id)
      .eq('company_id', companyId)
      .single()

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Deadline not found' }, { status: 404 })
      }
      return NextResponse.json({ error: getUserErrorMessage(fetchError) }, { status: 500 })
    }

    // Explicit state when the caller supplied one, otherwise toggle.
    const newCompletedState = requestedState ?? !existing.is_completed
    const { data, error } = await supabase
      .from('deadlines')
      .update({
        is_completed: newCompletedState,
        completed_at: newCompletedState ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .eq('company_id', companyId)
      .select('*, customer:customers(id, name)')
      .single()

    if (error) {
      return NextResponse.json({ error: getUserErrorMessage(error) }, { status: 500 })
    }

    return NextResponse.json({ data })
  },
  { requireWrite: true },
)
