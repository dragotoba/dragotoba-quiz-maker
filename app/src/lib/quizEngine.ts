export const QUIZ_RESULTS_ID = "__results__";
export const MAX_QUIZ_HOPS = 256;

export type VariableType = "number" | "bool" | "string";
export type VariableValue = number | string;
export type EffectOperation = "set" | "add" | "subtract" | "multiply" | "divide";
export type ConditionOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
export type ConditionJoin = "and" | "or";

export type ProjectVariable = {
  id: string;
  name: string;
  type: VariableType;
  value: VariableValue;
};

export type AnswerEffect = {
  id: string;
  variableId: string;
  operation: EffectOperation;
  value: VariableValue;
};

export type AnswerOption = {
  id: string;
  name: string;
  effects: AnswerEffect[];
  color?: string;
  textColor?: string;
};

export type TransitionCondition = {
  id: string;
  variableId: string;
  operator: ConditionOperator;
  value: VariableValue;
  join: ConditionJoin;
};

export type Transition = {
  id: string;
  fromId: string;
  toId: string;
  conditions: TransitionCondition[];
  fallback: boolean;
};

export type EngineBox = {
  id: string;
  x: number;
  y: number;
  kind: "question" | "transition" | "start" | "section-changer";
  question?: string;
  answers?: AnswerOption[];
  effects?: AnswerEffect[];
  targetSection?: string;
  color?: string;
};

export type EngineSection = {
  id: string;
  localVariables: ProjectVariable[];
  boxes: EngineBox[];
  transitions: Transition[];
};

export type TieBreaks = Record<string, number>;

export type QuizQuestionScreen = {
  kind: "question";
  sectionId: string;
  boxId: string;
  projectVariables: ProjectVariable[];
  localVariables: ProjectVariable[];
  tieBreaks: TieBreaks;
};

export type QuizResultsScreen = {
  kind: "results";
  projectVariables: ProjectVariable[];
  localVariables: ProjectVariable[];
  tieBreaks: TieBreaks;
};

export type QuizPlayScreen = QuizQuestionScreen | QuizResultsScreen;

type HopState = { n: number };

export function cloneVariables(vars: ProjectVariable[]): ProjectVariable[] {
  return vars.map((variable) => ({ ...variable }));
}

function cloneTieBreaks(tieBreaks: TieBreaks): TieBreaks {
  return { ...tieBreaks };
}

function resultsScreen(
  projectVariables: ProjectVariable[],
  localVariables: ProjectVariable[],
  tieBreaks: TieBreaks,
): QuizResultsScreen {
  return {
    kind: "results",
    projectVariables: cloneVariables(projectVariables),
    localVariables: cloneVariables(localVariables),
    tieBreaks: cloneTieBreaks(tieBreaks),
  };
}

function questionScreen(
  sectionId: string,
  boxId: string,
  projectVariables: ProjectVariable[],
  localVariables: ProjectVariable[],
  tieBreaks: TieBreaks,
): QuizQuestionScreen {
  return {
    kind: "question",
    sectionId,
    boxId,
    projectVariables: cloneVariables(projectVariables),
    localVariables: cloneVariables(localVariables),
    tieBreaks: cloneTieBreaks(tieBreaks),
  };
}

