export type ApiError = { status: number; message: string };

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "X-Requested-With": "fetch", ...init.headers },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const message = (body as { message?: unknown } | undefined)?.message;
    const error: ApiError = {
      status: response.status,
      message:
        response.status === 429 && message === "Too Many Requests"
          ? "Muitas tentativas. Tente novamente em instantes."
          : typeof message === "string"
            ? message
            : "Erro inesperado.",
    };
    throw error;
  }
  return body as T;
}

export function post<T = undefined>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function patch<T = undefined>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function del<T = undefined>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}

export function guard(e: unknown): boolean {
  const status = (e as ApiError | null)?.status;
  if (status !== 401 && status !== 403) return false;
  location.assign("/login");
  return true;
}

export function errorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && (error as ApiError).status
    ? message
    : "Erro inesperado.";
}
