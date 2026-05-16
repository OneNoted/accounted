import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withRouteContext } from '@/lib/api/with-route-context'
import { errorResponse } from '@/lib/errors/get-structured-error'
import { validateBody } from '@/lib/api/validate'
import { createAsset, listAssets } from '@/lib/bokslut/assets/asset-service'
import type { AssetCategory, DepreciationMethod } from '@/types'

const ASSET_CATEGORIES: readonly AssetCategory[] = [
  'immaterial',
  'building',
  'land_improvement',
  'machinery',
  'equipment',
  'vehicle',
  'computer',
  'other_tangible',
] as const

const DEPRECIATION_METHODS: readonly DepreciationMethod[] = [
  'linear',
  'declining_balance_30',
  'declining_balance_20',
] as const

const CreateAssetSchema = z.object({
  name: z.string().min(1),
  category: z.enum(ASSET_CATEGORIES as unknown as [AssetCategory, ...AssetCategory[]]),
  acquisition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  acquisition_cost: z.number().nonnegative(),
  salvage_value: z.number().nonnegative().optional(),
  useful_life_months: z.number().int().positive(),
  depreciation_method: z
    .enum(DEPRECIATION_METHODS as unknown as [DepreciationMethod, ...DepreciationMethod[]])
    .optional(),
  bas_asset_account: z.string().regex(/^\d{4}$/).optional(),
  bas_accumulated_account: z.string().regex(/^\d{4}$/).optional(),
  bas_expense_account: z.string().regex(/^\d{4}$/).optional(),
  notes: z.string().optional(),
})

export const GET = withRouteContext('assets.list', async (request, ctx) => {
  const { supabase, companyId, log, requestId } = ctx
  const url = new URL(request.url)
  const activeOnly = url.searchParams.get('active') === 'true'
  try {
    const data = await listAssets(supabase, companyId, { activeOnly })
    return NextResponse.json({ data })
  } catch (err) {
    return errorResponse(err, log, { requestId })
  }
})

export const POST = withRouteContext(
  'assets.create',
  async (request, ctx) => {
    const { user, supabase, companyId, log, requestId } = ctx
    const validation = await validateBody(request, CreateAssetSchema)
    if (!validation.success) return validation.response
    try {
      const asset = await createAsset(supabase, companyId, user.id, validation.data)
      return NextResponse.json({ data: asset })
    } catch (err) {
      return errorResponse(err, log, { requestId })
    }
  },
  { requireWrite: true },
)
