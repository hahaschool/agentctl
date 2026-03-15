import { type NextRequest, NextResponse } from 'next/server';

/**
 * Runtime API proxy middleware.
 *
 * Replaces static next.config.ts rewrites so that each deployment tier
 * (dev-1, dev-2, beta) can point to its own control-plane API via the
 * NEXT_PUBLIC_API_URL environment variable at *runtime*, not build time.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Only proxy /api/* and /health and /metrics to the backend
  if (pathname.startsWith('/api/') || pathname === '/health' || pathname === '/metrics') {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    const target = new URL(pathname + request.nextUrl.search, apiUrl);

    return NextResponse.rewrite(target);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/health', '/metrics'],
};
