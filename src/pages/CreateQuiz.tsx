import { useEffect, useId, useRef, useState } from "react";

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

type CanvasBox = QuestionBox | TransitionBlock;

type AnswerOption = {
  id: string;
  name: string;
  effects: AnswerEffect[];
};

type EffectOperation = "set" | "add" | "subtract" | "multiply" | "divide";

type AnswerEffect = {
  id: string;
  variableId: string;
  operation: EffectOperation;
  /** Amount / set-to value; for bool set, 0 = false and 1 = true. */
  value: number;
};

type ProjectVariable = {
  id: string;
  name: string;
  isBool: boolean;
  /** Float value; for bools, 0 = false and 1 = true. */
  value: number;
};

type ConditionOperator = "eq" | "neq" | "gt" | "lt" | "gte" | "lte";
type ConditionJoin = "and" | "or";

type TransitionCondition = {
  id: string;
  variableId: string;
  operator: ConditionOperator;
  /** Compare-to value; for bools, 0 = false and 1 = true. */
  value: number;
  /** How this condition combines with the previous one. Unused on the first. */
  join: ConditionJoin;
};

type Transition = {
  id: string;
  fromId: string;
  toId: string;
  conditions: TransitionCondition[];
};

type TransitionDraft = {
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
  if (box.kind === "transition") {
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
  excludeId: string,
) {
  let nearest: CanvasBox | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    if (box.id === excludeId) continue;
    const dist = (box.x - worldX) ** 2 + (box.y - worldY) ** 2;
    if (dist < best) {
      best = dist;
      nearest = box;
    }
  }
  return nearest;
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

function nextPrefixedName(prefix: string, existingNames: string[]) {
  const used = new Set(existingNames);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

function nextVarName(existing: ProjectVariable[]) {
  return nextPrefixedName(
    "Var",
    existing.map((v) => v.name),
  );
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
          const isBoolVar = selectedVar?.isBool ?? false;
          const operatorOptions = isBoolVar
            ? CONDITION_OPERATORS.filter((op) => op.value === "eq" || op.value === "neq")
            : CONDITION_OPERATORS;
          const operatorValue =
            isBoolVar && condition.operator !== "eq" && condition.operator !== "neq"
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
                      onUpdateCondition(condition.id, {
                        variableId,
                        operator:
                          nextVar?.isBool &&
                          condition.operator !== "eq" &&
                          condition.operator !== "neq"
                            ? "eq"
                            : condition.operator,
                        value: nextVar?.isBool
                          ? condition.value !== 0
                            ? 1
                            : 0
                          : condition.value,
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
                        {variable.isBool ? " (bool)" : ""}
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

                  {isBoolVar ? (
                    <label className="flex shrink-0 items-center gap-1 text-xs text-black/70">
                      <input
                        type="checkbox"
                        checked={condition.value !== 0}
                        aria-label="Boolean compare value"
                        onChange={(e) => {
                          onCheckpoint();
                          onUpdateCondition(condition.id, {
                            value: e.target.checked ? 1 : 0,
                          });
                        }}
                        className="cursor-pointer"
                      />
                      <span>{condition.value !== 0 ? "true" : "false"}</span>
                    </label>
                  ) : (
                    <input
                      type="number"
                      step="any"
                      value={condition.value}
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
          const isBoolVar = selectedVar?.isBool ?? false;
          const operationOptions = isBoolVar
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
                    onUpdateEffect(effect.id, {
                      variableId,
                      operation:
                        nextVar?.isBool && effect.operation !== "set"
                          ? "set"
                          : effect.operation,
                      value: nextVar?.isBool
                        ? effect.value !== 0
                          ? 1
                          : 0
                        : effect.value,
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
                      {variable.isBool ? " (bool)" : ""}
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
                  value={isBoolVar ? "set" : effect.operation}
                  disabled={isBoolVar}
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

                {isBoolVar ? (
                  <label className="flex shrink-0 items-center gap-1 text-xs text-black/70">
                    <input
                      type="checkbox"
                      checked={effect.value !== 0}
                      aria-label="Boolean set value"
                      onChange={(e) => {
                        onCheckpoint();
                        onUpdateEffect(effect.id, {
                          value: e.target.checked ? 1 : 0,
                        });
                      }}
                      className="cursor-pointer"
                    />
                    <span>{effect.value !== 0 ? "true" : "false"}</span>
                  </label>
                ) : (
                  <input
                    type="number"
                    step="any"
                    value={effect.value}
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

type EditorSnapshot = {
  projectName: string;
  boxes: CanvasBox[];
  variables: ProjectVariable[];
  defaultAnswers: AnswerOption[];
  transitions: Transition[];
  selectedId: string | null;
  selectedTransitionId: string | null;
};

const MAX_HISTORY = 200;
const STORAGE_KEY = "dragotoba-quiz-maker:v1";
const DEFAULT_PROJECT_NAME = "Untitled Quiz";

type PersistedQuiz = {
  version: 1;
  projectName: string;
  boxes: CanvasBox[];
  variables: ProjectVariable[];
  defaultAnswers: AnswerOption[];
  transitions: Transition[];
  camera: Camera;
};

function createEmptyQuiz(): PersistedQuiz {
  return {
    version: 1,
    projectName: DEFAULT_PROJECT_NAME,
    boxes: [],
    variables: [],
    defaultAnswers: [createDefaultAnswer()],
    transitions: [],
    camera: { x: 0, y: 0, scale: 1 },
  };
}

function normalizeCanvasBox(raw: unknown): CanvasBox | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string" || typeof box.x !== "number" || typeof box.y !== "number") {
    return null;
  }

  if (box.kind === "transition") {
    return {
      id: box.id,
      x: box.x,
      y: box.y,
      kind: "transition",
      effects: Array.isArray(box.effects) ? (box.effects as AnswerEffect[]) : [],
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
          value: typeof c.value === "number" && Number.isFinite(c.value) ? c.value : 0,
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

function loadPersistedQuiz(): PersistedQuiz | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || data.version !== 1) return null;

    const cameraRaw =
      data.camera && typeof data.camera === "object"
        ? (data.camera as Record<string, unknown>)
        : null;
    const camera: Camera = {
      x: typeof cameraRaw?.x === "number" ? cameraRaw.x : 0,
      y: typeof cameraRaw?.y === "number" ? cameraRaw.y : 0,
      scale:
        typeof cameraRaw?.scale === "number"
          ? clamp(cameraRaw.scale, MIN_SCALE, MAX_SCALE)
          : 1,
    };

    const boxes = Array.isArray(data.boxes)
      ? data.boxes.map(normalizeCanvasBox).filter((b): b is CanvasBox => b !== null)
      : [];
    const transitions = Array.isArray(data.transitions)
      ? data.transitions
          .map(normalizeTransition)
          .filter((t): t is Transition => t !== null)
      : [];
    const defaultAnswers = Array.isArray(data.defaultAnswers)
      ? (data.defaultAnswers as AnswerOption[])
      : [createDefaultAnswer()];

    return {
      version: 1,
      projectName:
        typeof data.projectName === "string" && data.projectName.trim()
          ? data.projectName
          : DEFAULT_PROJECT_NAME,
      boxes,
      variables: Array.isArray(data.variables)
        ? (data.variables as ProjectVariable[])
        : [],
      defaultAnswers: defaultAnswers.length > 0 ? defaultAnswers : [createDefaultAnswer()],
      transitions,
      camera,
    };
  } catch {
    return null;
  }
}

function savePersistedQuiz(quiz: PersistedQuiz) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quiz));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return structuredClone(snapshot);
}

export default function CreateQuiz() {
  const [initialQuiz] = useState(() => loadPersistedQuiz() ?? createEmptyQuiz());
  const viewportRef = useRef<HTMLElement>(null);
  const varNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const ansNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const defaultAnsNameRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [projectName, setProjectName] = useState(initialQuiz.projectName);
  const [boxes, setBoxes] = useState<CanvasBox[]>(initialQuiz.boxes);
  const [camera, setCamera] = useState<Camera>(initialQuiz.camera);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [dragKind, setDragKind] = useState<"pan" | "box" | null>(null);
  const [draggingBoxId, setDraggingBoxId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [variables, setVariables] = useState<ProjectVariable[]>(initialQuiz.variables);
  const [defaultAnswers, setDefaultAnswers] = useState<AnswerOption[]>(
    initialQuiz.defaultAnswers,
  );
  const [transitions, setTransitions] = useState<Transition[]>(initialQuiz.transitions);
  const [transitionDraft, setTransitionDraft] = useState<TransitionDraft | null>(null);
  const [focusVarId, setFocusVarId] = useState<string | null>(null);
  const [focusAnsId, setFocusAnsId] = useState<string | null>(null);
  const [focusDefaultAnsId, setFocusDefaultAnsId] = useState<string | null>(null);
  const menuId = useId();

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const projectNameRef = useRef(projectName);
  const boxesRef = useRef(boxes);
  const variablesRef = useRef(variables);
  const defaultAnswersRef = useRef(defaultAnswers);
  const transitionsRef = useRef(transitions);
  const selectedIdRef = useRef(selectedId);
  const selectedTransitionIdRef = useRef(selectedTransitionId);
  const transitionDraftRef = useRef(transitionDraft);
  projectNameRef.current = projectName;
  boxesRef.current = boxes;
  variablesRef.current = variables;
  defaultAnswersRef.current = defaultAnswers;
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
  const selectedTransitionBlock =
    selectedBox?.kind === "transition" ? selectedBox : null;
  const selectedTransition =
    transitions.find((t) => t.id === selectedTransitionId) ?? null;

  function getPersistedQuiz(): PersistedQuiz {
    return {
      version: 1,
      projectName: projectNameRef.current,
      boxes: boxesRef.current,
      variables: variablesRef.current,
      defaultAnswers: defaultAnswersRef.current,
      transitions: transitionsRef.current,
      camera: cameraRef.current,
    };
  }

  function getSnapshot(): EditorSnapshot {
    return {
      projectName: projectNameRef.current,
      boxes: boxesRef.current,
      variables: variablesRef.current,
      defaultAnswers: defaultAnswersRef.current,
      transitions: transitionsRef.current,
      selectedId: selectedIdRef.current,
      selectedTransitionId: selectedTransitionIdRef.current,
    };
  }

  function applySnapshot(snapshot: EditorSnapshot) {
    applyingHistoryRef.current = true;
    const next = cloneSnapshot(snapshot);
    projectNameRef.current = next.projectName;
    boxesRef.current = next.boxes;
    variablesRef.current = next.variables;
    defaultAnswersRef.current = next.defaultAnswers;
    transitionsRef.current = next.transitions;
    selectedIdRef.current = next.selectedId;
    selectedTransitionIdRef.current = next.selectedTransitionId;
    setProjectName(next.projectName);
    setBoxes(next.boxes);
    setVariables(next.variables);
    setDefaultAnswers(next.defaultAnswers);
    setTransitions(next.transitions);
    setSelectedId(next.selectedId);
    setSelectedTransitionId(next.selectedTransitionId);
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
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
      savePersistedQuiz(getPersistedQuiz());
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [projectName, boxes, variables, defaultAnswers, transitions, camera]);

  useEffect(() => {
    const flush = () => savePersistedQuiz(getPersistedQuiz());
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
        answers: cloneAnswersWithNewIds(defaultAnswersRef.current),
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

  function duplicateQuestion() {
    if (!menu || menu.kind !== "box") return;
    const sourceId = menu.boxId;
    const source = boxesRef.current.find((box) => box.id === sourceId);
    if (!source) return;

    pushHistory();
    const id = crypto.randomUUID();
    const copy: CanvasBox =
      source.kind === "question"
        ? {
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
          }
        : {
            ...structuredClone(source),
            id,
            x: source.x + DUPLICATE_OFFSET,
            y: source.y + DUPLICATE_OFFSET,
            effects: source.effects.map((effect) => ({
              ...effect,
              id: crypto.randomUUID(),
            })),
          };
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
    const local = {
      x: menu.screenX - (viewportRef.current?.getBoundingClientRect().left ?? 0),
      y: menu.screenY - (viewportRef.current?.getBoundingClientRect().top ?? 0),
    };
    const world = screenToWorld(local.x, local.y, camera);
    setTransitionDraft({
      fromId,
      mouseX: world.x,
      mouseY: world.y,
    });
    setMenu(null);
  }

  function completeTransitionAt(worldX: number, worldY: number) {
    const draft = transitionDraftRef.current;
    if (!draft) return;

    const target = findNearestBox(boxesRef.current, worldX, worldY, draft.fromId);
    setTransitionDraft(null);
    if (!target) return;

    const alreadyExists = transitionsRef.current.some(
      (t) => t.fromId === draft.fromId && t.toId === target.id,
    );
    if (alreadyExists) return;

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
    const defaultVarId = variablesRef.current[0]?.id ?? "";
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
    const defaultVarId = variablesRef.current[0]?.id ?? "";
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
    const defaultVarId = variablesRef.current[0]?.id ?? "";
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === selectedId && box.kind === "transition"
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
        if (box.id !== selectedId || box.kind !== "transition") return box;
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
        box.id === selectedId && box.kind === "transition"
          ? {
              ...box,
              effects: box.effects.filter((effect) => effect.id !== effectId),
            }
          : box,
      ),
    );
  }

  function addVariable() {
    pushHistory();
    const id = crypto.randomUUID();
    setVariables((prev) => [
      ...prev,
      {
        id,
        name: nextVarName(prev),
        isBool: false,
        value: 0,
      },
    ]);
    setSettingsOpen(true);
    setFocusVarId(id);
  }

  function updateVariable(id: string, patch: Partial<ProjectVariable>) {
    setVariables((prev) =>
      prev.map((variable) => (variable.id === id ? { ...variable, ...patch } : variable)),
    );
  }

  function removeVariable(id: string) {
    pushHistory();
    setVariables((prev) => prev.filter((variable) => variable.id !== id));
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
    const defaultVarId = variablesRef.current[0]?.id ?? "";
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

  const cursorClass =
    dragKind === "pan"
      ? "cursor-grabbing"
      : dragKind === "box"
        ? "cursor-move"
        : "cursor-grab";

  return (
    <div className="relative h-screen w-full overflow-hidden bg-white">
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
                const from = boxes.find((box) => box.id === transitionDraft.fromId);
                if (!from) return null;
                const fromRect = boxRect(from);
                return (
                  <line
                    x1={fromRect.cx}
                    y1={fromRect.cy}
                    x2={transitionDraft.mouseX}
                    y2={transitionDraft.mouseY}
                    stroke="#000000"
                    strokeWidth={1.5}
                    markerEnd="url(#transition-arrowhead)"
                  />
                );
              })()}
          </svg>

          {boxes.map((box) => {
            const selected = selectedId === box.id;
            const isTransitionBlock = box.kind === "transition";
            const { width, height, lines } = isTransitionBlock
              ? {
                  width: EMPTY_HEIGHT * ASPECT,
                  height: EMPTY_HEIGHT,
                  lines: [] as string[],
                }
              : layoutBox(box.question);
            const label = isTransitionBlock ? "Transition" : lines.join("\n");

            return (
              <div
                key={box.id}
                draggable={false}
                className={`absolute flex touch-none items-center justify-center overflow-hidden rounded-2xl text-center select-none cursor-move ${
                  isTransitionBlock ? "bg-[#9a9a9a] text-white" : "bg-black text-white"
                } ${
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
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={duplicateQuestion}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={deleteQuestion}
                >
                  Delete
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={makeTransition}
                >
                  Make Transition
                </button>
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
              variables={variables}
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

      {selectedTransitionBlock && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Transition Block</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Effects
            </h2>
            <EffectsEditor
              effects={selectedTransitionBlock.effects}
              variables={variables}
              onCheckpoint={pushHistory}
              onAddEffect={addBlockEffect}
              onUpdateEffect={updateBlockEffect}
              onRemoveEffect={removeBlockEffect}
            />
          </section>
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
              variables={variables}
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
            <h1 className="text-lg font-semibold text-black">Project Settings</h1>

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
                      onFocus={() => pushHistory()}
                      onChange={(e) => updateVariable(variable.id, { name: e.target.value })}
                      className="min-w-0 flex-1 border-none bg-transparent px-1 py-0.5 text-sm text-black outline-none"
                    />
                    <label
                      className="flex shrink-0 items-center gap-1 text-xs text-black/70"
                      title="Boolean"
                    >
                      <input
                        type="checkbox"
                        checked={variable.isBool}
                        aria-label="Boolean variable"
                        onChange={(e) => {
                          const isBool = e.target.checked;
                          pushHistory();
                          updateVariable(variable.id, {
                            isBool,
                            value: isBool ? (variable.value !== 0 ? 1 : 0) : variable.value,
                          });
                        }}
                        className="cursor-pointer"
                      />
                      <span>bool</span>
                    </label>
                    {variable.isBool ? (
                      <input
                        type="checkbox"
                        checked={variable.value !== 0}
                        aria-label="Boolean value"
                        onChange={(e) => {
                          pushHistory();
                          updateVariable(variable.id, { value: e.target.checked ? 1 : 0 });
                        }}
                        className="h-4 w-4 shrink-0 cursor-pointer"
                      />
                    ) : (
                      <input
                        type="number"
                        step="any"
                        value={variable.value}
                        aria-label="Variable value"
                        onFocus={() => pushHistory()}
                        onChange={(e) => {
                          const next = e.target.value === "" ? 0 : Number(e.target.value);
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
                variables={variables}
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
          </div>
        </aside>
      </div>
    </div>
  );
}