function coerceValue(type: VariableType, value: VariableValue): VariableValue {
  if (type === "string") return typeof value === "string" ? value : String(value ?? "");
  if (type === "bool") {
    if (typeof value === "string") return value === "true" || value === "1" ? 1 : 0;
    return value !== 0 ? 1 : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function numericOf(variable: ProjectVariable): number {
  if (variable.type === "bool") return variable.value ? 1 : 0;
  const n = Number(variable.value);
  return Number.isFinite(n) ? n : 0;
}

function findVariable(
  project: ProjectVariable[],
  local: ProjectVariable[],
  id: string,
): ProjectVariable | undefined {
  return project.find((variable) => variable.id === id) ?? local.find((variable) => variable.id === id);
}

export function applyEffects(
  project: ProjectVariable[],
  local: ProjectVariable[],
  effects: AnswerEffect[] | undefined,
) {
  if (!effects) return;
  for (const effect of effects) {
    const variable = findVariable(project, local, effect.variableId);
    if (!variable) continue;

    if (variable.type === "bool" || variable.type === "string") {
      if (effect.operation === "set") {
        variable.value = coerceValue(variable.type, effect.value);
      }
      continue;
    }

    const current = numericOf(variable);
    const amount = Number(effect.value);
    const rhs = Number.isFinite(amount) ? amount : 0;

    if (effect.operation === "set") {
      variable.value = Number.isFinite(amount) ? amount : 0;
      continue;
    }
    if (effect.operation === "add") {
      variable.value = current + rhs;
      continue;
    }
    if (effect.operation === "subtract") {
      variable.value = current - rhs;
      continue;
    }
    if (effect.operation === "multiply") {
      variable.value = current * rhs;
      continue;
    }
    if (effect.operation === "divide") {
      if (rhs === 0) continue;
      variable.value = current / rhs;
    }
  }
}

function compareValues(
  variable: ProjectVariable,
  operator: ConditionOperator,
  raw: VariableValue,
): boolean {
  if (variable.type === "string") {
    const left = String(variable.value ?? "");
    const right = String(raw ?? "");
    if (operator === "eq") return left === right;
    if (operator === "neq") return left !== right;
    const order = left.localeCompare(right);
    if (operator === "gt") return order > 0;
    if (operator === "lt") return order < 0;
    if (operator === "gte") return order >= 0;
    if (operator === "lte") return order <= 0;
    return false;
  }

  const left = numericOf(variable);
  const rightNum =
    variable.type === "bool"
      ? coerceValue("bool", raw)
        ? 1
        : 0
      : Number(raw);
  const right = Number.isFinite(rightNum) ? Number(rightNum) : 0;
  if (operator === "eq") return left === right;
  if (operator === "neq") return left !== right;
  if (operator === "gt") return left > right;
  if (operator === "lt") return left < right;
  if (operator === "gte") return left >= right;
  if (operator === "lte") return left <= right;
  return false;
}

/** AND binds tighter than OR: `A or B and C` is `A or (B and C)`. */
export function evaluateConditions(
  conditions: TransitionCondition[] | undefined,
  project: ProjectVariable[],
  local: ProjectVariable[],
): boolean {
  if (!conditions || conditions.length === 0) return true;

  const groups: boolean[] = [];
  let groupOk = true;

  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i];
    const variable = findVariable(project, local, condition.variableId);
    const ok = variable
      ? compareValues(variable, condition.operator, condition.value)
      : false;

    if (i > 0 && condition.join === "or") {
      groups.push(groupOk);
      groupOk = ok;
    } else {
      groupOk = groupOk && ok;
    }
  }
  groups.push(groupOk);
  return groups.some(Boolean);
}

