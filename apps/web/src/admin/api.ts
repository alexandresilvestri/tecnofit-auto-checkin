import type { ApiError } from "../api";
import { clear, consumeFresh, login, token } from "./auth";

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const bearer = token();
  if (!bearer) {
    await login();
    throw { status: 401, message: "Redirecionando para o login..." } satisfies ApiError;
  }
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${bearer}`, ...init.headers },
  });
  if (response.status === 401) {
    clear();
    if (consumeFresh()) throw { status: 401, message: "Sessão inválida. Saia e entre novamente." } satisfies ApiError;
    await login();
    throw { status: 401, message: "Redirecionando para o login..." } satisfies ApiError;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
    throw {
      status: response.status,
      message:
        response.status === 403
          ? "Acesso negado."
          : typeof body?.message === "string"
            ? body.message
            : "Erro inesperado.",
    } satisfies ApiError;
  }
  consumeFresh();
  return response;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const text = await (await request(path, init)).text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

export const get = <T>(path: string) => json<T>(path);

export const post = <T = undefined>(path: string, body?: unknown) => json<T>(path, jsonInit("POST", body));

export const del = <T = undefined>(path: string, body?: unknown) => json<T>(path, jsonInit("DELETE", body));

export async function download(path: string, filename: string) {
  const blob = await (await request(path)).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export { errorMessage } from "../api";
