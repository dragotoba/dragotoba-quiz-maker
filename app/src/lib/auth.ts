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

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authRequest(path: string, body: unknown): Promise<AuthResponse> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: (AuthResponse & { error?: string }) | null = null;
  try {
    data = raw ? (JSON.parse(raw) as AuthResponse & { error?: string }) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data?.token || !data.user) {
    throw new Error(data?.error || "Request failed.");
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
  // #region agent log
  fetch("http://127.0.0.1:7396/ingest/25b36585-94ec-47e1-8552-d4a8a44c933d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "a58a7b",
    },
    body: JSON.stringify({
      sessionId: "a58a7b",
      hypothesisId: "D",
      location: "auth.ts:loginAccount",
      message: "client stored session after login",
      data: {
        tokenLen: result.token?.length ?? 0,
        userIdPrefix: String(result.user?.id ?? "").slice(0, 8),
        storedTokenLen: getToken()?.length ?? 0,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  return result.user;
}

export function logoutAccount() {
  clearSession();
}

export function safeNextPath(raw: string | null | undefined, fallback = "/dashboard") {
  if (typeof raw !== "string") return fallback;
  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("://")) return fallback;
  return value;
}
