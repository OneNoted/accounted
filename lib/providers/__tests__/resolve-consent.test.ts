import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createQueuedMockSupabase } from '@/tests/helpers';

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}));

vi.mock('@/lib/providers/briox/oauth', () => ({
  refreshBrioxToken: vi.fn(),
}));

import { createServiceClient } from '@/lib/supabase/server';
import { refreshBrioxToken } from '@/lib/providers/briox/oauth';
import { resolveConsent } from '../resolve-consent';

const consentRow = { id: 'c1', company_id: 'co1', provider: 'briox', status: 1 };

const expiredTokens = {
  access_token: 'old-access',
  refresh_token: 'old-refresh',
  token_expires_at: '2020-01-01T00:00:00.000Z',
  provider_company_id: 'acct-1',
};

describe('resolveConsent — Briox token refresh concurrency', () => {
  let mock: ReturnType<typeof createQueuedMockSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createQueuedMockSupabase();
    vi.mocked(createServiceClient).mockReturnValue(mock.supabase as never);
    vi.mocked(refreshBrioxToken).mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('returns the stored token without refreshing when not expired', async () => {
    mock.enqueue({ data: [consentRow] });
    mock.enqueue({
      data: [{ ...expiredTokens, token_expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
    });

    const result = await resolveConsent('co1', 'c1');

    expect(result.accessToken).toBe('old-access');
    expect(refreshBrioxToken).not.toHaveBeenCalled();
  });

  it('persists the rotated pair when the guarded update wins the race', async () => {
    mock.enqueue({ data: [consentRow] }); // consent lookup
    mock.enqueue({ data: [expiredTokens] }); // expired token row
    mock.enqueue({ data: [{ id: 't1' }] }); // guarded update matched 1 row

    const result = await resolveConsent('co1', 'c1');

    expect(result.accessToken).toBe('new-access');
    expect(refreshBrioxToken).toHaveBeenCalledTimes(1);
    expect(refreshBrioxToken).toHaveBeenCalledWith('old-refresh', 'old-access');
  });

  it('adopts the concurrent winner\'s tokens when the guarded update matches 0 rows (lost race)', async () => {
    mock.enqueue({ data: [consentRow] }); // consent lookup
    mock.enqueue({ data: [expiredTokens] }); // expired token row (both requests read this)
    mock.enqueue({ data: [] }); // guarded update: another request already rotated
    mock.enqueue({
      // re-read returns the winner's freshly persisted pair
      data: [
        {
          access_token: 'winner-access',
          refresh_token: 'winner-refresh',
          token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          provider_company_id: 'acct-1',
        },
      ],
    });

    const result = await resolveConsent('co1', 'c1');

    // Must use the persisted fresh tokens, NOT call Briox /tokenrefresh again
    // — a second rotation would invalidate the winner's pair.
    expect(result.accessToken).toBe('winner-access');
    expect(result.providerCompanyId).toBe('acct-1');
    expect(refreshBrioxToken).toHaveBeenCalledTimes(1);
  });

  it('fails loudly with re-enter guidance when the rotated pair cannot be persisted', async () => {
    mock.enqueue({ data: [consentRow] }); // consent lookup
    mock.enqueue({ data: [expiredTokens] }); // expired token row
    mock.enqueue({ data: null, error: { message: 'connection reset' } }); // update failed

    // Briox has already rotated the tokens at this point — the stored pair is
    // dead, so the user must reconnect with fresh credentials.
    await expect(resolveConsent('co1', 'c1')).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining('re-enter the credentials'),
    });
  });
});
