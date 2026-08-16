export const DEFAULT_PROJECT_NAME = "Untitled Quiz";
export const LIBRARY_KEY = "dragotoba-quiz-maker:library";
export const LEGACY_KEY = "dragotoba-quiz-maker:v1";

export type QuizSummary = {
  id: string;
  projectName: string;
  updatedAt: number;
};

/** Serialized quiz document stored in the library. */
export type StoredQuizDocument = {
  version: 1;
  id: string;
  projectName: string;
  updatedAt: number;
  variables: unknown;
  defaultAnswers: unknown;
  sections: unknown;
  activeSectionId: string;
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
      },
    ],
    sections: [section],
    activeSectionId: section.id,
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
    sections,
    activeSectionId,
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

export function listQuizSummaries(): QuizSummary[] {
  return readLibrary()
    .quizzes.map((quiz) => ({
      id: quiz.id,
      projectName: quiz.projectName,
      updatedAt: quiz.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getStoredQuiz(id: string): StoredQuizDocument | null {
  return readLibrary().quizzes.find((quiz) => quiz.id === id) ?? null;
}

export function saveStoredQuiz(doc: StoredQuizDocument) {
  const library = readLibrary();
  const next: StoredQuizDocument = {
    ...doc,
    version: 1,
    updatedAt: Date.now(),
  };
  const index = library.quizzes.findIndex((quiz) => quiz.id === next.id);
  if (index >= 0) library.quizzes[index] = next;
  else library.quizzes.push(next);
  writeLibrary(library);
}

export function createStoredQuiz(): StoredQuizDocument {
  const doc = emptyDocument();
  saveStoredQuiz(doc);
  return doc;
}

export function deleteStoredQuiz(id: string) {
  const library = readLibrary();
  writeLibrary({
    version: 2,
    quizzes: library.quizzes.filter((quiz) => quiz.id !== id),
  });
}

export { nextSectionName, emptySection };
