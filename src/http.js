export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} from ${url}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Small fetch wrapper: form/JSON body encoding, timeout, and retry with
 * backoff on 429/5xx and network errors. Returns { status, headers, data }
 * where data is parsed JSON when the response is JSON, else text.
 */
export async function request(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    json,
    form,
    body,
    timeoutMs = 30_000,
    retries = 2,
  } = opts;

  const init = { method, headers: { ...headers } };
  if (json !== undefined) {
    init.headers['Content-Type'] ??= 'application/json';
    init.body = JSON.stringify(json);
  } else if (form !== undefined) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    init.body = body;
  }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      const isJson = (res.headers.get('content-type') || '').includes('json');
      const data = isJson && text ? JSON.parse(text) : text;
      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt < retries) {
          lastErr = new HttpError(res.status, url, text);
          continue;
        }
        throw new HttpError(res.status, url, text);
      }
      return { status: res.status, headers: res.headers, data };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastErr = err;
      if (attempt === retries) break;
    }
  }
  throw lastErr;
}
