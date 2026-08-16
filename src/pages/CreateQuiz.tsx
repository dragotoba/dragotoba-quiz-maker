import { useEffect, useId, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  DEFAULT_PROJECT_NAME,
  emptySection,
  getStoredQuiz,
  nextSectionName,
  saveStoredQuiz,
  type StoredQuizDocument,
} from "@/lib/quizStorage";

type QuestionBox = {
  id: string;
  x: number;
  y: number;
  kind: "question";
  question: string;
  answers: AnswerOption[];
};

type TransitionBlock = {
  id: string;
  x: number;
  y: number;
  kind: "transition";
  effects: AnswerEffect[];
};

type StartBlock = {
  id: string;
  x: number;
  y: number;
  kind: "start";
  effects: AnswerEffect[];
};

type SectionChangerBlock = {
  id: string;
  x: number;
  y: number;
  kind: "section-changer";
  effects: AnswerEffect[];
  /** "next" or a specific section id. */
  targetSection: "next" | string;
};

type CanvasBox = QuestionBox | TransitionBlock | StartBlock | SectionChangerBlock;
type EffectBlock = TransitionBlock | StartBlock | SectionChangerBlock;

function isEffectBlock(box: CanvasBox): box is EffectBlock {
  return (
    box.kind === "transition" ||
    box.kind === "start" ||
    box.kind === "section-changer"
  );
}

function createStartBlock(x = 0, y = 0): StartBlock {
  return {
    id: crypto.randomUUID(),
    x,
    y,
    kind: "start",
    effects: [],
  };
}

function createSectionChangerBlock(x = 0, y = 0): SectionChangerBlock {
  return {
    id: crypto.randomUUID(),
    x,
    y,
    kind: "section-changer",
    effects: [],
    targetSection: "next",
  };
}

function ensureStartBlock(boxes: CanvasBox[]): CanvasBox[] {
  if (boxes.some((box) => box.kind === "start")) return boxes;
  return [createStartBlock(), ...boxes];
}

type AnswerOption = {
  id: string;
  name: string;
  effects: AnswerEffect[];
};

type EffectOperation = "set" | "add" | "subtract" | "multiply" | "divide";

type VariableValue = number | string;

type AnswerEffect = {
  id: string;
  variableId: string;
  operation: EffectOperation;
  /** Amount / set-to value; for bool set, 0 = false and 1 = true. */
  value: VariableValue;
};

type VariableType = "number" | "bool" | "string";

type ProjectVariable = {
  id: string;
  name: string;
  type: VariableType;
  /** Float/bool(0|1)/string depending on type. */
  value: VariableValue;
};

type ConditionOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
type ConditionJoin = "and" | "or";

type TransitionCondition = {
  id: string;
  variableId: string;
  operator: ConditionOperator;
  /** Compare-to value; for bools, 0 = false and 1 = true. */
  value: VariableValue;
  /** How this condition combines with the previous one. Unused on the first. */
  join: ConditionJoin;
};

const VARIABLE_TYPES: { value: VariableType; label: string }[] = [
  { value: "number", label: "number" },
  { value: "bool", label: "bool" },
  { value: "string", label: "string" },
];

function coerceValueForType(type: VariableType, value: VariableValue): VariableValue {
  if (type === "string") return typeof value === "string" ? value : String(value ?? "");
  if (type === "bool") {
    if (typeof value === "string") return value === "true" || value === "1" ? 1 : 0;
    return value !== 0 ? 1 : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function variableTypeLabel(type: VariableType) {
  return type === "number" ? "" : ` (${type})`;
}

function isSetOnlyVariableType(type: VariableType | undefined) {
  return type === "bool" || type === "string";
}

function normalizeProjectVariable(raw: unknown): ProjectVariable | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.name !== "string") return null;

  let type: VariableType = "number";
  if (v.type === "bool" || v.type === "string" || v.type === "number") {
    type = v.type;
  } else if (v.isBool === true) {
    type = "bool";
  }

  return {
    id: v.id,
    name: v.name,
    type,
    value: coerceValueForType(type, v.value as VariableValue),
  };
}

type Transition = {
  id: string;
  fromId: string;
  toId: string;
  conditions: TransitionCondition[];
};

type TransitionDraft =
  | {
      kind: "create";
      fromId: string;
      mouseX: number;
      mouseY: number;
    }
  | {
      kind: "retarget-origin";
      transitionId: string;
      toId: string;
      mouseX: number;
      mouseY: number;
    }
  | {
      kind: "retarget-destination";
      transitionId: string;
      fromId: string;
      mouseX: number;
      mouseY: number;
    };

type Camera = {
  x: number;
  y: number;
  scale: number;
};

type ContextMenuState =
  | {
      kind: "canvas";
      screenX: number;
      screenY: number;
      worldX: number;
      worldY: number;
    }
  | {
      kind: "box";
      screenX: number;
      screenY: number;
      boxId: string;
    }
  | {
      kind: "transition";
      screenX: number;
      screenY: number;
      transitionId: string;
    }
  | null;

const DUPLICATE_OFFSET = 28;