function shuffleIds(ids: string[]): string[] {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function destPos(box: EngineBox | undefined) {
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}

function tieRank(
  fromId: string,
  x: number,
  y: number,
  transitionId: string,
  siblingIds: string[],
  tieBreaks: TieBreaks,
): number {
  const prefix = `${fromId}|${x}|${y}|`;
  const missing = siblingIds.filter((id) => tieBreaks[`${prefix}${id}`] === undefined);
  if (missing.length > 0) {
    const existing = siblingIds
      .map((id) => tieBreaks[`${prefix}${id}`])
      .filter((rank): rank is number => rank !== undefined);
    let next = existing.length > 0 ? Math.max(...existing) + 1 : 0;
    for (const id of shuffleIds(missing)) {
      tieBreaks[`${prefix}${id}`] = next++;
    }
  }
  return tieBreaks[`${prefix}${transitionId}`] ?? 0;
}

function sortByDestination(
  transitions: Transition[],
  boxes: EngineBox[],
  fromId: string,
  tieBreaks: TieBreaks,
): Transition[] {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  return [...transitions].sort((a, b) => {
    const da = destPos(boxById.get(a.toId));
    const db = destPos(boxById.get(b.toId));
    if (da.x !== db.x) return da.x - db.x;
    if (da.y !== db.y) return da.y - db.y;
    const siblings = transitions
      .filter((transition) => {
        const pos = destPos(boxById.get(transition.toId));
        return pos.x === da.x && pos.y === da.y;
      })
      .map((transition) => transition.id);
    return (
      tieRank(fromId, da.x, da.y, a.id, siblings, tieBreaks) -
      tieRank(fromId, da.x, da.y, b.id, siblings, tieBreaks)
    );
  });
}

function pickOutgoing(
  section: EngineSection,
  fromId: string,
  project: ProjectVariable[],
  local: ProjectVariable[],
  tieBreaks: TieBreaks,
): Transition | null {
  const outgoing = section.transitions.filter((transition) => transition.fromId === fromId);
  if (outgoing.length === 0) return null;

  const nonFallback = outgoing.filter((transition) => !transition.fallback);
  const matching = nonFallback.filter((transition) =>
    evaluateConditions(transition.conditions, project, local),
  );
  const pool =
    matching.length > 0
      ? matching
      : outgoing.filter((transition) => transition.fallback);

  if (pool.length === 0) return null;
  return sortByDestination(pool, section.boxes, fromId, tieBreaks)[0] ?? null;
}

function goNextSection(
  sections: EngineSection[],
  sectionIndex: number,
  project: ProjectVariable[],
  local: ProjectVariable[],
  tieBreaks: TieBreaks,
  hops: HopState,
): QuizPlayScreen {
  const nextIndex = sectionIndex + 1;
  if (nextIndex >= sections.length) {
    return resultsScreen(project, local, tieBreaks);
  }
  return enterSection(sections, nextIndex, project, tieBreaks, hops);
}

function jumpToTarget(
  sections: EngineSection[],
  sectionIndex: number,
  target: string | undefined,
  project: ProjectVariable[],
  local: ProjectVariable[],
  tieBreaks: TieBreaks,
  hops: HopState,
): QuizPlayScreen {
  if (!target || target === "next") {
    return goNextSection(sections, sectionIndex, project, local, tieBreaks, hops);
  }
  if (target === QUIZ_RESULTS_ID) {
    return resultsScreen(project, local, tieBreaks);
  }
  const destIndex = sections.findIndex((section) => section.id === target);
  if (destIndex < 0) {
    return goNextSection(sections, sectionIndex, project, local, tieBreaks, hops);
  }
  return enterSection(sections, destIndex, project, tieBreaks, hops);
}

function followOutgoing(
  sections: EngineSection[],
  sectionIndex: number,
  fromId: string,
  project: ProjectVariable[],
  local: ProjectVariable[],
  tieBreaks: TieBreaks,
  hops: HopState,
): QuizPlayScreen {
  if (hops.n++ > MAX_QUIZ_HOPS) {
    return resultsScreen(project, local, tieBreaks);
  }

  const section = sections[sectionIndex];
  if (!section) return resultsScreen(project, local, tieBreaks);

  const chosen = pickOutgoing(section, fromId, project, local, tieBreaks);
  if (!chosen) {
    return goNextSection(sections, sectionIndex, project, local, tieBreaks, hops);
  }

  const dest = section.boxes.find((box) => box.id === chosen.toId);
  if (!dest) {
    return goNextSection(sections, sectionIndex, project, local, tieBreaks, hops);
  }

  if (dest.kind === "question") {
    return questionScreen(section.id, dest.id, project, local, tieBreaks);
  }

  if (dest.kind === "section-changer") {
    applyEffects(project, local, dest.effects);
    return jumpToTarget(
      sections,
      sectionIndex,
      dest.targetSection,
      project,
      local,
      tieBreaks,
      hops,
    );
  }

  applyEffects(project, local, dest.effects);
  return followOutgoing(
    sections,
    sectionIndex,
    dest.id,
    project,
    local,
    tieBreaks,
    hops,
  );
}

function enterSection(
  sections: EngineSection[],
  sectionIndex: number,
  project: ProjectVariable[],
  tieBreaks: TieBreaks,
  hops: HopState,
): QuizPlayScreen {
  if (hops.n++ > MAX_QUIZ_HOPS) {
    return resultsScreen(project, [], tieBreaks);
  }

  const section = sections[sectionIndex];
  if (!section) return resultsScreen(project, [], tieBreaks);

  const local = cloneVariables(section.localVariables);
  const start = section.boxes.find((box) => box.kind === "start");
  if (!start) {
    return goNextSection(sections, sectionIndex, project, local, tieBreaks, hops);
  }

  applyEffects(project, local, start.effects);
  return followOutgoing(sections, sectionIndex, start.id, project, local, tieBreaks, hops);
}

export function startQuiz(
  sections: EngineSection[],
  projectVariables: ProjectVariable[],
): QuizPlayScreen {
  const project = cloneVariables(projectVariables);
  const tieBreaks: TieBreaks = {};
  const hops: HopState = { n: 0 };
  if (sections.length === 0) {
    return resultsScreen(project, [], tieBreaks);
  }
  return enterSection(sections, 0, project, tieBreaks, hops);
}

export function submitAnswer(
  sections: EngineSection[],
  screen: QuizQuestionScreen,
  answerId: string | null,
  sessionTieBreaks?: TieBreaks,
): QuizPlayScreen {
  const sectionIndex = sections.findIndex((section) => section.id === screen.sectionId);
  if (sectionIndex < 0) {
    return resultsScreen(screen.projectVariables, screen.localVariables, screen.tieBreaks);
  }

  const section = sections[sectionIndex];
  const question = section.boxes.find((box) => box.id === screen.boxId);
  const project = cloneVariables(screen.projectVariables);
  const local = cloneVariables(screen.localVariables);
  const tieBreaks = cloneTieBreaks(sessionTieBreaks ?? screen.tieBreaks);

  if (question?.kind === "question" && answerId) {
    const answer = (question.answers ?? []).find((item) => item.id === answerId);
    if (answer) applyEffects(project, local, answer.effects);
  }

  return followOutgoing(
    sections,
    sectionIndex,
    screen.boxId,
    project,
    local,
    tieBreaks,
    { n: 0 },
  );
}

export function findQuestionBox(sections: EngineSection[], screen: QuizQuestionScreen) {
  const section = sections.find((item) => item.id === screen.sectionId);
  const box = section?.boxes.find((item) => item.id === screen.boxId);
  if (!box || box.kind !== "question") return null;
  return box;
}
