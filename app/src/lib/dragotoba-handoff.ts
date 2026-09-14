import { clearSession, setSession, type AuthUser } from "@/lib/auth";

const TOKEN_KEY = "dragotoba.auth.token";

/**
 * Accept studio-hub handoff: ?dragotoba_token=<JWT>
 * Stores the token, strips it from the URL, then hydrates dragotoba.auth.user via /api/auth/me.
 */
export async function consumeDragotobaTokenHandoff(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const url = new URL(window.location.href);
  const token = url.searchParams.get("dragotoba_token")?.trim();
  if (!token) return false;

  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    return false;
  }

  url.searchParams.delete("dragotoba_token");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", next || "/");

  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const raw = await res.text();
    let data: { user?: AuthUser; error?: string } | null = null;
    try {
      data = raw ? (JSON.parse(raw) as { user?: AuthUser; error?: string }) : null;
    } catch {
      data = null;
    }

    if (!res.ok || !data?.user) {
      clearSession();
      return false;
    }

    setSession(token, data.user);
    window.dispatchEvent(new Event("dragotoba-auth-user"));
    return true;
  } catch {
    clearSession();
    return false;
  }
}
