import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "@/lib/auth";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token")?.trim() || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("This link is invalid or expired.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await resetPassword({ token, password });
      setSuccess(true);
      window.setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "mt-1.5 w-full rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]";

  if (!token) {
    return (
      <main className="qh-page flex min-h-screen w-full items-center justify-center px-6 py-10 font-[Poppins,sans-serif]">
        <div className="w-full max-w-sm">
          <div className="mt-6 rounded-2xl border border-[#1c2a33]/10 bg-white/80 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#1c2a33]">
              Invalid reset link
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#4a5560]">
              This link is invalid or expired.
            </p>
            <p className="mt-6 text-center text-sm text-[#5c6770]">
              <Link
                to="/forgot-password"
                className="font-semibold text-[#2f5d76] no-underline hover:text-[#244a5e]"
              >
                Request a new link
              </Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="qh-page flex min-h-screen w-full items-center justify-center px-6 py-10 font-[Poppins,sans-serif]">
      <div className="w-full max-w-sm">
        <Link
          to="/login"
          className="text-sm font-medium text-[#2f5d76] no-underline hover:text-[#244a5e]"
        >
          ← Log in
        </Link>

        <div className="mt-6 rounded-2xl border border-[#1c2a33]/10 bg-white/80 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#1c2a33]">
            Reset password
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#4a5560]">
            Choose a new password for your Dragotoba account.
          </p>

          {success ? (
            <p className="mt-6 text-sm leading-relaxed text-[#4a5560]" role="status">
              Password updated. Redirecting to log in…
            </p>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm text-[#1c2a33]">
                <span className="font-medium text-[#4a5560]">New password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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
                  placeholder="••••••••"
                  className={fieldClass}
                />
              </label>

              {error ? (
                <p className="text-sm font-medium text-[#7a3b3b]" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 w-full cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
