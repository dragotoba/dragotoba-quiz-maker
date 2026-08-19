import { authHeaders, getToken } from "./auth";

export const DEFAULT_PROJECT_NAME = "Untitled Quiz";
export const LIBRARY_KEY = "dragotoba-quiz-maker:library";
export const LEGACY_KEY = "dragotoba-quiz-maker:v1";

export type QuizSummary = {
  id: string;
  projectName: string;
  updatedAt: number;
};

export type CommunitySort = "trending" | "liked" | "recent";

export type CommunityQuizSummary = {
  id: string;
  name: string;
  description: string;
  coverImage: string;
  likes: number;
  liked?: boolean;
  publishedAt: number;
  author: string;
};

export type QuizListing = {
  description: string;
  coverImage: string;
  unlisted: boolean;
};

export function emptyListing(): QuizListing {
  return { description: "", coverImage: "", unlisted: false };
}

export function normalizeListing(raw: unknown): QuizListing {
  if (!raw || typeof raw !== "object") return emptyListing();
  const data = raw as Record<string, unknown>;
  return {
    description: typeof data.description === "string" ? data.description : "",
    coverImage: typeof data.coverImage === "string" ? data.coverImage : "",
    unlisted: data.unlisted === true,
  };
}

/** Serialized quiz document stored in the library. */
export type StoredQuizDocument = {
  version: 1;
  id: string;
  projectName: string;
  updatedAt: number;
  variables: unknown;
  defaultAnswers: unknown;
  defaultQuestionColor?: unknown;
  defaultAnswerColor?: unknown;
  defaultAnswerTextColor?: unknown;
  sections: unknown;
  activeSectionId: string;
  listing?: QuizListing;
  /** Results page (scroll document); optional for older saves. */
  results?: unknown;
  /** Question-screen layout; optional for older saves. */
  quizUi?: unknown;
  /** @deprecated migrated into sections */
  boxes?: unknown;
  transitions?: unknown;
  camera?: unknown;
  localVariables?: unknown;
  sceneName?: string;
  sectionName?: string;
};

type QuizLibrary = {
  version: 2;
  quizzes: StoredQuizDocument[];
};

function nextSectionName(existingNames: string[]) {
  const used = new Set(existingNames);
  let n = 1;
  while (used.has(`Section${n}`)) n += 1;
  return `Section${n}`;
}

function emptySection(existingNames: string[] = []) {
  return {
    id: crypto.randomUUID(),
    name: nextSectionName(existingNames),
    localVariables: [],
    localDefaultAnswers: [],
    localDefaultQuestionColor: null,
    localQuizUi: null,
    boxes: [
      {
        id: crypto.randomUUID(),
        x: 0,
        y: 0,
        kind: "start",
        effects: [],
      },
    ],
    transitions: [],
    camera: { x: 0, y: 0, scale: 1 },
  };
}

function emptyDocument(id: string = crypto.randomUUID()): StoredQuizDocument {
  const section = emptySection([]);
  return {
    version: 1,
    id,
    projectName: DEFAULT_PROJECT_NAME,
    updatedAt: Date.now(),
    variables: [],
    defaultAnswers: [
      {
        id: crypto.randomUUID(),
        name: "Ans1",
        effects: [],
        color: "#9a9a9a",
        textColor: "#ffffff",
      },
    ],
    defaultQuestionColor: "#e6e6e6",
    defaultAnswerColor: "#9a9a9a",
    defaultAnswerTextColor: "#ffffff",
    sections: [section],
    activeSectionId: section.id,
    results: { textBoxes: [] },
    listing: emptyListing(),
    quizUi: undefined,
  };
}

