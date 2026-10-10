import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AccountButton from "@/components/AccountButton";
import { fetchCurrentUser, getStoredUser, getToken } from "@/lib/auth";
import {
  DEFAULT_QUIZ_COVER,
  QUIZ_CATEGORIES,
  activeTagSearch,
  getCommunityQuiz,
  getCommunityQuizResult,
  getPublishedQuiz,
  listCommunityQuizzes,
  quizMatchesTagSearch,
  remixCommunityQuiz,
  saveCommunityQuizResult,
  toggleCommunityLike,
  updateCommunityQuizCategories,
  type CommunityQuizSummary,
  type CommunitySort,
  type SavedCommunityResult,
  type TagSearchOp,
  type TagSearchTerm,
} from "@/lib/quizStorage";
import { CreateQuizEditor, parseStoredQuiz } from "./CreateQuiz";

const SORT_OPTIONS: { value: CommunitySort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "liked", label: "Most Liked" },
  { value: "recent", label: "Most Recent" },
];

function quizLink(id: string) {
  return `${window.location.origin}/community/${id}`;
}

function formatLikes(count: number) {
  return count === 1 ? "1 like" : `${count} likes`;
}

function quizCategories(quiz: CommunityQuizSummary) {
  return Array.isArray(quiz.categories) ? quiz.categories : [];
}

function quizTags(quiz: CommunityQuizSummary) {
  return Array.isArray(quiz.tags) ? quiz.tags : [];
}

function coverSrc(quiz: CommunityQuizSummary) {
  const raw = quiz.coverImage.trim();
  if (!raw) return DEFAULT_QUIZ_COVER;
  // Older listings may point at the PNG icon which composites with a black square in some views.
  if (
    raw === "/quiz-maker-icon.png" ||
    raw.endsWith("/quiz-maker-icon.png") ||
    raw === DEFAULT_QUIZ_COVER
  ) {
    return DEFAULT_QUIZ_COVER;
  }
  return raw;
}

function isDefaultCover(quiz: CommunityQuizSummary) {
  return coverSrc(quiz) === DEFAULT_QUIZ_COVER;
}

function TagPills({
  tags,
  singleLine = false,
}: {
  tags: string[];
  singleLine?: boolean;
}) {
  if (tags.length === 0) {
    return singleLine ? <div className="mt-2 h-6" aria-hidden /> : null;
  }
  return (
    <div
      className={
        singleLine
          ? "mt-2 flex h-6 max-h-6 flex-wrap gap-1.5 overflow-hidden"
          : "mt-2 flex flex-wrap gap-1.5"
      }
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full border border-[#2f5d76]/20 bg-[#2f5d76]/8 px-2 py-0.5 text-[11px] leading-4 text-[#2f5d76]"
        >
          #{tag}
        </span>
      ))}
    </div>
  );
}

function matchesCategoryFilter(
  quiz: CommunityQuizSummary,
  selected: Set<string>,
  allSelected: boolean,
) {
  if (allSelected) return true;
  if (selected.size === 0) return false;
  return quizCategories(quiz).some((category) => selected.has(category));
}

function quizDisplayName(quiz: CommunityQuizSummary) {
  return quiz.name.trim() || "Untitled Quiz";
}

function matchesNameFilter(quiz: CommunityQuizSummary, query: string) {
  if (!query) return true;
  return quizDisplayName(quiz).toLowerCase().includes(query.toLowerCase());
}

const TAG_SEARCH_OPS: TagSearchOp[] = ["and", "or", "not"];

type TagDraftRow = {
  id: string;
  tag: string;
  op: TagSearchOp;
};

function blankTagRow(): TagDraftRow {
  return { id: crypto.randomUUID(), tag: "", op: "and" };
}

