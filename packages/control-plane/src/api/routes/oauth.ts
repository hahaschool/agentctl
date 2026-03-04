import { createHash, randomBytes } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';
import { apiAccounts } from '../../db/schema.js';
import { encryptCredential, maskCredential } from '../../utils/credential-crypto.js';

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
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLOW_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// Placeholder authorization endpoints — update when Anthropic publishes OAuth docs.
const OAUTH_ENDPOINTS: Record<string, { authorizeUrl: string; tokenUrl: string }> = {
  claude_max: {
    authorizeUrl: 'https://auth.anthropic.com/oauth/authorize',
    tokenUrl: 'https://auth.anthropic.com/oauth/token',
  },
  claude_team: {
    authorizeUrl: 'https://auth.anthropic.com/oauth/authorize',
    tokenUrl: 'https://auth.anthropic.com/oauth/token',
  },
};

const CLIENT_ID = process.env.ANTHROPIC_OAUTH_CLIENT_ID ?? 'agentctl';
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
    };
  }>('/initiate', async (request, reply) => {
    const { provider, accountName } = request.body;

    if (!provider || !accountName) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'provider and accountName are required',
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

    pendingFlows.set(state, {
      provider,
      accountName,
      codeVerifier,
      createdAt: Date.now(),
    });

    // Build the authorization URL with PKCE parameters
    const redirectUri = `${request.protocol}://${request.hostname}${REDIRECT_PATH}`;
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'user:inference',
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

    // Exchange authorization code for token
    try {
      const redirectUri = `${request.protocol}://${request.hostname}${REDIRECT_PATH}`;
      const tokenResponse = await fetch(endpoints.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
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

      if (!accessToken) {
        return reply.type('text/html').send(callbackHtml({ error: 'No access token in response' }));
      }

      // Encrypt and store as an account
      const { encrypted, iv } = encryptCredential(accessToken, encryptionKey);

      const [inserted] = await db
        .insert(apiAccounts)
        .values({
          name: flow.accountName,
          provider: flow.provider,
          credential: encrypted,
          credentialIv: iv,
          priority: 0,
          metadata: { authMethod: 'oauth' },
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

  return `<!DOCTYPE html>
<html>
<head><title>AgentCTL OAuth</title></head>
<body>
<p>${result.error ? `Error: ${escapeHtml(result.error)}` : 'Login successful! This window will close.'}</p>
<script>
  if (window.opener) {
    window.opener.postMessage(${escapeHtml(payload)}, window.location.origin);
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