function migrateFlatToSections(data: Record<string, unknown>) {
  const name =
    (typeof data.sectionName === "string" && data.sectionName.trim()
      ? data.sectionName
      : null) ||
    (typeof data.sceneName === "string" && data.sceneName.trim()
      ? data.sceneName
      : null) ||
    "Section1";

  const section = {
    id: crypto.randomUUID(),
    name,
    localVariables: data.localVariables ?? [],
    localDefaultAnswers: data.localDefaultAnswers ?? [],
    localDefaultQuestionColor: data.localDefaultQuestionColor ?? null,
    localQuizUi: data.localQuizUi ?? null,
    boxes: data.boxes ?? [],
    transitions: data.transitions ?? [],
    camera: data.camera ?? { x: 0, y: 0, scale: 1 },
  };

  return {
    sections: [section],
    activeSectionId: section.id,
  };
}

function asDocument(raw: unknown): StoredQuizDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (data.version !== 1) return null;

  const id = typeof data.id === "string" && data.id ? data.id : crypto.randomUUID();
  const projectName =
    typeof data.projectName === "string" && data.projectName.trim()
      ? data.projectName
      : DEFAULT_PROJECT_NAME;
  const updatedAt =
    typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
      ? data.updatedAt
      : Date.now();

  let sections = data.sections;
  let activeSectionId =
    typeof data.activeSectionId === "string" ? data.activeSectionId : "";

  if (!Array.isArray(sections) || sections.length === 0) {
    const migrated = migrateFlatToSections(data);
    sections = migrated.sections;
    activeSectionId = migrated.activeSectionId;
  }

  const sectionList = sections as { id?: string }[];
  if (!sectionList.some((s) => s && s.id === activeSectionId)) {
    activeSectionId = typeof sectionList[0]?.id === "string" ? sectionList[0].id : "";
  }

  return {
    version: 1,
    id,
    projectName,
    updatedAt,
    variables: data.variables ?? [],
    defaultAnswers: data.defaultAnswers ?? emptyDocument(id).defaultAnswers,
    defaultQuestionColor: data.defaultQuestionColor,
    defaultAnswerColor: data.defaultAnswerColor,
    defaultAnswerTextColor: data.defaultAnswerTextColor,
    sections,
    activeSectionId,
    results: data.results ?? { textBoxes: [] },
    listing: normalizeListing(data.listing),
    quizUi: data.quizUi,
  };
}

function migrateLegacy(): StoredQuizDocument[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const doc = asDocument({
      ...(typeof parsed === "object" && parsed ? parsed : {}),
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
      version: 1,
    });
    if (!doc) return [];
    localStorage.removeItem(LEGACY_KEY);
    return [doc];
  } catch {
    return [];
  }
}

function readLibrary(): QuizLibrary {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data?.version === 2 && Array.isArray(data.quizzes)) {
        const quizzes = data.quizzes
          .map((q) => asDocument(q))
          .filter((q): q is StoredQuizDocument => q !== null);
        return { version: 2, quizzes };
      }
    }
  } catch {
    // fall through to migrate / empty
  }

  const migrated = migrateLegacy();
  const library: QuizLibrary = { version: 2, quizzes: migrated };
  writeLibrary(library);
  return library;
}

function writeLibrary(library: QuizLibrary) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function usesRemoteStorage() {
  return Boolean(getToken());
}

