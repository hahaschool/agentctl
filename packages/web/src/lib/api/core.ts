// ---------------------------------------------------------------------------
// Core API client primitives — base fetch wrapper, typed error, and attachment
// upload helpers. All domain modules import `request` from here.
// In dev mode, Vite proxies /api/* to localhost:8080.
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  public hint?: string;
  public details?: Record<string, unknown>;
  constructor(
    public status: number,
    public code: string,
    message: string,
    hint?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.hint = hint;
    this.details = details;
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set Content-Type: application/json when there is a body to send.
  // Sending this header without a body causes Fastify to reject the request
  // with "Body cannot be empty when content-type is set to 'application/json'".
  const headers: HeadersInit = init?.body
    ? { 'Content-Type': 'application/json', ...init?.headers }
    : { ...init?.headers };

  const res = await fetch(path, {
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as Record<string, string>).error ?? 'UNKNOWN',
      (body as Record<string, string>).message ?? res.statusText,
      (body as Record<string, string>).hint,
      (body as Record<string, unknown>).details as Record<string, unknown> | undefined,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export type HealthResponse = {
  status: 'ok' | 'degraded';
  timestamp: string;
  dependencies?: Record<string, { status: 'ok' | 'error'; latencyMs: number; error?: string }>;
};

/**
 * Payload returned by `GET /api/version-compat` (roadmap §33.11). Intentionally
 * duplicated from `@agentctl/shared` so this module stays import-light; the
 * shapes MUST stay in sync.
 */
export type VersionCompatResponse = {
  appVersion: string;
  gitSha: string;
  schemaVersion: number;
  minSupportedMobileBuild: number;
  minSupportedWebBuild: number;
};

export const healthApi = {
  health: () => request<HealthResponse>('/health?detail=true'),
  versionCompat: () => request<VersionCompatResponse>('/api/version-compat'),

  // Dashboard / Metrics (Prometheus text format → parsed object)
  metrics: async (): Promise<Record<string, string | number>> => {
    const res = await fetch('/metrics');
    if (!res.ok) throw new ApiError(res.status, 'METRICS_ERROR', res.statusText);
    const text = await res.text();
    const result: Record<string, string | number> = {};
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || line.trim() === '') continue;
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx > 0) {
        const key = line.slice(0, spaceIdx);
        const val = line.slice(spaceIdx + 1).trim();
        const num = Number(val);
        result[key] = Number.isNaN(num) ? val : num;
      }
    }
    return result;
  },
};

// ---------------------------------------------------------------------------
// Attachment upload helpers
// ---------------------------------------------------------------------------

export type Attachment = {
  name: string;
  type: 'image' | 'file';
  /** Base64 data URL for preview (images only). */
  previewUrl?: string;
  /** Size in bytes. */
  size: number;
  /** The text content (for text files) or base64 content (for binary). */
  content: string;
  /** Whether this is base64 encoded. */
  isBase64: boolean;
};

/** Read a File object into an Attachment. */
export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isImage = file.type.startsWith('image/');
    const isText =
      file.type.startsWith('text/') ||
      /\.(ts|js|json|md|py|sh|yaml|yml|toml|cfg|ini|xml|html|css|sql|csv)$/i.test(file.name);

    if (isText) {
      reader.onload = () => {
        resolve({
          name: file.name,
          type: 'file',
          size: file.size,
          content: reader.result as string,
          isBase64: false,
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    } else {
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1] ?? '';
        resolve({
          name: file.name,
          type: isImage ? 'image' : 'file',
          previewUrl: isImage ? (reader.result as string) : undefined,
          size: file.size,
          content: base64,
          isBase64: true,
        });
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    }
  });
}

/** Convert a clipboard image blob into an Attachment. */
export function clipboardImageToAttachment(blob: Blob): Promise<Attachment> {
  const ext = blob.type.split('/')[1] ?? 'png';
  const name = `clipboard-${Date.now()}.${ext}`;
  const file = new File([blob], name, { type: blob.type });
  return fileToAttachment(file);
}
