import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AccountButton from "@/components/AccountButton";
import {
  getPublishedQuiz,
  listCommunityQuizzes,
  type CommunityQuizSummary,
  type CommunitySort,
} from "@/lib/quizStorage";
import { CreateQuizEditor, parseStoredQuiz } from "./CreateQuiz";

const SORT_OPTIONS: { value: CommunitySort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "liked", label: "Most Liked" },
  { value: "recent", label: "Most Recent" },
];

export default function Community() {
  const [sort, setSort] = useState<CommunitySort>("trending");
  const [quizzes, setQuizzes] = useState<CommunityQuizSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CommunityQuizSummary | null>(null);
  const [playQuiz, setPlayQuiz] = useState<ReturnType<typeof parseStoredQuiz> | null>(
    null,
  );
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const list = await listCommunityQuizzes(sort);
        if (!cancelled) setQuizzes(list);
      } catch (err) {
        if (!cancelled) {
          setQuizzes([]);
          setError(err instanceof Error ? err.message : "Could not load quizzes.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sort]);

  useEffect(() => {
    if (!selected || playQuiz) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, playQuiz]);

  async function handlePlay() {
    if (!selected || playBusy) return;
    setPlayBusy(true);
    setPlayError("");
    try {
      const doc = await getPublishedQuiz(selected.id);
      setPlayQuiz(parseStoredQuiz(doc));
      setSelected(null);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Could not load quiz.");
    } finally {
      setPlayBusy(false);
    }
  }

  if (playQuiz) {
    return (
      <CreateQuizEditor
        key={playQuiz.id}
        initialQuiz={playQuiz}
        playOnly
        onExitPlay={() => setPlayQuiz(null)}
      />
    );
  }

  return (
    <main className="qh-page relative min-h-screen w-full font-[Poppins,sans-serif] text-[#1a1a1a]">
      <label className="absolute top-6 left-6 z-[5] sm:left-8">
        <span className="sr-only">Sort community quizzes</span>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as CommunitySort)}
          className="cursor-pointer appearance-none rounded-full border border-[#2f5d76]/25 bg-white/70 py-2 pr-9 pl-4 text-sm font-semibold text-[#2f5d76] shadow-sm outline-none hover:bg-white hover:text-[#244a5e] focus:border-[#2f5d76]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[10px] text-[#2f5d76]">
          ▾
        </span>
      </label>

      <AccountButton className="absolute top-6 right-6 z-[5] sm:right-8" />

      <div className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-24 pb-10 sm:px-8 sm:pt-28 sm:pb-14">
        <Link
          to="/"
          className="text-sm font-medium text-[#2f5d76] no-underline hover:text-[#244a5e]"
        >
          ← Home
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.02em] text-[#1c2a33] sm:text-4xl">
          Community Quizzes
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-[#4a5560]">
          Browse quizzes shared by other creators.
        </p>

        {error ? (
          <p className="mt-10 text-sm font-medium text-[#7a3b3b]" role="alert">
            {error}
          </p>
        ) : loading ? (
          <p className="mt-10 text-sm text-[#4a5560]">Loading quizzes…</p>
        ) : quizzes.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-[#1c2a33]/10 bg-white/80 px-6 py-10 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            <p className="text-base font-semibold text-[#1c2a33]">
              No community quizzes yet.
            </p>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-[#4a5560]">
              Published quizzes will show up here. Check back soon, or create one
              of your own.
            </p>
          </div>
        ) : (
          <ul className="mt-10 m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((quiz) => (
              <li key={quiz.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPlayError("");
                    setSelected(quiz);
                  }}
                  className="w-full cursor-pointer overflow-hidden rounded-2xl border border-[#1c2a33]/10 bg-white/80 text-left shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:border-[#2f5d76]/40"
                >
                  <div className="flex h-40 items-center justify-center bg-[#f4f1ea]">
                    {quiz.coverImage ? (
                      <img
                        src={quiz.coverImage}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-sm text-[#5c6770]">No image</span>
                    )}
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-base font-semibold text-[#1c2a33]">
                      {quiz.name.trim() || "Untitled Quiz"}
                    </h2>
                    {quiz.author ? (
                      <p className="mt-0.5 truncate text-xs text-[#5c6770]">
                        by {quiz.author}
                      </p>
                    ) : null}
                    <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed text-[#4a5560]">
                      {quiz.description.trim() || "No description"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-quiz-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#1c2a33]/10 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 p-5 pb-0">
              {selected.coverImage ? (
                <div className="flex max-h-[40vh] items-center justify-center overflow-auto rounded-xl bg-[#f4f1ea]">
                  <img
                    src={selected.coverImage}
                    alt=""
                    className="max-h-[40vh] w-auto max-w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-28 items-center justify-center rounded-xl bg-[#f4f1ea] text-sm text-[#5c6770]">
                  No image
                </div>
              )}
              <h2
                id="community-quiz-title"
                className="mt-4 text-xl font-semibold text-[#1c2a33]"
              >
                {selected.name.trim() || "Untitled Quiz"}
              </h2>
              {selected.author ? (
                <p className="mt-1 text-sm text-[#5c6770]">by {selected.author}</p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#4a5560]">
                {selected.description.trim() || "No description"}
              </p>
            </div>
            <div className="shrink-0 border-t border-[#1c2a33]/10 p-5">
              {playError ? (
                <p className="mb-3 text-sm font-medium text-[#7a3b3b]" role="alert">
                  {playError}
                </p>
              ) : null}
              <button
                type="button"
                disabled={playBusy}
                onClick={() => void handlePlay()}
                className="w-full cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {playBusy ? "Loading…" : "Play quiz"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