function listLocalSummaries(): QuizSummary[] {
  return readLibrary()
    .quizzes.map((quiz) => ({
      id: quiz.id,
      projectName: quiz.projectName,
      updatedAt: quiz.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function getLocalQuiz(id: string): StoredQuizDocument | null {
  return readLibrary().quizzes.find((quiz) => quiz.id === id) ?? null;
}

function saveLocalQuiz(doc: StoredQuizDocument) {
  const library = readLibrary();
  const next: StoredQuizDocument = {
    ...doc,
    version: 1,
  };
  const index = library.quizzes.findIndex((quiz) => quiz.id === next.id);
  if (index >= 0) library.quizzes[index] = next;
  else library.quizzes.push(next);
  writeLibrary(library);
}

function deleteLocalQuiz(id: string) {
  const library = readLibrary();
  writeLibrary({
    version: 2,
    quizzes: library.quizzes.filter((quiz) => quiz.id !== id),
  });
}

function clearLocalLibrary() {
  try {
    localStorage.removeItem(LIBRARY_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    writeLibrary({ version: 2, quizzes: [] });
  }
}

function peekLocalQuizzes(): StoredQuizDocument[] {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (data?.version === 2 && Array.isArray(data.quizzes)) {
        return data.quizzes
          .map((quiz) => asDocument(quiz))
          .filter((quiz): quiz is StoredQuizDocument => quiz !== null);
      }
    }
  } catch {
    // fall through to legacy
  }

  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const doc = asDocument({
      ...(typeof parsed === "object" && parsed ? parsed : {}),
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
      version: 1,
    });
    return doc ? [doc] : [];
  } catch {
    return [];
  }
}

function localQuizCount() {
  return peekLocalQuizzes().length;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function withValidId(doc: StoredQuizDocument): StoredQuizDocument {
  if (UUID_RE.test(doc.id)) return doc;
  return { ...doc, id: crypto.randomUUID() };
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(authHeaders() as Record<string, string>),
  };
  const extra = init.headers;
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    Object.assign(headers, extra);
  }

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;

  const raw = await res.text();
  let data: (T & { error?: string }) | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T & { error?: string }) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(
      data && typeof data === "object" && "error" in data && data.error
        ? String(data.error)
        : "Request failed.",
    );
  }
  return data as T;
}

function contentKey(doc: StoredQuizDocument) {
  const { updatedAt: _updatedAt, ...rest } = doc;
  return JSON.stringify(rest);
}

const pendingSaves = new Map<string, StoredQuizDocument>();
const inflightSaves = new Map<string, Promise<void>>();
const lastSavedKey = new Map<string, string>();

async function putRemoteQuiz(doc: StoredQuizDocument, keepalive = false) {
  const key = contentKey(doc);
  if (lastSavedKey.get(doc.id) === key) return;
  await apiJson<{ quiz: StoredQuizDocument }>(`/quizzes/${encodeURIComponent(doc.id)}`, {
    method: "PUT",
    body: JSON.stringify({ quiz: doc }),
    keepalive,
  });
  lastSavedKey.set(doc.id, key);
}

function enqueueRemoteSave(doc: StoredQuizDocument) {
  pendingSaves.set(doc.id, doc);
  const existing = inflightSaves.get(doc.id);
  if (existing) return existing;

  const run = (async () => {
    try {
      while (pendingSaves.has(doc.id)) {
        const next = pendingSaves.get(doc.id);
        pendingSaves.delete(doc.id);
        if (next) await putRemoteQuiz(next);
      }
    } finally {
      inflightSaves.delete(doc.id);
    }
  })();

  inflightSaves.set(doc.id, run);
  return run;
}

let migratePromise: Promise<void> | null = null;

export async function migrateLocalQuizzesIfNeeded() {
  if (!usesRemoteStorage()) return;
  if (migratePromise) return migratePromise;

  migratePromise = (async () => {
    const quizzes = peekLocalQuizzes().map(withValidId);
    if (quizzes.length === 0) return;
    writeLibrary({ version: 2, quizzes });
    await apiJson("/quizzes/import", {
      method: "POST",
      body: JSON.stringify({ quizzes }),
    });
    clearLocalLibrary();
  })().finally(() => {
    migratePromise = null;
  });

  return migratePromise;
}

export async function listQuizSummaries(): Promise<QuizSummary[]> {
  if (!usesRemoteStorage()) return listLocalSummaries();
  await migrateLocalQuizzesIfNeeded();
  const data = await apiJson<{ quizzes: QuizSummary[] }>("/quizzes");
  return Array.isArray(data?.quizzes) ? data.quizzes : [];
}

