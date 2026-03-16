import createClient from 'openapi-fetch';
import { config } from '@/app/config';
import type { paths } from '@/shared/api/generated/schema';

let getToken: (() => string | undefined) | null = null;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;
let unauthorizedInFlight: Promise<void> | null = null;

export function setTokenGetter(getter: () => string | undefined) {
  getToken = getter;
}

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;

  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null;
    }
  };
}

export function getAuthToken() {
  return getToken?.();
}

async function notifyUnauthorizedResponse(response: Response) {
  if (response.status !== 401) {
    return false;
  }

  return triggerUnauthorizedHandler().catch(() => false);
}

export async function triggerUnauthorizedHandler() {
  if (!unauthorizedHandler) {
    return false;
  }

  if (!unauthorizedInFlight) {
    unauthorizedInFlight = Promise.resolve(unauthorizedHandler()).finally(() => {
      unauthorizedInFlight = null;
    });
  }

  await unauthorizedInFlight;
  return true;
}

export const apiClient = createClient<paths>({
  baseUrl: config.api.baseUrl,
});

apiClient.use({
  onRequest({ request }) {
    const token = getAuthToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return request;
  },
  async onResponse({ response }) {
    if (!response.ok) {
      throw await toApiError(response);
    }
    return response;
  },
});

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly traceId?: string,
    public readonly unauthorizedHandled = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function toApiError(response: Response) {
  const unauthorizedHandled = await notifyUnauthorizedResponse(response);

  const body = await response
    .clone()
    .json()
    .catch(() => null);
  const apiError = body?.error;
  return new ApiError(
    response.status,
    apiError?.code ?? 'UNKNOWN',
    apiError?.message ?? response.statusText,
    apiError?.details,
    apiError?.trace_id,
    unauthorizedHandled,
  );
}

export function buildApiUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${config.api.baseUrl}${path}`;
}

export function createRequestHeaders(headers?: HeadersInit, options?: { json?: boolean }) {
  const normalized = new Headers(headers);
  const token = getAuthToken();
  if (token && !normalized.has('Authorization')) {
    normalized.set('Authorization', `Bearer ${token}`);
  }
  if (options?.json && !normalized.has('Content-Type')) {
    normalized.set('Content-Type', 'application/json');
  }
  return normalized;
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers: createRequestHeaders(init.headers, {
      json: init.body != null && !(init.body instanceof FormData),
    }),
  });
  if (!response.ok) {
    throw await toApiError(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function isConflict(err: unknown): err is ApiError {
  return isApiError(err) && err.status === 409;
}

export function isRateLimit(err: unknown): err is ApiError {
  return isApiError(err) && err.status === 429;
}

export function isValidationError(err: unknown): err is ApiError {
  return isApiError(err) && err.status === 422;
}

export function isNotFound(err: unknown): err is ApiError {
  return isApiError(err) && err.status === 404;
}

export function isIntegrationNotConfigured(err: unknown): err is ApiError {
  return isApiError(err) && err.code === 'INTEGRATION_NOT_CONFIGURED';
}
