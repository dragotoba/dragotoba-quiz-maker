export type AuthUser = {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  isAdmin?: boolean;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
  needsDisplayName?: boolean;
};

const TOKEN_KEY = "dragotoba.auth.token";
const USER_KEY = "dragotoba.auth.user";
const NEEDS_DISPLAY_NAME_KEY = "dragotoba.auth.needsDisplayName";

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
    return {
      ...parsed,
      isAdmin: parsed.isAdmin === true,
    };
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser, options?: { needsDisplayName?: boolean }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (options?.needsDisplayName) {
    try {
      sessionStorage.setItem(NEEDS_DISPLAY_NAME_KEY, "1");
    } catch {
      // Ignore private-mode failures.
    }
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  try {
    sessionStorage.removeItem(NEEDS_DISPLAY_NAME_KEY);
  } catch {
    // Ignore.
  }
}

export function peekNeedsDisplayNamePrompt(): boolean {
  try {
    return sessionStorage.getItem(NEEDS_DISPLAY_NAME_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearNeedsDisplayNamePrompt() {
  try {
    sessionStorage.removeItem(NEEDS_DISPLAY_NAME_KEY);
  } catch {
    // Ignore.
  }
}

export function updateStoredUser(user: AuthUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
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
  let data: (AuthResponse & {
    error?: string;
    code?: string;
    needsLogin?: boolean;
    message?: string;
  }) | null = null;
  try {
    data = raw
      ? (JSON.parse(raw) as AuthResponse & {
          error?: string;
          code?: string;
          needsLogin?: boolean;
          message?: string;
        })
      : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.error || "Request failed.") as Error & {
      code?: string;
      status?: number;
    };
    if (data?.code) err.code = data.code;
    err.status = res.status;
    throw err;
  }
  if (data?.needsLogin && data.user && !data.token) {
    const err = new Error(data.message || "Account created — sign in.") as Error & {
      code?: string;
      status?: number;
    };
    err.code = "NEEDS_LOGIN";
    err.status = res.status;
    throw err;
  }
  if (!data?.token || !data.user) {
    throw new Error(data?.error || "Request failed.");
  }
  return data;
}

export async function signupAccount(input: {
  username: string;
  email: string;
  password: string;
}) {
  const result = await authRequest("/auth/signup", {
    ...input,
    returnOrigin: window.location.origin,
  });
  setSession(result.token, result.user);
  return result.user;
}

export async function loginAccount(input: {
  identifier: string;
  password: string;
}) {
  const result = await authRequest("/auth/login", input);
  setSession(result.token, result.user, {
    needsDisplayName: Boolean(result.needsDisplayName),
  });
  return result.user;
}

export async function loginWithGoogle(idToken: string): Promise<AuthUser> {
  const result = await authRequest("/auth/google", { idToken });
  setSession(result.token, result.user, {
    needsDisplayName: Boolean(result.needsDisplayName),
  });
  return result.user;
}

export async function updateDisplayName(displayName: string): Promise<AuthUser> {
  const res = await fetch("/api/auth/me", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ displayName }),
  });
  const raw = await res.text();
  let data: { user?: AuthUser; error?: string } | null = null;
  try {
    data = raw ? (JSON.parse(raw) as { user?: AuthUser; error?: string }) : null;
  } catch {
    data = null;
  }
  if (!res.ok || !data?.user) {
    throw new Error(data?.error || "Could not update display name.");
  }
  updateStoredUser(data.user);
  return data.user;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: AuthUser };
    if (!data?.user?.id) return null;
    updateStoredUser(data.user);
    return data.user;
  } catch {
    return null;
  }
}

const FORGOT_PASSWORD_MESSAGE =
  "If an account exists for that email, we sent a password reset link.";

export async function forgotPassword(email: string) {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      returnOrigin: window.location.origin,
    }),
  });
  const raw = await res.text();
  let data: { ok?: boolean; message?: string; error?: string } | null = null;
  try {
    data = raw ? (JSON.parse(raw) as { ok?: boolean; message?: string; error?: string }) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || "Could not send reset email.");
  }
  return data?.message || FORGOT_PASSWORD_MESSAGE;
}

export async function resetPassword(input: { token: string; password: string }) {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const raw = await res.text();
  let data: { ok?: boolean; message?: string; error?: string } | null = null;
  try {
    data = raw ? (JSON.parse(raw) as { ok?: boolean; message?: string; error?: string }) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error || "Could not reset password.");
  }
  clearSession();
  return data?.message || "Password updated.";
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
