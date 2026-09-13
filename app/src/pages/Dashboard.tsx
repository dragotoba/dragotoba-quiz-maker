import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import AccountButton from "@/components/AccountButton";
import {
  clearNeedsDisplayNamePrompt,
  getStoredUser,
  getToken,
  peekNeedsDisplayNamePrompt,
  updateDisplayName,
  type AuthUser,
} from "@/lib/auth";
import {
  createStoredQuiz,
  deleteStoredQuiz,
  listQuizSummaries,
  localQuizCount,
  type QuizSummary,
} from "@/lib/quizStorage";

const DELETE_COUNTDOWN_SECONDS = 3;

function formatUpdatedAt(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

function profileLabel(user: AuthUser | null) {
  if (!user) return "";
  return user.displayName?.trim() || user.username;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const [displayNameDraft, setDisplayNameDraft] = useState(
    () => getStoredUser()?.displayName?.trim() || getStoredUser()?.username || "",
  );
  const [displayNameBusy, setDisplayNameBusy] = useState(false);
  const [displayNameError, setDisplayNameError] = useState("");
  const [displayNameSaved, setDisplayNameSaved] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [welcomeDraft, setWelcomeDraft] = useState("");
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeError, setWelcomeError] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState(DELETE_COUNTDOWN_SECONDS);

  const empty = !loading && !error && quizzes.length === 0;
  const sorted = useMemo(() => quizzes, [quizzes]);
  const deleteLabel = deleteConfirm?.name.trim() || "Untitled Quiz";
  const signedIn = Boolean(getToken() && user);

  async function refresh() {
    const uploading = Boolean(getToken()) && localQuizCount() > 0;
    setMigrating(uploading);
    setError("");
    try {
      const list = await listQuizSummaries();
      setQuizzes(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load quizzes.");
    } finally {
      setLoading(false);
      setMigrating(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    if (!peekNeedsDisplayNamePrompt()) return;
    setWelcomeDraft(profileLabel(getStoredUser()));
    setWelcomeError("");
    setWelcomeOpen(true);
  }, [signedIn]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const quiz = await createStoredQuiz();
      navigate(`/quiz/${quiz.id}`);
    } catch (err) {
      setCreating(false);
      setError(err instanceof Error ? err.message : "Could not create quiz.");
    }
  }

  function openDeleteConfirm(id: string, name: string) {
    setDeleteConfirm({ id, name });
  }

  function closeDeleteConfirm() {
    setDeleteConfirm(null);
  }

  async function confirmDelete() {
    if (!deleteConfirm || deleteCountdown > 0) return;
    const id = deleteConfirm.id;
    setDeleteConfirm(null);
    try {
      await deleteStoredQuiz(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete quiz.");
    }
  }

  async function saveDisplayName(e: FormEvent) {
    e.preventDefault();
    setDisplayNameError("");
    setDisplayNameSaved(false);
    const next = displayNameDraft.trim();
    if (!next) {
      setDisplayNameError("Enter a display name.");
      return;
    }
    setDisplayNameBusy(true);
    try {
      const updated = await updateDisplayName(next);
      setUser(updated);
      setDisplayNameDraft(updated.displayName?.trim() || updated.username);
      setDisplayNameSaved(true);
      window.dispatchEvent(new Event("dragotoba-auth-user"));
    } catch (err) {
      setDisplayNameError(
        err instanceof Error ? err.message : "Could not update display name.",
      );
    } finally {
      setDisplayNameBusy(false);
    }
  }

  function closeWelcomePrompt() {
    clearNeedsDisplayNamePrompt();
    setWelcomeOpen(false);
    setWelcomeError("");
  }

  async function saveWelcomeDisplayName(e: FormEvent) {
    e.preventDefault();
    setWelcomeError("");
    const next = welcomeDraft.trim();
    if (!next) {
      setWelcomeError("Enter a display name.");
      return;
    }
    setWelcomeBusy(true);
    try {
      const updated = await updateDisplayName(next);
      setUser(updated);
      setDisplayNameDraft(updated.displayName?.trim() || updated.username);
      clearNeedsDisplayNamePrompt();
      setWelcomeOpen(false);
      window.dispatchEvent(new Event("dragotoba-auth-user"));
    } catch (err) {
      setWelcomeError(
        err instanceof Error ? err.message : "Could not update display name.",
      );
    } finally {
      setWelcomeBusy(false);
    }
  }

  useEffect(() => {
    if (!deleteConfirm) return;
    setDeleteCountdown(DELETE_COUNTDOWN_SECONDS);
    const timer = window.setInterval(() => {
      setDeleteCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [deleteConfirm]);

  useEffect(() => {
    if (!deleteConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDeleteConfirm();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirm]);

  useEffect(() => {
    if (!welcomeOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWelcomePrompt();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [welcomeOpen]);

  const fieldClass =
    "mt-1.5 w-full rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]";

  return (
    <main className="qh-page relative min-h-screen w-full font-[Poppins,sans-serif] text-[#1a1a1a]">
      <AccountButton className="absolute top-6 right-6 sm:right-8" />

      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-10 sm:px-8 sm:py-14">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              to="/"
              className="text-sm font-medium text-[#2f5d76] no-underline hover:text-[#244a5e]"
            >
              ← Home
            </Link>
            <h1 className="mt-3 text-3xl font-bold tracking-[-0.02em] text-[#1c2a33] sm:text-4xl">
              Your Quizzes
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-[#4a5560]">
              Open a saved quiz or start a new one.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || migrating}
            className="cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create New Quiz"}
          </button>
        </div>

        {signedIn ? (
          <section className="mb-8 rounded-2xl border border-[#1c2a33]/10 bg-white/70 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-[0.04em] text-[#5c6770]">
              Profile
            </h2>
            <p className="mt-1 text-sm text-[#4a5560]">
              Choose how your name appears on Quiz Maker. Username{" "}
              <span className="font-medium text-[#1c2a33]">@{user?.username}</span> stays the same.
            </p>
            <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={saveDisplayName}>
              <label className="min-w-[12rem] flex-1 text-sm text-[#1c2a33]">
                <span className="font-medium text-[#4a5560]">Display name</span>
                <input
                  type="text"
                  name="displayName"
                  maxLength={120}
                  value={displayNameDraft}
                  onChange={(e) => {
                    setDisplayNameDraft(e.target.value);
                    setDisplayNameSaved(false);
                  }}
                  className={fieldClass}
                />
              </label>
              <button
                type="submit"
                disabled={displayNameBusy}
                className="cursor-pointer rounded-full border-none bg-[#2f5d76] px-5 py-2.5 text-sm font-semibold text-[#f8fafc] hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {displayNameBusy ? "Saving…" : "Save"}
              </button>
            </form>
            {displayNameError ? (
              <p className="mt-2 text-sm font-medium text-[#7a3b3b]" role="alert">
                {displayNameError}
              </p>
            ) : null}
            {displayNameSaved ? (
              <p className="mt-2 text-sm text-[#2f5d76]" role="status">
                Display name updated.
              </p>
            ) : null}
          </section>
        ) : null}

        {migrating ? (
          <p className="mb-4 text-sm text-[#4a5560]">
            Saving your local quizzes to your account…
          </p>
        ) : null}

        {error ? (
          <p className="mb-4 text-sm font-medium text-[#7a3b3b]" role="alert">
            {error}{" "}
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
              className="cursor-pointer border-none bg-transparent p-0 font-semibold text-[#2f5d76] hover:text-[#244a5e]"
            >
              Retry
            </button>
          </p>
        ) : null}

        {loading ? (
          <p className="border-t border-[#1c2a33]/15 pt-10 text-sm text-[#4a5560]">
            Loading quizzes…
          </p>
        ) : empty ? (
          <div className="border-t border-[#1c2a33]/15 pt-10">
            <p className="text-base text-[#4a5560]">No quizzes yet.</p>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || migrating}
              className="mt-5 cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[#2f5d76] hover:text-[#244a5e] disabled:opacity-60"
            >
              Create your first quiz →
            </button>
          </div>
        ) : (
          <ul className="m-0 list-none border-t border-[#1c2a33]/15 p-0">
            {sorted.map((quiz) => (
              <li
                key={quiz.id}
                className="flex items-stretch gap-3 border-b border-[#1c2a33]/10"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/quiz/${quiz.id}`)}
                  className="min-w-0 flex-1 cursor-pointer border-none bg-transparent py-5 pr-2 text-left hover:bg-white/35"
                >
                  <span className="block truncate text-base font-semibold text-[#1c2a33]">
                    {quiz.projectName.trim() || "Untitled Quiz"}
                  </span>
                  <span className="mt-1 block text-xs text-[#5c6770]">
                    Updated {formatUpdatedAt(quiz.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${quiz.projectName || "quiz"}`}
                  onClick={() => openDeleteConfirm(quiz.id, quiz.projectName)}
                  className="shrink-0 cursor-pointer self-center border-none bg-transparent px-3 py-2 text-sm text-[#7a3b3b] hover:text-[#5c1f1f]"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {welcomeOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={closeWelcomePrompt}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-name-title"
            aria-describedby="welcome-name-desc"
            className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="welcome-name-title" className="text-lg font-semibold text-black">
              Choose a display name
            </h2>
            <p id="welcome-name-desc" className="mt-2 text-sm leading-relaxed text-black/70">
              Welcome to Quiz Maker. Pick a name to show on your profile, or close to keep{" "}
              <span className="font-medium text-black">{profileLabel(user)}</span>.
            </p>
            <form className="mt-4 space-y-3" onSubmit={saveWelcomeDisplayName}>
              <label className="block text-sm text-[#1c2a33]">
                <span className="font-medium text-[#4a5560]">Display name</span>
                <input
                  type="text"
                  name="welcomeDisplayName"
                  autoFocus
                  maxLength={120}
                  value={welcomeDraft}
                  onChange={(e) => setWelcomeDraft(e.target.value)}
                  className={fieldClass}
                />
              </label>
              {welcomeError ? (
                <p className="text-sm font-medium text-[#7a3b3b]" role="alert">
                  {welcomeError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeWelcomePrompt}
                  className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
                >
                  Keep for now
                </button>
                <button
                  type="submit"
                  disabled={welcomeBusy}
                  className="cursor-pointer rounded-lg border-none bg-[#2f5d76] px-3 py-2 text-sm font-medium text-white hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {welcomeBusy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {deleteConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={closeDeleteConfirm}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-quiz-title"
            aria-describedby="delete-quiz-desc"
            className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-quiz-title" className="text-lg font-semibold text-black">
              Delete this quiz?
            </h2>
            <p id="delete-quiz-desc" className="mt-2 text-sm leading-relaxed text-black/70">
              “{deleteLabel}” will be permanently deleted. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteConfirm}
                className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteCountdown > 0}
                onClick={() => void confirmDelete()}
                className="cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#c0392b]"
              >
                {deleteCountdown > 0 ? `Delete (${deleteCountdown})` : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
