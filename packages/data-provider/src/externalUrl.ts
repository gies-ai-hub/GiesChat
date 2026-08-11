export const EXTERNAL_URL_ALLOWED_HOSTS = [
  'replit.app',
  'replit.dev',
  'repl.co',
  /** GiesChat deck previews, served by the pptx-mcp container. */
  'pptx-mcp.azurewebsites.net',
];

/** Local dev only: the preview container runs on http://localhost:8001. Scoped to
 * loopback names so no remote host can ever ride the relaxed protocol check. */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];

/** Validates an external-url string before it reaches an iframe src. Returns the
 * normalized href for allowed hosts, otherwise null (fail closed). */
export function getAllowedExternalUrl(content: string | null | undefined): string | null {
  const trimmed = (content ?? '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    const isLoopback = LOOPBACK_HOSTS.includes(url.hostname);
    if (url.protocol !== 'https:' && !(isLoopback && url.protocol === 'http:')) {
      return null;
    }
    if (isLoopback) {
      return url.href;
    }
    const allowed = EXTERNAL_URL_ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    return allowed ? url.href : null;
  } catch {
    return null;
  }
}
