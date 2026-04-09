/**
 * Browser fetch with bounded retries on network errors, 429, and 5xx (aligned with Android SupabaseHttp).
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 350;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch {
      if (attempt >= maxAttempts - 1) throw new Error('fetchWithRetry: network error after retries');
      await delay(Math.min(baseDelayMs * (attempt + 1), 2500));
      continue;
    }

    if (response.ok) return response;
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt >= maxAttempts - 1) return response;
    await delay(Math.min(baseDelayMs * (attempt + 1), 2500));
  }

  throw new Error('fetchWithRetry: exhausted attempts');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
