export type AuthUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
};

const TOKEN_KEY = "dragotoba.auth.token";
const USER_KEY = "dragotoba.auth.user";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.id || !parsed.username || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function authRequest(path: string, body: unknown): Promise<AuthResponse> {
  const url = `/api${path}`;
  console.log("[auth-client] request", { url });
  // #region agent log
  fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "a58a7b",
    },
    body: JSON.stringify({
      sessionId: "a58a7b",
      hypothesisId: "E",
      location: "app/src/lib/auth.ts:authRequest",
      message: "client request start",
      data: { url },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("[auth-client] network error", { url, message });
    throw new Error(message || "Request failed.");
  }
  const raw = await res.text();
  let data: (AuthResponse & { error?: string }) | null = null;
  try {
    data = raw ? (JSON.parse(raw) as AuthResponse & { error?: string }) : null;
  } catch {
    data = null;
  }
  console.log("[auth-client] response", {
    url,
    status: res.status,
    json: Boolean(data),
    error: data?.error ?? null,
    preview: raw.slice(0, 80),
  });
  // #region agent log
  fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "a58a7b",
    },
    body: JSON.stringify({
      sessionId: "a58a7b",
      hypothesisId: "E",
      location: "app/src/lib/auth.ts:authRequest",
      message: "client response",
      data: {
        url,
        status: res.status,
        json: Boolean(data),
        error: data?.error ?? null,
        preview: raw.slice(0, 80),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  if (!res.ok || !data?.token || !data.user) {
    throw new Error(data?.error || raw || "Request failed.");
  }
  return data;
}

export async function signupAccount(input: {
  username: string;
  email: string;
  password: string;
}) {
  const result = await authRequest("/auth/signup", input);
  setSession(result.token, result.user);
  return result.user;
}

export async function loginAccount(input: {
  identifier: string;
  password: string;
}) {
  const result = await authRequest("/auth/login", input);
  setSession(result.token, result.user);
  return result.user;
}

export function logoutAccount() {
  clearSession();
}
