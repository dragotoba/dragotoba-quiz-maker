import { type FormEvent } from "react";
import { Link } from "react-router-dom";

export default function Login() {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
  }

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
            Log in
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#4a5560]">
            Sign in to your Dragotoba account.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]"
              />
            </label>

            <label className="block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1.5 w-full rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]"
              />
            </label>

            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 text-sm font-medium text-[#2f5d76] hover:text-[#244a5e]"
            >
              Forgot password?
            </button>

            <button
              type="submit"
              className="mt-2 w-full cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e]"
            >
              Sign in
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#5c6770]">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 font-semibold text-[#2f5d76] hover:text-[#244a5e]"
            >
              Sign up
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
