/** RFC 9457 problem details, as returned by every API error. */
export interface Problem {
  title: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
  [extension: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
}

export interface ApiOptions {
  baseUrl?: string;
  /** Synchronizer token of the session, sent on every state-changing request. */
  csrfToken: () => string | null;
  /** Called when the API answers 401: the session ended (expired or revoked). */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
}

const SAFE_METHODS = new Set(['GET', 'HEAD']);

export function createApi(options: ApiOptions): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = options.csrfToken();
    if (token && !SAFE_METHODS.has(method)) headers['X-CSRF-Token'] = token;

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) options.onUnauthorized?.();
      const problem =
        typeof payload === 'object' && payload !== null && 'title' in payload
          ? (payload as Problem)
          : { title: response.statusText || 'Error', status: response.status };
      throw new ApiError(response.status, problem);
    }
    return payload as T;
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    delete: (path) => request('DELETE', path),
  };
}

let client: ApiClient | null = null;

/** The application configures the client once (main.ts); tests install a fake. */
export function configureApi(instance: ApiClient): void {
  client = instance;
}

export function api(): ApiClient {
  if (!client) throw new Error('The API client is not configured');
  return client;
}

/** User-facing message in French for an error thrown by the API client. */
export function describeError(error: unknown, overrides: Record<number, string> = {}): string {
  if (error instanceof ApiError) {
    const override = overrides[error.status];
    if (override) return override;
    if (error.status === 403) return "Vous n'avez pas la permission d'effectuer cette action.";
    if (error.status === 429) return 'Trop de tentatives. Patientez avant de réessayer.';
    if (error.problem.errors?.length) {
      return error.problem.errors.map((issue) => `${issue.path} : ${issue.message}`).join(' · ');
    }
    return error.problem.detail ?? error.problem.title;
  }
  return 'Le serveur est injoignable.';
}
