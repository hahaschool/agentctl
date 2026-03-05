import { createHash, randomBytes } from 'node:crypto';

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { apiAccounts } from '../../db/schema.js';
import {
  decryptCredential,
  encryptCredential,
  maskCredential,
} from '../../utils/credential-crypto.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OAuthRoutesOptions = {
  db: Database;
  encryptionKey: string;
};

type PendingFlow = {
  provider: string;
  accountName: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLOW_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// Claude Code OAuth endpoints (PKCE public-client flow used by `claude login`).
// Authorization goes through claude.ai; token exchange through console.anthropic.com.
const OAUTH_ENDPOINTS: Record<string, { authorizeUrl: string; tokenUrl: string }> = {
  claude_max: {
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  },
  claude_team: {
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  },
};

const CLIENT_ID = process.env.ANTHROPIC_OAUTH_CLIENT_ID ?? '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REDIRECT_PATH = '/api/oauth/callback';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const oauthRoutes: FastifyPluginAsync<OAuthRoutesOptions> = async (app, opts) => {
  const { db, encryptionKey } = opts;

  // In-memory store for pending OAuth flows keyed by `state`
  const pendingFlows = new Map<string, PendingFlow>();

  // Periodic cleanup of expired flows
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [state, flow] of pendingFlows) {
      if (now - flow.createdAt > FLOW_TTL_MS) {
        pendingFlows.delete(state);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(cleanupTimer);
  });

  // -------------------------------------------------------------------------
  // POST /initiate — start a PKCE OAuth flow
  // -------------------------------------------------------------------------

  app.post<{
    Body: {
      provider: string;
      accountName: string;
      redirectUri?: string;
    };
  }>('/initiate', async (request, reply) => {
    const { provider, accountName, redirectUri: clientRedirectUri } = request.body;

    if (!provider || !accountName) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'provider and accountName are required',
      });
    }

    if (typeof accountName === 'string' && accountName.length > 255) {
      return reply.code(400).send({
        error: 'ACCOUNT_NAME_TOO_LONG',
        message: 'accountName must be under 255 characters',
      });
    }

    const endpoints = OAUTH_ENDPOINTS[provider];
    if (!endpoints) {
      return reply.code(400).send({
        error: 'UNSUPPORTED_PROVIDER',
        message: `OAuth is not supported for provider: ${provider}`,
      });
    }

    const state = randomBytes(16).toString('hex');
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Use caller-provided redirectUri (e.g. from Next.js frontend) or fall back to
    // constructing from the Fastify request (direct access to control-plane).
    const redirectUri =
      clientRedirectUri ?? `${request.protocol}://${request.hostname}${REDIRECT_PATH}`;

    pendingFlows.set(state, {
      provider,
      accountName,
      codeVerifier,
      redirectUri,
      createdAt: Date.now(),
    });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'user:inference user:profile',
    });

    const authorizationUrl = `${endpoints.authorizeUrl}?${params.toString()}`;

    return reply.send({ authorizationUrl, state });
  });

  // -------------------------------------------------------------------------
  // GET /callback — handle the OAuth redirect
  // -------------------------------------------------------------------------

  app.get<{
    Querystring: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
  }>('/callback', async (request, reply) => {
    const { code, state, error: oauthError, error_description: errorDesc } = request.query;

    // Handle OAuth error response
    if (oauthError) {
      return reply.type('text/html').send(callbackHtml({ error: errorDesc ?? oauthError }));
    }

    if (!state || !code) {
      return reply
        .type('text/html')
        .send(callbackHtml({ error: 'Missing state or code parameter' }));
    }

    // Anthropic returns the authorization code in `code#state` format.
    // Split on `#` and use only the code portion before the hash.
    const authCode = code.includes('#') ? code.split('#')[0] : code;

    const flow = pendingFlows.get(state);
    if (!flow) {
      return reply
        .type('text/html')
        .send(callbackHtml({ error: 'Unknown or expired OAuth state' }));
    }

    // Remove flow immediately to prevent replay
    pendingFlows.delete(state);

    // Check TTL
    if (Date.now() - flow.createdAt > FLOW_TTL_MS) {
      return reply
        .type('text/html')
        .send(callbackHtml({ error: 'OAuth flow expired — please try again' }));
    }

    const endpoints = OAUTH_ENDPOINTS[flow.provider];
    if (!endpoints) {
      return reply
        .type('text/html')
        .send(callbackHtml({ error: `No token endpoint for provider: ${flow.provider}` }));
    }

    // Exchange authorization code for token — use the same redirectUri that was
    // sent to the authorization server during /initiate so they match exactly.
    // Anthropic's token endpoint expects a JSON body, not form-urlencoded.
    try {
      const redirectUri = flow.redirectUri;
      const tokenResponse = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code: authCode,
          redirect_uri: redirectUri,
          code_verifier: flow.codeVerifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text().catch(() => 'Unknown error');
        app.log.warn({ status: tokenResponse.status, body }, 'OAuth token exchange failed');
        return reply
          .type('text/html')
          .send(callbackHtml({ error: `Token exchange failed: HTTP ${tokenResponse.status}` }));
      }

      const tokenBody = (await tokenResponse.json()) as Record<string, unknown>;
      const accessToken = (tokenBody.access_token as string) ?? (tokenBody.token as string) ?? '';
      const refreshToken = (tokenBody.refresh_token as string) ?? undefined;

      if (!accessToken) {
        return reply.type('text/html').send(callbackHtml({ error: 'No access token in response' }));
      }

      // Encrypt and store as an account.
      // Persist the refresh_token in metadata so we can auto-renew later.
      const { encrypted, iv } = encryptCredential(accessToken, encryptionKey);

      const metadata: Record<string, unknown> = { authMethod: 'oauth' };
      if (refreshToken) {
        const encRefresh = encryptCredential(refreshToken, encryptionKey);
        metadata.refreshToken = encRefresh.encrypted;
        metadata.refreshTokenIv = encRefresh.iv;
      }

      const [inserted] = await db
        .insert(apiAccounts)
        .values({
          name: flow.accountName,
          provider: flow.provider,
          credential: encrypted,
          credentialIv: iv,
          priority: 0,
          metadata,
        })
        .returning();

      return reply.type('text/html').send(
        callbackHtml({
          account: {
            id: inserted.id,
            name: inserted.name,
            provider: inserted.provider,
            credentialMasked: maskCredential(accessToken),
          },
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err: message }, 'OAuth callback error');
      return reply.type('text/html').send(callbackHtml({ error: `OAuth error: ${message}` }));
    }
  });

  // -------------------------------------------------------------------------
  // POST /refresh — refresh an OAuth token using a stored refresh_token
  // -------------------------------------------------------------------------

  app.post<{
    Body: {
      accountId: string;
    };
  }>('/refresh', async (request, reply) => {
    const { accountId } = request.body;

    if (!accountId) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'accountId is required',
      });
    }

    // Look up the account
    const [account] = await db
      .select()
      .from(apiAccounts)
      .where(eq(apiAccounts.id, accountId))
      .limit(1);

    if (!account) {
      return reply.code(404).send({
        error: 'ACCOUNT_NOT_FOUND',
        message: `No account found with id: ${accountId}`,
      });
    }

    const meta = (account.metadata ?? {}) as Record<string, unknown>;
    if (meta.authMethod !== 'oauth') {
      return reply.code(400).send({
        error: 'NOT_OAUTH_ACCOUNT',
        message: 'This account was not created via OAuth and cannot be refreshed',
      });
    }

    const encRefreshToken = meta.refreshToken as string | undefined;
    const refreshTokenIv = meta.refreshTokenIv as string | undefined;
    if (!encRefreshToken || !refreshTokenIv) {
      return reply.code(400).send({
        error: 'NO_REFRESH_TOKEN',
        message: 'No refresh token stored for this account',
      });
    }

    // Decrypt the stored refresh_token
    const refreshToken = decryptCredential(encRefreshToken, refreshTokenIv, encryptionKey);

    const endpoints = OAUTH_ENDPOINTS[account.provider];
    if (!endpoints) {
      return reply.code(400).send({
        error: 'UNSUPPORTED_PROVIDER',
        message: `No token endpoint for provider: ${account.provider}`,
      });
    }

    // Call the token endpoint with grant_type=refresh_token
    try {
      const tokenResponse = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!tokenResponse.ok) {
        const body = await tokenResponse.text().catch(() => 'Unknown error');
        app.log.warn({ status: tokenResponse.status, body }, 'OAuth token refresh failed');
        return reply.code(502).send({
          error: 'TOKEN_REFRESH_FAILED',
          message: `Token refresh failed: HTTP ${tokenResponse.status}`,
        });
      }

      const tokenBody = (await tokenResponse.json()) as Record<string, unknown>;
      const newAccessToken =
        (tokenBody.access_token as string) ?? (tokenBody.token as string) ?? '';
      const newRefreshToken = (tokenBody.refresh_token as string) ?? undefined;

      if (!newAccessToken) {
        return reply.code(502).send({
          error: 'NO_ACCESS_TOKEN',
          message: 'No access token in refresh response',
        });
      }

      // Encrypt the new access token
      const { encrypted, iv } = encryptCredential(newAccessToken, encryptionKey);

      // Update metadata with new refresh_token if one was returned
      const updatedMeta: Record<string, unknown> = { ...meta };
      if (newRefreshToken) {
        const encNewRefresh = encryptCredential(newRefreshToken, encryptionKey);
        updatedMeta.refreshToken = encNewRefresh.encrypted;
        updatedMeta.refreshTokenIv = encNewRefresh.iv;
      }

      // Update the account with new credential and metadata
      await db
        .update(apiAccounts)
        .set({
          credential: encrypted,
          credentialIv: iv,
          metadata: updatedMeta,
          updatedAt: new Date(),
        })
        .where(eq(apiAccounts.id, accountId));

      return reply.send({
        success: true,
        accountId,
        credentialMasked: maskCredential(newAccessToken),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err: message, accountId }, 'OAuth refresh error');
      return reply.code(500).send({
        error: 'REFRESH_ERROR',
        message: `OAuth refresh error: ${message}`,
      });
    }
  });
};

// ---------------------------------------------------------------------------
// Callback HTML — posts result to opener window and closes popup
// ---------------------------------------------------------------------------

function callbackHtml(
  result:
    | { error: string; account?: undefined }
    | {
        account: { id: string; name: string; provider: string; credentialMasked: string };
        error?: undefined;
      },
): string {
  const payload = result.error
    ? JSON.stringify({ type: 'oauth_error', error: result.error })
    : JSON.stringify({ type: 'oauth_success', account: result.account });

  // Inside <script>, use JSON.stringify to produce a safe JS string literal.
  // Escape </script> sequences to prevent premature tag closure (XSS vector).
  const safePayload = payload.replace(/<\/script>/gi, '<\\/script>');

  return `<!DOCTYPE html>
<html>
<head><title>AgentCTL OAuth</title></head>
<body>
<p>${result.error ? `Error: ${escapeHtml(result.error)}` : 'Login successful! This window will close.'}</p>
<script>
  if (window.opener) {
    window.opener.postMessage(${safePayload}, window.location.origin);
  }
  window.close();
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
