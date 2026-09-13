import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import GoogleSignIn from "@/components/GoogleSignIn";
import {
  getStoredUser,
  loginWithGoogle,
  safeNextPath,
  signupAccount,
} from "@/lib/auth";
import { migrateLocalQuizzesIfNeeded } from "@/lib/quizStorage";

export default function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const existing = getStoredUser();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (existing) {
    return <Navigate to={nextPath} replace />;
  }

  const loginHref =
    nextPath === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(nextPath)}`;

  async function afterAuth() {
    try {
      await migrateLocalQuizzesIfNeeded();
    } catch {
      // Dashboard retries the upload if local quizzes remain.
    }
    navigate(nextPath, { replace: true });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setErrorCode(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await signupAccount({ username, email, password });
      await afterAuth();
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code ?? "")
          : "";
      if (code === "NEEDS_LOGIN") {
        navigate(
          `${loginHref}${loginHref.includes("?") ? "&" : "?"}notice=${encodeURIComponent("Account created — sign in.")}`,
          { replace: true },
        );
        return;
      }
      setErrorCode(code || null);
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle(idToken: string) {
    setError("");
    setErrorCode(null);
    setBusy(true);
    try {
      await loginWithGoogle(idToken);
      await afterAuth();
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code ?? "")
          : "";
      const message =
        err instanceof Error ? err.message : "Could not sign in with Google.";
      setErrorCode(code || null);
      setError(message);
      if (!code && /already|exists|linked|conflict/i.test(message)) {
        setErrorCode("DRAGOTOBA_ACCOUNT_EXISTS");
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]";

  return (
    <main className="qh-page flex min-h-screen w-full items-center justify-center px-6 py-10 font-[Poppins,sans-serif]">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="text-sm font-medium text-[#2f5d76] no-underline hover:text-[#244a5e]"
        >
          ← Home
        </Link>

        <div className="mt-6 rounded-2xl border border-[#1c2a33]/10 bg-white/80 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#1c2a33]">
            Create account
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#4a5560]">
            Continue with Google, or sign up with a username, email, and password.
          </p>

          <div className="mt-6 space-y-4">
            <GoogleSignIn
              disabled={busy}
              onCredential={handleGoogle}
              onError={(message) => {
                setErrorCode(null);
                setError(message);
              }}
            />
            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.08em] text-[#8a939c]">
              <span className="h-px flex-1 bg-[#1c2a33]/12" />
              or
              <span className="h-px flex-1 bg-[#1c2a33]/12" />
            </div>
          </div>

          <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Username</span>
              <input
                type="text"
                name="username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="yourname"
                className={fieldClass}
              />
            </label>

            <label className="block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={fieldClass}
              />
            </label>

            <label className="block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Password</span>
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={fieldClass}
              />
            </label>

            <label className="block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Confirm password</span>
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className={fieldClass}
              />
            </label>

            {error ? (
              <div className="space-y-2" role="alert">
                <p className="text-sm font-medium text-[#7a3b3b]">{error}</p>
                {errorCode === "DRAGOTOBA_ACCOUNT_EXISTS" ||
                (errorCode === null && /already|exists|linked|conflict/i.test(error)) ? (
                  <p className="text-sm text-[#4a5560]">
                    <Link
                      to={loginHref}
                      className="font-semibold text-[#2f5d76] no-underline hover:text-[#244a5e]"
                    >
                      Log in
                    </Link>
                    {" · "}
                    <Link
                      to="/forgot-password"
                      className="font-semibold text-[#2f5d76] no-underline hover:text-[#244a5e]"
                    >
                      Forgot password?
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#5c6770]">
            Already have an account?{" "}
            <Link
              to={loginHref}
              className="font-semibold text-[#2f5d76] no-underline hover:text-[#244a5e]"
            >
              Log in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
