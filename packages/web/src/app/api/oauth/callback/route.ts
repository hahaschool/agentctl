import { type NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// OAuth callback proxy — intercepts the redirect from Anthropic's OAuth
// server and forwards it to the control-plane's /api/oauth/callback handler.
//
// This route exists because the browser-facing redirect_uri points to the
// Next.js origin (e.g. http://localhost:3000/api/oauth/callback), but the
// actual OAuth flow state lives in the control-plane (Fastify).  Without this
// proxy the Next.js rewrite in next.config.ts would normally handle the
// forwarding, but Next.js rewrites only apply when there is NO matching API
// route — and we need this route to exist so that the redirect_uri registered
// with the OAuth provider matches the user-accessible URL.
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL ?? 'http://localhost:8080';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const url = new URL('/api/oauth/callback', CONTROL_PLANE_URL);

  // Forward all query params (code, state, error, error_description) to the
  // control-plane so it can complete the token exchange.
  searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000),
    });
    const html = await response.text();

    return new NextResponse(html, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'text/html' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><title>AgentCTL OAuth Error</title></head>
<body>
<p>Error: Failed to reach the control plane: ${message}</p>
<script>
  if (window.opener) {
    window.opener.postMessage(JSON.stringify({
      type: 'oauth_error',
      error: 'Failed to reach the control plane'
    }), window.location.origin);
  }
  window.close();
</script>
</body>
</html>`,
      { status: 502, headers: { 'Content-Type': 'text/html' } },
    );
  }
}