function rowsFromTagQuery(terms: TagSearchTerm[]): TagDraftRow[] {
  if (terms.length === 0) return [blankTagRow()];
  return terms.map((term) => ({ id: crypto.randomUUID(), tag: term.tag, op: term.op }));
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none">
      <path
        d="M3.5 5h17l-6.2 7.2a2 2 0 0 0-.5 1.3V19l-3.6 1.6v-7.1a2 2 0 0 0-.5-1.3L3.5 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AdvancedTagSearch({
  rows,
  onChange,
  onClose,
  onApply,
  onClear,
}: {
  rows: TagDraftRow[];
  onChange: (rows: TagDraftRow[]) => void;
  onClose: () => void;
  onApply: (terms: TagSearchTerm[]) => void;
  onClear: () => void;
}) {
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function updateRow(id: string, patch: Partial<TagDraftRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="advanced-search-title"
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#1c2a33]/10 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 id="advanced-search-title" className="text-lg font-semibold text-[#1c2a33]">
              Advanced search
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[#4a5560]">
              Search by tags. Operators are read from left to right.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close advanced search"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#4a5560] hover:bg-black/5"
          >
            ×
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3 overflow-y-auto px-5 pb-2">
          {rows.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-3">
              {index > 0 ? (
                <div
                  className="flex justify-center gap-1"
                  role="group"
                  aria-label={`Operator before tag ${index + 1}`}
                >
                  {TAG_SEARCH_OPS.map((op) => (
                    <button
                      key={op}
                      type="button"
                      aria-pressed={row.op === op}
                      onClick={() => updateRow(row.id, { op })}
                      className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold ${
                        row.op === op
                          ? "bg-[#2f5d76] text-white"
                          : "bg-[#f4f1ea] text-[#2f5d76] hover:bg-[#2f5d76]/10"
                      }`}
                    >
                      {op}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2 focus-within:border-[#2f5d76]">
                  <span className="select-none text-[#5c6770]" aria-hidden>
                    #
                  </span>
                  <input
                    ref={index === 0 ? firstInputRef : undefined}
                    aria-label={`Tag ${index + 1}`}
                    value={row.tag}
                    spellCheck={false}
                    placeholder="tag"
                    onChange={(e) =>
                      updateRow(row.id, { tag: e.target.value.replace(/^#+/, "") })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        onApply(rows.map((item) => ({ tag: item.tag, op: item.op })));
                      }
                    }}
                    className="min-w-0 flex-1 border-none bg-transparent px-0.5 text-sm text-[#1c2a33] outline-none placeholder:text-[#5c6770]/50"
                  />
                </label>
                {rows.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove tag ${index + 1}`}
                    onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                    className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#4a5560] hover:bg-black/5"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={rows.length >= 12}
            onClick={() => onChange([...rows, blankTagRow()])}
            className="cursor-pointer self-start rounded-full px-3 py-1.5 text-sm font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/8 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add tag
          </button>
        </div>
        <div className="flex gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClear}
            className="cursor-pointer rounded-full border border-[#2f5d76] bg-white px-5 py-2.5 text-sm font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/5"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => onApply(rows.map((item) => ({ tag: item.tag, op: item.op })))}
            className="flex-1 cursor-pointer rounded-full border-none bg-[#2f5d76] px-5 py-2.5 text-sm font-semibold text-[#f8fafc] hover:bg-[#244a5e]"
          >
            Search
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Community() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const [sort, setSort] = useState<CommunitySort>("trending");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [browseQuizzes, setBrowseQuizzes] = useState<CommunityQuizSummary[]>([]);
  const [searchQuizzes, setSearchQuizzes] = useState<CommunityQuizSummary[] | null>(null);
  const [searchQuizzesKey, setSearchQuizzesKey] = useState("");
  const [tagQuery, setTagQuery] = useState<TagSearchTerm[]>([]);
  const [tagDraft, setTagDraft] = useState<TagDraftRow[]>(() => [blankTagRow()]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(QUIZ_CATEGORIES),
  );
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CommunityQuizSummary | null>(null);
  const [selectedError, setSelectedError] = useState("");
  const [playQuiz, setPlayQuiz] = useState<ReturnType<typeof parseStoredQuiz> | null>(
    null,
  );
  const [playResults, setPlayResults] = useState<SavedCommunityResult | null>(null);
  const [savedResult, setSavedResult] = useState<SavedCommunityResult | null>(null);
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState("");
  const [likeBusy, setLikeBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => getStoredUser()?.isAdmin === true);
  const [adminCategoryMenuOpen, setAdminCategoryMenuOpen] = useState(false);
  const adminCategoryMenuRef = useRef<HTMLDivElement>(null);
  const [adminCategoryBusy, setAdminCategoryBusy] = useState(false);
  const [adminCategoryError, setAdminCategoryError] = useState("");
  const [remixBusy, setRemixBusy] = useState(false);

  const allCategoriesSelected = selectedCategories.size === QUIZ_CATEGORIES.length;
  const nameQuery = search.trim();
  const activeTags = useMemo(() => activeTagSearch(tagQuery), [tagQuery]);
  const requestKey = JSON.stringify({ name: appliedSearch, tags: activeTags });
  const liveKey = JSON.stringify({ name: nameQuery, tags: activeTags });
  const serverReady =
    searchQuizzes !== null &&
    searchQuizzesKey === requestKey &&
    requestKey === liveKey &&
    (appliedSearch.length > 0 || activeTags.length > 0);
  const searchSource = serverReady && searchQuizzes ? searchQuizzes : browseQuizzes;
  const nameMatches = useMemo(
    () => searchSource.filter((quiz) => matchesNameFilter(quiz, nameQuery)),
    [searchSource, nameQuery],
  );
  const tagMatches = useMemo(
    () => nameMatches.filter((quiz) => quizMatchesTagSearch(quizTags(quiz), activeTags)),
    [nameMatches, activeTags],
  );
  const filteredQuizzes = useMemo(
    () =>
      tagMatches.filter((quiz) =>
        matchesCategoryFilter(quiz, selectedCategories, allCategoriesSelected),
      ),
    [tagMatches, selectedCategories, allCategoriesSelected],
  );

  const categoryFilterLabel = allCategoriesSelected
    ? "All categories"
    : selectedCategories.size === 0
      ? "No categories"
      : selectedCategories.size === 1
        ? [...selectedCategories][0]
        : `${selectedCategories.size} categories`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const user = await fetchCurrentUser();
      if (!cancelled) setIsAdmin(user?.isAdmin === true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setSearchQuizzes(null);
    setSearchQuizzesKey("");
    void (async () => {
      try {
        const list = await listCommunityQuizzes(sort);
        if (!cancelled) setBrowseQuizzes(list);
      } catch (err) {
        if (!cancelled) {
          setBrowseQuizzes([]);
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
    const tags = activeTagSearch(tagQuery);
    if (!appliedSearch && tags.length === 0) {
      setSearchQuizzes(null);
      setSearchQuizzesKey("");
      return;
    }
    const key = JSON.stringify({ name: appliedSearch, tags });
    let cancelled = false;
    void (async () => {
      try {
        const list = await listCommunityQuizzes(sort, {
          name: appliedSearch,
          tags,
        });
        if (!cancelled) {
          setSearchQuizzes(list);
          setSearchQuizzesKey(key);
        }
      } catch {
        if (!cancelled) {
          setSearchQuizzes(null);
          setSearchQuizzesKey("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sort, appliedSearch, tagQuery]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!categoryMenuRef.current?.contains(e.target as Node)) {
        setCategoryMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCategoryMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [categoryMenuOpen]);

  useEffect(() => {
    if (!adminCategoryMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!adminCategoryMenuRef.current?.contains(e.target as Node)) {
        setAdminCategoryMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdminCategoryMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [adminCategoryMenuOpen]);

  useEffect(() => {
    setAdminCategoryMenuOpen(false);
    setAdminCategoryError("");
  }, [quizId]);

  useEffect(() => {
    if (!quizId) {
      setSelected(null);
      setSelectedError("");
      return;
    }
    setSelectedError("");
    setSelected((prev) => {
      if (prev?.id === quizId) return prev;
      return (
        browseQuizzes.find((quiz) => quiz.id === quizId) ??
        searchQuizzes?.find((quiz) => quiz.id === quizId) ??
        null
      );
    });
    let cancelled = false;
    void (async () => {
      try {
        const listing = await getCommunityQuiz(quizId);
        if (cancelled) return;
        setSelected(listing);
        const merge = (quiz: CommunityQuizSummary) =>
          quiz.id === listing.id ? { ...quiz, ...listing } : quiz;
        setBrowseQuizzes((prev) => prev.map(merge));
        setSearchQuizzes((prev) => (prev ? prev.map(merge) : prev));
      } catch (err) {
        if (cancelled) return;
        setSelected((prev) => (prev?.id === quizId ? prev : null));
        setSelectedError(err instanceof Error ? err.message : "Quiz not found.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  useEffect(() => {
    setCopied(false);
    setPlayError("");
    setSavedResult(quizId ? getCommunityQuizResult(quizId) : null);
  }, [quizId]);

  useEffect(() => {
    if ((!selected && !selectedError) || playQuiz) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (advancedOpen || adminCategoryMenuOpen || categoryMenuOpen) return;
      navigate("/community");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedError, playQuiz, navigate, adminCategoryMenuOpen, categoryMenuOpen, advancedOpen]);

  function openAdvancedSearch() {
    setTagDraft(rowsFromTagQuery(tagQuery));
    setAdvancedOpen(true);
  }

  function applyTagSearch(terms: TagSearchTerm[]) {
    const next = activeTagSearch(terms);
    setTagQuery(next);
    setTagDraft(rowsFromTagQuery(next));
    setAdvancedOpen(false);
  }

  function clearTagSearch() {
    setTagQuery([]);
    setTagDraft([blankTagRow()]);
  }

  function toggleCategory(category: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function patchListedQuiz(
    id: string,
    update: (quiz: CommunityQuizSummary) => CommunityQuizSummary,
  ) {
    setBrowseQuizzes((prev) => prev.map((quiz) => (quiz.id === id ? update(quiz) : quiz)));
    setSearchQuizzes((prev) =>
      prev ? prev.map((quiz) => (quiz.id === id ? update(quiz) : quiz)) : prev,
    );
  }

  function applyLike(id: string, likes: number, liked: boolean) {
    patchListedQuiz(id, (quiz) => ({ ...quiz, likes, liked }));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, likes, liked } : prev));
  }

  function applyListing(listing: CommunityQuizSummary) {
    patchListedQuiz(listing.id, (quiz) => ({ ...quiz, ...listing }));
    setSelected((prev) => (prev && prev.id === listing.id ? { ...prev, ...listing } : prev));
  }

  async function handleAdminToggleCategory(category: string) {
    if (!selected || adminCategoryBusy) return;
    const current = quizCategories(selected);
    const next = current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category];
    if (next.length < 1) {
      setAdminCategoryError("Keep at least one category.");
      return;
    }
    setAdminCategoryBusy(true);
    setAdminCategoryError("");
    try {
      const listing = await updateCommunityQuizCategories(selected.id, next);
      applyListing(listing);
    } catch (err) {
      setAdminCategoryError(
        err instanceof Error ? err.message : "Could not update categories.",
      );
    } finally {
      setAdminCategoryBusy(false);
    }
  }

  async function handleCopyLink() {
    if (!selected) return;
    const url = quizLink(selected.id);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const field = document.createElement("textarea");
      field.value = url;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function handleLike() {
    if (!selected || likeBusy) return;
    if (!getToken()) {
      navigate(`/login?next=${encodeURIComponent(`/community/${selected.id}`)}`);
      return;
    }
    setLikeBusy(true);
    try {
      const result = await toggleCommunityLike(selected.id);
      applyLike(selected.id, result.likes, result.liked);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Could not update like.");
    } finally {
      setLikeBusy(false);
    }
  }

  async function handleRemix() {
    if (!selected || remixBusy) return;
    if (!getToken()) {
      navigate(`/login?next=${encodeURIComponent(`/community/${selected.id}`)}`);
      return;
    }
    setRemixBusy(true);
    setPlayError("");
    try {
      const quiz = await remixCommunityQuiz(selected.id);
      navigate(`/quiz/${quiz.id}`);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Could not remix quiz.");
      setRemixBusy(false);
    }
  }

  async function handlePlay() {
    if (!selected || playBusy) return;
    setPlayBusy(true);
    setPlayError("");
    try {
      const doc = await getPublishedQuiz(selected.id);
      setPlayResults(null);
      setPlayQuiz(parseStoredQuiz(doc));
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Could not load quiz.");
    } finally {
      setPlayBusy(false);
    }
  }

  async function handleViewLastResult() {
    if (!selected || playBusy || !savedResult) return;
    setPlayBusy(true);
    setPlayError("");
    try {
      const doc = await getPublishedQuiz(selected.id);
      setPlayResults(savedResult);
      setPlayQuiz(parseStoredQuiz(doc));
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : "Could not load results.");
    } finally {
      setPlayBusy(false);
    }
  }

  if (playQuiz) {
    return (
      <CreateQuizEditor
        key={`${playQuiz.id}-${playQuiz.updatedAt}-${playResults ? "results" : "play"}`}
        initialQuiz={playQuiz}
        playOnly
        playResults={playResults}
        onPlayResults={(screen) => {
          saveCommunityQuizResult(
            playQuiz.id,
            screen.projectVariables,
            screen.localVariables,
          );
          setSavedResult({
            quizId: playQuiz.id,
            savedAt: Date.now(),
            projectVariables: screen.projectVariables,
            localVariables: screen.localVariables,
          });
        }}
        onExitPlay={() => {
          setPlayQuiz(null);
          setPlayResults(null);
        }}
      />
    );
  }

  const popupOpen = Boolean(quizId);

  return (
    <main className="qh-page relative min-h-screen w-full font-[Poppins,sans-serif] text-[#1a1a1a]">
      <div className="absolute top-6 right-6 left-6 z-[5] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:right-8 sm:left-8 sm:grid-cols-[auto_minmax(12rem,1fr)_auto]">
        <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
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

        <div className="relative" ref={categoryMenuRef}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={categoryMenuOpen}
            onClick={() => setCategoryMenuOpen((open) => !open)}
            className="cursor-pointer rounded-full border border-[#2f5d76]/25 bg-white/70 py-2 pr-9 pl-4 text-sm font-semibold text-[#2f5d76] shadow-sm outline-none hover:bg-white hover:text-[#244a5e]"
          >
            {categoryFilterLabel}
            <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[10px] text-[#2f5d76]">
              ▾
            </span>
          </button>
          {categoryMenuOpen ? (
            <div
              role="listbox"
              aria-label="Filter by category"
              className="absolute top-full left-0 z-10 mt-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-[#1c2a33]/10 bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            >
              <div className="mb-1 flex gap-2 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategories(new Set(QUIZ_CATEGORIES))}
                  className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/8"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCategories(new Set())}
                  className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-[#5c6770] hover:bg-black/5"
                >
                  None
                </button>
              </div>
              {QUIZ_CATEGORIES.map((category) => {
                const checked = selectedCategories.has(category);
                return (
                  <label
                    key={category}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#1c2a33] hover:bg-[#f4f1ea]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCategory(category)}
                      className="h-4 w-4 cursor-pointer"
                    />
                    <span>{category}</span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
        </div>
        <div className="col-span-2 flex justify-center sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:px-4">
          <div className="flex w-full max-w-md items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Search quizzes by name</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search quizzes"
                className="w-full rounded-full border border-[#2f5d76]/25 bg-white/70 px-4 py-2 text-sm text-[#1c2a33] shadow-sm outline-none placeholder:text-[#5c6770] hover:bg-white focus:border-[#2f5d76] focus:bg-white"
              />
            </label>
            <button
              type="button"
              aria-label="Advanced search"
              aria-expanded={advancedOpen}
              aria-pressed={activeTags.length > 0}
              onClick={openAdvancedSearch}
              className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border shadow-sm ${
                activeTags.length > 0
                  ? "border-[#2f5d76] bg-[#2f5d76] text-white hover:bg-[#244a5e]"
                  : "border-[#2f5d76]/25 bg-white/70 text-[#2f5d76] hover:bg-white hover:text-[#244a5e]"
              }`}
            >
              <FunnelIcon />
            </button>
          </div>
        </div>
        <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3 sm:row-start-1">
          <AccountButton />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-col px-6 pt-36 pb-10 sm:px-8 sm:pt-28 sm:pb-14">
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
        ) : filteredQuizzes.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-[#1c2a33]/10 bg-white/80 px-6 py-10 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            <p className="text-base font-semibold text-[#1c2a33]">
              {browseQuizzes.length === 0 && !nameQuery && activeTags.length === 0
                ? "No community quizzes yet."
                : nameQuery && activeTags.length > 0 && tagMatches.length === 0
                  ? "No quizzes match that name and those tags."
                  : nameMatches.length === 0
                    ? "No quizzes match that name."
                    : tagMatches.length === 0
                      ? "No quizzes match those tags."
                      : "No quizzes match these categories."}
            </p>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-[#4a5560]">
              {browseQuizzes.length === 0 && !nameQuery && activeTags.length === 0
                ? "Published quizzes will show up here. Check back soon, or create one of your own."
                : nameQuery && activeTags.length > 0 && tagMatches.length === 0
                  ? "Try a different name or tags, or clear the search."
                  : nameMatches.length === 0
                    ? "Try a different name, or clear the search."
                    : tagMatches.length === 0
                      ? "Try different tags, or clear advanced search."
                      : "Try selecting more categories, or choose All."}
            </p>
          </div>
        ) : (
          <ul className="mt-10 m-0 grid list-none grid-cols-1 gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {filteredQuizzes.map((quiz) => {
              const categories = quizCategories(quiz);
              return (
              <li key={quiz.id}>
                <Link
                  to={`/community/${quiz.id}`}
                  className="block w-full overflow-hidden rounded-2xl border border-[#1c2a33]/10 bg-white/80 text-left no-underline shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:border-[#2f5d76]/40"
                >
                  <div className="flex h-40 items-center justify-center bg-[#f4f1ea]">
                    <img
                      src={coverSrc(quiz)}
                      alt=""
                      className={
                        isDefaultCover(quiz)
                          ? "h-24 w-24 rounded-full bg-transparent object-contain"
                          : "h-full w-full object-cover"
                      }
                    />
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
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <span className="font-medium text-[#2f5d76]">
                        {formatLikes(quiz.likes)}
                      </span>
                      {categories.length > 0 ? (
                        <>
                          <span className="text-[#c5ccd2]" aria-hidden="true">
                            ·
                          </span>
                          <span className="min-w-0 text-[#5c6770]">
                            {categories.join(" · ")}
                          </span>
                        </>
                      ) : null}
                    </div>
                    <TagPills tags={quizTags(quiz)} singleLine />
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {advancedOpen ? (
        <AdvancedTagSearch
          rows={tagDraft}
          onChange={setTagDraft}
          onClose={() => setAdvancedOpen(false)}
          onApply={applyTagSearch}
          onClear={clearTagSearch}
        />
      ) : null}

      {popupOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => navigate("/community")}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-quiz-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#1c2a33]/10 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedError && !selected ? (
              <div className="p-6">
                <p className="text-sm font-medium text-[#7a3b3b]" role="alert">
                  {selectedError}
                </p>
                <button
                  type="button"
                  onClick={() => navigate("/community")}
                  className="mt-4 w-full cursor-pointer rounded-full border border-[#2f5d76] bg-white px-6 py-3 text-sm font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/5"
                >
                  Back to community
                </button>
              </div>
            ) : selected ? (
              <>
                <div className="shrink-0 p-5 pb-0">
                  <div className="flex max-h-[40vh] items-center justify-center overflow-auto rounded-xl bg-[#f4f1ea]">
                    <img
                      src={coverSrc(selected)}
                      alt=""
                      className={
                        isDefaultCover(selected)
                          ? "h-28 w-28 rounded-full bg-transparent object-contain"
                          : "max-h-[40vh] w-auto max-w-full object-contain"
                      }
                    />
                  </div>
                  <h2
                    id="community-quiz-title"
                    className="mt-4 text-xl font-semibold text-[#1c2a33]"
                  >
                    {selected.name.trim() || "Untitled Quiz"}
                  </h2>
                  {selected.author ? (
                    <p className="mt-1 text-sm text-[#5c6770]">by {selected.author}</p>
                  ) : null}
                  {selected.remixedFrom?.id ? (
                    <p className="mt-1 text-sm text-[#5c6770]">
                      Remixed from{" "}
                      <Link
                        to={`/community/${selected.remixedFrom.id}`}
                        className="font-semibold text-[#2f5d76] no-underline hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {selected.remixedFrom.author.trim() || "a quiz"}
                      </Link>
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {quizCategories(selected).length > 0 ? (
                      <p className="text-xs text-[#5c6770]">
                        {quizCategories(selected).join(" · ")}
                      </p>
                    ) : (
                      <p className="text-xs text-[#5c6770]">No categories</p>
                    )}
                    {isAdmin ? (
                      <div className="relative" ref={adminCategoryMenuRef}>
                        <button
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={adminCategoryMenuOpen}
                          disabled={adminCategoryBusy}
                          onClick={() => setAdminCategoryMenuOpen((open) => !open)}
                          className="cursor-pointer rounded-full border border-[#2f5d76]/25 bg-white px-3 py-1 text-xs font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/5 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Edit categories ▾
                        </button>
                        {adminCategoryMenuOpen ? (
                          <div
                            role="listbox"
                            aria-label="Edit quiz categories"
                            className="absolute top-full left-0 z-20 mt-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-[#1c2a33]/10 bg-white p-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                          >
                            {QUIZ_CATEGORIES.map((category) => {
                              const checked = quizCategories(selected).includes(category);
                              return (
                                <label
                                  key={category}
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#1c2a33] hover:bg-[#f4f1ea]"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={adminCategoryBusy}
                                    onChange={() => void handleAdminToggleCategory(category)}
                                    className="h-4 w-4 cursor-pointer"
                                  />
                                  <span>{category}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {adminCategoryError ? (
                    <p className="mt-2 text-xs font-medium text-[#7a3b3b]" role="alert">
                      {adminCategoryError}
                    </p>
                  ) : null}
                  {quizTags(selected).length > 0 ? (
                    <TagPills tags={quizTags(selected)} />
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
                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyLink()}
                      className="flex-1 cursor-pointer rounded-full border border-[#2f5d76] bg-white px-4 py-2.5 text-sm font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/5"
                    >
                      {copied ? "Copied" : "Copy link"}
                    </button>
                    <button
                      type="button"
                      disabled={likeBusy}
                      onClick={() => void handleLike()}
                      className={`flex-1 cursor-pointer rounded-full border px-4 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected.liked
                          ? "border-[#2f5d76] bg-[#2f5d76] text-[#f8fafc]"
                          : "border-[#2f5d76] bg-white text-[#2f5d76] hover:bg-[#2f5d76]/5"
                      }`}
                    >
                      {selected.liked ? "Liked" : "Like"} · {selected.likes}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={remixBusy || playBusy}
                    onClick={() => void handleRemix()}
                    className="mb-2 w-full cursor-pointer rounded-full border border-[#2f5d76] bg-white px-6 py-3 text-sm font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {remixBusy ? "Remixing…" : "Remix"}
                  </button>
                  <button
                    type="button"
                    disabled={playBusy || remixBusy}
                    onClick={() => void handlePlay()}
                    className="w-full cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {playBusy ? "Loading…" : "Play quiz"}
                  </button>
                  {savedResult ? (
                    <button
                      type="button"
                      disabled={playBusy}
                      onClick={() => void handleViewLastResult()}
                      className="mt-2 w-full cursor-pointer rounded-full border border-[#2f5d76] bg-white px-6 py-3 text-sm font-semibold text-[#2f5d76] hover:bg-[#2f5d76]/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      View last result
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="p-6">
                <p className="text-sm text-[#4a5560]">Loading quiz…</p>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
