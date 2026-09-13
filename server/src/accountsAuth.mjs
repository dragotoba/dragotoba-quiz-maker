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
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ ok: true, token: string, user: { id: string, email?: string, name?: string } } | { ok: false, status: number, error: string }>}
 */
export async function proxyLoginToAccounts(email, password) {
  const base = getAccountsApiBaseUrl();
  let response;
  try {
    response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dragotoba-Service": SERVICE,
      },
      body: JSON.stringify({
        email,
        password,
        service: SERVICE,
      }),
    });
  } catch (error) {
    console.error("Accounts login request failed:", error);
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
        : "Incorrect email/username or password.";
    return { ok: false, status: response.status, error };
  }

  const token = data?.token;
  const accountsUser = data?.user;
  if (typeof token !== "string" || !accountsUser || typeof accountsUser.id !== "string") {
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
