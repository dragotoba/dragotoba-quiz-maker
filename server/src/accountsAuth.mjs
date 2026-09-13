/**
 * Proxy auth calls to Dragotoba accounts.
 *
 * Env:
 *   ACCOUNTS_API_BASE_URL — e.g. https://accounts.example.com (no trailing slash)
 */
const SERVICE = "quiz_maker";

export function getAccountsApiBaseUrl() {
  const base = process.env.ACCOUNTS_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("ACCOUNTS_API_BASE_URL is not set");
  }
  return base;
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @param {{ headers?: Record<string, string> }} [options]
 * @returns {Promise<{ ok: true, status: number, data: Record<string, unknown> } | { ok: false, status: number, error: string }>}
 */
async function proxyAccountsPost(path, body, options = {}) {
  const base = getAccountsApiBaseUrl();
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dragotoba-Service": SERVICE,
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({ ...body, service: SERVICE }),
    });
  } catch (error) {
    console.error(`Accounts request failed (${path}):`, error);
    return {
      ok: false,
      status: 502,
      error: "Could not reach Dragotoba accounts.",
    };
  }

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error =
      data && typeof data === "object" && typeof data.error === "string"
        ? data.error
        : "Request failed.";
    return { ok: false, status: response.status, error };
  }

  return {
    ok: true,
    status: response.status,
    data: data && typeof data === "object" ? data : {},
  };
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: true, token: string, user: { id: string, email?: string, name?: string } } | { ok: false, status: number, error: string }>}
 */
export async function proxyLoginToAccounts(email, password) {
  const result = await proxyAccountsPost("/api/auth/login", { email, password });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error:
        result.error === "Request failed."
          ? "Incorrect email/username or password."
          : result.error,
    };
  }

  const token = result.data?.token;
  const accountsUser = result.data?.user;
  if (
    typeof token !== "string" ||
    !accountsUser ||
    typeof accountsUser !== "object" ||
    typeof accountsUser.id !== "string"
  ) {
    return {
      ok: false,
      status: 502,
      error: "Invalid response from Dragotoba accounts.",
    };
  }

  return {
    ok: true,
    token,
    user: accountsUser,
  };
}

/**
 * Accounts signup does not return a session token — only `{ ok, user }`.
 *
 * @param {{ name: string, email: string, password: string, returnOrigin?: string | null }} input
 */
export async function proxySignupToAccounts(input) {
  const returnOrigin =
    typeof input.returnOrigin === "string" ? input.returnOrigin.trim().replace(/\/+$/, "") : "";
  /** @type {Record<string, unknown>} */
  const body = {
    name: input.name,
    email: input.email,
    password: input.password,
  };
  if (returnOrigin) body.returnOrigin = returnOrigin;

  /** @type {Record<string, string>} */
  const headers = {};
  if (returnOrigin) headers["X-Return-Origin"] = returnOrigin;

  const result = await proxyAccountsPost("/api/auth/signup", body, { headers });
  if (!result.ok) {
    return result;
  }

  const accountsUser = result.data?.user;
  if (!accountsUser || typeof accountsUser !== "object" || typeof accountsUser.id !== "string") {
    return {
      ok: false,
      status: 502,
      error: "Invalid response from Dragotoba accounts.",
    };
  }

  return {
    ok: true,
    status: result.status,
    user: accountsUser,
  };
}

/**
 * @param {string} idToken
 * @returns {Promise<{ ok: true, token: string, user: { id: string, email?: string, name?: string }, isNewUser: boolean } | { ok: false, status: number, error: string }>}
 */
export async function proxyGoogleToAccounts(idToken) {
  const result = await proxyAccountsPost("/api/auth/google", { idToken });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      error:
        result.error === "Request failed."
          ? "Google sign-in failed."
          : result.error,
    };
  }

  const token = result.data?.token;
  const accountsUser = result.data?.user;
  if (
    typeof token !== "string" ||
    !accountsUser ||
    typeof accountsUser !== "object" ||
    typeof accountsUser.id !== "string"
  ) {
    return {
      ok: false,
      status: 502,
      error: "Invalid response from Dragotoba accounts.",
    };
  }

  return {
    ok: true,
    token,
    user: accountsUser,
    isNewUser: Boolean(result.data?.isNewUser),
  };
}

/**
 * @param {string} email
 * @param {string | null | undefined} returnOrigin
 */
export async function proxyForgotPasswordToAccounts(email, returnOrigin) {
  /** @type {Record<string, unknown>} */
  const body = { email };
  if (typeof returnOrigin === "string" && returnOrigin.trim()) {
    body.returnOrigin = returnOrigin.trim().replace(/\/+$/, "");
  }
  return proxyAccountsPost("/api/auth/forgot-password", body);
}

/**
 * @param {string} token
 * @param {string} password
 */
export async function proxyResetPasswordToAccounts(token, password) {
  return proxyAccountsPost("/api/auth/reset-password", { token, password });
}
