import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createStoredQuiz,
  deleteStoredQuiz,
  listQuizSummaries,
  type QuizSummary,
} from "@/lib/quizStorage";

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

  const empty = quizzes.length === 0;
  const sorted = useMemo(() => quizzes, [quizzes]);

  function refresh() {
    setQuizzes(listQuizSummaries());
  }

  function handleCreate() {
    const quiz = createStoredQuiz();
    navigate(`/quiz/${quiz.id}`);
  }

  function handleDelete(id: string, name: string) {
    const label = name.trim() || "this quiz";
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return;
    deleteStoredQuiz(id);
    refresh();
  }

  return (
    <main className="qh-page relative min-h-screen w-full font-[Poppins,sans-serif] text-[#1a1a1a]">
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
                  onClick={() => handleDelete(quiz.id, quiz.projectName)}
                  className="shrink-0 cursor-pointer self-center border-none bg-transparent px-3 py-2 text-sm text-[#7a3b3b] hover:text-[#5c1f1f]"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