type DragState = {
  type: "pan" | "box";
  pointerId: number;
  boxId?: string;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

/** Width : height = 3 : 1 (1×3 card). */
const ASPECT = 3;
const FONT_SIZE = 13;
const LINE_HEIGHT = 1.25;
const PAD_X = 20;
const PAD_Y = 12;
const EMPTY_HEIGHT = 40;
const MAX_HEIGHT = 280;
const PREVIEW_CHAR_LIMIT = 100;
const CLICK_MOVE_THRESHOLD = 5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.0015;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function screenToWorld(
  screenX: number,
  screenY: number,
  camera: Camera,
): { x: number; y: number } {
  return {
    x: (screenX - camera.x) / camera.scale,
    y: (screenY - camera.y) / camera.scale,
  };
}

function previewLabel(question: string) {
  if (!question) return "";
  if (question.length <= PREVIEW_CHAR_LIMIT) return question;
  return `${question.slice(0, PREVIEW_CHAR_LIMIT)}...`;
}

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx() {
  if (typeof document === "undefined") return null;
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  return measureCtx;
}

function wrapLines(text: string, maxWidth: number): string[] {
  const ctx = getMeasureCtx();
  const font = `500 ${FONT_SIZE}px Poppins, sans-serif`;
  if (ctx) ctx.font = font;

  const measure = (s: string) => (ctx ? ctx.measureText(s).width : s.length * FONT_SIZE * 0.55);

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";

    const pushLongWord = (word: string) => {
      let chunk = "";
      for (const ch of word) {
        const trial = chunk + ch;
        if (measure(trial) <= maxWidth || chunk.length === 0) {
          chunk = trial;
        } else {
          lines.push(chunk);
          chunk = ch;
        }
      }
      current = chunk;
    };

    for (const word of words) {
      const trial = current ? `${current} ${word}` : word;
      if (measure(trial) <= maxWidth) {
        current = trial;
      } else {
        if (current) lines.push(current);
        if (measure(word) <= maxWidth) {
          current = word;
        } else {
          pushLongWord(word);
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function textBlockHeight(lineCount: number) {
  return lineCount * FONT_SIZE * LINE_HEIGHT;
}

function layoutBox(question: string) {
  const label = previewLabel(question);
  if (!label) {
    return {
      width: EMPTY_HEIGHT * ASPECT,
      height: EMPTY_HEIGHT,
      lines: [] as string[],
    };
  }

  const fits = (height: number) => {
    const width = height * ASPECT;
    const contentW = Math.max(8, width - PAD_X);
    const contentH = Math.max(8, height - PAD_Y);
    const lines = wrapLines(label, contentW);
    return textBlockHeight(lines.length) <= contentH + 0.5;
  };

  let lo = 28;
  let hi = 64;
  while (!fits(hi) && hi < MAX_HEIGHT) {
    hi = Math.min(MAX_HEIGHT, hi * 1.35);
  }
  if (!fits(hi)) {
    hi = MAX_HEIGHT;
  }

  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }

  // Slightly larger than the minimum fit so text isn't flush to the edge.
  const height = Math.min(MAX_HEIGHT, Math.ceil(hi + 6));
  const width = height * ASPECT;
  const lines = wrapLines(label, Math.max(8, width - PAD_X));

  return { width, height, lines };
}

type BoxRect = {
  cx: number;
  cy: number;
  width: number;
  height: number;
};

function boxRect(box: CanvasBox): BoxRect {
  if (
    box.kind === "transition" ||
    box.kind === "start" ||
    box.kind === "section-changer"
  ) {
    const height = EMPTY_HEIGHT;
    const width = height * ASPECT;
    return { cx: box.x, cy: box.y, width, height };
  }
  const { width, height } = layoutBox(box.question);
  return { cx: box.x, cy: box.y, width, height };
}

/** Point on the rectangle edge facing toward (towardX, towardY). */
function edgePointFacing(rect: BoxRect, towardX: number, towardY: number) {
  const dx = towardX - rect.cx;
  const dy = towardY - rect.cy;
  if (dx === 0 && dy === 0) {
    return { x: rect.cx, y: rect.cy - rect.height / 2 };
  }
  const scaleX = dx !== 0 ? rect.width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? rect.height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  return {
    x: rect.cx + dx * scale,
    y: rect.cy + dy * scale,
  };
}

function findNearestBox(
  boxes: CanvasBox[],
  worldX: number,
  worldY: number,
  excludeIds: string | string[],
  options?: { excludeKinds?: CanvasBox["kind"][] },
) {
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);
  const excludeKinds = new Set(options?.excludeKinds ?? []);
  let nearest: CanvasBox | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    if (excluded.has(box.id)) continue;
    if (excludeKinds.has(box.kind)) continue;
    const dist = (box.x - worldX) ** 2 + (box.y - worldY) ** 2;
    if (dist < best) {
      best = dist;
      nearest = box;
    }
  }
  return nearest;
}

/** True if a and b are already linked by any transition, either direction. */
function boxesAlreadyConnected(
  transitions: Transition[],
  aId: string,
  bId: string,
  ignoreTransitionId?: string,
) {
  return transitions.some((t) => {
    if (ignoreTransitionId && t.id === ignoreTransitionId) return false;
    return (
      (t.fromId === aId && t.toId === bId) || (t.fromId === bId && t.toId === aId)
    );
  });
}

function worldToScreen(
  worldX: number,
  worldY: number,
  camera: Camera,
): { x: number; y: number } {
  return {
    x: worldX * camera.scale + camera.x,
    y: worldY * camera.scale + camera.y,
  };
}

function cameraCenterWorld(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
) {
  return screenToWorld(viewportWidth / 2, viewportHeight / 2, camera);
}

function cameraCenteredOn(
  worldX: number,
  worldY: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  return {
    scale,
    x: viewportWidth / 2 - worldX * scale,
    y: viewportHeight / 2 - worldY * scale,
  };
}

/** True if the box's screen rect intersects the viewport. */
function isBoxInViewport(
  box: CanvasBox,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
) {
  const rect = boxRect(box);
  const center = worldToScreen(rect.cx, rect.cy, camera);
  const halfW = (rect.width * camera.scale) / 2;
  const halfH = (rect.height * camera.scale) / 2;
  const left = center.x - halfW;
  const right = center.x + halfW;
  const top = center.y - halfH;
  const bottom = center.y + halfH;
  return (
    right > 0 && left < viewportWidth && bottom > 0 && top < viewportHeight
  );
}

function anyBoxInViewport(
  boxes: CanvasBox[],
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
) {
  return boxes.some((box) =>
    isBoxInViewport(box, camera, viewportWidth, viewportHeight),
  );
}

function comparableName(name: string) {
  return name.trim().toLowerCase();
}

function isNameTaken(candidate: string, existingNames: Iterable<string>) {
  const key = comparableName(candidate);
  if (!key) return true;
  for (const name of existingNames) {
    if (comparableName(name) === key) return true;
  }
  return false;
}

function nextPrefixedName(prefix: string, existingNames: string[]) {
  const used = new Set(existingNames.map(comparableName));
  let n = 1;
  while (used.has(comparableName(`${prefix}${n}`))) n += 1;
  return `${prefix}${n}`;
}

function nextVarName(existingNames: string[]) {
  return nextPrefixedName("Var", existingNames);
}

function nextAnsName(existing: AnswerOption[]) {
  return nextPrefixedName(
    "Ans",
    existing.map((a) => a.name),
  );
}

function createDefaultAnswer(): AnswerOption {
  return {
    id: crypto.randomUUID(),
    name: "Ans1",
    effects: [],
  };
}

function createDefaultEffect(variableId = ""): AnswerEffect {
  return {
    id: crypto.randomUUID(),
    variableId,
    operation: "set",
    value: 0,
  };
}

function cloneAnswersWithNewIds(answers: AnswerOption[]): AnswerOption[] {
  return answers.map((answer) => ({
    ...answer,
    id: crypto.randomUUID(),
    effects: answer.effects.map((effect) => ({
      ...effect,
      id: crypto.randomUUID(),
    })),
  }));
}

const EFFECT_OPERATIONS: { value: EffectOperation; label: string }[] = [
  { value: "set", label: "set" },
  { value: "add", label: "add" },
  { value: "subtract", label: "subtract" },
  { value: "multiply", label: "multiply" },
  { value: "divide", label: "divide" },
];

const CONDITION_OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
];

const CONDITION_JOINS: { value: ConditionJoin; label: string }[] = [
  { value: "and", label: "And" },
  { value: "or", label: "Or" },
];

function createDefaultCondition(
  variableId = "",
  join: ConditionJoin = "and",
): TransitionCondition {
  return {
    id: crypto.randomUUID(),
    variableId,
    operator: "eq",
    value: 0,
    join,
  };
}

type ConditionsEditorProps = {
  conditions: TransitionCondition[];
  variables: ProjectVariable[];
  onCheckpoint: () => void;
  onAddCondition: () => void;
  onUpdateCondition: (conditionId: string, patch: Partial<TransitionCondition>) => void;
  onRemoveCondition: (conditionId: string) => void;
};

function ConditionsEditor({
  conditions,
  variables,
  onCheckpoint,
  onAddCondition,
  onUpdateCondition,
  onRemoveCondition,
}: ConditionsEditorProps) {
  return (
    <>
      <div className="mt-3 flex flex-col gap-2">
        {conditions.map((condition, index) => {
          const selectedVar = variables.find(
            (variable) => variable.id === condition.variableId,
          );
          const varType = selectedVar?.type ?? "number";
          const comparisonOnly = isSetOnlyVariableType(varType);
          const operatorOptions = comparisonOnly
            ? CONDITION_OPERATORS.filter((op) => op.value === "eq" || op.value === "neq")
            : CONDITION_OPERATORS;
          const operatorValue =
            comparisonOnly && condition.operator !== "eq" && condition.operator !== "neq"
              ? "eq"
              : condition.operator;

          return (
            <div key={condition.id} className="flex flex-col gap-2">
              {index > 0 && (
                <div className="flex justify-center">
                  <select
                    aria-label="Condition join"
                    value={condition.join ?? "and"}
                    onFocus={onCheckpoint}
                    onChange={(e) =>
                      onUpdateCondition(condition.id, {
                        join: e.target.value as ConditionJoin,
                      })
                    }
                    className="rounded border border-black/15 bg-white px-2 py-1 text-xs font-semibold tracking-wide text-black uppercase outline-none focus:border-[#2f5d76]"
                  >
                    {CONDITION_JOINS.map((join) => (
                      <option key={join.value} value={join.value}>
                        {join.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5 rounded border border-black/10 bg-white p-2">
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Condition variable"
                    value={condition.variableId}
                    onFocus={onCheckpoint}
                    onChange={(e) => {
                      const variableId = e.target.value;
                      const nextVar = variables.find((v) => v.id === variableId);
                      const nextType = nextVar?.type ?? "number";
                      onUpdateCondition(condition.id, {
                        variableId,
                        operator:
                          isSetOnlyVariableType(nextType) &&
                          condition.operator !== "eq" &&
                          condition.operator !== "neq"
                            ? "eq"
                            : condition.operator,
                        value: coerceValueForType(nextType, condition.value),
                      });
                    }}
                    className="min-w-0 flex-1 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                  >
                    <option value="">
                      {variables.length === 0 ? "No variables" : "Variable…"}
                    </option>
                    {variables.map((variable) => (
                      <option key={variable.id} value={variable.id}>
                        {variable.name}
                        {variableTypeLabel(variable.type)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    aria-label="Remove condition"
                    onClick={() => onRemoveCondition(condition.id)}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-base leading-none text-black hover:bg-black/5"
                  >
                    −
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <select
                    aria-label="Condition operator"
                    value={operatorValue}
                    onFocus={onCheckpoint}
                    onChange={(e) =>
                      onUpdateCondition(condition.id, {
                        operator: e.target.value as ConditionOperator,
                      })
                    }
                    className="min-w-0 flex-1 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                  >
                    {operatorOptions.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>

                  {varType === "bool" ? (
                    <label className="flex shrink-0 items-center gap-1 text-xs text-black/70">
                      <input
                        type="checkbox"
                        checked={condition.value !== 0 && condition.value !== "0"}
                        aria-label="Boolean compare value"
                        onChange={(e) => {
                          onCheckpoint();
                          onUpdateCondition(condition.id, {
                            value: e.target.checked ? 1 : 0,
                          });
                        }}
                        className="cursor-pointer"
                      />
                      <span>
                        {condition.value !== 0 && condition.value !== "0" ? "true" : "false"}
                      </span>
                    </label>
                  ) : varType === "string" ? (
                    <input
                      type="text"
                      value={typeof condition.value === "string" ? condition.value : ""}
                      aria-label="Condition text"
                      onFocus={onCheckpoint}
                      onChange={(e) =>
                        onUpdateCondition(condition.id, { value: e.target.value })
                      }
                      className="min-w-0 w-24 shrink-0 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                    />
                  ) : (
                    <input
                      type="number"
                      step="any"
                      value={typeof condition.value === "number" ? condition.value : 0}
                      aria-label="Condition amount"
                      onFocus={onCheckpoint}
                      onChange={(e) => {
                        const next = e.target.value === "" ? 0 : Number(e.target.value);
                        onUpdateCondition(condition.id, {
                          value: Number.isFinite(next) ? next : 0,
                        });
                      }}
                      className="w-20 shrink-0 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Add condition"
        onClick={onAddCondition}
        className="mt-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-lg leading-none text-black hover:bg-black/5"
      >
        +
      </button>
    </>
  );
}

type EffectsEditorProps = {
  effects: AnswerEffect[];
  variables: ProjectVariable[];
  onCheckpoint: () => void;
  onAddEffect: () => void;
  onUpdateEffect: (effectId: string, patch: Partial<AnswerEffect>) => void;
  onRemoveEffect: (effectId: string) => void;
  /** Smaller + button and nested card background for answer-embedded effects. */
  nested?: boolean;
};

function EffectsEditor({
  effects,
  variables,
  onCheckpoint,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
  nested = false,
}: EffectsEditorProps) {
  return (
    <>
      <div className={`flex flex-col gap-2 ${nested ? "mt-2" : "mt-3"}`}>
        {effects.map((effect) => {
          const selectedVar = variables.find(
            (variable) => variable.id === effect.variableId,
          );
          const varType = selectedVar?.type ?? "number";
          const setOnly = isSetOnlyVariableType(varType);
          const operationOptions = setOnly
            ? EFFECT_OPERATIONS.filter((op) => op.value === "set")
            : EFFECT_OPERATIONS;

          return (
            <div
              key={effect.id}
              className={`flex flex-col gap-1.5 rounded border border-black/10 p-2 ${
                nested ? "bg-[#fafafa]" : "bg-white"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Effect variable"
                  value={effect.variableId}
                  onFocus={onCheckpoint}
                  onChange={(e) => {
                    const variableId = e.target.value;
                    const nextVar = variables.find((v) => v.id === variableId);
                    const nextType = nextVar?.type ?? "number";
                    onUpdateEffect(effect.id, {
                      variableId,
                      operation:
                        isSetOnlyVariableType(nextType) && effect.operation !== "set"
                          ? "set"
                          : effect.operation,
                      value: coerceValueForType(nextType, effect.value),
                    });
                  }}
                  className="min-w-0 flex-1 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                >
                  <option value="">
                    {variables.length === 0 ? "No variables" : "Variable…"}
                  </option>
                  {variables.map((variable) => (
                    <option key={variable.id} value={variable.id}>
                      {variable.name}
                      {variableTypeLabel(variable.type)}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  aria-label="Remove effect"
                  onClick={() => onRemoveEffect(effect.id)}
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-base leading-none text-black hover:bg-black/5"
                >
                  −
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Effect operation"
                  value={setOnly ? "set" : effect.operation}
                  disabled={setOnly}
                  onFocus={onCheckpoint}
                  onChange={(e) =>
                    onUpdateEffect(effect.id, {
                      operation: e.target.value as EffectOperation,
                    })
                  }
                  className="min-w-0 flex-1 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76] disabled:opacity-70"
                >
                  {operationOptions.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {varType === "bool" ? (
                  <label className="flex shrink-0 items-center gap-1 text-xs text-black/70">
                    <input
                      type="checkbox"
                      checked={effect.value !== 0 && effect.value !== "0"}
                      aria-label="Boolean set value"
                      onChange={(e) => {
                        onCheckpoint();
                        onUpdateEffect(effect.id, {
                          value: e.target.checked ? 1 : 0,
                        });
                      }}
                      className="cursor-pointer"
                    />
                    <span>
                      {effect.value !== 0 && effect.value !== "0" ? "true" : "false"}
                    </span>
                  </label>
                ) : varType === "string" ? (
                  <input
                    type="text"
                    value={typeof effect.value === "string" ? effect.value : ""}
                    aria-label="Effect text"
                    onFocus={onCheckpoint}
                    onChange={(e) =>
                      onUpdateEffect(effect.id, { value: e.target.value })
                    }
                    className="min-w-0 w-24 shrink-0 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                  />
                ) : (
                  <input
                    type="number"
                    step="any"
                    value={typeof effect.value === "number" ? effect.value : 0}
                    aria-label="Effect amount"
                    onFocus={onCheckpoint}
                    onChange={(e) => {
                      const next = e.target.value === "" ? 0 : Number(e.target.value);
                      onUpdateEffect(effect.id, {
                        value: Number.isFinite(next) ? next : 0,
                      });
                    }}
                    className="w-20 shrink-0 rounded border border-black/15 bg-white px-1.5 py-1 text-xs text-black outline-none focus:border-[#2f5d76]"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        aria-label="Add effect"
        onClick={onAddEffect}
        className={`flex cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white leading-none text-black hover:bg-black/5 ${
          nested
            ? "mt-2 h-7 w-7 text-base"
            : "mt-3 h-8 w-8 text-lg"
        }`}
      >
        +
      </button>
    </>
  );
}

type AnswersEditorProps = {
  answers: AnswerOption[];
  variables: ProjectVariable[];
  nameRefs?: React.MutableRefObject<Map<string, HTMLInputElement>>;
  onCheckpoint: () => void;
  onUpdateAnswer: (answerId: string, patch: Partial<AnswerOption>) => void;
  onRemoveAnswer: (answerId: string) => void;
  onAddAnswer: () => void;
  onAddEffect: (answerId: string) => void;
  onUpdateEffect: (
    answerId: string,
    effectId: string,
    patch: Partial<AnswerEffect>,
  ) => void;
  onRemoveEffect: (answerId: string, effectId: string) => void;
};

function AnswersEditor({
  answers,
  variables,
  nameRefs,
  onCheckpoint,
  onUpdateAnswer,
  onRemoveAnswer,
  onAddAnswer,
  onAddEffect,
  onUpdateEffect,
  onRemoveEffect,
}: AnswersEditorProps) {
  return (
    <>
      <div className="mt-3 flex flex-col gap-3">
        {answers.map((answer) => (
          <div
            key={answer.id}
            className="rounded-md border border-black/10 bg-white px-2 py-2"
          >
            <div className="flex items-center gap-2">
              <input
                ref={(el) => {
                  if (!nameRefs) return;
                  if (el) nameRefs.current.set(answer.id, el);
                  else nameRefs.current.delete(answer.id);
                }}
                type="text"
                value={answer.name}
                aria-label="Answer name"
                onFocus={onCheckpoint}
                onChange={(e) => onUpdateAnswer(answer.id, { name: e.target.value })}
                className="min-w-0 flex-1 border-none bg-transparent px-1 py-0.5 text-sm text-black outline-none"
              />
              <button
                type="button"
                aria-label="Remove answer"
                onClick={() => onRemoveAnswer(answer.id)}
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-base leading-none text-black hover:bg-black/5"
              >
                −
              </button>
            </div>

            <div className="mt-2 border-t border-black/10 pt-2">
              <div className="text-xs font-semibold tracking-wide text-black/55 uppercase">
                Effects
              </div>
              <EffectsEditor
                effects={answer.effects}
                variables={variables}
                nested
                onCheckpoint={onCheckpoint}
                onAddEffect={() => onAddEffect(answer.id)}
                onUpdateEffect={(effectId, patch) =>
                  onUpdateEffect(answer.id, effectId, patch)
                }
                onRemoveEffect={(effectId) => onRemoveEffect(answer.id, effectId)}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        aria-label="Add answer"
        onClick={onAddAnswer}
        className="mt-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-lg leading-none text-black hover:bg-black/5"
      >
        +
      </button>
    </>
  );
}

type QuizSection = {
  id: string;
  name: string;
  localVariables: ProjectVariable[];
  localDefaultAnswers: AnswerOption[];
  boxes: CanvasBox[];
  transitions: Transition[];
  camera: Camera;
};

type EditorSnapshot = {
  projectName: string;
  variables: ProjectVariable[];
  defaultAnswers: AnswerOption[];
  sections: QuizSection[];
  activeSectionId: string;
  selectedId: string | null;
  selectedTransitionId: string | null;
};

const MAX_HISTORY = 200;

type PersistedQuiz = {
  version: 1;
  id: string;
  projectName: string;
  updatedAt: number;
  variables: ProjectVariable[];
  defaultAnswers: AnswerOption[];
  sections: QuizSection[];
  activeSectionId: string;
};

function normalizeCanvasBox(raw: unknown): CanvasBox | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string" || typeof box.x !== "number" || typeof box.y !== "number") {
    return null;
  }

  if (box.kind === "transition" || box.kind === "start") {
    return {
      id: box.id,
      x: box.x,
      y: box.y,
      kind: box.kind,
      effects: Array.isArray(box.effects) ? (box.effects as AnswerEffect[]) : [],
    };
  }

  if (box.kind === "section-changer") {
    return {
      id: box.id,
      x: box.x,
      y: box.y,
      kind: "section-changer",
      effects: Array.isArray(box.effects) ? (box.effects as AnswerEffect[]) : [],
      targetSection:
        typeof box.targetSection === "string" && box.targetSection
          ? box.targetSection
          : "next",
    };
  }

  return {
    id: box.id,
    x: box.x,
    y: box.y,
    kind: "question",
    question: typeof box.question === "string" ? box.question : "",
    answers: Array.isArray(box.answers) ? (box.answers as AnswerOption[]) : [],
  };
}

function normalizeTransition(raw: unknown): Transition | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (
    typeof t.id !== "string" ||
    typeof t.fromId !== "string" ||
    typeof t.toId !== "string"
  ) {
    return null;
  }

  const conditions = Array.isArray(t.conditions)
    ? t.conditions
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          id: typeof c.id === "string" ? c.id : crypto.randomUUID(),
          variableId: typeof c.variableId === "string" ? c.variableId : "",
          operator: (typeof c.operator === "string" ? c.operator : "eq") as ConditionOperator,
          value:
            typeof c.value === "string"
              ? c.value
              : typeof c.value === "number" && Number.isFinite(c.value)
                ? c.value
                : 0,
          join: c.join === "or" ? ("or" as const) : ("and" as const),
        }))
    : [];

  return {
    id: t.id,
    fromId: t.fromId,
    toId: t.toId,
    conditions,
  };
}

function normalizeSection(raw: unknown): QuizSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string") return null;

  const cameraRaw =
    s.camera && typeof s.camera === "object"
      ? (s.camera as Record<string, unknown>)
      : null;

  const boxes = ensureStartBlock(
    Array.isArray(s.boxes)
      ? s.boxes.map(normalizeCanvasBox).filter((b): b is CanvasBox => b !== null)
      : [],
  );
  const startIds = new Set(
    boxes.filter((box) => box.kind === "start").map((box) => box.id),
  );
  const noOutgoingIds = new Set(
    boxes
      .filter((box) => box.kind === "section-changer")
      .map((box) => box.id),
  );
  const transitions = (
    Array.isArray(s.transitions)
      ? s.transitions
          .map(normalizeTransition)
          .filter((t): t is Transition => t !== null)
      : []
  ).filter((t) => !startIds.has(t.toId) && !noOutgoingIds.has(t.fromId));

  return {
    id: s.id,
    name:
      typeof s.name === "string" && s.name.trim()
        ? s.name
        : nextSectionName([]),
    localVariables: Array.isArray(s.localVariables)
      ? s.localVariables
          .map(normalizeProjectVariable)
          .filter((v): v is ProjectVariable => v !== null)
      : [],
    localDefaultAnswers: Array.isArray(s.localDefaultAnswers)
      ? (s.localDefaultAnswers as AnswerOption[])
      : [],
    boxes,
    transitions,
    camera: {
      x: typeof cameraRaw?.x === "number" ? cameraRaw.x : 0,
      y: typeof cameraRaw?.y === "number" ? cameraRaw.y : 0,
      scale:
        typeof cameraRaw?.scale === "number"
          ? clamp(cameraRaw.scale, MIN_SCALE, MAX_SCALE)
          : 1,
    },
  };
}

function parseStoredQuiz(doc: StoredQuizDocument): PersistedQuiz {
  const defaultAnswers = Array.isArray(doc.defaultAnswers)
    ? (doc.defaultAnswers as AnswerOption[])
    : [createDefaultAnswer()];

  let sections = Array.isArray(doc.sections)
    ? doc.sections.map(normalizeSection).filter((s): s is QuizSection => s !== null)
    : [];

  if (sections.length === 0) {
    const fallback = emptySection([]) as QuizSection;
    const boxes = ensureStartBlock(
      Array.isArray(doc.boxes)
        ? doc.boxes.map(normalizeCanvasBox).filter((b): b is CanvasBox => b !== null)
        : [],
    );
    const startIds = new Set(
      boxes.filter((box) => box.kind === "start").map((box) => box.id),
    );
    sections = [
      {
        ...fallback,
        name: "Section1",
        localVariables: Array.isArray(doc.localVariables)
          ? doc.localVariables
              .map(normalizeProjectVariable)
              .filter((v): v is ProjectVariable => v !== null)
          : [],
        localDefaultAnswers: [],
        boxes,
        transitions: (
          Array.isArray(doc.transitions)
            ? doc.transitions
                .map(normalizeTransition)
                .filter((t): t is Transition => t !== null)
            : []
        ).filter((t) => !startIds.has(t.toId)),
        camera: { x: 0, y: 0, scale: 1 },
      },
    ];
  }

  const activeSectionId = sections.some((s) => s.id === doc.activeSectionId)
    ? doc.activeSectionId
    : sections[0].id;

  return {
    version: 1,
    id: doc.id,
    projectName: doc.projectName.trim() ? doc.projectName : DEFAULT_PROJECT_NAME,
    updatedAt: doc.updatedAt,
    variables: Array.isArray(doc.variables)
      ? doc.variables
          .map(normalizeProjectVariable)
          .filter((v): v is ProjectVariable => v !== null)
      : [],
    defaultAnswers: defaultAnswers.length > 0 ? defaultAnswers : [createDefaultAnswer()],
    sections,
    activeSectionId,
  };
}

function loadQuizById(id: string): PersistedQuiz | null {
  const stored = getStoredQuiz(id);
  if (!stored) return null;
  return parseStoredQuiz(stored);
}

function persistQuiz(quiz: PersistedQuiz) {
  saveStoredQuiz({
    version: 1,
    id: quiz.id,
    projectName: quiz.projectName,
    updatedAt: quiz.updatedAt,
    variables: quiz.variables,
    defaultAnswers: quiz.defaultAnswers,
    sections: quiz.sections,
    activeSectionId: quiz.activeSectionId,
  });
}

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return structuredClone(snapshot);
}

export default function CreateQuiz() {
  const { quizId } = useParams<{ quizId: string }>();
  if (!quizId) {
    return <Navigate to="/dashboard" replace />;
  }

  const initialQuiz = loadQuizById(quizId);
  if (!initialQuiz) {
    return <Navigate to="/dashboard" replace />;
  }

  return <CreateQuizEditor key={initialQuiz.id} initialQuiz={initialQuiz} />;
}

function CreateQuizEditor({ initialQuiz }: { initialQuiz: PersistedQuiz }) {
  const initialSection =
    initialQuiz.sections.find((s) => s.id === initialQuiz.activeSectionId) ??
    initialQuiz.sections[0];

  const quizIdRef = useRef(initialQuiz.id);
  const viewportRef = useRef<HTMLElement>(null);
  const varNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const localVarNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const ansNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const defaultAnsNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const localDefaultAnsNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [projectName, setProjectName] = useState(initialQuiz.projectName);
  const [sectionName, setSectionName] = useState(initialSection.name);
  const [settingsPane, setSettingsPane] = useState<"project" | "section">("project");
  const [sections, setSections] = useState<QuizSection[]>(initialQuiz.sections);
  const [activeSectionId, setActiveSectionId] = useState(initialSection.id);
  const [boxes, setBoxes] = useState<CanvasBox[]>(initialSection.boxes);
  const [camera, setCamera] = useState<Camera>(initialSection.camera);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [dragKind, setDragKind] = useState<"pan" | "box" | null>(null);
  const [draggingBoxId, setDraggingBoxId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [variables, setVariables] = useState<ProjectVariable[]>(initialQuiz.variables);
  const [localVariables, setLocalVariables] = useState<ProjectVariable[]>(
    initialSection.localVariables,
  );
  const [defaultAnswers, setDefaultAnswers] = useState<AnswerOption[]>(
    initialQuiz.defaultAnswers,
  );
  const [localDefaultAnswers, setLocalDefaultAnswers] = useState<AnswerOption[]>(
    initialSection.localDefaultAnswers,
  );
  const [transitions, setTransitions] = useState<Transition[]>(initialSection.transitions);
  const [transitionDraft, setTransitionDraft] = useState<TransitionDraft | null>(null);
  const [focusVarId, setFocusVarId] = useState<string | null>(null);
  const [focusLocalVarId, setFocusLocalVarId] = useState<string | null>(null);
  const [focusAnsId, setFocusAnsId] = useState<string | null>(null);
  const [focusDefaultAnsId, setFocusDefaultAnsId] = useState<string | null>(null);
  const [focusLocalDefaultAnsId, setFocusLocalDefaultAnsId] = useState<string | null>(null);
  const menuId = useId();

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const projectNameRef = useRef(projectName);
  const sectionNameRef = useRef(sectionName);
  const sectionsRef = useRef(sections);
  const activeSectionIdRef = useRef(activeSectionId);
  const boxesRef = useRef(boxes);
  const variablesRef = useRef(variables);
  const localVariablesRef = useRef(localVariables);
  const defaultAnswersRef = useRef(defaultAnswers);
  const localDefaultAnswersRef = useRef(localDefaultAnswers);
  const transitionsRef = useRef(transitions);
  const selectedIdRef = useRef(selectedId);
  const selectedTransitionIdRef = useRef(selectedTransitionId);
  const transitionDraftRef = useRef(transitionDraft);
  projectNameRef.current = projectName;
  sectionNameRef.current = sectionName;
  sectionsRef.current = sections;
  activeSectionIdRef.current = activeSectionId;
  boxesRef.current = boxes;
  variablesRef.current = variables;
  localVariablesRef.current = localVariables;
  defaultAnswersRef.current = defaultAnswers;
  localDefaultAnswersRef.current = localDefaultAnswers;
  transitionsRef.current = transitions;
  selectedIdRef.current = selectedId;
  selectedTransitionIdRef.current = selectedTransitionId;
  transitionDraftRef.current = transitionDraft;

  const pastRef = useRef<EditorSnapshot[]>([]);
  const futureRef = useRef<EditorSnapshot[]>([]);
  const applyingHistoryRef = useRef(false);
  const completeTransitionAtRef = useRef<(worldX: number, worldY: number) => void>(
    () => {},
  );

  const dragRef = useRef<
    (DragState & {
      historyPushed?: boolean;
      preDragSnapshot?: EditorSnapshot;
    }) | null
  >(null);

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;
  const selectedQuestion = selectedBox?.kind === "question" ? selectedBox : null;
  const selectedEffectBlock =
    selectedBox && isEffectBlock(selectedBox) ? selectedBox : null;
  const selectedTransition =
    transitions.find((t) => t.id === selectedTransitionId) ?? null;
  const allVariables = [...variables, ...localVariables];

  function getSectionsWithActive(): QuizSection[] {
    return sectionsRef.current.map((section) =>
      section.id === activeSectionIdRef.current
        ? {
            ...section,
            name: sectionNameRef.current,
            localVariables: localVariablesRef.current,
            localDefaultAnswers: localDefaultAnswersRef.current,
            boxes: boxesRef.current,
            transitions: transitionsRef.current,
            camera: cameraRef.current,
          }
        : section,
    );
  }

  function loadSection(section: QuizSection) {
    sectionNameRef.current = section.name;
    localVariablesRef.current = section.localVariables;
    localDefaultAnswersRef.current = section.localDefaultAnswers;
    boxesRef.current = section.boxes;
    transitionsRef.current = section.transitions;
    cameraRef.current = section.camera;
    setSectionName(section.name);
    setLocalVariables(section.localVariables);
    setLocalDefaultAnswers(section.localDefaultAnswers);
    setBoxes(section.boxes);
    setTransitions(section.transitions);
    setCamera(section.camera);
    setSelectedId(null);
    setSelectedTransitionId(null);
    setTransitionDraft(null);
    setMenu(null);
  }

  function getPersistedQuiz(): PersistedQuiz {
    const mergedSections = getSectionsWithActive();
    return {
      version: 1,
      id: quizIdRef.current,
      projectName: projectNameRef.current,
      updatedAt: Date.now(),
      variables: variablesRef.current,
      defaultAnswers: defaultAnswersRef.current,
      sections: mergedSections,
      activeSectionId: activeSectionIdRef.current,
    };
  }

  function getSnapshot(): EditorSnapshot {
    return {
      projectName: projectNameRef.current,
      variables: variablesRef.current,
      defaultAnswers: defaultAnswersRef.current,
      sections: getSectionsWithActive(),
      activeSectionId: activeSectionIdRef.current,
      selectedId: selectedIdRef.current,
      selectedTransitionId: selectedTransitionIdRef.current,
    };
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    applyingHistoryRef.current = true;
    const next = cloneSnapshot(snapshot);
    const active =
      next.sections.find((s) => s.id === next.activeSectionId) ?? next.sections[0];
    projectNameRef.current = next.projectName;
    variablesRef.current = next.variables;
    defaultAnswersRef.current = next.defaultAnswers;
    sectionsRef.current = next.sections;
    activeSectionIdRef.current = active.id;
    selectedIdRef.current = next.selectedId;
    selectedTransitionIdRef.current = next.selectedTransitionId;
    setProjectName(next.projectName);
    setVariables(next.variables);
    setDefaultAnswers(next.defaultAnswers);
    setSections(next.sections);
    setActiveSectionId(active.id);
    loadSection(active);
    setSelectedId(next.selectedId);
    setSelectedTransitionId(next.selectedTransitionId);
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
  }

  function selectSection(sectionId: string) {
    if (sectionId === activeSectionIdRef.current) return;
    const merged = getSectionsWithActive();
    const next = merged.find((s) => s.id === sectionId);
    if (!next) return;
    pushHistory();
    sectionsRef.current = merged;
    setSections(merged);
    activeSectionIdRef.current = next.id;
    setActiveSectionId(next.id);
    loadSection(next);
  }

  function createSection() {
    pushHistory();
    const merged = getSectionsWithActive();
    const created = emptySection(merged.map((s) => s.name)) as QuizSection;
    const nextSections = [...merged, created];
    sectionsRef.current = nextSections;
    setSections(nextSections);
    activeSectionIdRef.current = created.id;
    setActiveSectionId(created.id);
    loadSection(created);
    setSettingsPane("section");
    setSettingsOpen(true);
  }

  function pushHistory(snapshot = getSnapshot()) {
    if (applyingHistoryRef.current) return;
    const next = cloneSnapshot(snapshot);
    const last = pastRef.current[pastRef.current.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(next)) return;
    pastRef.current.push(next);
    if (pastRef.current.length > MAX_HISTORY) {
      pastRef.current.shift();
    }
    futureRef.current = [];
  }

  function undo() {
    if (pastRef.current.length === 0) return;
    futureRef.current.push(cloneSnapshot(getSnapshot()));
    const previous = pastRef.current.pop();
    if (previous) applySnapshot(previous);
  }

  function redo() {
    if (futureRef.current.length === 0) return;
    pastRef.current.push(cloneSnapshot(getSnapshot()));
    const next = futureRef.current.pop();
    if (next) applySnapshot(next);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      persistQuiz(getPersistedQuiz());
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [projectName, sectionName, sections, activeSectionId, boxes, variables, localVariables, defaultAnswers, localDefaultAnswers, transitions, camera]);

  useEffect(() => {
    const flush = () => persistQuiz(getPersistedQuiz());
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (boxesRef.current.length === 0) return;

    const { width, height } = el.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;

    const cam = cameraRef.current;
    if (anyBoxInViewport(boxesRef.current, cam, width, height)) return;

    const focus = cameraCenterWorld(cam, width, height);
    const nearest = findNearestBox(boxesRef.current, focus.x, focus.y, "");
    if (!nearest) return;

    setCamera(cameraCenteredOn(nearest.x, nearest.y, cam.scale, width, height));
  }, []);

  useEffect(() => {
    if (!focusVarId) return;
    const input = varNameRefs.current.get(focusVarId);
    if (!input) return;
    input.focus();
    input.select();
    setFocusVarId(null);
  }, [focusVarId, variables]);

  useEffect(() => {
    if (!focusLocalVarId) return;
    const input = localVarNameRefs.current.get(focusLocalVarId);
    if (!input) return;
    input.focus();
    input.select();
    setFocusLocalVarId(null);
  }, [focusLocalVarId, localVariables]);

  useEffect(() => {
    if (!focusAnsId || !selectedQuestion) return;
    const input = ansNameRefs.current.get(focusAnsId);
    if (!input) return;
    input.focus();
    input.select();
    setFocusAnsId(null);
  }, [focusAnsId, selectedQuestion]);

  useEffect(() => {
    if (!focusDefaultAnsId) return;
    const input = defaultAnsNameRefs.current.get(focusDefaultAnsId);
    if (!input) return;
    input.focus();
    input.select();
    setFocusDefaultAnsId(null);
  }, [focusDefaultAnsId, defaultAnswers]);

  useEffect(() => {
    if (!focusLocalDefaultAnsId) return;
    const input = localDefaultAnsNameRefs.current.get(focusLocalDefaultAnsId);
    if (!input) return;
    input.focus();
    input.select();
    setFocusLocalDefaultAnsId(null);
  }, [focusLocalDefaultAnsId, localDefaultAnswers]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (transitionDraftRef.current) {
          setTransitionDraft(null);
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!transitionDraft) return;

    const onMove = (e: PointerEvent) => {
      const el = viewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const world = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top,
        cameraRef.current,
      );
      setTransitionDraft((draft) =>
        draft ? { ...draft, mouseX: world.x, mouseY: world.y } : null,
      );
    };

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [transitionDraft]);

  useEffect(() => {
    if (!menu) return;

    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setMenu(null);

      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = cameraRef.current;
      const world = screenToWorld(sx, sy, cam);

      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
      const nextScale = clamp(cam.scale * factor, MIN_SCALE, MAX_SCALE);

      setCamera({
        scale: nextScale,
        x: sx - world.x * nextScale,
        y: sy - world.y * nextScale,
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      e.preventDefault();

      const totalDx = e.clientX - drag.startX;
      const totalDy = e.clientY - drag.startY;
      if (
        !drag.moved &&
        totalDx * totalDx + totalDy * totalDy >=
          CLICK_MOVE_THRESHOLD * CLICK_MOVE_THRESHOLD
      ) {
        drag.moved = true;
        if (drag.type === "box" && !drag.historyPushed && drag.preDragSnapshot) {
          pushHistory(drag.preDragSnapshot);
          drag.historyPushed = true;
        }
      }

      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      if (!drag.moved) return;

      if (drag.type === "pan") {
        setCamera((cam) => ({
          ...cam,
          x: cam.x + dx,
          y: cam.y + dy,
        }));
        return;
      }

      if (!drag.boxId) return;
      const scale = cameraRef.current.scale;
      setBoxes((prev) =>
        prev.map((box) =>
          box.id === drag.boxId
            ? { ...box, x: box.x + dx / scale, y: box.y + dy / scale }
            : box,
        ),
      );
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;

      const wasClick = !drag.moved;
      const boxId = drag.boxId;
      const type = drag.type;

      dragRef.current = null;
      setDragKind(null);
      setDraggingBoxId(null);

      if (type === "box" && wasClick && boxId) {
        setSelectedId(boxId);
        setSelectedTransitionId(null);
        return;
      }

      if (type === "pan" && wasClick) {
        setSelectedId(null);
        setSelectedTransitionId(null);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  function localPoint(e: { clientX: number; clientY: number }) {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onContextMenu(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault();
    const local = localPoint(e);
    const world = screenToWorld(local.x, local.y, camera);
    setMenu({
      kind: "canvas",
      screenX: e.clientX,
      screenY: e.clientY,
      worldX: world.x,
      worldY: world.y,
    });
  }

  function onBoxContextMenu(e: React.MouseEvent<HTMLElement>, boxId: string) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(boxId);
    setSelectedTransitionId(null);
    setMenu({
      kind: "box",
      screenX: e.clientX,
      screenY: e.clientY,
      boxId,
    });
  }

  function beginDrag(
    state: DragState & {
      historyPushed?: boolean;
      preDragSnapshot?: EditorSnapshot;
    },
  ) {
    dragRef.current = state;
    setDragKind(state.type);
    setDraggingBoxId(state.type === "box" ? (state.boxId ?? null) : null);
    setMenu(null);
  }

  function onViewportPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.preventDefault();

    if (transitionDraftRef.current) {
      const local = localPoint(e);
      const world = screenToWorld(local.x, local.y, cameraRef.current);
      completeTransitionAtRef.current(world.x, world.y);
      return;
    }

    beginDrag({
      type: "pan",
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    });
  }

  function onBoxPointerDown(e: React.PointerEvent<HTMLElement>, boxId: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (transitionDraftRef.current) {
      const local = localPoint(e);
      const world = screenToWorld(local.x, local.y, cameraRef.current);
      completeTransitionAtRef.current(world.x, world.y);
      return;
    }

    beginDrag({
      type: "box",
      pointerId: e.pointerId,
      boxId,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
  }

  function createQuestion() {
    if (!menu || menu.kind !== "canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    setBoxes((prev) => [
      ...prev,
      {
        id,
        x: menu.worldX,
        y: menu.worldY,
        kind: "question",
        question: "",
        answers: cloneAnswersWithNewIds(localDefaultAnswersRef.current),
      },
    ]);
    setSelectedId(id);
    setSelectedTransitionId(null);
    setMenu(null);
  }

  function createTransitionBlock() {
    if (!menu || menu.kind !== "canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    setBoxes((prev) => [
      ...prev,
      {
        id,
        x: menu.worldX,
        y: menu.worldY,
        kind: "transition",
        effects: [],
      },
    ]);
    setSelectedId(id);
    setSelectedTransitionId(null);
    setMenu(null);
  }

  function createStartBlockAtMenu() {
    if (!menu || menu.kind !== "canvas") return;
    if (boxesRef.current.some((box) => box.kind === "start")) {
      setMenu(null);
      return;
    }
    pushHistory();
    const block = createStartBlock(menu.worldX, menu.worldY);
    setBoxes((prev) => [...prev, block]);
    setSelectedId(block.id);
    setSelectedTransitionId(null);
    setMenu(null);
  }

  function createSectionChangerAtMenu() {
    if (!menu || menu.kind !== "canvas") return;
    pushHistory();
    const block = createSectionChangerBlock(menu.worldX, menu.worldY);
    setBoxes((prev) => [...prev, block]);
    setSelectedId(block.id);
    setSelectedTransitionId(null);
    setMenu(null);
  }

  function updateSectionChangerTarget(targetSection: "next" | string) {
    if (!selectedId) return;
    pushHistory();
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === selectedId && box.kind === "section-changer"
          ? { ...box, targetSection }
          : box,
      ),
    );
  }

  function duplicateQuestion() {
    if (!menu || menu.kind !== "box") return;
    const sourceId = menu.boxId;
    const source = boxesRef.current.find((box) => box.id === sourceId);
    if (!source || source.kind === "start") return;

    pushHistory();
    const id = crypto.randomUUID();
    let copy: CanvasBox;
    if (source.kind === "question") {
      copy = {
        ...structuredClone(source),
        id,
        x: source.x + DUPLICATE_OFFSET,
        y: source.y + DUPLICATE_OFFSET,
        answers: source.answers.map((answer) => ({
          ...answer,
          id: crypto.randomUUID(),
          effects: answer.effects.map((effect) => ({
            ...effect,
            id: crypto.randomUUID(),
          })),
        })),
      };
    } else if (source.kind === "section-changer") {
      copy = {
        ...structuredClone(source),
        id,
        x: source.x + DUPLICATE_OFFSET,
        y: source.y + DUPLICATE_OFFSET,
        effects: source.effects.map((effect) => ({
          ...effect,
          id: crypto.randomUUID(),
        })),
      };
    } else {
      copy = {
        ...structuredClone(source),
        id,
        x: source.x + DUPLICATE_OFFSET,
        y: source.y + DUPLICATE_OFFSET,
        effects: source.effects.map((effect) => ({
          ...effect,
          id: crypto.randomUUID(),
        })),
      };
    }
    setBoxes((prev) => [...prev, copy]);
    setSelectedId(id);
    setSelectedTransitionId(null);
    setMenu(null);
  }

  function deleteQuestion() {
    if (!menu || menu.kind !== "box") return;
    const sourceId = menu.boxId;
    pushHistory();
    setBoxes((prev) => prev.filter((box) => box.id !== sourceId));
    setTransitions((prev) =>
      prev.filter((t) => t.fromId !== sourceId && t.toId !== sourceId),
    );
    setSelectedId((current) => (current === sourceId ? null : current));
    setSelectedTransitionId((current) => {
      if (!current) return current;
      const stillExists = transitionsRef.current.some(
        (t) =>
          t.id === current && t.fromId !== sourceId && t.toId !== sourceId,
      );
      return stillExists ? current : null;
    });
    setMenu(null);
  }

  function makeTransition() {
    if (!menu || menu.kind !== "box") return;
    const fromId = menu.boxId;
    const fromBox = boxesRef.current.find((box) => box.id === fromId);
    if (!fromBox || fromBox.kind === "section-changer") return;
    const local = {
      x: menu.screenX - (viewportRef.current?.getBoundingClientRect().left ?? 0),
      y: menu.screenY - (viewportRef.current?.getBoundingClientRect().top ?? 0),
    };
    const world = screenToWorld(local.x, local.y, camera);
    setTransitionDraft({
      kind: "create",
      fromId,
      mouseX: world.x,
      mouseY: world.y,
    });
    setMenu(null);
  }

  function onTransitionContextMenu(
    e: React.MouseEvent<SVGGElement>,
    transitionId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedTransitionId(transitionId);
    setSelectedId(null);
    setMenu({
      kind: "transition",
      screenX: e.clientX,
      screenY: e.clientY,
      transitionId,
    });
  }

  function deleteTransition() {
    if (!menu || menu.kind !== "transition") return;
    const transitionId = menu.transitionId;
    pushHistory();
    setTransitions((prev) => prev.filter((t) => t.id !== transitionId));
    setSelectedTransitionId((current) => (current === transitionId ? null : current));
    setMenu(null);
  }

  function beginChangeTransitionOrigin() {
    if (!menu || menu.kind !== "transition") return;
    const transition = transitionsRef.current.find((t) => t.id === menu.transitionId);
    if (!transition) return;
    const local = {
      x: menu.screenX - (viewportRef.current?.getBoundingClientRect().left ?? 0),
      y: menu.screenY - (viewportRef.current?.getBoundingClientRect().top ?? 0),
    };
    const world = screenToWorld(local.x, local.y, camera);
    setSelectedTransitionId(transition.id);
    setSelectedId(null);
    setTransitionDraft({
      kind: "retarget-origin",
      transitionId: transition.id,
      toId: transition.toId,
      mouseX: world.x,
      mouseY: world.y,
    });
    setMenu(null);
  }

  function beginChangeTransitionDestination() {
    if (!menu || menu.kind !== "transition") return;
    const transition = transitionsRef.current.find((t) => t.id === menu.transitionId);
    if (!transition) return;
    const local = {
      x: menu.screenX - (viewportRef.current?.getBoundingClientRect().left ?? 0),
      y: menu.screenY - (viewportRef.current?.getBoundingClientRect().top ?? 0),
    };
    const world = screenToWorld(local.x, local.y, camera);
    setSelectedTransitionId(transition.id);
    setSelectedId(null);
    setTransitionDraft({
      kind: "retarget-destination",
      transitionId: transition.id,
      fromId: transition.fromId,
      mouseX: world.x,
      mouseY: world.y,
    });
    setMenu(null);
  }

  function completeTransitionAt(worldX: number, worldY: number) {
    const draft = transitionDraftRef.current;
    if (!draft) return;
    setTransitionDraft(null);

    if (draft.kind === "create" || draft.kind === "retarget-destination") {
      const fromBox = boxesRef.current.find((box) => box.id === draft.fromId);
      if (!fromBox || fromBox.kind === "section-changer") return;

      const target = findNearestBox(boxesRef.current, worldX, worldY, draft.fromId, {
        excludeKinds: ["start"],
      });
      if (!target) return;

      if (draft.kind === "create") {
        if (boxesAlreadyConnected(transitionsRef.current, draft.fromId, target.id)) {
          return;
        }
        pushHistory();
        setTransitions((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            fromId: draft.fromId,
            toId: target.id,
            conditions: [],
          },
        ]);
        return;
      }

      if (
        boxesAlreadyConnected(
          transitionsRef.current,
          draft.fromId,
          target.id,
          draft.transitionId,
        )
      ) {
        return;
      }
      if (target.id === draft.fromId) return;

      pushHistory();
      setTransitions((prev) =>
        prev.map((t) =>
          t.id === draft.transitionId ? { ...t, toId: target.id } : t,
        ),
      );
      return;
    }

    // retarget-origin
    const target = findNearestBox(boxesRef.current, worldX, worldY, draft.toId, {
      excludeKinds: ["section-changer"],
    });
    if (!target) return;

    if (
      boxesAlreadyConnected(
        transitionsRef.current,
        target.id,
        draft.toId,
        draft.transitionId,
      )
    ) {
      return;
    }

    pushHistory();
    setTransitions((prev) =>
      prev.map((t) =>
        t.id === draft.transitionId ? { ...t, fromId: target.id } : t,
      ),
    );
  }
  completeTransitionAtRef.current = completeTransitionAt;

  function selectTransition(transitionId: string) {
    setSelectedTransitionId(transitionId);
    setSelectedId(null);
    setMenu(null);
  }

  function addTransitionCondition() {
    if (!selectedTransitionId) return;
    pushHistory();
    const defaultVarId =
      variablesRef.current[0]?.id ?? localVariablesRef.current[0]?.id ?? "";
    setTransitions((prev) =>
      prev.map((transition) =>
        transition.id === selectedTransitionId
          ? {
              ...transition,
              conditions: [
                ...transition.conditions,
                createDefaultCondition(defaultVarId, "and"),
              ],
            }
          : transition,
      ),
    );
  }

  function updateTransitionCondition(
    conditionId: string,
    patch: Partial<TransitionCondition>,
  ) {
    if (!selectedTransitionId) return;
    setTransitions((prev) =>
      prev.map((transition) => {
        if (transition.id !== selectedTransitionId) return transition;
        return {
          ...transition,
          conditions: transition.conditions.map((condition) =>
            condition.id === conditionId ? { ...condition, ...patch } : condition,
          ),
        };
      }),
    );
  }

  function removeTransitionCondition(conditionId: string) {
    if (!selectedTransitionId) return;
    pushHistory();
    setTransitions((prev) =>
      prev.map((transition) =>
        transition.id === selectedTransitionId
          ? {
              ...transition,
              conditions: transition.conditions.filter(
                (condition) => condition.id !== conditionId,
              ),
            }
          : transition,
      ),
    );
  }

  function updateQuestion(value: string) {
    if (!selectedId) return;
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === selectedId && box.kind === "question"
          ? { ...box, question: value }
          : box,
      ),
    );
  }

  function addAnswer() {
    if (!selectedId) return;
    pushHistory();
    const id = crypto.randomUUID();
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || box.kind !== "question") return box;
        return {
          ...box,
          answers: [
            ...box.answers,
            {
              id,
              name: nextAnsName(box.answers),
              effects: [],
            },
          ],
        };
      }),
    );
    setFocusAnsId(id);
  }

  function updateAnswer(answerId: string, patch: Partial<AnswerOption>) {
    if (!selectedId) return;
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || box.kind !== "question") return box;
        return {
          ...box,
          answers: box.answers.map((answer) =>
            answer.id === answerId ? { ...answer, ...patch } : answer,
          ),
        };
      }),
    );
  }

  function removeAnswer(answerId: string) {
    if (!selectedId) return;
    pushHistory();
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || box.kind !== "question") return box;
        return {
          ...box,
          answers: box.answers.filter((answer) => answer.id !== answerId),
        };
      }),
    );
  }

  function addEffect(answerId: string) {
    if (!selectedId) return;
    pushHistory();
    const defaultVarId =
      variablesRef.current[0]?.id ?? localVariablesRef.current[0]?.id ?? "";
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || box.kind !== "question") return box;
        return {
          ...box,
          answers: box.answers.map((answer) =>
            answer.id === answerId
              ? {
                  ...answer,
                  effects: [...answer.effects, createDefaultEffect(defaultVarId)],
                }
              : answer,
          ),
        };
      }),
    );
  }

  function updateEffect(
    answerId: string,
    effectId: string,
    patch: Partial<AnswerEffect>,
  ) {
    if (!selectedId) return;
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || box.kind !== "question") return box;
        return {
          ...box,
          answers: box.answers.map((answer) => {
            if (answer.id !== answerId) return answer;
            return {
              ...answer,
              effects: answer.effects.map((effect) =>
                effect.id === effectId ? { ...effect, ...patch } : effect,
              ),
            };
          }),
        };
      }),
    );
  }

  function removeEffect(answerId: string, effectId: string) {
    if (!selectedId) return;
    pushHistory();
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || box.kind !== "question") return box;
        return {
          ...box,
          answers: box.answers.map((answer) =>
            answer.id === answerId
              ? {
                  ...answer,
                  effects: answer.effects.filter((effect) => effect.id !== effectId),
                }
              : answer,
          ),
        };
      }),
    );
  }

  function addBlockEffect() {
    if (!selectedId) return;
    pushHistory();
    const defaultVarId =
      variablesRef.current[0]?.id ?? localVariablesRef.current[0]?.id ?? "";
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === selectedId && isEffectBlock(box)
          ? {
              ...box,
              effects: [...box.effects, createDefaultEffect(defaultVarId)],
            }
          : box,
      ),
    );
  }

  function updateBlockEffect(effectId: string, patch: Partial<AnswerEffect>) {
    if (!selectedId) return;
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id !== selectedId || !isEffectBlock(box)) return box;
        return {
          ...box,
          effects: box.effects.map((effect) =>
            effect.id === effectId ? { ...effect, ...patch } : effect,
          ),
        };
      }),
    );
  }

  function removeBlockEffect(effectId: string) {
    if (!selectedId) return;
    pushHistory();
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === selectedId && isEffectBlock(box)
          ? {
              ...box,
              effects: box.effects.filter((effect) => effect.id !== effectId),
            }
          : box,
      ),
    );
  }

  const nameEditBaselineRef = useRef<string>("");

  function collectLocalVariableNames(): string[] {
    const names: string[] = [];
    for (const section of sectionsRef.current) {
      const locals =
        section.id === activeSectionIdRef.current
          ? localVariablesRef.current
          : section.localVariables;
      for (const variable of locals) {
        names.push(variable.name);
      }
    }
    return names;
  }

  function addVariable() {
    pushHistory();
    const id = crypto.randomUUID();
    const reserved = [
      ...variablesRef.current.map((variable) => variable.name),
      ...collectLocalVariableNames(),
    ];
    setVariables((prev) => [
      ...prev,
      {
        id,
        name: nextVarName(reserved),
        type: "number",
        value: 0,
      },
    ]);
    setSettingsOpen(true);
    setSettingsPane("project");
    setFocusVarId(id);
  }

  function updateVariable(id: string, patch: Partial<ProjectVariable>) {
    setVariables((prev) =>
      prev.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
    );
  }

  function commitVariableName(id: string) {
    const variable = variablesRef.current.find((item) => item.id === id);
    if (!variable) return;
    const previous = nameEditBaselineRef.current;
    const trimmed = variable.name.trim();
    const reserved = [
      ...variablesRef.current
        .filter((item) => item.id !== id)
        .map((item) => item.name),
      ...collectLocalVariableNames(),
    ];
    if (isNameTaken(trimmed, reserved)) {
      if (variable.name !== previous) {
        setVariables((prev) =>
          prev.map((item) => (item.id === id ? { ...item, name: previous } : item)),
        );
      }
      return;
    }
    if (variable.name !== trimmed) {
      setVariables((prev) =>
        prev.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
      );
    }
  }

  function removeVariable(id: string) {
    pushHistory();
    setVariables((prev) => prev.filter((variable) => variable.id !== id));
  }

  function addLocalVariable() {
    pushHistory();
    const id = crypto.randomUUID();
    const reserved = [
      ...variablesRef.current.map((variable) => variable.name),
      ...localVariablesRef.current.map((variable) => variable.name),
    ];
    setLocalVariables((prev) => [
      ...prev,
      {
        id,
        name: nextVarName(reserved),
        type: "number",
        value: 0,
      },
    ]);
    setSettingsOpen(true);
    setSettingsPane("section");
    setFocusLocalVarId(id);
  }

  function updateLocalVariable(id: string, patch: Partial<ProjectVariable>) {
    setLocalVariables((prev) =>
      prev.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
    );
  }

  function commitLocalVariableName(id: string) {
    const variable = localVariablesRef.current.find((item) => item.id === id);
    if (!variable) return;
    const previous = nameEditBaselineRef.current;
    const trimmed = variable.name.trim();
    const reserved = [
      ...variablesRef.current.map((item) => item.name),
      ...localVariablesRef.current
        .filter((item) => item.id !== id)
        .map((item) => item.name),
    ];
    if (isNameTaken(trimmed, reserved)) {
      if (variable.name !== previous) {
        setLocalVariables((prev) =>
          prev.map((item) => (item.id === id ? { ...item, name: previous } : item)),
        );
      }
      return;
    }
    if (variable.name !== trimmed) {
      setLocalVariables((prev) =>
        prev.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
      );
    }
  }

  function removeLocalVariable(id: string) {
    pushHistory();
    setLocalVariables((prev) => prev.filter((variable) => variable.id !== id));
  }

  function commitSectionName() {
    const previous = nameEditBaselineRef.current;
    const trimmed = sectionNameRef.current.trim();
    const reserved = sectionsRef.current
      .filter((section) => section.id !== activeSectionIdRef.current)
      .map((section) => section.name);
    if (isNameTaken(trimmed, reserved)) {
      if (sectionNameRef.current !== previous) {
        setSectionName(previous);
      }
      return;
    }
    if (sectionNameRef.current !== trimmed) {
      setSectionName(trimmed);
    }
  }

  function addDefaultAnswer() {
    pushHistory();
    const id = crypto.randomUUID();
    setDefaultAnswers((prev) => [
      ...prev,
      {
        id,
        name: nextAnsName(prev),
        effects: [],
      },
    ]);
    setFocusDefaultAnsId(id);
  }

  function updateDefaultAnswer(answerId: string, patch: Partial<AnswerOption>) {
    setDefaultAnswers((prev) =>
      prev.map((answer) => (answer.id === answerId ? { ...answer, ...patch } : answer)),
    );
  }

  function removeDefaultAnswer(answerId: string) {
    pushHistory();
    setDefaultAnswers((prev) => prev.filter((answer) => answer.id !== answerId));
  }

  function addDefaultEffect(answerId: string) {
    pushHistory();
    const defaultVarId =
      variablesRef.current[0]?.id ?? localVariablesRef.current[0]?.id ?? "";
    setDefaultAnswers((prev) =>
      prev.map((answer) =>
        answer.id === answerId
          ? {
              ...answer,
              effects: [...answer.effects, createDefaultEffect(defaultVarId)],
            }
          : answer,
      ),
    );
  }

  function updateDefaultEffect(
    answerId: string,
    effectId: string,
    patch: Partial<AnswerEffect>,
  ) {
    setDefaultAnswers((prev) =>
      prev.map((answer) => {
        if (answer.id !== answerId) return answer;
        return {
          ...answer,
          effects: answer.effects.map((effect) =>
            effect.id === effectId ? { ...effect, ...patch } : effect,
          ),
        };
      }),
    );
  }

  function removeDefaultEffect(answerId: string, effectId: string) {
    pushHistory();
    setDefaultAnswers((prev) =>
      prev.map((answer) =>
        answer.id === answerId
          ? {
              ...answer,
              effects: answer.effects.filter((effect) => effect.id !== effectId),
            }
          : answer,
      ),
    );
  }

  function addLocalDefaultAnswer() {
    pushHistory();
    const id = crypto.randomUUID();
    setLocalDefaultAnswers((prev) => [
      ...prev,
      {
        id,
        name: nextAnsName(prev),
        effects: [],
      },
    ]);
    setFocusLocalDefaultAnsId(id);
  }

  function updateLocalDefaultAnswer(answerId: string, patch: Partial<AnswerOption>) {
    setLocalDefaultAnswers((prev) =>
      prev.map((answer) => (answer.id === answerId ? { ...answer, ...patch } : answer)),
    );
  }

  function removeLocalDefaultAnswer(answerId: string) {
    pushHistory();
    setLocalDefaultAnswers((prev) => prev.filter((answer) => answer.id !== answerId));
  }

  function addLocalDefaultEffect(answerId: string) {
    pushHistory();
    const defaultVarId =
      variablesRef.current[0]?.id ?? localVariablesRef.current[0]?.id ?? "";
    setLocalDefaultAnswers((prev) =>
      prev.map((answer) =>
        answer.id === answerId
          ? {
              ...answer,
              effects: [...answer.effects, createDefaultEffect(defaultVarId)],
            }
          : answer,
      ),
    );
  }

  function updateLocalDefaultEffect(
    answerId: string,
    effectId: string,
    patch: Partial<AnswerEffect>,
  ) {
    setLocalDefaultAnswers((prev) =>
      prev.map((answer) => {
        if (answer.id !== answerId) return answer;
        return {
          ...answer,
          effects: answer.effects.map((effect) =>
            effect.id === effectId ? { ...effect, ...patch } : effect,
          ),
        };
      }),
    );
  }

  function removeLocalDefaultEffect(answerId: string, effectId: string) {
    pushHistory();
    setLocalDefaultAnswers((prev) =>
      prev.map((answer) =>
        answer.id === answerId
          ? {
              ...answer,
              effects: answer.effects.filter((effect) => effect.id !== effectId),
            }
          : answer,
      ),
    );
  }

  const sectionList = sections.map((section) =>
    section.id === activeSectionId ? { ...section, name: sectionName } : section,
  );

  const cursorClass =
    dragKind === "pan"
      ? "cursor-grabbing"
      : dragKind === "box"
        ? "cursor-move"
        : "cursor-grab";

  return (
    <div className="relative h-screen w-full overflow-hidden bg-white">
      <div
        className="pointer-events-none absolute top-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <select
          aria-label="Active section"
          value={activeSectionId}
          onChange={(e) => selectSection(e.target.value)}
          className="pointer-events-auto max-w-[220px] cursor-pointer rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black shadow-sm outline-none focus:border-[#2f5d76]"
        >
          {sectionList.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name.trim() || "Untitled Section"}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Create section"
          onClick={createSection}
          className="pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-lg leading-none text-black shadow-sm hover:bg-[#f5f5f5]"
        >
          +
        </button>
      </div>

      <main
        ref={viewportRef}
        className={`absolute inset-0 touch-none overflow-hidden bg-white select-none ${
          transitionDraft ? "cursor-crosshair" : cursorClass
        }`}
        onContextMenu={onContextMenu}
        onPointerDown={onViewportPointerDown}
      >
        <div
          className="absolute top-0 left-0 origin-top-left will-change-transform"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          }}
        >
          <svg
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width={1}
            height={1}
            aria-hidden
          >
            <defs>
              <marker
                id="transition-arrowhead"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#000000" />
              </marker>
              <marker
                id="transition-arrowhead-selected"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
                markerUnits="userSpaceOnUse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#2f5d76" />
              </marker>
            </defs>

            {transitions.map((transition) => {
              const from = boxes.find((box) => box.id === transition.fromId);
              const to = boxes.find((box) => box.id === transition.toId);
              if (!from || !to) return null;
              const fromRect = boxRect(from);
              const toRect = boxRect(to);
              const end = edgePointFacing(toRect, fromRect.cx, fromRect.cy);
              const selected = selectedTransitionId === transition.id;
              return (
                <g
                  key={transition.id}
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    selectTransition(transition.id);
                  }}
                  onContextMenu={(e) => onTransitionContextMenu(e, transition.id)}
                >
                  <line
                    x1={fromRect.cx}
                    y1={fromRect.cy}
                    x2={end.x}
                    y2={end.y}
                    stroke="transparent"
                    strokeWidth={14}
                  />
                  <line
                    x1={fromRect.cx}
                    y1={fromRect.cy}
                    x2={end.x}
                    y2={end.y}
                    stroke={selected ? "#2f5d76" : "#000000"}
                    strokeWidth={selected ? 2.5 : 1.5}
                    markerEnd={
                      selected
                        ? "url(#transition-arrowhead-selected)"
                        : "url(#transition-arrowhead)"
                    }
                  />
                </g>
              );
            })}

            {transitionDraft &&
              (() => {
                if (transitionDraft.kind === "retarget-origin") {
                  const to = boxes.find((box) => box.id === transitionDraft.toId);
                  if (!to) return null;
                  const toRect = boxRect(to);
                  const end = edgePointFacing(
                    toRect,
                    transitionDraft.mouseX,
                    transitionDraft.mouseY,
                  );
                  return (
                    <line
                      x1={transitionDraft.mouseX}
                      y1={transitionDraft.mouseY}
                      x2={end.x}
                      y2={end.y}
                      stroke="#2f5d76"
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      markerEnd="url(#transition-arrowhead-selected)"
                    />
                  );
                }

                const from = boxes.find((box) => box.id === transitionDraft.fromId);
                if (!from) return null;
                const fromRect = boxRect(from);
                return (
                  <line
                    x1={fromRect.cx}
                    y1={fromRect.cy}
                    x2={transitionDraft.mouseX}
                    y2={transitionDraft.mouseY}
                    stroke={
                      transitionDraft.kind === "retarget-destination" ? "#2f5d76" : "#000000"
                    }
                    strokeWidth={1.5}
                    strokeDasharray={
                      transitionDraft.kind === "retarget-destination" ? "6 4" : undefined
                    }
                    markerEnd={
                      transitionDraft.kind === "retarget-destination"
                        ? "url(#transition-arrowhead-selected)"
                        : "url(#transition-arrowhead)"
                    }
                  />
                );
              })()}
          </svg>

          {boxes.map((box) => {
            const selected = selectedId === box.id;
            const isFixedLabelBlock = isEffectBlock(box);
            const { width, height, lines } = isFixedLabelBlock
              ? {
                  width: EMPTY_HEIGHT * ASPECT,
                  height: EMPTY_HEIGHT,
                  lines: [] as string[],
                }
              : layoutBox(box.question);
            const label =
              box.kind === "start"
                ? "Start"
                : box.kind === "transition"
                  ? "Transition"
                  : box.kind === "section-changer"
                    ? "Section"
                    : lines.join("\n");
            const colorClass =
              box.kind === "start"
                ? "bg-[#2f9e5b] text-white"
                : box.kind === "transition"
                  ? "bg-[#9a9a9a] text-white"
                  : box.kind === "section-changer"
                    ? "bg-[#4f6bc4] text-white"
                    : "bg-black text-white";

            return (
              <div
                key={box.id}
                draggable={false}
                className={`absolute flex touch-none items-center justify-center overflow-hidden rounded-2xl text-center select-none cursor-move ${colorClass} ${
                  draggingBoxId === box.id || selected ? "z-10" : ""
                } ${selected ? "ring-2 ring-[#2f5d76] ring-offset-2" : ""}`}
                style={{
                  left: box.x,
                  top: box.y,
                  width,
                  height,
                  paddingLeft: PAD_X / 2,
                  paddingRight: PAD_X / 2,
                  paddingTop: PAD_Y / 2,
                  paddingBottom: PAD_Y / 2,
                  transform: "translate(-50%, -50%)",
                  WebkitUserDrag: "none",
                } as React.CSSProperties}
                onPointerDown={(e) => onBoxPointerDown(e, box.id)}
                onContextMenu={(e) => onBoxContextMenu(e, box.id)}
                onDragStart={(e) => e.preventDefault()}
              >
                {label && (
                  <span
                    className="block w-full whitespace-pre-wrap break-words"
                    style={{
                      fontSize: FONT_SIZE,
                      lineHeight: LINE_HEIGHT,
                      fontWeight: 500,
                    }}
                  >
                    {label}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {menu && (
          <div
            id={menuId}
            role="menu"
            className="fixed z-50 min-w-[200px] rounded-md border border-black/15 bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            style={{ left: menu.screenX, top: menu.screenY }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.kind === "canvas" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createQuestion}
                >
                  Create Question
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createTransitionBlock}
                >
                  Create Transition Block
                </button>
                {!boxes.some((box) => box.kind === "start") && (
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                    onClick={createStartBlockAtMenu}
                  >
                    Create Start Block
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createSectionChangerAtMenu}
                >
                  Create A Section Changer
                </button>
              </>
            ) : menu.kind === "transition" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={deleteTransition}
                >
                  Delete
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={beginChangeTransitionOrigin}
                >
                  Change Origin
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={beginChangeTransitionDestination}
                >
                  Change Destination
                </button>
              </>
            ) : (
              <>
                {boxes.find((box) => box.id === menu.boxId)?.kind !== "start" && (
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                    onClick={duplicateQuestion}
                  >
                    Duplicate
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={deleteQuestion}
                >
                  Delete
                </button>
                {boxes.find((box) => box.id === menu.boxId)?.kind !==
                  "section-changer" && (
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                    onClick={makeTransition}
                  >
                    Make Transition
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {selectedQuestion && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <label className="mb-2 text-sm font-medium text-black" htmlFor="question-field">
            Question
          </label>
          <textarea
            id="question-field"
            value={selectedQuestion.question}
            onFocus={() => pushHistory()}
            onChange={(e) => updateQuestion(e.target.value)}
            rows={6}
            placeholder="Type your question…"
            className="w-full resize-y rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
            autoFocus
          />

          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Answers
            </h2>
            <AnswersEditor
              answers={selectedQuestion.answers}
              variables={allVariables}
              nameRefs={ansNameRefs}
              onCheckpoint={pushHistory}
              onUpdateAnswer={updateAnswer}
              onRemoveAnswer={removeAnswer}
              onAddAnswer={addAnswer}
              onAddEffect={addEffect}
              onUpdateEffect={updateEffect}
              onRemoveEffect={removeEffect}
            />
          </section>
        </aside>
      )}

      {selectedEffectBlock && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">
            {selectedEffectBlock.kind === "start"
              ? "Start Block"
              : selectedEffectBlock.kind === "section-changer"
                ? "Section Changer"
                : "Transition Block"}
          </h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Effects
            </h2>
            <EffectsEditor
              effects={selectedEffectBlock.effects}
              variables={allVariables}
              onCheckpoint={pushHistory}
              onAddEffect={addBlockEffect}
              onUpdateEffect={updateBlockEffect}
              onRemoveEffect={removeBlockEffect}
            />
          </section>
          {selectedEffectBlock.kind === "section-changer" && (
            <section className="mt-8">
              <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                Go To Section
              </h2>
              <select
                aria-label="Target section"
                value={selectedEffectBlock.targetSection}
                onFocus={() => pushHistory()}
                onChange={(e) => updateSectionChangerTarget(e.target.value)}
                className="mt-3 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
              >
                <option value="next">Next section</option>
                {sectionList.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name.trim() || "Untitled Section"}
                  </option>
                ))}
              </select>
            </section>
          )}
        </aside>
      )}

      {selectedTransition && !selectedBox && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Transition</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Conditions
            </h2>
            <ConditionsEditor
              conditions={selectedTransition.conditions}
              variables={allVariables}
              onCheckpoint={pushHistory}
              onAddCondition={addTransitionCondition}
              onUpdateCondition={updateTransitionCondition}
              onRemoveCondition={removeTransitionCondition}
            />
          </section>
        </aside>
      )}

      <div
        className="absolute top-0 right-0 bottom-0 z-30 flex"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={settingsOpen ? "Collapse project settings" : "Expand project settings"}
          onClick={() => setSettingsOpen((open) => !open)}
          className="relative z-10 mt-4 -mr-4 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center self-start rounded-full border border-black/15 bg-white text-base text-black shadow-sm hover:bg-[#f5f5f5]"
        >
          {settingsOpen ? "<" : ">"}
        </button>

        <aside
          className={`flex h-full flex-col overflow-hidden border-l border-black/10 bg-[#fafafa] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] transition-[width] duration-200 ease-out ${
            settingsOpen ? "w-[320px]" : "w-0 border-l-0 shadow-none"
          }`}
        >
          <div className="flex w-[320px] flex-col overflow-y-auto p-5 pt-6 pl-7">
            <Link
              to="/dashboard"
              className="mb-4 text-sm font-medium text-[#2f5d76] no-underline hover:text-[#244a5e]"
            >
              ← Your Quizzes
            </Link>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-lg font-semibold text-black">
                {settingsPane === "project" ? "Project Settings" : "Section Settings"}
              </h1>
              <button
                type="button"
                onClick={() =>
                  setSettingsPane((pane) => (pane === "project" ? "section" : "project"))
                }
                className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-left text-xs font-medium leading-snug text-[#2f5d76] hover:text-[#244a5e]"
              >
                {settingsPane === "project"
                  ? "Switch To Section Settings"
                  : "Switch To Project Settings"}
              </button>
            </div>

            {settingsPane === "project" ? (
              <>
                <section className="mt-6">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Project Name
                  </h2>
                  <input
                    type="text"
                    value={projectName}
                    aria-label="Project name"
                    onFocus={() => pushHistory()}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder={DEFAULT_PROJECT_NAME}
                    className="mt-3 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
                  />
                </section>

                <section className="mt-8">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Variables
                  </h2>

                  <div className="mt-3 flex flex-col gap-2">
                    {variables.map((variable) => (
                      <div
                        key={variable.id}
                        className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-2 py-1.5"
                      >
                        <input
                          ref={(el) => {
                            if (el) varNameRefs.current.set(variable.id, el);
                            else varNameRefs.current.delete(variable.id);
                          }}
                          type="text"
                          value={variable.name}
                          aria-label="Variable name"
                          onFocus={() => {
                            pushHistory();
                            nameEditBaselineRef.current = variable.name;
                          }}
                          onChange={(e) =>
                            updateVariable(variable.id, { name: e.target.value })
                          }
                          onBlur={() => commitVariableName(variable.id)}
                          className="min-w-0 flex-1 border-none bg-transparent px-1 py-0.5 text-sm text-black outline-none"
                        />
                        <select
                          aria-label="Variable type"
                          value={variable.type}
                          onFocus={() => pushHistory()}
                          onChange={(e) => {
                            const type = e.target.value as VariableType;
                            pushHistory();
                            updateVariable(variable.id, {
                              type,
                              value: coerceValueForType(type, variable.value),
                            });
                          }}
                          className="shrink-0 rounded border border-black/15 bg-white px-1 py-0.5 text-xs text-black outline-none focus:border-[#2f5d76]"
                        >
                          {VARIABLE_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {variable.type === "bool" ? (
                          <input
                            type="checkbox"
                            checked={variable.value !== 0 && variable.value !== "0"}
                            aria-label="Boolean value"
                            onChange={(e) => {
                              pushHistory();
                              updateVariable(variable.id, {
                                value: e.target.checked ? 1 : 0,
                              });
                            }}
                            className="h-4 w-4 shrink-0 cursor-pointer"
                          />
                        ) : variable.type === "string" ? (
                          <input
                            type="text"
                            value={typeof variable.value === "string" ? variable.value : ""}
                            aria-label="Variable value"
                            onFocus={() => pushHistory()}
                            onChange={(e) =>
                              updateVariable(variable.id, { value: e.target.value })
                            }
                            className="w-20 shrink-0 rounded border border-black/15 px-1.5 py-0.5 text-sm text-black outline-none focus:border-[#2f5d76]"
                          />
                        ) : (
                          <input
                            type="number"
                            step="any"
                            value={typeof variable.value === "number" ? variable.value : 0}
                            aria-label="Variable value"
                            onFocus={() => pushHistory()}
                            onChange={(e) => {
                              const next =
                                e.target.value === "" ? 0 : Number(e.target.value);
                              updateVariable(variable.id, {
                                value: Number.isFinite(next) ? next : 0,
                              });
                            }}
                            className="w-16 shrink-0 rounded border border-black/15 px-1.5 py-0.5 text-sm text-black outline-none focus:border-[#2f5d76]"
                          />
                        )}
                        <button
                          type="button"
                          aria-label="Remove variable"
                          onClick={() => removeVariable(variable.id)}
                          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-base leading-none text-black hover:bg-black/5"
                        >
                          −
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    aria-label="Add variable"
                    onClick={addVariable}
                    className="mt-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-lg leading-none text-black hover:bg-black/5"
                  >
                    +
                  </button>
                </section>

                <section className="mt-8">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Default Question Answers
                  </h2>
                  <AnswersEditor
                    answers={defaultAnswers}
                    variables={allVariables}
                    nameRefs={defaultAnsNameRefs}
                    onCheckpoint={pushHistory}
                    onUpdateAnswer={updateDefaultAnswer}
                    onRemoveAnswer={removeDefaultAnswer}
                    onAddAnswer={addDefaultAnswer}
                    onAddEffect={addDefaultEffect}
                    onUpdateEffect={updateDefaultEffect}
                    onRemoveEffect={removeDefaultEffect}
                  />
                </section>
              </>
            ) : (
              <>
                <section className="mt-6">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Section Name
                  </h2>
                  <input
                    type="text"
                    value={sectionName}
                    aria-label="Section name"
                    onFocus={() => {
                      pushHistory();
                      nameEditBaselineRef.current = sectionName;
                    }}
                    onChange={(e) => setSectionName(e.target.value)}
                    onBlur={() => commitSectionName()}
                    placeholder="Section1"
                    className="mt-3 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
                  />
                </section>

                <section className="mt-8">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Local Variables
                  </h2>

                  <div className="mt-3 flex flex-col gap-2">
                    {localVariables.map((variable) => (
                      <div
                        key={variable.id}
                        className="flex items-center gap-2 rounded-md border border-black/10 bg-white px-2 py-1.5"
                      >
                        <input
                          ref={(el) => {
                            if (el) localVarNameRefs.current.set(variable.id, el);
                            else localVarNameRefs.current.delete(variable.id);
                          }}
                          type="text"
                          value={variable.name}
                          aria-label="Local variable name"
                          onFocus={() => {
                            pushHistory();
                            nameEditBaselineRef.current = variable.name;
                          }}
                          onChange={(e) =>
                            updateLocalVariable(variable.id, { name: e.target.value })
                          }
                          onBlur={() => commitLocalVariableName(variable.id)}
                          className="min-w-0 flex-1 border-none bg-transparent px-1 py-0.5 text-sm text-black outline-none"
                        />
                        <select
                          aria-label="Local variable type"
                          value={variable.type}
                          onFocus={() => pushHistory()}
                          onChange={(e) => {
                            const type = e.target.value as VariableType;
                            pushHistory();
                            updateLocalVariable(variable.id, {
                              type,
                              value: coerceValueForType(type, variable.value),
                            });
                          }}
                          className="shrink-0 rounded border border-black/15 bg-white px-1 py-0.5 text-xs text-black outline-none focus:border-[#2f5d76]"
                        >
                          {VARIABLE_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {variable.type === "bool" ? (
                          <input
                            type="checkbox"
                            checked={variable.value !== 0 && variable.value !== "0"}
                            aria-label="Boolean value"
                            onChange={(e) => {
                              pushHistory();
                              updateLocalVariable(variable.id, {
                                value: e.target.checked ? 1 : 0,
                              });
                            }}
                            className="h-4 w-4 shrink-0 cursor-pointer"
                          />
                        ) : variable.type === "string" ? (
                          <input
                            type="text"
                            value={typeof variable.value === "string" ? variable.value : ""}
                            aria-label="Local variable value"
                            onFocus={() => pushHistory()}
                            onChange={(e) =>
                              updateLocalVariable(variable.id, { value: e.target.value })
                            }
                            className="w-20 shrink-0 rounded border border-black/15 px-1.5 py-0.5 text-sm text-black outline-none focus:border-[#2f5d76]"
                          />
                        ) : (
                          <input
                            type="number"
                            step="any"
                            value={typeof variable.value === "number" ? variable.value : 0}
                            aria-label="Local variable value"
                            onFocus={() => pushHistory()}
                            onChange={(e) => {
                              const next =
                                e.target.value === "" ? 0 : Number(e.target.value);
                              updateLocalVariable(variable.id, {
                                value: Number.isFinite(next) ? next : 0,
                              });
                            }}
                            className="w-16 shrink-0 rounded border border-black/15 px-1.5 py-0.5 text-sm text-black outline-none focus:border-[#2f5d76]"
                          />
                        )}
                        <button
                          type="button"
                          aria-label="Remove local variable"
                          onClick={() => removeLocalVariable(variable.id)}
                          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-base leading-none text-black hover:bg-black/5"
                        >
                          −
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    aria-label="Add local variable"
                    onClick={addLocalVariable}
                    className="mt-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-lg leading-none text-black hover:bg-black/5"
                  >
                    +
                  </button>
                </section>

                <section className="mt-8">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Local Default Question Answers
                  </h2>
                  <AnswersEditor
                    answers={localDefaultAnswers}
                    variables={allVariables}
                    nameRefs={localDefaultAnsNameRefs}
                    onCheckpoint={pushHistory}
                    onUpdateAnswer={updateLocalDefaultAnswer}
                    onRemoveAnswer={removeLocalDefaultAnswer}
                    onAddAnswer={addLocalDefaultAnswer}
                    onAddEffect={addLocalDefaultEffect}
                    onUpdateEffect={updateLocalDefaultEffect}
                    onRemoveEffect={removeLocalDefaultEffect}
                  />
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
