import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuthConfig = {
  enabled: boolean;
  apiKeys: string[];
  bearerTokenSecret?: string;
  skipPaths: string[];
};

type AuthenticatedRequest = {
  authMethod: 'api-key' | 'bearer-token' | 'none';
  authKeyId?: string;
};

const DEFAULT_MAX_AGE_SECONDS = 300;
const API_KEY_SALT_BYTES = 16;
const API_KEY_HASH_BYTES = 64;
const API_KEY_HASH_PREFIX = 'scrypt';

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Salted scrypt hash of an API key, encoded as `scrypt$<saltHex>$<hashHex>`.
 */
export function hashApiKey(key: string): string {
  const salt = randomBytes(API_KEY_SALT_BYTES);
  const derivedKey = scryptSync(key, salt, API_KEY_HASH_BYTES);
  return `${API_KEY_HASH_PREFIX}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function verifyApiKey(candidate: string, storedHash: string): boolean {
  const [algorithm, saltHex, expectedHex] = storedHash.split('$');
  if (
    algorithm !== API_KEY_HASH_PREFIX ||
    !saltHex ||
    !expectedHex ||
    !/^[0-9a-f]+$/i.test(saltHex) ||
    !/^[0-9a-f]+$/i.test(expectedHex)
  ) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  const derived = scryptSync(candidate, salt, expected.length);

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Generate a bearer token in the format `<timestamp>.<signature>` where
 * `timestamp` is the current epoch in seconds and `signature` is the
 * HMAC-SHA256 of the timestamp using the provided secret, encoded as hex.
 */
export function generateBearerToken(secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac('sha256', secret).update(timestamp).digest('hex');
  return `${timestamp}.${signature}`;
}

/**
 * Validate a bearer token:
 * 1. Must be in `<timestamp>.<signature>` format
 * 2. HMAC-SHA256 of the timestamp (using secret) must match the signature
 * 3. Timestamp must be within `maxAgeSeconds` of the current time
 */
export function validateBearerToken(
  token: string,
  secret: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): boolean {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) {
    return false;
  }

  const timestamp = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  // Timestamp must be a non-empty numeric string
  if (timestamp.length === 0 || !/^\d+$/.test(timestamp)) {
    return false;
  }

  // Signature must be a non-empty hex string
  if (signature.length === 0 || !/^[0-9a-f]+$/i.test(signature)) {
    return false;
  }

  // Verify HMAC using timing-safe comparison
  const expected = createHmac('sha256', secret).update(timestamp).digest('hex');
  if (expected.length !== signature.length) {
    return false;
  }

  const signatureValid = timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signature.toLowerCase(), 'hex'),
  );
  if (!signatureValid) {
    return false;
  }

  // Check freshness
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenSeconds = Number.parseInt(timestamp, 10);
  const age = Math.abs(nowSeconds - tokenSeconds);

  return age <= maxAgeSeconds;
}

// ---------------------------------------------------------------------------
// Fastify hook factory
// ---------------------------------------------------------------------------

/**
 * Create a Fastify `onRequest` hook that enforces authentication.
 *
 * The hook decorates each request with `auth: AuthenticatedRequest` so
 * downstream handlers can inspect the authentication method and masked key ID.
 */
export function createAuthHook(config: AuthConfig): onRequestHookHandler {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // 1. Auth disabled — allow everything
    if (!config.enabled) {
      (request as FastifyRequest & { auth: AuthenticatedRequest }).auth = {
        authMethod: 'none',
      };
      return;
    }

    // 2. Skip paths — allow without auth
    if (config.skipPaths.some((p) => request.url === p || request.url.startsWith(`${p}?`))) {
      (request as FastifyRequest & { auth: AuthenticatedRequest }).auth = {
        authMethod: 'none',
      };
      return;
    }

    const authHeader = request.headers.authorization;

    // 3. No Authorization header at all → 401
    if (!authHeader) {
      reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    const spaceIndex = authHeader.indexOf(' ');
    if (spaceIndex === -1) {
      reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    const scheme = authHeader.slice(0, spaceIndex);
    const credential = authHeader.slice(spaceIndex + 1);

    // 3a. Bearer token
    if (scheme.toLowerCase() === 'bearer') {
      if (!config.bearerTokenSecret) {
        reply.status(403).send({
          error: 'Invalid credentials',
          code: 'AUTH_INVALID',
        });
        return;
      }

      if (!validateBearerToken(credential, config.bearerTokenSecret)) {
        reply.status(403).send({
          error: 'Invalid credentials',
          code: 'AUTH_INVALID',
        });
        return;
      }

      (request as FastifyRequest & { auth: AuthenticatedRequest }).auth = {
        authMethod: 'bearer-token',
        authKeyId: credential.slice(-4),
      };
      return;
    }

    // 3b. API key
    if (scheme.toLowerCase() === 'apikey') {
      const isValid = config.apiKeys.some((storedHash) => verifyApiKey(credential, storedHash));

      if (!isValid) {
        reply.status(403).send({
          error: 'Invalid credentials',
          code: 'AUTH_INVALID',
        });
        return;
      }

      // Only expose last 4 chars of the raw key for logging
      (request as FastifyRequest & { auth: AuthenticatedRequest }).auth = {
        authMethod: 'api-key',
        authKeyId: credential.slice(-4),
      };
      return;
    }

    // Unknown scheme → 401
    reply.status(401).send({
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  };
}

export type { AuthConfig, AuthenticatedRequest };
