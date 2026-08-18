import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AccountButton from "@/components/AccountButton";
import {
  createStoredQuiz,
  deleteStoredQuiz,
  listQuizSummaries,
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

export default function Dashboard() {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>(() => listQuizSummaries());
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState(DELETE_COUNTDOWN_SECONDS);

  const empty = quizzes.length === 0;
  const sorted = useMemo(() => quizzes, [quizzes]);
  const deleteLabel = deleteConfirm?.name.trim() || "Untitled Quiz";

  function refresh() {
    setQuizzes(listQuizSummaries());
  }

  function handleCreate() {
    const quiz = createStoredQuiz();
    navigate(`/quiz/${quiz.id}`);
  }

  function openDeleteConfirm(id: string, name: string) {
    setDeleteConfirm({ id, name });
  }

  function closeDeleteConfirm() {
    setDeleteConfirm(null);
  }

  function confirmDelete() {
    if (!deleteConfirm || deleteCountdown > 0) return;
    deleteStoredQuiz(deleteConfirm.id);
    setDeleteConfirm(null);
    refresh();
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
            onClick={handleCreate}
            className="cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e]"
          >
            Create New Quiz
          </button>
        </div>

        {empty ? (
          <div className="border-t border-[#1c2a33]/15 pt-10">
            <p className="text-base text-[#4a5560]">No quizzes yet.</p>
            <button
              type="button"
              onClick={handleCreate}
              className="mt-5 cursor-pointer border-none bg-transparent p-0 text-sm font-semibold text-[#2f5d76] hover:text-[#244a5e]"
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
                onClick={confirmDelete}
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
