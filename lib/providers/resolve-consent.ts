import { createServiceClient } from '@/lib/supabase/server';
import type { TokenResponse } from './types';
import { getOAuthConfig } from './oauth-config';
import { refreshFortnoxToken } from './fortnox/oauth';
import { refreshVismaToken } from './visma/oauth';
import { refreshBrioxToken } from './briox/oauth';
import { refreshBjornLundenToken } from './bjornlunden/oauth';
import { createLogger } from '@/lib/logger';

const log = createLogger('providers/resolve-consent');

export interface ResolvedConsent {
  consent: Record<string, unknown>;
  accessToken: string;
  providerCompanyId?: string;
}

export async function resolveConsent(companyId: string, consentId: string): Promise<ResolvedConsent> {
  const supabase = createServiceClient();

  // Load consent
  const { data: consentRows } = await supabase
    .from('provider_consents')
    .select('*')
    .eq('id', consentId)
    .eq('company_id', companyId)
    .limit(1);

  if (!consentRows || consentRows.length === 0) {
    throw { status: 404, message: 'Consent not found' };
  }

  const consent = consentRows[0]!;
  // Accept status 0 (token submitted, migration pending) and 1 (fully accepted)
  if (consent.status !== 0 && consent.status !== 1) {
    throw { status: 403, message: 'Consent is not in a valid status' };
  }

  if (!consent.provider) {
    throw { status: 400, message: 'Consent has no provider set — complete onboarding first' };
  }

  // Load tokens
  const { data: tokenRows } = await supabase
    .from('provider_consent_tokens')
    .select('*')
    .eq('consent_id', consentId)
    .limit(1);

  if (!tokenRows || tokenRows.length === 0) {
    throw { status: 401, message: 'No tokens found for this consent — complete OAuth first' };
  }

  const tokens = tokenRows[0]!;

  // Bokio: private API tokens that don't expire
  if (consent.provider === 'bokio') {
    return {
      consent,
      accessToken: tokens.access_token as string,
      providerCompanyId: tokens.provider_company_id as string | undefined,
    };
  }

  // Björn Lunden: client credentials — auto-refresh when expired
  if (consent.provider === 'bjornlunden') {
    if (tokens.token_expires_at && new Date(tokens.token_expires_at as string) < new Date()) {
      const refreshed = await refreshBjornLundenToken();
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

      await supabase
        .from('provider_consent_tokens')
        .update({
          access_token: refreshed.access_token,
          token_expires_at: newExpiresAt,
        })
        .eq('consent_id', consentId);

      return {
        consent,
        accessToken: refreshed.access_token,
        providerCompanyId: tokens.provider_company_id as string | undefined,
      };
    }

    return {
      consent,
      accessToken: tokens.access_token as string,
      providerCompanyId: tokens.provider_company_id as string | undefined,
    };
  }

  // Check expiry, auto-refresh if needed
  if (tokens.token_expires_at && new Date(tokens.token_expires_at as string) < new Date()) {
    if (!tokens.refresh_token) {
      throw { status: 401, message: 'Access token expired and no refresh token available' };
    }

    let refreshed: TokenResponse;

    if (consent.provider === 'fortnox') {
      refreshed = await refreshFortnoxToken(getOAuthConfig('fortnox'), tokens.refresh_token as string);
    } else if (consent.provider === 'briox') {
      // Briox /tokenrefresh wants the (expired) access token alongside the
      // refresh token; no app-level config involved. Both tokens rotate —
      // the new refresh_token is persisted below.
      refreshed = await refreshBrioxToken(tokens.refresh_token as string, tokens.access_token as string);
    } else {
      refreshed = await refreshVismaToken(getOAuthConfig(consent.provider as string), tokens.refresh_token as string);
    }

    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

    // Optimistic concurrency guard: providers like Briox and Fortnox rotate
    // BOTH tokens on refresh, so two concurrent requests refreshing the same
    // expired pair must not both persist — the second write would overwrite
    // the pair the first request just stored with a possibly-dead one. Key
    // the UPDATE on the token_expires_at we read above: if another request
    // already rotated, zero rows match and we adopt the stored fresh tokens.
    const { data: updatedRows, error: updateError } = await supabase
      .from('provider_consent_tokens')
      .update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_expires_at: newExpiresAt,
      })
      .eq('consent_id', consentId)
      .eq('token_expires_at', tokens.token_expires_at as string)
      .select('id');

    if (updateError) {
      // The provider has ALREADY rotated the tokens but we failed to persist
      // the new pair — the stored pair is now dead and every later call on
      // this consent will fail. Log loudly; the only recovery is to
      // disconnect and re-enter the provider credentials.
      log.error(
        `Failed to persist rotated ${consent.provider} tokens for consent ${consentId} — ` +
        'the stored credentials are now invalid and the consent will break',
        { reason: updateError.message },
      );
      throw {
        status: 500,
        message:
          'Token refresh succeeded at the provider but the rotated tokens could not be saved. ' +
          'The stored credentials are no longer valid — disconnect the provider and re-enter the credentials.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Lost the refresh race: a concurrent request already rotated and
      // persisted a fresh pair. Use those tokens as-is — calling the provider
      // refresh endpoint again here would invalidate the winner's pair.
      const { data: freshRows } = await supabase
        .from('provider_consent_tokens')
        .select('*')
        .eq('consent_id', consentId)
        .limit(1);

      const fresh = freshRows?.[0];
      if (fresh?.access_token) {
        return {
          consent,
          accessToken: fresh.access_token as string,
          providerCompanyId: (fresh.provider_company_id ?? tokens.provider_company_id) as
            | string
            | undefined,
        };
      }
      // Token row vanished mid-flight (disconnect?) — fall through to our own
      // refreshed pair, which the provider still considers the latest one.
    }

    return {
      consent,
      accessToken: refreshed.access_token,
      providerCompanyId: tokens.provider_company_id as string | undefined,
    };
  }

  return {
    consent,
    accessToken: tokens.access_token as string,
    providerCompanyId: tokens.provider_company_id as string | undefined,
  };
}