export async function getStoredQuiz(id: string): Promise<StoredQuizDocument | null> {
  const loaded = await loadStoredQuiz(id);
  return loaded?.quiz ?? null;
}

export async function loadStoredQuiz(
  id: string,
): Promise<{ quiz: StoredQuizDocument; published: boolean } | null> {
  if (!usesRemoteStorage()) {
    const quiz = getLocalQuiz(id);
    return quiz ? { quiz, published: false } : null;
  }
  await migrateLocalQuizzesIfNeeded();
  try {
    const data = await apiJson<{ quiz: StoredQuizDocument; published?: boolean }>(
      `/quizzes/${encodeURIComponent(id)}`,
    );
    const quiz = data?.quiz;
    if (quiz && typeof quiz === "object") {
      lastSavedKey.set(id, contentKey(quiz));
      return { quiz, published: Boolean(data.published) };
    }
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === "Quiz not found.") return null;
    throw error;
  }
}

export async function publishStoredQuiz(id: string) {
  if (!usesRemoteStorage()) {
    throw new Error("Sign in to publish a quiz.");
  }
  await migrateLocalQuizzesIfNeeded();
  await apiJson<{ published: boolean }>(`/quizzes/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

export async function listCommunityQuizzes(
  sort: CommunitySort = "trending",
): Promise<CommunityQuizSummary[]> {
  const query = new URLSearchParams({ sort });
  const data = await apiJson<{ quizzes: CommunityQuizSummary[] }>(
    `/community/quizzes?${query.toString()}`,
  );
  return Array.isArray(data?.quizzes) ? data.quizzes : [];
}

export async function getCommunityQuiz(id: string): Promise<CommunityQuizSummary> {
  const data = await apiJson<{ quiz: CommunityQuizSummary }>(
    `/community/quizzes/${encodeURIComponent(id)}`,
  );
  if (!data?.quiz?.id) {
    throw new Error("Quiz not found.");
  }
  return data.quiz;
}

export async function getPublishedQuiz(id: string): Promise<StoredQuizDocument> {
  const data = await apiJson<{ quiz: StoredQuizDocument }>(
    `/community/quizzes/${encodeURIComponent(id)}/document`,
  );
  if (!data?.quiz || typeof data.quiz !== "object") {
    throw new Error("Quiz not found.");
  }
  return data.quiz;
}

export async function toggleCommunityLike(id: string): Promise<{ likes: number; liked: boolean }> {
  const data = await apiJson<{ likes: number; liked: boolean }>(
    `/community/quizzes/${encodeURIComponent(id)}/like`,
    { method: "POST" },
  );
  return {
    likes: Number(data?.likes) || 0,
    liked: Boolean(data?.liked),
  };
}

export async function saveStoredQuiz(doc: StoredQuizDocument, options?: { keepalive?: boolean }) {
  const next: StoredQuizDocument = {
    ...withValidId(doc),
    version: 1,
    updatedAt: Date.now(),
  };
  if (!usesRemoteStorage()) {
    saveLocalQuiz(next);
    return;
  }
  await migrateLocalQuizzesIfNeeded();
  if (options?.keepalive) {
    pendingSaves.set(next.id, next);
    await putRemoteQuiz(next, true);
    return;
  }
  await enqueueRemoteSave(next);
}

export async function createStoredQuiz(): Promise<StoredQuizDocument> {
  const doc = emptyDocument();
  await saveStoredQuiz(doc);
  return doc;
}

export async function deleteStoredQuiz(id: string) {
  if (!usesRemoteStorage()) {
    deleteLocalQuiz(id);
    lastSavedKey.delete(id);
    return;
  }
  await migrateLocalQuizzesIfNeeded();
  await apiJson(`/quizzes/${encodeURIComponent(id)}`, { method: "DELETE" });
  lastSavedKey.delete(id);
  pendingSaves.delete(id);
}

export { nextSectionName, emptySection, localQuizCount };
