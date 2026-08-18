import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  findQuestionBox,
  startQuiz,
  submitAnswer,
  type QuizPlayScreen,
  type QuizQuestionScreen,
} from "@/lib/quizEngine";
import {
  DEFAULT_PROJECT_NAME,
  emptyListing,
  emptySection,
  getStoredQuiz,
  nextSectionName,
  normalizeListing,
  saveStoredQuiz,
  type QuizListing,
  type StoredQuizDocument,
} from "@/lib/quizStorage";
import { getToken } from "@/lib/auth";

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
  /** "next", results, or a specific section id. */
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

function formatVariablePreviewValue(variable: ProjectVariable | undefined) {
  if (!variable) return "";
  if (variable.type === "bool") return variable.value ? "true" : "false";
  return String(variable.value ?? "");
}

function formatAxisPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function axisPercentageFromVariable(variable: ProjectVariable | undefined) {
  if (!variable) return 0;
  let n = 0;
  if (variable.type === "bool") {
    n = variable.value ? 100 : 0;
  } else {
    n = Number(variable.value);
  }
  if (!Number.isFinite(n)) n = 0;
  return clamp(n, 0, 100);
}

function variableNumericValue(variable: ProjectVariable | undefined) {
  if (!variable) return 0;
  if (variable.type === "bool") return variable.value ? 1 : 0;
  const n = Number(variable.value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBarBound(raw: unknown, fallback: number) {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function formatBarNumber(n: number) {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

function formatBarReadout(
  variable: ProjectVariable | undefined,
  asPercent: boolean,
) {
  if (asPercent) {
    const n =
      variable?.type === "bool" ? (variable.value ? 100 : 0) : variableNumericValue(variable);
    return `${formatBarNumber(n)}%`;
  }
  return formatBarNumber(variableNumericValue(variable));
}

function barUsesNegativeLayout(
  variable: ProjectVariable | undefined,
  asPercent: boolean,
  min: number,
  max: number,
) {
  if (asPercent) return false;
  return Math.min(min, max) < 0 && variableNumericValue(variable) < 0;
}

function barFillGeometry(
  variable: ProjectVariable | undefined,
  asPercent: boolean,
  min: number,
  max: number,
): { direction: "up" | "down"; ratio: number } {
  if (asPercent) {
    return {
      direction: "up",
      ratio: axisPercentageFromVariable(variable) / 100,
    };
  }
  const n = variableNumericValue(variable);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (n >= 0) {
    const top = Math.max(hi, 0);
    if (top === 0) return { direction: "up", ratio: n > 0 ? 1 : 0 };
    return { direction: "up", ratio: clamp(n / top, 0, 1) };
  }
  if (lo >= 0) {
    return { direction: "up", ratio: 0 };
  }
  return {
    direction: "down",
    ratio: clamp(Math.abs(n) / Math.abs(lo), 0, 1),
  };
}

/** 0,0 is bottom-left; 100,100 is top-right. Values are clamped to the square. */
function compassDotStyle(
  xVariable: ProjectVariable | undefined,
  yVariable: ProjectVariable | undefined,
  width: number,
  height: number,
): CSSProperties {
  const x = axisPercentageFromVariable(xVariable);
  const y = axisPercentageFromVariable(yVariable);
  const pad = RESULTS_COMPASS_DOT_SIZE / 2;
  return {
    width: RESULTS_COMPASS_DOT_SIZE,
    height: RESULTS_COMPASS_DOT_SIZE,
    left: pad + (x / 100) * Math.max(0, width - RESULTS_COMPASS_DOT_SIZE),
    top: pad + ((100 - y) / 100) * Math.max(0, height - RESULTS_COMPASS_DOT_SIZE),
  };
}

function parseHexColor(raw: unknown, allowShort = true): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  if (value[0] !== "#") value = `#${value}`;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (allowShort && /^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase();
  }
  return null;
}

function normalizeStoredColor(raw: unknown, fallback: string): string {
  return parseHexColor(raw) ?? fallback;
}

function contrastTextOn(hex: string): string {
  const parsed = parseHexColor(hex) ?? "#000000";
  const r = parseInt(parsed.slice(1, 3), 16) / 255;
  const g = parseInt(parsed.slice(3, 5), 16) / 255;
  const b = parseInt(parsed.slice(5, 7), 16) / 255;
  const toLinear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.45 ? "#111111" : "#ffffff";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const parsed = parseHexColor(hex);
  if (!parsed) return null;
  return {
    r: parseInt(parsed.slice(1, 3), 16),
    g: parseInt(parsed.slice(3, 5), 16),
    b: parseInt(parsed.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d + 6) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

function hsvToHex(h: number, s: number, v: number): string {
  const rgb = hsvToRgb(h, s, v);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  return rgbToHsv(rgb.r, rgb.g, rgb.b);
}

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
  fallback: boolean;
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
  | {
      kind: "results-canvas";
      screenX: number;
      screenY: number;
      contentX: number;
      contentY: number;
    }
  | {
      kind: "results-text";
      screenX: number;
      screenY: number;
      textId: string;
    }
  | {
      kind: "results-axis";
      screenX: number;
      screenY: number;
      axisId: string;
    }
  | {
      kind: "results-compass";
      screenX: number;
      screenY: number;
      compassId: string;
    }
  | {
      kind: "results-bar";
      screenX: number;
      screenY: number;
      barId: string;
    }
  | {
      kind: "results-image";
      screenX: number;
      screenY: number;
      imageId: string;
    }
  | null;

const DUPLICATE_OFFSET = 28;
const RESULTS_VIEW_ID = "__results__";
const RESULTS_TEXT_DEFAULT_WIDTH = 280;
const RESULTS_TEXT_DEFAULT_HEIGHT = 120;
const RESULTS_TEXT_MIN_WIDTH = 120;
const RESULTS_TEXT_MIN_HEIGHT = 72;
const RESULTS_TEXT_MAX_HEIGHT = 600;
const RESULTS_TEXT_IMAGE_GAP = 8;
const RESULTS_TEXT_IMAGE_DEFAULT_SIZE = 96;
const RESULTS_IMAGE_DEFAULT_SIZE = 160;
const RESULTS_IMAGE_MIN_SIZE = 32;
const RESULTS_IMAGE_MAX_SIZE = 720;
const RESULTS_AXIS_DEFAULT_WIDTH = 560;
const RESULTS_AXIS_DEFAULT_HEIGHT = 48;
const RESULTS_AXIS_MIN_WIDTH = 120;
const RESULTS_AXIS_MIN_HEIGHT = 24;
const RESULTS_AXIS_MAX_HEIGHT = 600;
const RESULTS_AXIS_LABEL_MIN_HEIGHT = 36;
const RESULTS_AXIS_LABEL_GAP = 8;
const RESULTS_AXIS_LABEL_OFFSET =
  RESULTS_AXIS_LABEL_MIN_HEIGHT + RESULTS_AXIS_LABEL_GAP;
const RESULTS_AXIS_IMAGE_GAP = 8;
const RESULTS_COMPASS_DEFAULT_SIZE = 280;
const RESULTS_COMPASS_MIN_SIZE = 140;
const RESULTS_COMPASS_MAX_SIZE = 720;
const RESULTS_COMPASS_SIDE_LABEL_WIDTH = 132;
const RESULTS_COMPASS_LABEL_GAP = 8;
const RESULTS_COMPASS_LABEL_OFFSET =
  RESULTS_AXIS_LABEL_MIN_HEIGHT + RESULTS_COMPASS_LABEL_GAP;
const RESULTS_COMPASS_DOT_SIZE = 14;
const RESULTS_BAR_DEFAULT_WIDTH = 80;
const RESULTS_BAR_DEFAULT_HEIGHT = 220;
const RESULTS_BAR_MIN_WIDTH = 36;
const RESULTS_BAR_MIN_HEIGHT = 80;
const RESULTS_BAR_MAX_HEIGHT = 720;
const RESULTS_BAR_LABEL_GAP = 8;
const RESULTS_BAR_LABEL_OFFSET =
  RESULTS_AXIS_LABEL_MIN_HEIGHT + RESULTS_BAR_LABEL_GAP;
const RESULTS_BAR_IMAGE_GAP = 8;
const RESULTS_BAR_TRACK_INSET = 8;
const RESULTS_AXIS_LEFT_COLOR = "#2f5d76";
const RESULTS_AXIS_RIGHT_COLOR = "#7a9aad";
const RESULTS_COMPASS_TOP_LEFT_COLOR = "#f4b4ae";
const RESULTS_COMPASS_TOP_RIGHT_COLOR = "#7ec8e3";
const RESULTS_COMPASS_BOTTOM_LEFT_COLOR = "#c4e572";
const RESULTS_COMPASS_BOTTOM_RIGHT_COLOR = "#cbb6e8";
const RESULTS_PRESET_COLORS = [
  "#ffffff",
  "#111111",
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#27ae60",
  "#3498db",
  "#9b59b6",
  RESULTS_AXIS_LEFT_COLOR,
  RESULTS_AXIS_RIGHT_COLOR,
  RESULTS_COMPASS_TOP_LEFT_COLOR,
  RESULTS_COMPASS_TOP_RIGHT_COLOR,
  RESULTS_COMPASS_BOTTOM_LEFT_COLOR,
  RESULTS_COMPASS_BOTTOM_RIGHT_COLOR,
  "#94a3b8",
  "#f5f5a7",
] as const;
const COLOR_WHEEL_SIZE = 220;
const COLOR_WHEEL_RING = 20;
const COLOR_WHEEL_GAP = 16;
const RESULTS_SIDEBAR_EDITOR_MAX_HEIGHT = 240;
const RESULTS_FONT_SIZE_DEFAULT = 14;
const RESULTS_FONT_SIZE_MIN = 1;
const RESULTS_FONT_SIZE_MAX = 128;
const RESULTS_PAGE_BOTTOM_PAD = 320;
const RESULTS_GRID_TICKS_DEFAULT = 16;
const RESULTS_GRID_TICKS_MIN = 1;
const RESULTS_GRID_TICKS_MAX = 256;
const SIDEBAR_WIDTH = 320;

type ResultsResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type ResultsItemKind = "text" | "axis" | "compass" | "bar" | "image" | "text-image";

type DragState = {
  type: "pan" | "box" | "results-text" | "results-resize";
  pointerId: number;
  boxId?: string;
  resultsItemKind?: ResultsItemKind;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  moved: boolean;
  resizeHandle?: ResultsResizeHandle;
  originX?: number;
  originY?: number;
  originWidth?: number;
  originHeight?: number;
  resizeCursor?: string;
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

function clampResultsTextBoxPosition(
  x: number,
  y: number,
  width: number,
  pageWidth: number,
  pageHeight: number,
  boxHeight: number,
  minY = 0,
  minX = 0,
) {
  return {
    x: clamp(x, minX, Math.max(minX, pageWidth - width)),
    y: clamp(y, minY, Math.max(minY, pageHeight - boxHeight)),
  };
}

function resultsAxisImagePad(
  axis: Pick<ResultsAxis, "showImages" | "height"> | undefined | null,
) {
  if (!axis?.showImages) return 0;
  return Math.max(RESULTS_AXIS_MIN_HEIGHT, axis.height) + RESULTS_AXIS_IMAGE_GAP;
}

function clampResultsAxisForImages(axis: ResultsAxis, pageWidth: number) {
  const pad = resultsAxisImagePad(axis);
  if (pad <= 0) return axis;
  const maxWidth = Math.max(RESULTS_AXIS_MIN_WIDTH, pageWidth - 2 * pad);
  const width = Math.min(axis.width, maxWidth);
  const x = clamp(axis.x, pad, Math.max(pad, pageWidth - pad - width));
  if (x === axis.x && width === axis.width) return axis;
  return { ...axis, x, width };
}

function normalizeResultsImageDim(raw: unknown, fallback: number) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return clamp(Math.round(raw), RESULTS_IMAGE_MIN_SIZE, RESULTS_IMAGE_MAX_SIZE);
  }
  return fallback;
}

function normalizeResultsFontSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return RESULTS_FONT_SIZE_DEFAULT;
  return clamp(Math.round(n), RESULTS_FONT_SIZE_MIN, RESULTS_FONT_SIZE_MAX);
}

function normalizeResultsTextAlign(raw: unknown): ResultsTextAlign {
  if (raw === "center" || raw === "right") return raw;
  return "left";
}

function resultsTextAttachedImageRect(box: {
  x: number;
  y: number;
  width: number;
  height: number;
  imageAbove: boolean;
  imageWidth: number;
  imageHeight: number;
  imageOffsetX: number;
}) {
  const width = normalizeResultsImageDim(box.imageWidth, RESULTS_TEXT_IMAGE_DEFAULT_SIZE);
  const height = normalizeResultsImageDim(
    box.imageHeight,
    RESULTS_TEXT_IMAGE_DEFAULT_SIZE,
  );
  return {
    x: box.x + box.imageOffsetX,
    y: box.imageAbove
      ? box.y - RESULTS_TEXT_IMAGE_GAP - height
      : box.y + box.height + RESULTS_TEXT_IMAGE_GAP,
    width,
    height,
  };
}

function resultsGridSteps(
  pageWidth: number,
  viewportHeight: number,
  horizontalTicks: number,
  verticalTicks: number,
) {
  return {
    stepX: Math.max(
      1,
      pageWidth / clamp(horizontalTicks, RESULTS_GRID_TICKS_MIN, RESULTS_GRID_TICKS_MAX),
    ),
    stepY: Math.max(
      1,
      viewportHeight / clamp(verticalTicks, RESULTS_GRID_TICKS_MIN, RESULTS_GRID_TICKS_MAX),
    ),
  };
}

function snapToGrid(value: number, step: number) {
  return Math.round(value / step) * step;
}

type ResultsSnapAnchor =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right";

const RESULTS_SNAP_ANCHORS: ResultsSnapAnchor[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "top",
  "bottom",
  "left",
  "right",
];

function anchorPointOnBox(
  anchor: ResultsSnapAnchor,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  switch (anchor) {
    case "top-left":
      return { x, y };
    case "top-right":
      return { x: x + width, y };
    case "bottom-left":
      return { x, y: y + height };
    case "bottom-right":
      return { x: x + width, y: y + height };
    case "top":
      return { x: x + width / 2, y };
    case "bottom":
      return { x: x + width / 2, y: y + height };
    case "left":
      return { x, y: y + height / 2 };
    case "right":
      return { x: x + width, y: y + height / 2 };
  }
}

function boxPositionFromAnchorOnGrid(
  anchor: ResultsSnapAnchor,
  gridX: number,
  gridY: number,
  width: number,
  height: number,
) {
  switch (anchor) {
    case "top-left":
      return { x: gridX, y: gridY };
    case "top-right":
      return { x: gridX - width, y: gridY };
    case "bottom-left":
      return { x: gridX, y: gridY - height };
    case "bottom-right":
      return { x: gridX - width, y: gridY - height };
    case "top":
      return { x: gridX - width / 2, y: gridY };
    case "bottom":
      return { x: gridX - width / 2, y: gridY - height };
    case "left":
      return { x: gridX, y: gridY - height / 2 };
    case "right":
      return { x: gridX - width, y: gridY - height / 2 };
  }
}

/** Snap by aligning the nearest corner or edge midpoint to the grid point closest to the mouse. */
function snapResultsBoxToGrid(
  x: number,
  y: number,
  width: number,
  height: number,
  mouseX: number,
  mouseY: number,
  stepX: number,
  stepY: number,
) {
  let best = { x, y };
  let bestDist = Infinity;

  for (const anchor of RESULTS_SNAP_ANCHORS) {
    const point = anchorPointOnBox(anchor, x, y, width, height);
    const gridX = snapToGrid(point.x, stepX);
    const gridY = snapToGrid(point.y, stepY);
    const dist = Math.hypot(mouseX - gridX, mouseY - gridY);
    if (dist < bestDist) {
      bestDist = dist;
      best = boxPositionFromAnchorOnGrid(anchor, gridX, gridY, width, height);
    }
  }

  return best;
}

function fixedCornerForResizeHandle(
  handle: ResultsResizeHandle,
  origin: { x: number; y: number; width: number; height: number },
): { corner: ResultsSnapAnchor; point: { x: number; y: number } } {
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  switch (handle) {
    case "nw":
      return { corner: "bottom-right", point: { x: right, y: bottom } };
    case "ne":
      return { corner: "bottom-left", point: { x: origin.x, y: bottom } };
    case "sw":
      return { corner: "top-right", point: { x: right, y: origin.y } };
    case "se":
    default:
      return { corner: "top-left", point: { x: origin.x, y: origin.y } };
  }
}

function movingAnchorsForResizeHandle(handle: ResultsResizeHandle): ResultsSnapAnchor[] {
  switch (handle) {
    case "nw":
      return ["top-left", "top", "left"];
    case "ne":
      return ["top-right", "top", "right"];
    case "sw":
      return ["bottom-left", "bottom", "left"];
    case "se":
      return ["bottom-right", "bottom", "right"];
    default:
      return [];
  }
}

function rectFromFixedCornerAndAnchor(
  fixed: ResultsSnapAnchor,
  fixedPoint: { x: number; y: number },
  anchor: ResultsSnapAnchor,
  gridPoint: { x: number; y: number },
) {
  const { x: gx, y: gy } = gridPoint;
  const { x: fx, y: fy } = fixedPoint;

  if (fixed === "top-left") {
    if (anchor === "bottom-right") return { x: fx, y: fy, width: gx - fx, height: gy - fy };
    if (anchor === "bottom") return { x: fx, y: fy, width: 2 * (gx - fx), height: gy - fy };
    if (anchor === "right") return { x: fx, y: fy, width: gx - fx, height: 2 * (gy - fy) };
  }
  if (fixed === "top-right") {
    if (anchor === "bottom-left") return { x: gx, y: fy, width: fx - gx, height: gy - fy };
    if (anchor === "bottom") return { x: 2 * gx - fx, y: fy, width: fx - gx, height: gy - fy };
    if (anchor === "left") return { x: gx, y: fy, width: fx - gx, height: 2 * (gy - fy) };
  }
  if (fixed === "bottom-left") {
    if (anchor === "top-right") return { x: fx, y: gy, width: gx - fx, height: fy - gy };
    if (anchor === "top") return { x: fx, y: gy, width: 2 * (gx - fx), height: fy - gy };
    if (anchor === "right") return { x: fx, y: 2 * gy - fy, width: gx - fx, height: fy - gy };
  }
  if (fixed === "bottom-right") {
    if (anchor === "top-left") return { x: gx, y: gy, width: fx - gx, height: fy - gy };
    if (anchor === "top") return { x: 2 * gx - fx, y: gy, width: fx - gx, height: fy - gy };
    if (anchor === "left") return { x: gx, y: 2 * gy - fy, width: fx - gx, height: fy - gy };
  }

  return null;
}

function clampSnappedRect(
  rect: { x: number; y: number; width: number; height: number },
  minWidth: number,
  minHeight: number,
  maxHeight: number,
) {
  const width = Math.max(minWidth, rect.width);
  const height = clamp(rect.height, minHeight, maxHeight);
  return { x: rect.x, y: rect.y, width, height };
}

function snapResultsResizeToGrid(
  handle: ResultsResizeHandle,
  rect: { x: number; y: number; width: number; height: number },
  origin: { x: number; y: number; width: number; height: number },
  mouseX: number,
  mouseY: number,
  stepX: number,
  stepY: number,
  minWidth: number,
  minHeight: number,
  maxHeight: number,
) {
  const movingAnchors = movingAnchorsForResizeHandle(handle);
  if (movingAnchors.length > 0) {
    const fixed = fixedCornerForResizeHandle(handle, origin);
    let best = rect;
    let bestDist = Infinity;

    for (const anchor of movingAnchors) {
      const point = anchorPointOnBox(anchor, rect.x, rect.y, rect.width, rect.height);
      const gridX = snapToGrid(point.x, stepX);
      const gridY = snapToGrid(point.y, stepY);
      const candidate = rectFromFixedCornerAndAnchor(fixed.corner, fixed.point, anchor, {
        x: gridX,
        y: gridY,
      });
      if (!candidate) continue;
      const snapped = clampSnappedRect(candidate, minWidth, minHeight, maxHeight);
      const dist = Math.hypot(mouseX - gridX, mouseY - gridY);
      if (dist < bestDist) {
        bestDist = dist;
        best = snapped;
      }
    }

    return best;
  }

  let { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes("e")) {
    width = Math.max(minWidth, snapToGrid(right, stepX) - x);
  }
  if (handle.includes("w")) {
    const snappedLeft = snapToGrid(x, stepX);
    width = Math.max(minWidth, right - snappedLeft);
    x = right - width;
  }
  if (handle.includes("s")) {
    height = clamp(snapToGrid(bottom, stepY) - y, minHeight, maxHeight);
  }
  if (handle.includes("n")) {
    height = clamp(bottom - snapToGrid(y, stepY), minHeight, maxHeight);
    y = bottom - height;
  }

  return { x, y, width, height };
}

function resizeResultsTextBox(
  handle: ResultsResizeHandle,
  origin: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
  snapSteps?: { stepX: number; stepY: number; mouseX: number; mouseY: number } | null,
  sizeLimits: {
    minWidth: number;
    minHeight: number;
    maxHeight: number;
    minY?: number;
    minX?: number;
    square?: boolean;
  } = {
    minWidth: RESULTS_TEXT_MIN_WIDTH,
    minHeight: RESULTS_TEXT_MIN_HEIGHT,
    maxHeight: RESULTS_TEXT_MAX_HEIGHT,
  },
) {
  const { minWidth, minHeight, maxHeight } = sizeLimits;
  const minY = sizeLimits.minY ?? 0;
  const minX = sizeLimits.minX ?? 0;
  const right = origin.x + origin.width;
  const bottom = origin.y + origin.height;
  let x = origin.x;
  let y = origin.y;
  let width = origin.width;
  let height = origin.height;

  if (handle.includes("e")) {
    width = clamp(origin.width + dx, minWidth, pageWidth - origin.x);
  }
  if (handle.includes("w")) {
    width = clamp(origin.width - dx, minWidth, right - minX);
    x = right - width;
    if (x < minX) {
      x = minX;
      width = right - minX;
    }
  }
  if (handle.includes("s")) {
    height = clamp(
      origin.height + dy,
      minHeight,
      Math.max(minHeight, pageHeight - origin.y),
    );
  }
  if (handle.includes("n")) {
    height = clamp(origin.height - dy, minHeight, bottom - minY);
    y = bottom - height;
    if (y < minY) {
      y = minY;
      height = bottom - minY;
    }
  }

  if (snapSteps) {
    ({ x, y, width, height } = snapResultsResizeToGrid(
      handle,
      { x, y, width, height },
      origin,
      snapSteps.mouseX,
      snapSteps.mouseY,
      snapSteps.stepX,
      snapSteps.stepY,
      minWidth,
      minHeight,
      maxHeight,
    ));
  }

  if (sizeLimits.square) {
    const minSize = Math.max(minWidth, minHeight);
    const maxSize = Math.min(
      maxHeight,
      Math.max(minSize, pageWidth - minX),
      Math.max(minSize, pageHeight - minY),
    );
    const size = clamp(
      handle.includes("n") || handle.includes("s") ? height : width,
      minSize,
      maxSize,
    );
    width = size;
    height = size;
    x = handle.includes("w") ? right - size : origin.x;
    y = handle.includes("n") ? bottom - size : origin.y;
  }

  width = clamp(width, minWidth, pageWidth);
  height = clamp(height, minHeight, maxHeight);
  const clamped = clampResultsTextBoxPosition(
    x,
    y,
    width,
    pageWidth,
    pageHeight,
    height,
    minY,
    minX,
  );
  return { ...clamped, width, height };
}

const RESULTS_RESIZE_HANDLES: {
  handle: ResultsResizeHandle;
  className: string;
  cursor: string;
}[] = [
  { handle: "n", className: "left-3 right-3 -top-1 h-2", cursor: "ns-resize" },
  { handle: "s", className: "left-3 right-3 -bottom-1 h-2", cursor: "ns-resize" },
  { handle: "e", className: "top-3 bottom-3 -right-1 w-2", cursor: "ew-resize" },
  { handle: "w", className: "top-3 bottom-3 -left-1 w-2", cursor: "ew-resize" },
  {
    handle: "nw",
    className: "-left-1.5 -top-1.5 h-3 w-3 rounded-sm border border-[#2f5d76]/40 bg-white",
    cursor: "nwse-resize",
  },
  {
    handle: "ne",
    className: "-right-1.5 -top-1.5 h-3 w-3 rounded-sm border border-[#2f5d76]/40 bg-white",
    cursor: "nesw-resize",
  },
  {
    handle: "sw",
    className: "-left-1.5 -bottom-1.5 h-3 w-3 rounded-sm border border-[#2f5d76]/40 bg-white",
    cursor: "nesw-resize",
  },
  {
    handle: "se",
    className: "-right-1.5 -bottom-1.5 h-3 w-3 rounded-sm border border-[#2f5d76]/40 bg-white",
    cursor: "nwse-resize",
  },
];

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

function normalizeResultsTextSegments(
  segments: ResultsTextSegment[],
): ResultsTextSegment[] {
  const merged: ResultsTextSegment[] = [];
  for (const segment of segments) {
    if (segment.kind === "text") {
      const prev = merged[merged.length - 1];
      if (prev && prev.kind === "text") {
        merged[merged.length - 1] = {
          ...prev,
          text: prev.text + segment.text,
        };
      } else {
        merged.push({ ...segment });
      }
      continue;
    }
    merged.push({ ...segment });
  }
  if (merged.length === 0 || merged[merged.length - 1].kind !== "text") {
    merged.push({ id: crypto.randomUUID(), kind: "text", text: "" });
  }
  return merged;
}

function textCharsBefore(
  segments: ResultsTextSegment[],
  segmentIndex: number,
  offset: number,
) {
  let count = 0;
  for (let i = 0; i < segmentIndex; i++) {
    const segment = segments[i];
    if (segment?.kind === "text") count += segment.text.length;
  }
  return count + Math.max(0, offset);
}

function fieldLineMetrics(
  field: HTMLElement,
  clientY: number,
) {
  const style = window.getComputedStyle(field);
  const fontSize = Number.parseFloat(style.fontSize) || 14;
  const parsedLineHeight = Number.parseFloat(style.lineHeight);
  const lineHeight =
    Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
      ? parsedLineHeight
      : fontSize * 1.25;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const rect = field.getBoundingClientRect();
  const y = clientY - rect.top - paddingTop + (field as HTMLElement & { scrollTop?: number }).scrollTop;
  const lineIndex = Math.max(0, Math.floor(y / lineHeight));
  const top = paddingTop + lineIndex * lineHeight;
  return {
    top: Math.max(0, top),
    height: lineHeight,
  };
}

function caretOffsetInTextNode(clientX: number, clientY: number, fallbackLength: number) {
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      return range.startOffset;
    }
  }
  if (typeof document.caretPositionFromPoint === "function") {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos?.offsetNode?.nodeType === Node.TEXT_NODE) {
      return pos.offset;
    }
  }
  return fallbackLength;
}

function moveVariableInSegments(
  segments: ResultsTextSegment[],
  fromIndex: number,
  targetSegmentIndex: number,
  targetOffset: number,
): ResultsTextSegment[] {
  const dragged = segments[fromIndex];
  if (!dragged || dragged.kind !== "variable") return segments;

  const remaining = segments.filter((_, index) => index !== fromIndex);
  let segmentIndex = targetSegmentIndex;
  let offset = targetOffset;
  if (fromIndex < targetSegmentIndex) segmentIndex -= 1;
  segmentIndex = Math.max(0, Math.min(segmentIndex, remaining.length));

  if (segmentIndex >= remaining.length) {
    segmentIndex = remaining.length - 1;
    const last = remaining[segmentIndex];
    offset = last?.kind === "text" ? last.text.length : 0;
  } else if (remaining[segmentIndex]?.kind === "variable") {
    offset = 0;
  } else {
    const text = remaining[segmentIndex];
    if (text?.kind === "text") {
      offset = Math.max(0, Math.min(offset, text.text.length));
    } else {
      offset = 0;
    }
  }

  if (textCharsBefore(remaining, segmentIndex, offset) === 0) {
    return normalizeResultsTextSegments([dragged, ...remaining]);
  }

  const target = remaining[segmentIndex];
  if (!target || target.kind !== "text") {
    const next = [...remaining];
    next.splice(segmentIndex, 0, dragged);
    return normalizeResultsTextSegments(next);
  }

  const left = target.text.slice(0, offset);
  const right = target.text.slice(offset);
  const next: ResultsTextSegment[] = [
    ...remaining.slice(0, segmentIndex),
    { id: crypto.randomUUID(), kind: "text", text: left },
    dragged,
    { id: target.id, kind: "text", text: right },
    ...remaining.slice(segmentIndex + 1),
  ];
  return normalizeResultsTextSegments(next);
}

function MeasuredGrowBox({
  id,
  onHeight,
  className,
  style,
  children,
}: {
  id: string;
  onHeight: (id: string, height: number) => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      onHeight(id, Math.max(RESULTS_AXIS_LABEL_MIN_HEIGHT, Math.round(h)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, onHeight]);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

function BoundNumberInput({
  label,
  value,
  onCheckpoint,
  onChange,
}: {
  label: string;
  value: number;
  onCheckpoint: () => void;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function commit(raw: string) {
    const n = Number(raw);
    const next = Number.isFinite(n) ? n : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <label className="block text-sm text-black">
      <span className="text-black/70">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onFocus={() => onCheckpoint()}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => commit(draft)}
        className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
      />
    </label>
  );
}

function firstImageFile(files: FileList | null | undefined) {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}

function firstClipboardImage(data: DataTransfer | null | undefined) {
  if (!data) return null;
  const items = data.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      return item.getAsFile();
    }
  }
  return firstImageFile(data.files);
}

function AxisImagePicker({
  label,
  value,
  onCheckpoint,
  onChange,
}: {
  label: string;
  value: string;
  onCheckpoint: () => void;
  onChange: (dataUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const onCheckpointRef = useRef(onCheckpoint);
  const onChangeRef = useRef(onChange);
  const [open, setOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  onCheckpointRef.current = onCheckpoint;
  onChangeRef.current = onChange;

  function closePicker() {
    dragDepthRef.current = 0;
    setDragOver(false);
    setOpen(false);
  }

  function commitFile(file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    onCheckpointRef.current();
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) {
        onChangeRef.current(result);
        closePicker();
      }
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = firstClipboardImage(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      commitFile(file);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closePicker();
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mt-3">
      <div className="text-sm text-black/70">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-black/15 bg-white">
          {value ? (
            <img
              src={value}
              alt=""
              draggable={false}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-[10px] text-black/35">None</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
        >
          Choose image
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => {
              onCheckpoint();
              onChange("");
            }}
            className="cursor-pointer rounded-lg px-2 py-2 text-sm font-medium text-black/60 hover:bg-black/5 hover:text-black"
          >
            Clear
          </button>
        ) : null}
      </div>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
            role="presentation"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={closePicker}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => e.preventDefault()}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="axis-image-picker-title"
              className="w-full max-w-md rounded-xl border border-black/10 bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2
                id="axis-image-picker-title"
                className="text-lg font-semibold text-black"
              >
                {label}
              </h2>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label={`Browse ${label}`}
                onChange={(e) => {
                  const file = firstImageFile(e.target.files);
                  e.target.value = "";
                  commitFile(file);
                }}
              />
              <div
                className={`mt-4 flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
                  dragOver
                    ? "border-[#2f5d76] bg-[#2f5d76]/10"
                    : "border-black/20 bg-[#fafafa]"
                }`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  dragDepthRef.current += 1;
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={() => {
                  dragDepthRef.current -= 1;
                  if (dragDepthRef.current <= 0) {
                    dragDepthRef.current = 0;
                    setDragOver(false);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  dragDepthRef.current = 0;
                  setDragOver(false);
                  commitFile(firstImageFile(e.dataTransfer.files));
                }}
              >
                <p className="text-sm font-medium text-black">
                  {dragOver ? "Drop image" : "Drop or paste an image"}
                </p>
                {!dragOver && (
                  <p className="mt-1 text-xs text-black/50">
                    Paste with Ctrl+V, or browse your files
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="mt-4 cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
                >
                  Choose file
                </button>
              </div>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={closePicker}
                  className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function CoverImageField({
  value,
  onCheckpoint,
  onChange,
}: {
  value: string;
  onCheckpoint: () => void;
  onChange: (dataUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  function commitFile(file: File | null) {
    if (!file || !file.type.startsWith("image/")) return;
    onCheckpoint();
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (result) onChange(result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Browse front image"
        onChange={(e) => {
          const file = firstImageFile(e.target.files);
          e.target.value = "";
          commitFile(file);
        }}
      />
      <div
        className={`relative flex min-h-44 w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
          dragOver
            ? "border-[#2f5d76] bg-[#2f5d76]/10"
            : "border-black/20 bg-[#fafafa]"
        }`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepthRef.current += 1;
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          dragDepthRef.current -= 1;
          if (dragDepthRef.current <= 0) {
            dragDepthRef.current = 0;
            setDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepthRef.current = 0;
          setDragOver(false);
          commitFile(firstImageFile(e.dataTransfer.files));
        }}
      >
        {value ? (
          <img
            src={value}
            alt=""
            draggable={false}
            className="h-48 w-full object-cover"
          />
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-black">
              {dragOver ? "Drop image" : "Front image"}
            </p>
            <p className="mt-1 text-xs text-black/50">
              Drop an image, or choose a file
            </p>
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
        >
          {value ? "Change image" : "Choose image"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => {
              onCheckpoint();
              onChange("");
            }}
            className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-black/60 hover:bg-black/5 hover:text-black"
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AxisSideImage({
  side,
  src,
  size,
  showPlaceholder,
}: {
  side: "left" | "right";
  src: string;
  size: number;
  showPlaceholder: boolean;
}) {
  if (!src && !showPlaceholder) return null;
  const isLeft = side === "left";
  return (
    <div
      className={`absolute top-1/2 -translate-y-1/2 overflow-hidden rounded-md ${
        src ? "border border-black/15 bg-white" : "border border-dashed border-black/25 bg-white/70"
      }`}
      style={{
        [isLeft ? "right" : "left"]: "100%",
        [isLeft ? "marginRight" : "marginLeft"]: RESULTS_AXIS_IMAGE_GAP,
        width: size,
        height: size,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full object-contain"
        />
      ) : null}
    </div>
  );
}

function BarLabelImage({
  src,
  size,
  showPlaceholder,
}: {
  src: string;
  size: number;
  showPlaceholder: boolean;
}) {
  if (!src && !showPlaceholder) return null;
  return (
    <div
      className={`shrink-0 overflow-hidden rounded-md ${
        src
          ? "border border-black/15 bg-white"
          : "border border-dashed border-black/25 bg-white/70"
      }`}
      style={{
        width: size,
        height: size,
        marginTop: RESULTS_BAR_IMAGE_GAP,
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="h-full w-full object-contain"
        />
      ) : null}
    </div>
  );
}

function ResultsCanvasImage({
  src,
  preview,
  selected,
  onResizePointerDown,
}: {
  src: string;
  preview: boolean;
  selected: boolean;
  onResizePointerDown?: (
    e: React.PointerEvent<HTMLElement>,
    handle: ResultsResizeHandle,
  ) => void;
}) {
  return (
    <div className="relative h-full w-full">
      <div
        className={`h-full w-full overflow-hidden rounded-lg ${
          preview
            ? src
              ? ""
              : "border border-dashed border-black/20 bg-white/50"
            : selected
              ? "border border-[#2f5d76] bg-white shadow-sm ring-2 ring-[#2f5d76]/ring-offset-1"
              : "border border-black/15 bg-white shadow-sm"
        }`}
      >
        {src ? (
          <img
            src={src}
            alt=""
            draggable={false}
            className="h-full w-full object-contain"
          />
        ) : preview ? null : (
          <div className="flex h-full w-full items-center justify-center text-xs text-black/35">
            No image
          </div>
        )}
      </div>
      {selected &&
        !preview &&
        onResizePointerDown &&
        RESULTS_RESIZE_HANDLES.map(({ handle, className, cursor }) => (
          <div
            key={handle}
            data-results-resize={handle}
            className={`absolute z-10 ${className}`}
            style={{ cursor }}
            onPointerDown={(e) => onResizePointerDown(e, handle)}
          />
        ))}
    </div>
  );
}

function AxisLabelGrowRow({
  axisId,
  onHeight,
  children,
}: {
  axisId: string;
  onHeight: (axisId: string, height: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      onHeight(
        axisId,
        Math.max(RESULTS_AXIS_LABEL_MIN_HEIGHT, Math.round(h)),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [axisId, onHeight]);
  return (
    <div
      ref={ref}
      className="absolute left-0 right-0 flex items-end gap-2"
      style={{ bottom: "100%", marginBottom: RESULTS_AXIS_LABEL_GAP }}
    >
      {children}
    </div>
  );
}

const COLOR_WHEEL_GRADIENT =
  "conic-gradient(from 90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)";

function ResultsColorWheel({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<"hue" | "sv" | null>(null);
  const hsvRef = useRef(hexToHsv(value));
  const lastEmittedRef = useRef(value.toLowerCase());

  if (modeRef.current === null) {
    const incoming = value.toLowerCase();
    if (incoming !== lastEmittedRef.current) {
      const parsed = hexToHsv(incoming);
      if (parsed.s > 0.01) hsvRef.current.h = parsed.h;
      hsvRef.current.s = parsed.s;
      hsvRef.current.v = parsed.v;
      lastEmittedRef.current = incoming;
    }
  }
  const { h, s, v } = hsvRef.current;

  const size = COLOR_WHEEL_SIZE;
  const ring = COLOR_WHEEL_RING;
  const gap = COLOR_WHEEL_GAP;
  const squareSize = size - (ring + gap) * 2;
  const squareOffset = ring + gap;
  const outerR = size / 2;
  const innerR = outerR - ring;
  const hueR = outerR - ring / 2;
  const hueRad = (h * Math.PI) / 180;

  function emitHsv(next: { h: number; s: number; v: number }) {
    hsvRef.current = next;
    const hex = hsvToHex(next.h, next.s, next.v);
    lastEmittedRef.current = hex;
    onChange(hex);
  }

  function applyFromPoint(clientX: number, clientY: number, mode: "hue" | "sv") {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const current = hsvRef.current;
    if (mode === "hue") {
      const nextH = (Math.atan2(y - outerR, x - outerR) * 180) / Math.PI;
      emitHsv({ h: (nextH + 360) % 360, s: current.s, v: current.v });
      return;
    }
    emitHsv({
      h: current.h,
      s: clamp((x - squareOffset) / squareSize, 0, 1),
      v: clamp(1 - (y - squareOffset) / squareSize, 0, 1),
    });
  }

  function hitMode(clientX: number, clientY: number): "hue" | "sv" | null {
    const el = rootRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (
      x >= squareOffset &&
      y >= squareOffset &&
      x <= squareOffset + squareSize &&
      y <= squareOffset + squareSize
    ) {
      return "sv";
    }
    const dist = Math.hypot(x - outerR, y - outerR);
    if (dist >= innerR - 4 && dist <= outerR + 6) return "hue";
    return null;
  }

  return (
    <div
      ref={rootRef}
      role="slider"
      aria-label="Color wheel"
      aria-valuetext={value}
      className="relative touch-none select-none"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        const mode = hitMode(e.clientX, e.clientY);
        if (!mode) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        modeRef.current = mode;
        applyFromPoint(e.clientX, e.clientY, mode);
      }}
      onPointerMove={(e) => {
        if (modeRef.current === null) return;
        applyFromPoint(e.clientX, e.clientY, modeRef.current);
      }}
      onPointerUp={() => {
        modeRef.current = null;
      }}
      onPointerCancel={() => {
        modeRef.current = null;
      }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: COLOR_WHEEL_GRADIENT,
        }}
      />
      <div
        className="absolute rounded-full bg-white"
        style={{ inset: ring }}
      />
      <div
        className="absolute overflow-hidden rounded-[2px]"
        style={{
          left: squareOffset,
          top: squareOffset,
          width: squareSize,
          height: squareSize,
          background: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${hsvToHex(h, 1, 1)})`,
        }}
      />
      <div
        className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{
          left: outerR + hueR * Math.cos(hueRad),
          top: outerR + hueR * Math.sin(hueRad),
        }}
      />
      <div
        className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{
          left: squareOffset + s * squareSize,
          top: squareOffset + (1 - v) * squareSize,
        }}
      />
    </div>
  );
}

function ResultsColorPicker({
  label,
  value,
  onCheckpoint,
  onChange,
}: {
  label: string;
  value: string;
  onCheckpoint: () => void;
  onChange: (color: string) => void;
}) {
  const [hexDraft, setHexDraft] = useState(value);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelPos, setWheelPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  useEffect(() => {
    if (!wheelOpen) return;
    function placeMenu() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuW = COLOR_WHEEL_SIZE + 24;
      const menuH = COLOR_WHEEL_SIZE + 24;
      let left = rect.right + 8;
      let top = rect.top;
      if (left + menuW > window.innerWidth - 8) left = rect.left - menuW - 8;
      if (top + menuH > window.innerHeight - 8) {
        top = window.innerHeight - menuH - 8;
      }
      setWheelPos({
        top: Math.max(8, top),
        left: Math.max(8, left),
      });
    }
    placeMenu();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setWheelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWheelOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
    };
  }, [wheelOpen]);

  function commitHex(raw: string) {
    const next = parseHexColor(raw) ?? value;
    setHexDraft(next);
    if (next !== value) onChange(next);
  }

  return (
    <div className="mt-3">
      <div className="text-sm text-black/70">{label}</div>
      <div className="mt-1.5 grid grid-cols-8 gap-1.5">
        {RESULTS_PRESET_COLORS.map((color) => {
          const selected = value.toLowerCase() === color;
          return (
            <button
              key={color}
              type="button"
              title={color}
              aria-label={`${label} ${color}`}
              aria-pressed={selected}
              onClick={() => {
                onCheckpoint();
                onChange(color);
              }}
              className={`aspect-square w-full cursor-pointer rounded-md border border-black/20 ${
                selected ? "ring-2 ring-[#2f5d76] ring-offset-1" : ""
              }`}
              style={{ backgroundColor: color }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="h-9 w-9 shrink-0 rounded-md border border-black/20"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <input
          aria-label={`${label} hex`}
          value={hexDraft}
          spellCheck={false}
          placeholder="#rrggbb"
          onFocus={() => onCheckpoint()}
          onChange={(e) => {
            const raw = e.target.value;
            setHexDraft(raw);
            const parsed = parseHexColor(raw, false);
            if (parsed && parsed !== value) onChange(parsed);
          }}
          onBlur={() => commitHex(hexDraft)}
          className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 font-mono text-sm text-black outline-none focus:border-[#2f5d76]"
        />
        <button
          ref={buttonRef}
          type="button"
          title="Color wheel"
          aria-label={`Open ${label} color wheel`}
          aria-haspopup="dialog"
          aria-expanded={wheelOpen}
          onClick={() => {
            onCheckpoint();
            setWheelOpen((open) => !open);
          }}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-black/15 bg-white hover:bg-black/5"
        >
          <span
            className="block h-6 w-6 rounded-full border border-black/15"
            style={{
              background:
                "conic-gradient(#ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            }}
          />
        </button>
      </div>
      {wheelOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={`${label} color wheel`}
            className="fixed z-50 rounded-md border border-black/15 bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            style={{ top: wheelPos.top, left: wheelPos.left }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ResultsColorWheel value={value} onChange={onChange} />
          </div>,
          document.body,
        )}
    </div>
  );
}

function FontSizeControl({
  label,
  value,
  onCheckpoint,
  onChange,
}: {
  label?: string;
  value: number;
  onCheckpoint: () => void;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  function applyDelta(delta: number) {
    onCheckpoint();
    onChange(normalizeResultsFontSize(value + delta));
  }

  function commit(raw: string) {
    const n = Number(raw);
    const next = Number.isFinite(n)
      ? normalizeResultsFontSize(n)
      : normalizeResultsFontSize(value);
    setDraft(String(next));
    if (next !== value) {
      onCheckpoint();
      onChange(next);
    }
  }

  const buttonClass =
    "flex h-8 min-w-[2.25rem] cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white px-2 text-sm font-medium text-black hover:bg-black/5";

  return (
    <div className={label ? "mt-3" : ""}>
      {label ? <div className="text-sm text-black/70">{label}</div> : null}
      <div className={`flex items-center gap-2 ${label ? "mt-1.5" : ""}`}>
        <button type="button" aria-label="Decrease font size by 1" onClick={() => applyDelta(-1)} className={buttonClass}>
          −1
        </button>
        <button type="button" aria-label="Increase font size by 1" onClick={() => applyDelta(1)} className={buttonClass}>
          +1
        </button>
        <button type="button" aria-label="Increase font size by 2" onClick={() => applyDelta(2)} className={buttonClass}>
          +2
        </button>
        <input
          type="number"
          min={RESULTS_FONT_SIZE_MIN}
          max={RESULTS_FONT_SIZE_MAX}
          step={1}
          aria-label={label ? `${label} font size` : "Font size"}
          value={draft}
          onFocus={() => onCheckpoint()}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            if (raw === "") return;
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(normalizeResultsFontSize(n));
          }}
          onBlur={() => commit(draft)}
          className="h-8 w-16 rounded-md border border-black/15 bg-white px-2 text-sm text-black outline-none focus:border-[#2f5d76]"
        />
      </div>
    </div>
  );
}

function ResultsRichTextEditor({
  segments,
  variables,
  onCheckpoint,
  onChange,
  compact = false,
  align = "left",
  preview = false,
  autoHeight = false,
  growFromEnd = true,
  fontSize = RESULTS_FONT_SIZE_DEFAULT,
}: {
  segments: ResultsTextSegment[];
  variables: ProjectVariable[];
  onCheckpoint: () => void;
  onChange: (segments: ResultsTextSegment[]) => void;
  compact?: boolean;
  align?: "left" | "center" | "right";
  preview?: boolean;
  autoHeight?: boolean;
  growFromEnd?: boolean;
  fontSize?: number;
}) {
  const dragFromRef = useRef<number | null>(null);
  const dropTargetRef = useRef<{
    segmentIndex: number;
    offset: number;
    caretLeft?: number;
    caretTop?: number;
    caretHeight?: number;
  } | null>(null);
  const chipPointerRef = useRef<{
    segmentId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const textSpanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const pendingCaretRef = useRef<{ segmentId: string; offset: number } | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<{
    segmentIndex: number;
    offset: number;
    caretLeft?: number;
    caretTop?: number;
    caretHeight?: number;
  } | null>(null);
  const [openVariableMenu, setOpenVariableMenu] = useState<{
    segmentId: string;
    screenX: number;
    screenY: number;
    minWidth: number;
  } | null>(null);
  const [chipContextMenu, setChipContextMenu] = useState<{
    segmentId: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  useEffect(() => {
    if (!openVariableMenu && !chipContextMenu) return;
    const close = () => {
      setOpenVariableMenu(null);
      setChipContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [openVariableMenu, chipContextMenu]);

  useEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    pendingCaretRef.current = null;
    const el = textSpanRefs.current.get(pending.segmentId);
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const textNode =
      el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE
        ? el.firstChild
        : null;
    const range = document.createRange();
    if (textNode) {
      const offset = Math.min(
        pending.offset,
        textNode.textContent?.length ?? 0,
      );
      range.setStart(textNode, offset);
      range.collapse(true);
    } else {
      range.selectNodeContents(el);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }, [segments]);

  function updateDropTarget(next: {
    segmentIndex: number;
    offset: number;
    caretLeft?: number;
    caretTop?: number;
    caretHeight?: number;
  }) {
    dropTargetRef.current = next;
    setDropTarget(next);
  }

  function finishDrag(
    override?: { segmentIndex: number; offset: number } | null,
  ) {
    const from = dragFromRef.current;
    const target = override ?? dropTargetRef.current;
    dragFromRef.current = null;
    dropTargetRef.current = null;
    setDropTarget(null);
    if (from === null || !target) return;
    onCheckpoint();
    onChange(
      moveVariableInSegments(segments, from, target.segmentIndex, target.offset),
    );
  }

  function variableLabel(variableId: string) {
    const variable = variables.find((item) => item.id === variableId);
    if (!variable) return variables.length === 0 ? "No variables" : "Choose variable";
    return variable.name.trim() || "Untitled";
  }

  function deleteVariableSegment(segmentId: string, caretAfter?: {
    segmentId: string;
    offset: number;
  }) {
    if (!segments.some((segment) => segment.id === segmentId && segment.kind === "variable")) {
      return;
    }
    onCheckpoint();
    if (caretAfter) pendingCaretRef.current = caretAfter;
    onChange(
      normalizeResultsTextSegments(
        segments.filter((segment) => segment.id !== segmentId),
      ),
    );
    setOpenVariableMenu(null);
    setChipContextMenu(null);
  }

  function deleteVariableBeforeText(textIndex: number) {
    const prev = segments[textIndex - 1];
    if (!prev || prev.kind !== "variable") return false;
    const before = segments[textIndex - 2];
    const textSegment = segments[textIndex];
    const caretAfter =
      before?.kind === "text"
        ? { segmentId: before.id, offset: before.text.length }
        : textSegment?.kind === "text"
          ? { segmentId: textSegment.id, offset: 0 }
          : undefined;
    deleteVariableSegment(prev.id, caretAfter);
    return true;
  }

  const alignClass =
    align === "center" ? "text-center" : align === "right" ? "text-right" : "";
  const compactBoxClass = autoHeight
    ? "min-h-[36px]"
    : compact
      ? "max-h-full min-h-[56px]"
      : "min-h-[120px]";
  const compactBoxStyle = autoHeight
    ? undefined
    : compact
      ? { height: "100%", maxHeight: "100%" }
      : { maxHeight: RESULTS_SIDEBAR_EDITOR_MAX_HEIGHT };
  const compactOverflowClass = autoHeight
    ? "overflow-x-hidden overflow-y-visible"
    : "overflow-x-hidden overflow-y-auto";
  const resolvedFontSize = normalizeResultsFontSize(fontSize);
  const textStyle = {
    fontSize: `${resolvedFontSize}px`,
    lineHeight: 1.375,
  } as const;
  const chipFontSize = Math.max(
    RESULTS_FONT_SIZE_MIN,
    Math.round(resolvedFontSize * 0.857),
  );

  if (preview) {
    return (
      <div
        className={`w-full ${compactOverflowClass} ${compactBoxClass} p-2 ${alignClass} ${
          autoHeight
            ? `flex flex-col ${growFromEnd ? "justify-end" : "justify-start"}`
            : ""
        }`}
        style={compactBoxStyle}
      >
        <div className="w-full">
          {segments.map((segment) =>
            segment.kind === "text" ? (
              <span
                key={segment.id}
                className={`inline whitespace-pre-wrap break-words align-baseline text-black ${
                  compact ? "py-0.5" : "py-1"
                }`}
                style={textStyle}
              >
                {segment.text}
              </span>
            ) : (
              <span
                key={segment.id}
                className={`inline whitespace-pre-wrap break-words align-baseline text-black ${
                  compact ? "py-0.5" : "py-1"
                }`}
                style={textStyle}
              >
                {formatVariablePreviewValue(
                  variables.find((item) => item.id === segment.variableId),
                )}
              </span>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-lg border border-black/15 bg-white p-2 ${compactOverflowClass} ${compactBoxClass} ${alignClass} ${
        autoHeight
          ? `flex flex-col ${growFromEnd ? "justify-end" : "justify-start"}`
          : ""
      }`}
      style={compactBoxStyle}
      onDragOver={(e) => {
        if (dragFromRef.current === null) return;
        e.preventDefault();
        const lastIndex = Math.max(0, segments.length - 1);
        const last = segments[lastIndex];
        updateDropTarget({
          segmentIndex: lastIndex,
          offset: last?.kind === "text" ? last.text.length : 0,
        });
      }}
      onDrop={(e) => {
        e.preventDefault();
        finishDrag();
      }}
    >
      <div className="w-full">
      {segments.map((segment, index) => (
        <span
          key={segment.id}
          className={`relative max-w-full align-baseline ${
            segment.kind === "text" ? "inline" : "mx-0.5 inline-flex shrink-0"
          }`}
        >
          {dropTarget &&
            dropTarget.segmentIndex === index &&
            segment.kind === "text" && (
              <span
                className="pointer-events-none absolute z-10 w-0.5 rounded bg-[#2f5d76]"
                style={{
                  left: `${(dropTarget.caretLeft ?? dropTarget.offset * 8) + 2}px`,
                  top: dropTarget.caretTop ?? 2,
                  height: dropTarget.caretHeight ?? 18,
                }}
                aria-hidden
              />
            )}
          {dropTarget &&
            dropTarget.segmentIndex === index &&
            segment.kind === "variable" && (
              <span
                className="pointer-events-none absolute top-1/2 left-0 z-10 h-[1.15em] w-0.5 -translate-y-1/2 rounded bg-[#2f5d76]"
                aria-hidden
              />
            )}
          {segment.kind === "text" ? (
            <span
              ref={(el) => {
                if (!el) {
                  textSpanRefs.current.delete(segment.id);
                  return;
                }
                textSpanRefs.current.set(segment.id, el);
                if (
                  document.activeElement !== el &&
                  el.textContent !== segment.text
                ) {
                  el.textContent = segment.text;
                }
              }}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Text"
              data-placeholder={
                segments.length === 1 && !segment.text ? "Type text…" : undefined
              }
              onFocus={() => onCheckpoint()}
              onInput={(e) => {
                const text = e.currentTarget.textContent ?? "";
                onChange(
                  segments.map((item) =>
                    item.id === segment.id && item.kind === "text"
                      ? { ...item, text }
                      : item,
                  ),
                );
              }}
              onKeyDown={(e) => {
                if (e.key !== "Backspace") return;
                const selection = window.getSelection();
                if (!selection || !selection.isCollapsed) return;
                if (selection.anchorOffset !== 0) return;
                if (deleteVariableBeforeText(index)) {
                  e.preventDefault();
                }
              }}
              onDragOver={(e) => {
                if (dragFromRef.current === null) return;
                e.preventDefault();
                e.stopPropagation();
                const offset = caretOffsetInTextNode(
                  e.clientX,
                  e.clientY,
                  segment.text.length,
                );
                const line = fieldLineMetrics(e.currentTarget, e.clientY);
                const rect = e.currentTarget.getBoundingClientRect();
                updateDropTarget({
                  segmentIndex: index,
                  offset,
                  caretLeft: Math.max(0, e.clientX - rect.left),
                  caretTop: line.top,
                  caretHeight: line.height,
                });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const offset = caretOffsetInTextNode(
                  e.clientX,
                  e.clientY,
                  segment.text.length,
                );
                finishDrag({ segmentIndex: index, offset });
              }}
              className={`inline whitespace-pre-wrap break-words align-baseline text-black outline-none empty:inline-block empty:min-w-[3ch] ${
                compact ? "py-0.5" : "py-1"
              }`}
              style={textStyle}
            />
          ) : (
            <span
              tabIndex={0}
              draggable
              aria-label={`Variable ${variableLabel(segment.variableId)}`}
              onDragStart={(e) => {
                if (chipPointerRef.current?.segmentId === segment.id) {
                  chipPointerRef.current.moved = true;
                }
                setOpenVariableMenu(null);
                setChipContextMenu(null);
                dragFromRef.current = index;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", segment.id);
              }}
              onDragEnd={() => {
                dragFromRef.current = null;
                dropTargetRef.current = null;
                chipPointerRef.current = null;
                setDropTarget(null);
              }}
              onDragOver={(e) => {
                if (dragFromRef.current === null) return;
                e.preventDefault();
                e.stopPropagation();
                updateDropTarget({ segmentIndex: index, offset: 0 });
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                finishDrag({ segmentIndex: index, offset: 0 });
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                chipPointerRef.current = {
                  segmentId: segment.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  moved: false,
                };
              }}
              onPointerMove={(e) => {
                const press = chipPointerRef.current;
                if (!press || press.segmentId !== segment.id || press.moved) return;
                const dx = e.clientX - press.startX;
                const dy = e.clientY - press.startY;
                if (
                  dx * dx + dy * dy >=
                  CLICK_MOVE_THRESHOLD * CLICK_MOVE_THRESHOLD
                ) {
                  press.moved = true;
                }
              }}
              onPointerUp={(e) => {
                if (e.button !== 0) return;
                const press = chipPointerRef.current;
                chipPointerRef.current = null;
                if (!press || press.segmentId !== segment.id || press.moved) return;
                e.preventDefault();
                e.stopPropagation();
                setChipContextMenu(null);
                const rect = e.currentTarget.getBoundingClientRect();
                setOpenVariableMenu((current) =>
                  current?.segmentId === segment.id
                    ? null
                    : {
                        segmentId: segment.id,
                        screenX: rect.left,
                        screenY: rect.bottom + 4,
                        minWidth: Math.max(140, rect.width),
                      },
                );
              }}
              onPointerCancel={() => {
                chipPointerRef.current = null;
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpenVariableMenu(null);
                setChipContextMenu({
                  segmentId: segment.id,
                  screenX: e.clientX,
                  screenY: e.clientY,
                });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Backspace" && e.key !== "Delete") return;
                e.preventDefault();
                const before = segments[index - 1];
                const after = segments[index + 1];
                const caretAfter =
                  before?.kind === "text"
                    ? { segmentId: before.id, offset: before.text.length }
                    : after?.kind === "text"
                      ? { segmentId: after.id, offset: 0 }
                      : undefined;
                deleteVariableSegment(segment.id, caretAfter);
              }}
              className="inline-flex cursor-grab items-center rounded-full border border-[#2f5d76]/30 bg-[#2f5d76]/10 px-2 py-0.5 font-medium text-[#2f5d76] outline-none focus:ring-2 focus:ring-[#2f5d76]/40 active:cursor-grabbing"
              style={{ fontSize: `${chipFontSize}px` }}
            >
              <span className="max-w-[140px] truncate">
                {variableLabel(segment.variableId)}
              </span>
            </span>
          )}
        </span>
      ))}
      </div>

      {openVariableMenu && (
        <div
          role="listbox"
          aria-label="Choose variable"
          className="fixed z-[60] rounded-md border border-black/15 bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          style={{
            left: openVariableMenu.screenX,
            top: openVariableMenu.screenY,
            minWidth: openVariableMenu.minWidth,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {variables.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-black/50">No variables</div>
          ) : (
            variables.map((variable) => {
              const segment = segments.find(
                (item) => item.id === openVariableMenu.segmentId,
              );
              const selectedId =
                segment?.kind === "variable" ? segment.variableId : "";
              return (
                <button
                  key={variable.id}
                  type="button"
                  role="option"
                  aria-selected={variable.id === selectedId}
                  className={`block w-full cursor-pointer border-none px-3 py-1.5 text-left text-xs ${
                    variable.id === selectedId
                      ? "bg-[#2f5d76]/10 font-medium text-[#2f5d76]"
                      : "bg-transparent text-black hover:bg-black/5"
                  }`}
                  onClick={() => {
                    onCheckpoint();
                    onChange(
                      segments.map((item) =>
                        item.id === openVariableMenu.segmentId &&
                        item.kind === "variable"
                          ? { ...item, variableId: variable.id }
                          : item,
                      ),
                    );
                    setOpenVariableMenu(null);
                  }}
                >
                  {variable.name.trim() || "Untitled"}
                </button>
              );
            })
          )}
        </div>
      )}

      {chipContextMenu && (
        <div
          role="menu"
          className="fixed z-[60] min-w-[140px] rounded-md border border-black/15 bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          style={{ left: chipContextMenu.screenX, top: chipContextMenu.screenY }}
          onPointerDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full cursor-pointer border-none bg-transparent px-3 py-1.5 text-left text-sm text-black hover:bg-black/5"
            onClick={() => {
              const segmentId = chipContextMenu.segmentId;
              const index = segments.findIndex((segment) => segment.id === segmentId);
              const before = index > 0 ? segments[index - 1] : undefined;
              const after = index >= 0 ? segments[index + 1] : undefined;
              const caretAfter =
                before?.kind === "text"
                  ? { segmentId: before.id, offset: before.text.length }
                  : after?.kind === "text"
                    ? { segmentId: after.id, offset: 0 }
                    : undefined;
              deleteVariableSegment(segmentId, caretAfter);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
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

type ResultsTextSegment =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "variable"; variableId: string };

type ResultsTextAlign = "left" | "center" | "right";

type ResultsTextBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  segments: ResultsTextSegment[];
  fontSize: number;
  textAlign: ResultsTextAlign;
  showImage: boolean;
  image: string;
  imageAbove: boolean;
  imageWidth: number;
  imageHeight: number;
  imageOffsetX: number;
};

type ResultsAxis = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  segments: ResultsTextSegment[];
  leftSegments: ResultsTextSegment[];
  rightSegments: ResultsTextSegment[];
  centerFontSize: number;
  leftFontSize: number;
  rightFontSize: number;
  percentageVariableId: string;
  leftColor: string;
  rightColor: string;
  showImages: boolean;
  leftImage: string;
  rightImage: string;
};

type ResultsCompass = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  topSegments: ResultsTextSegment[];
  bottomSegments: ResultsTextSegment[];
  leftSegments: ResultsTextSegment[];
  rightSegments: ResultsTextSegment[];
  topFontSize: number;
  bottomFontSize: number;
  leftFontSize: number;
  rightFontSize: number;
  xVariableId: string;
  yVariableId: string;
  topLeftColor: string;
  topRightColor: string;
  bottomLeftColor: string;
  bottomRightColor: string;
};

type ResultsBar = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  segments: ResultsTextSegment[];
  fontSize: number;
  variableId: string;
  asPercent: boolean;
  min: number;
  max: number;
  showImage: boolean;
  image: string;
};

type ResultsImage = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
};

type ResultsDocument = {
  textBoxes: ResultsTextBox[];
  axes: ResultsAxis[];
  compasses: ResultsCompass[];
  bars: ResultsBar[];
  images: ResultsImage[];
  gridVisible: boolean;
  horizontalTicks: number;
  verticalTicks: number;
};

type EditorSnapshot = {
  projectName: string;
  variables: ProjectVariable[];
  defaultAnswers: AnswerOption[];
  sections: QuizSection[];
  activeSectionId: string;
  results: ResultsDocument;
  listing: QuizListing;
  editorView: "section" | "results";
  selectedId: string | null;
  selectedTransitionId: string | null;
  selectedResultsTextId: string | null;
  selectedResultsAxisId: string | null;
  selectedResultsCompassId: string | null;
  selectedResultsBarId: string | null;
  selectedResultsImageId: string | null;
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
  results: ResultsDocument;
  listing: QuizListing;
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
    fallback: Boolean(t.fallback),
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

  const fallbackOrigins = new Set<string>();
  const exclusiveTransitions = transitions.map((transition) => {
    if (!transition.fallback) return transition;
    if (fallbackOrigins.has(transition.fromId)) {
      return { ...transition, fallback: false };
    }
    fallbackOrigins.add(transition.fromId);
    return transition;
  });

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
    transitions: exclusiveTransitions,
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

function emptyResultsSegments(): ResultsTextSegment[] {
  return [{ id: crypto.randomUUID(), kind: "text", text: "" }];
}

function normalizeResultsSegment(raw: unknown): ResultsTextSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const segment = raw as Record<string, unknown>;
  const id = typeof segment.id === "string" ? segment.id : crypto.randomUUID();
  if (segment.kind === "variable") {
    return {
      id,
      kind: "variable",
      variableId: typeof segment.variableId === "string" ? segment.variableId : "",
    };
  }
  if (segment.kind === "text" || typeof segment.text === "string") {
    return {
      id,
      kind: "text",
      text: typeof segment.text === "string" ? segment.text : "",
    };
  }
  return null;
}

function normalizeResultsSegments(
  raw: unknown,
  legacyText: unknown,
): ResultsTextSegment[] {
  if (Array.isArray(raw)) {
    const segments = raw
      .map(normalizeResultsSegment)
      .filter((segment): segment is ResultsTextSegment => segment !== null);
    return segments.length > 0 ? segments : emptyResultsSegments();
  }
  if (typeof legacyText === "string") {
    return [{ id: crypto.randomUUID(), kind: "text", text: legacyText }];
  }
  return emptyResultsSegments();
}

function normalizeResultsTextBox(raw: unknown): ResultsTextBox | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string") return null;
  const x = typeof box.x === "number" && Number.isFinite(box.x) ? box.x : 0;
  const y = typeof box.y === "number" && Number.isFinite(box.y) ? Math.max(0, box.y) : 0;
  const width =
    typeof box.width === "number" && Number.isFinite(box.width) && box.width >= RESULTS_TEXT_MIN_WIDTH
      ? box.width
      : RESULTS_TEXT_DEFAULT_WIDTH;
  const height =
    typeof box.height === "number" &&
    Number.isFinite(box.height) &&
    box.height >= RESULTS_TEXT_MIN_HEIGHT
      ? Math.min(box.height, RESULTS_TEXT_MAX_HEIGHT)
      : RESULTS_TEXT_DEFAULT_HEIGHT;
  return {
    id: box.id,
    x,
    y,
    width,
    height,
    segments: normalizeResultsSegments(box.segments, box.text),
    fontSize: normalizeResultsFontSize(box.fontSize),
    textAlign: normalizeResultsTextAlign(box.textAlign),
    showImage: Boolean(box.showImage),
    image: typeof box.image === "string" ? box.image : "",
    imageAbove: Boolean(box.imageAbove),
    imageWidth: normalizeResultsImageDim(
      box.imageWidth,
      RESULTS_TEXT_IMAGE_DEFAULT_SIZE,
    ),
    imageHeight: normalizeResultsImageDim(
      box.imageHeight,
      RESULTS_TEXT_IMAGE_DEFAULT_SIZE,
    ),
    imageOffsetX:
      typeof box.imageOffsetX === "number" && Number.isFinite(box.imageOffsetX)
        ? box.imageOffsetX
        : (width - RESULTS_TEXT_IMAGE_DEFAULT_SIZE) / 2,
  };
}

function normalizeGridTicks(raw: unknown, fallback = RESULTS_GRID_TICKS_DEFAULT) {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clamp(Math.round(n), RESULTS_GRID_TICKS_MIN, RESULTS_GRID_TICKS_MAX);
}

function normalizeResultsAxis(raw: unknown): ResultsAxis | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string") return null;
  const x = typeof box.x === "number" && Number.isFinite(box.x) ? box.x : 0;
  const y = typeof box.y === "number" && Number.isFinite(box.y) ? box.y : 0;
  const width =
    typeof box.width === "number" &&
    Number.isFinite(box.width) &&
    box.width >= RESULTS_AXIS_MIN_WIDTH
      ? box.width
      : RESULTS_AXIS_DEFAULT_WIDTH;
  const height =
    typeof box.height === "number" &&
    Number.isFinite(box.height) &&
    box.height >= RESULTS_AXIS_MIN_HEIGHT
      ? Math.min(box.height, RESULTS_AXIS_MAX_HEIGHT)
      : RESULTS_AXIS_DEFAULT_HEIGHT;
  return {
    id: box.id,
    x,
    y,
    width,
    height,
    segments: normalizeResultsSegments(box.segments, box.text),
    leftSegments: normalizeResultsSegments(box.leftSegments, undefined),
    rightSegments: normalizeResultsSegments(box.rightSegments, undefined),
    centerFontSize: normalizeResultsFontSize(box.centerFontSize ?? box.fontSize),
    leftFontSize: normalizeResultsFontSize(box.leftFontSize ?? box.fontSize),
    rightFontSize: normalizeResultsFontSize(box.rightFontSize ?? box.fontSize),
    percentageVariableId:
      typeof box.percentageVariableId === "string" ? box.percentageVariableId : "",
    leftColor: normalizeStoredColor(box.leftColor, RESULTS_AXIS_LEFT_COLOR),
    rightColor: normalizeStoredColor(box.rightColor, RESULTS_AXIS_RIGHT_COLOR),
    showImages: Boolean(box.showImages),
    leftImage: typeof box.leftImage === "string" ? box.leftImage : "",
    rightImage: typeof box.rightImage === "string" ? box.rightImage : "",
  };
}

function normalizeResultsCompass(raw: unknown): ResultsCompass | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string") return null;
  const x = typeof box.x === "number" && Number.isFinite(box.x) ? box.x : 0;
  const y = typeof box.y === "number" && Number.isFinite(box.y) ? box.y : 0;
  const rawSize =
    typeof box.width === "number" && Number.isFinite(box.width)
      ? box.width
      : typeof box.height === "number" && Number.isFinite(box.height)
        ? box.height
        : RESULTS_COMPASS_DEFAULT_SIZE;
  const size = clamp(rawSize, RESULTS_COMPASS_MIN_SIZE, RESULTS_COMPASS_MAX_SIZE);
  return {
    id: box.id,
    x,
    y,
    width: size,
    height: size,
    topSegments: normalizeResultsSegments(box.topSegments, undefined),
    bottomSegments: normalizeResultsSegments(box.bottomSegments, undefined),
    leftSegments: normalizeResultsSegments(box.leftSegments, undefined),
    rightSegments: normalizeResultsSegments(box.rightSegments, undefined),
    topFontSize: normalizeResultsFontSize(box.topFontSize ?? box.fontSize),
    bottomFontSize: normalizeResultsFontSize(box.bottomFontSize ?? box.fontSize),
    leftFontSize: normalizeResultsFontSize(box.leftFontSize ?? box.fontSize),
    rightFontSize: normalizeResultsFontSize(box.rightFontSize ?? box.fontSize),
    xVariableId: typeof box.xVariableId === "string" ? box.xVariableId : "",
    yVariableId: typeof box.yVariableId === "string" ? box.yVariableId : "",
    topLeftColor: normalizeStoredColor(
      box.topLeftColor,
      RESULTS_COMPASS_TOP_LEFT_COLOR,
    ),
    topRightColor: normalizeStoredColor(
      box.topRightColor,
      RESULTS_COMPASS_TOP_RIGHT_COLOR,
    ),
    bottomLeftColor: normalizeStoredColor(
      box.bottomLeftColor,
      RESULTS_COMPASS_BOTTOM_LEFT_COLOR,
    ),
    bottomRightColor: normalizeStoredColor(
      box.bottomRightColor,
      RESULTS_COMPASS_BOTTOM_RIGHT_COLOR,
    ),
  };
}

function normalizeResultsBar(raw: unknown): ResultsBar | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string") return null;
  const x = typeof box.x === "number" && Number.isFinite(box.x) ? box.x : 0;
  const y = typeof box.y === "number" && Number.isFinite(box.y) ? box.y : 0;
  const width =
    typeof box.width === "number" &&
    Number.isFinite(box.width) &&
    box.width >= RESULTS_BAR_MIN_WIDTH
      ? box.width
      : RESULTS_BAR_DEFAULT_WIDTH;
  const height =
    typeof box.height === "number" &&
    Number.isFinite(box.height) &&
    box.height >= RESULTS_BAR_MIN_HEIGHT
      ? Math.min(box.height, RESULTS_BAR_MAX_HEIGHT)
      : RESULTS_BAR_DEFAULT_HEIGHT;
  return {
    id: box.id,
    x,
    y,
    width,
    height,
    segments: normalizeResultsSegments(box.segments, undefined),
    fontSize: normalizeResultsFontSize(box.fontSize),
    variableId: typeof box.variableId === "string" ? box.variableId : "",
    asPercent: Boolean(box.asPercent),
    min: normalizeBarBound(box.min, 0),
    max: normalizeBarBound(box.max, 100),
    showImage: Boolean(box.showImage),
    image: typeof box.image === "string" ? box.image : "",
  };
}

function normalizeResultsImage(raw: unknown): ResultsImage | null {
  if (!raw || typeof raw !== "object") return null;
  const box = raw as Record<string, unknown>;
  if (typeof box.id !== "string") return null;
  const x = typeof box.x === "number" && Number.isFinite(box.x) ? box.x : 0;
  const y = typeof box.y === "number" && Number.isFinite(box.y) ? Math.max(0, box.y) : 0;
  return {
    id: box.id,
    x,
    y,
    width: normalizeResultsImageDim(box.width, RESULTS_IMAGE_DEFAULT_SIZE),
    height: normalizeResultsImageDim(box.height, RESULTS_IMAGE_DEFAULT_SIZE),
    src: typeof box.src === "string" ? box.src : "",
  };
}

function emptyResultsDocument(): ResultsDocument {
  return {
    textBoxes: [],
    axes: [],
    compasses: [],
    bars: [],
    images: [],
    gridVisible: false,
    horizontalTicks: RESULTS_GRID_TICKS_DEFAULT,
    verticalTicks: RESULTS_GRID_TICKS_DEFAULT,
  };
}

function normalizeResults(raw: unknown): ResultsDocument {
  if (!raw || typeof raw !== "object") return emptyResultsDocument();
  const data = raw as Record<string, unknown>;
  const textBoxes = Array.isArray(data.textBoxes)
    ? data.textBoxes
        .map(normalizeResultsTextBox)
        .filter((box): box is ResultsTextBox => box !== null)
    : [];
  const axes = Array.isArray(data.axes)
    ? data.axes
        .map(normalizeResultsAxis)
        .filter((axis): axis is ResultsAxis => axis !== null)
    : [];
  const compasses = Array.isArray(data.compasses)
    ? data.compasses
        .map(normalizeResultsCompass)
        .filter((item): item is ResultsCompass => item !== null)
    : [];
  const bars = Array.isArray(data.bars)
    ? data.bars
        .map(normalizeResultsBar)
        .filter((item): item is ResultsBar => item !== null)
    : [];
  const images = Array.isArray(data.images)
    ? data.images
        .map(normalizeResultsImage)
        .filter((item): item is ResultsImage => item !== null)
    : [];
  return {
    textBoxes,
    axes,
    compasses,
    bars,
    images,
    gridVisible: Boolean(data.gridVisible),
    horizontalTicks: normalizeGridTicks(data.horizontalTicks),
    verticalTicks: normalizeGridTicks(data.verticalTicks),
  };
}

function resultsContentHeight(
  results: Pick<
    ResultsDocument,
    "textBoxes" | "axes" | "compasses" | "bars" | "images"
  >,
  viewportHeight: number,
) {
  let bottom = 0;
  for (const box of results.textBoxes) {
    let boxBottom = box.y + box.height;
    if (box.showImage && !box.imageAbove) {
      boxBottom += RESULTS_TEXT_IMAGE_GAP + box.imageHeight;
    }
    bottom = Math.max(bottom, boxBottom);
  }
  for (const axis of results.axes) {
    bottom = Math.max(bottom, axis.y + axis.height);
  }
  for (const compass of results.compasses) {
    bottom = Math.max(
      bottom,
      compass.y + compass.height + RESULTS_COMPASS_LABEL_OFFSET,
    );
  }
  for (const bar of results.bars ?? []) {
    const dip =
      !bar.asPercent && Math.min(bar.min, bar.max) < 0 ? bar.height : 0;
    const imagePad = bar.showImage
      ? RESULTS_BAR_IMAGE_GAP + Math.max(RESULTS_BAR_MIN_WIDTH, bar.width)
      : 0;
    bottom = Math.max(
      bottom,
      bar.y + bar.height + dip + RESULTS_BAR_LABEL_OFFSET + imagePad,
    );
  }
  for (const image of results.images ?? []) {
    bottom = Math.max(bottom, image.y + image.height);
  }
  return Math.max(viewportHeight, bottom + RESULTS_PAGE_BOTTOM_PAD);
}

function findResultsRect(
  results: ResultsDocument,
  id: string,
): {
  kind: "text" | "axis" | "compass" | "bar" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const text = results.textBoxes.find((box) => box.id === id);
  if (text) {
    return {
      kind: "text",
      x: text.x,
      y: text.y,
      width: text.width,
      height: text.height,
    };
  }
  const axis = results.axes.find((item) => item.id === id);
  if (axis) {
    return {
      kind: "axis",
      x: axis.x,
      y: axis.y,
      width: axis.width,
      height: axis.height,
    };
  }
  const compass = results.compasses.find((item) => item.id === id);
  if (compass) {
    return {
      kind: "compass",
      x: compass.x,
      y: compass.y,
      width: compass.width,
      height: compass.height,
    };
  }
  const bar = (results.bars ?? []).find((item) => item.id === id);
  if (bar) {
    return {
      kind: "bar",
      x: bar.x,
      y: bar.y,
      width: bar.width,
      height: bar.height,
    };
  }
  const image = (results.images ?? []).find((item) => item.id === id);
  if (image) {
    return {
      kind: "image",
      x: image.x,
      y: image.y,
      width: image.width,
      height: image.height,
    };
  }
  return null;
}

function patchResultsRect(
  results: ResultsDocument,
  id: string,
  patch: Partial<Pick<ResultsAxis, "x" | "y" | "width" | "height">>,
): ResultsDocument {
  let found = false;
  const textBoxes = results.textBoxes.map((box) => {
    if (box.id !== id) return box;
    found = true;
    return { ...box, ...patch };
  });
  if (found) return { ...results, textBoxes };
  found = false;
  const axes = results.axes.map((axis) => {
    if (axis.id !== id) return axis;
    found = true;
    return { ...axis, ...patch };
  });
  if (found) return { ...results, axes };
  found = false;
  const compasses = results.compasses.map((compass) => {
    if (compass.id !== id) return compass;
    found = true;
    return { ...compass, ...patch };
  });
  if (found) return { ...results, compasses };
  found = false;
  const bars = (results.bars ?? []).map((bar) => {
    if (bar.id !== id) return bar;
    found = true;
    return { ...bar, ...patch };
  });
  if (found) return { ...results, bars };
  return {
    ...results,
    images: (results.images ?? []).map((image) =>
      image.id === id ? { ...image, ...patch } : image,
    ),
  };
}

function resultsItemSizeLimits(kind: ResultsItemKind) {
  if (kind === "axis") {
    return {
      minWidth: RESULTS_AXIS_MIN_WIDTH,
      minHeight: RESULTS_AXIS_MIN_HEIGHT,
      maxHeight: RESULTS_AXIS_MAX_HEIGHT,
      minY: RESULTS_AXIS_LABEL_OFFSET,
    };
  }
  if (kind === "compass") {
    return {
      minWidth: RESULTS_COMPASS_MIN_SIZE,
      minHeight: RESULTS_COMPASS_MIN_SIZE,
      maxHeight: RESULTS_COMPASS_MAX_SIZE,
      minY: RESULTS_COMPASS_LABEL_OFFSET,
      minX: RESULTS_COMPASS_SIDE_LABEL_WIDTH + RESULTS_COMPASS_LABEL_GAP,
      square: true,
    };
  }
  if (kind === "bar") {
    return {
      minWidth: RESULTS_BAR_MIN_WIDTH,
      minHeight: RESULTS_BAR_MIN_HEIGHT,
      maxHeight: RESULTS_BAR_MAX_HEIGHT,
      minY: RESULTS_BAR_LABEL_OFFSET,
    };
  }
  if (kind === "image" || kind === "text-image") {
    return {
      minWidth: RESULTS_IMAGE_MIN_SIZE,
      minHeight: RESULTS_IMAGE_MIN_SIZE,
      maxHeight: RESULTS_IMAGE_MAX_SIZE,
    };
  }
  return {
    minWidth: RESULTS_TEXT_MIN_WIDTH,
    minHeight: RESULTS_TEXT_MIN_HEIGHT,
    maxHeight: RESULTS_TEXT_MAX_HEIGHT,
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
    results: normalizeResults(doc.results),
    listing: normalizeListing(doc.listing),
  };
}

function persistQuiz(quiz: PersistedQuiz, options?: { keepalive?: boolean }) {
  void saveStoredQuiz(
    {
      version: 1,
      id: quiz.id,
      projectName: quiz.projectName,
      updatedAt: quiz.updatedAt,
      variables: quiz.variables,
      defaultAnswers: quiz.defaultAnswers,
      sections: quiz.sections,
      activeSectionId: quiz.activeSectionId,
      results: quiz.results,
      listing: quiz.listing,
    },
    options,
  );
}

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return structuredClone(snapshot);
}

export default function CreateQuiz() {
  const { quizId } = useParams<{ quizId: string }>();
  const [initialQuiz, setInitialQuiz] = useState<PersistedQuiz | null | undefined>(
    undefined,
  );
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!quizId) {
      setInitialQuiz(null);
      return;
    }
    let cancelled = false;
    setInitialQuiz(undefined);
    setLoadError("");
    void (async () => {
      try {
        const stored = await getStoredQuiz(quizId);
        if (cancelled) return;
        setInitialQuiz(stored ? parseStoredQuiz(stored) : null);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Could not load quiz.");
        setInitialQuiz(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  if (!quizId) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loadError) {
    return (
      <main className="qh-page flex min-h-screen w-full items-center justify-center px-6 font-[Poppins,sans-serif] text-[#1a1a1a]">
        <div className="max-w-md text-center">
          <p className="text-sm font-medium text-[#7a3b3b]">{loadError}</p>
          <Link
            to="/dashboard"
            className="mt-4 inline-block text-sm font-semibold text-[#2f5d76] no-underline hover:text-[#244a5e]"
          >
            ← Your Quizzes
          </Link>
        </div>
      </main>
    );
  }

  if (initialQuiz === undefined) {
    return (
      <main className="qh-page flex min-h-screen w-full items-center justify-center px-6 font-[Poppins,sans-serif] text-[#1a1a1a]">
        <p className="text-sm text-[#4a5560]">Loading quiz…</p>
      </main>
    );
  }

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
  const [settingsPane, setSettingsPane] = useState<"project" | "section" | "results">(
    "project",
  );
  const [sections, setSections] = useState<QuizSection[]>(initialQuiz.sections);
  const [activeSectionId, setActiveSectionId] = useState(initialSection.id);
  const [boxes, setBoxes] = useState<CanvasBox[]>(initialSection.boxes);
  const [camera, setCamera] = useState<Camera>(initialSection.camera);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [dragKind, setDragKind] = useState<
    "pan" | "box" | "results-text" | "results-resize" | null
  >(null);
  const [draggingBoxId, setDraggingBoxId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [deleteSectionConfirmOpen, setDeleteSectionConfirmOpen] = useState(false);
  const [editorView, setEditorView] = useState<"section" | "results">("section");
  const [results, setResults] = useState<ResultsDocument>(initialQuiz.results);
  const [selectedResultsTextId, setSelectedResultsTextId] = useState<string | null>(null);
  const [selectedResultsAxisId, setSelectedResultsAxisId] = useState<string | null>(null);
  const [selectedResultsCompassId, setSelectedResultsCompassId] = useState<string | null>(
    null,
  );
  const [selectedResultsBarId, setSelectedResultsBarId] = useState<string | null>(
    null,
  );
  const [selectedResultsImageId, setSelectedResultsImageId] = useState<
    string | null
  >(null);
  const [resultsPreview, setResultsPreview] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [listing, setListing] = useState<QuizListing>(initialQuiz.listing);
  const [listingSaved, setListingSaved] = useState(false);
  const [quizScreen, setQuizScreen] = useState<QuizPlayScreen | null>(null);
  const [quizGraph, setQuizGraph] = useState<QuizSection[] | null>(null);
  const [quizHistory, setQuizHistory] = useState<
    Array<QuizQuestionScreen & { selectedAnswerId: string | null }>
  >([]);
  const [quizSelectedAnswerId, setQuizSelectedAnswerId] = useState<string | null>(
    null,
  );
  const [axisLabelHeights, setAxisLabelHeights] = useState<Record<string, number>>(
    {},
  );
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
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
  const selectedResultsTextIdRef = useRef(selectedResultsTextId);
  const selectedResultsAxisIdRef = useRef(selectedResultsAxisId);
  const selectedResultsCompassIdRef = useRef(selectedResultsCompassId);
  const selectedResultsBarIdRef = useRef(selectedResultsBarId);
  const selectedResultsImageIdRef = useRef(selectedResultsImageId);
  const resultsPreviewRef = useRef(resultsPreview);
  const publishOpenRef = useRef(publishOpen);
  const listingRef = useRef(listing);
  const quizScreenRef = useRef(quizScreen);
  const quizTieBreaksRef = useRef<Record<string, number>>({});
  const quizReturnViewRef = useRef<"section" | "results">("section");
  const quizReturnPreviewRef = useRef(false);
  const exitQuizPlayRef = useRef<() => void>(() => {});
  const axisLabelHeightRef = useRef<Record<string, number>>({});
  const resultsRef = useRef(results);
  const editorViewRef = useRef(editorView);
  const resultsScaleRef = useRef(1);
  const resultsLeftInsetRef = useRef(0);
  const resultsBaseWidthRef = useRef(1);
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
  selectedResultsTextIdRef.current = selectedResultsTextId;
  selectedResultsAxisIdRef.current = selectedResultsAxisId;
  selectedResultsCompassIdRef.current = selectedResultsCompassId;
  selectedResultsBarIdRef.current = selectedResultsBarId;
  selectedResultsImageIdRef.current = selectedResultsImageId;
  resultsPreviewRef.current = resultsPreview;
  publishOpenRef.current = publishOpen;
  listingRef.current = listing;
  quizScreenRef.current = quizScreen;
  axisLabelHeightRef.current = axisLabelHeights;
  resultsRef.current = results;
  editorViewRef.current = editorView;
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

  const reportAxisLabelHeight = useCallback((axisId: string, height: number) => {
    if (axisLabelHeightRef.current[axisId] === height) return;
    axisLabelHeightRef.current = {
      ...axisLabelHeightRef.current,
      [axisId]: height,
    };
    setAxisLabelHeights((prev) =>
      prev[axisId] === height ? prev : { ...prev, [axisId]: height },
    );
  }, []);

  function axisLabelMinY(axisId: string) {
    return (
      (axisLabelHeightRef.current[axisId] ?? RESULTS_AXIS_LABEL_MIN_HEIGHT) +
      RESULTS_AXIS_LABEL_GAP
    );
  }

  const selectedBox = boxes.find((b) => b.id === selectedId) ?? null;
  const selectedQuestion =
    editorView === "section" && selectedBox?.kind === "question" ? selectedBox : null;
  const selectedEffectBlock =
    editorView === "section" && selectedBox && isEffectBlock(selectedBox)
      ? selectedBox
      : null;
  const selectedTransition =
    editorView === "section"
      ? (transitions.find((t) => t.id === selectedTransitionId) ?? null)
      : null;
  const selectedResultsText =
    editorView === "results"
      ? (results.textBoxes.find((box) => box.id === selectedResultsTextId) ?? null)
      : null;
  const selectedResultsAxis =
    editorView === "results"
      ? (results.axes.find((axis) => axis.id === selectedResultsAxisId) ?? null)
      : null;
  const selectedResultsCompass =
    editorView === "results"
      ? (results.compasses.find((item) => item.id === selectedResultsCompassId) ??
        null)
      : null;
  const selectedResultsBar =
    editorView === "results"
      ? ((results.bars ?? []).find((item) => item.id === selectedResultsBarId) ??
        null)
      : null;
  const selectedResultsImage =
    editorView === "results"
      ? ((results.images ?? []).find(
          (item) => item.id === selectedResultsImageId,
        ) ?? null)
      : null;
  const allVariables = quizScreen
    ? [...quizScreen.projectVariables, ...quizScreen.localVariables]
    : [...variables, ...localVariables];
  const hideEditorChrome = resultsPreview || quizScreen !== null || publishOpen;
  const isResultsView = editorView === "results";
  const resultsLeftInset =
    isResultsView &&
    !resultsPreview &&
    (selectedResultsText ||
      selectedResultsAxis ||
      selectedResultsCompass ||
      selectedResultsBar ||
      selectedResultsImage)
      ? SIDEBAR_WIDTH
      : 0;
  const resultsRightInset =
    isResultsView && !resultsPreview && settingsOpen ? SIDEBAR_WIDTH : 0;
  const resultsBaseWidth = Math.max(1, viewportSize.width);
  const resultsAvailableWidth = Math.max(
    1,
    resultsBaseWidth - resultsLeftInset - resultsRightInset,
  );
  const resultsScale = Math.min(1, resultsAvailableWidth / resultsBaseWidth);
  resultsScaleRef.current = resultsScale;
  resultsLeftInsetRef.current = resultsLeftInset;
  resultsBaseWidthRef.current = resultsBaseWidth;

  useEffect(() => {
    if (dragRef.current) return;
    setResults((prev) => {
      let changed = false;
      const axes = prev.axes.map((axis) => {
        const minY = axisLabelMinY(axis.id);
        const padded = clampResultsAxisForImages(
          axis,
          resultsBaseWidthRef.current,
        );
        const y = Math.max(padded.y, minY);
        if (
          padded.x === axis.x &&
          padded.width === axis.width &&
          y === axis.y
        ) {
          return axis;
        }
        changed = true;
        return { ...padded, y };
      });
      const compasses = prev.compasses.map((compass) => {
        const minY = axisLabelMinY(compass.id);
        const minX = RESULTS_COMPASS_SIDE_LABEL_WIDTH + RESULTS_COMPASS_LABEL_GAP;
        if (compass.y >= minY && compass.x >= minX) return compass;
        changed = true;
        return {
          ...compass,
          x: Math.max(compass.x, minX),
          y: Math.max(compass.y, minY),
        };
      });
      const bars = (prev.bars ?? []).map((bar) => {
        const minY = axisLabelMinY(bar.id);
        if (bar.y >= minY) return bar;
        changed = true;
        return { ...bar, y: minY };
      });
      const textBoxes = prev.textBoxes.map((box) => {
        if (!box.showImage || !box.imageAbove) return box;
        const minY = box.imageHeight + RESULTS_TEXT_IMAGE_GAP;
        if (box.y >= minY) return box;
        changed = true;
        return { ...box, y: minY };
      });
      return changed ? { ...prev, axes, compasses, bars, textBoxes } : prev;
    });
  }, [axisLabelHeights]);

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
      results: resultsRef.current,
      listing: listingRef.current,
    };
  }

  function getSnapshot(): EditorSnapshot {
    return {
      projectName: projectNameRef.current,
      variables: variablesRef.current,
      defaultAnswers: defaultAnswersRef.current,
      sections: getSectionsWithActive(),
      activeSectionId: activeSectionIdRef.current,
      results: resultsRef.current,
      listing: listingRef.current,
      editorView: editorViewRef.current,
      selectedId: selectedIdRef.current,
      selectedTransitionId: selectedTransitionIdRef.current,
      selectedResultsTextId: selectedResultsTextIdRef.current,
      selectedResultsAxisId: selectedResultsAxisIdRef.current,
      selectedResultsCompassId: selectedResultsCompassIdRef.current,
      selectedResultsBarId: selectedResultsBarIdRef.current,
      selectedResultsImageId: selectedResultsImageIdRef.current,
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
    resultsRef.current = next.results;
    listingRef.current = next.listing ?? emptyListing();
    editorViewRef.current = next.editorView;
    selectedIdRef.current = next.selectedId;
    selectedTransitionIdRef.current = next.selectedTransitionId;
    selectedResultsTextIdRef.current = next.selectedResultsTextId;
    selectedResultsAxisIdRef.current = next.selectedResultsAxisId;
    selectedResultsCompassIdRef.current = next.selectedResultsCompassId ?? null;
    selectedResultsBarIdRef.current = next.selectedResultsBarId ?? null;
    selectedResultsImageIdRef.current = next.selectedResultsImageId ?? null;
    setProjectName(next.projectName);
    setVariables(next.variables);
    setDefaultAnswers(next.defaultAnswers);
    setSections(next.sections);
    setActiveSectionId(active.id);
    setResults(next.results);
    setListing(next.listing ?? emptyListing());
    setEditorView(next.editorView);
    if (next.editorView === "results") {
      setSettingsPane("project");
    }
    loadSection(active);
    setSelectedId(next.selectedId);
    setSelectedTransitionId(next.selectedTransitionId);
    setSelectedResultsTextId(next.selectedResultsTextId);
    setSelectedResultsAxisId(next.selectedResultsAxisId);
    setSelectedResultsCompassId(next.selectedResultsCompassId ?? null);
    setSelectedResultsBarId(next.selectedResultsBarId ?? null);
    setSelectedResultsImageId(next.selectedResultsImageId ?? null);
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
  }

  function selectSection(sectionId: string) {
    if (
      sectionId === activeSectionIdRef.current &&
      editorViewRef.current === "section"
    ) {
      return;
    }
    const merged = getSectionsWithActive();
    const next = merged.find((s) => s.id === sectionId);
    if (!next) return;
    pushHistory();
    sectionsRef.current = merged;
    setSections(merged);
    activeSectionIdRef.current = next.id;
    setActiveSectionId(next.id);
    setEditorView("section");
    setSettingsPane((pane) => (pane === "results" ? "project" : pane));
    setResultsPreview(false);
    loadSection(next);
  }

  function openResultsView() {
    if (editorViewRef.current === "results") return;
    const merged = getSectionsWithActive();
    sectionsRef.current = merged;
    setSections(merged);
    setEditorView("results");
    setSettingsPane("project");
    setSelectedId(null);
    setSelectedTransitionId(null);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setTransitionDraft(null);
    setMenu(null);
    setResultsPreview(false);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = 0;
  }

  function enterResultsPreview() {
    setResultsPreview(true);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setMenu(null);
  }

  function exitResultsPreview() {
    setResultsPreview(false);
  }

  function showQuizResults() {
    setEditorView("results");
    setResultsPreview(true);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsBarId(null);
    setSelectedResultsImageId(null);
    setMenu(null);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = 0;
  }

  function startQuizPlay() {
    const graph = getSectionsWithActive();
    quizReturnViewRef.current = editorViewRef.current;
    quizReturnPreviewRef.current = resultsPreviewRef.current;
    setQuizGraph(graph);
    setQuizHistory([]);
    setQuizSelectedAnswerId(null);
    setMenu(null);
    setTransitionDraft(null);
    const screen = startQuiz(graph, variablesRef.current);
    quizTieBreaksRef.current = screen.tieBreaks;
    setQuizScreen(screen);
    if (screen.kind === "results") {
      showQuizResults();
    } else {
      setEditorView("section");
      setResultsPreview(false);
    }
  }

  function exitQuizPlay() {
    if (!quizScreenRef.current) return;
    setQuizScreen(null);
    setQuizGraph(null);
    setQuizHistory([]);
    setQuizSelectedAnswerId(null);
    quizTieBreaksRef.current = {};
    setEditorView(quizReturnViewRef.current);
    setResultsPreview(quizReturnPreviewRef.current);
  }

  function quizGoBack() {
    setQuizHistory((prev) => {
      if (prev.length === 0) return prev;
      const restored = prev[prev.length - 1];
      setQuizScreen({
        kind: "question",
        sectionId: restored.sectionId,
        boxId: restored.boxId,
        projectVariables: restored.projectVariables,
        localVariables: restored.localVariables,
        tieBreaks: restored.tieBreaks,
      });
      setQuizSelectedAnswerId(restored.selectedAnswerId);
      setEditorView("section");
      setResultsPreview(false);
      return prev.slice(0, -1);
    });
  }

  function quizGoNext() {
    const screen = quizScreenRef.current;
    if (!screen || screen.kind !== "question" || !quizGraph) return;
    const question = findQuestionBox(quizGraph, screen);
    const answers = question?.answers ?? [];
    if (answers.length > 0 && !quizSelectedAnswerId) return;

    const snapshot = {
      ...screen,
      selectedAnswerId: quizSelectedAnswerId,
    };
    const next = submitAnswer(
      quizGraph,
      screen,
      quizSelectedAnswerId,
      quizTieBreaksRef.current,
    );
    quizTieBreaksRef.current = next.tieBreaks;
    setQuizHistory((prev) => [...prev, snapshot]);
    setQuizSelectedAnswerId(null);
    setQuizScreen(next);
    if (next.kind === "results") {
      showQuizResults();
    } else {
      setEditorView("section");
      setResultsPreview(false);
    }
  }

  exitQuizPlayRef.current = exitQuizPlay;

  function onSectionSelectChange(value: string) {
    if (value === RESULTS_VIEW_ID) {
      openResultsView();
      return;
    }
    selectSection(value);
  }

  function createSection() {
    pushHistory();
    const merged = getSectionsWithActive();
    const created = emptySection(merged.map((s) => s.name)) as QuizSection;
    const viewport = viewportRef.current;
    const vw = viewport?.clientWidth ?? 0;
    const vh = viewport?.clientHeight ?? 0;
    if (vw > 0 && vh > 0 && editorViewRef.current === "section") {
      const center = cameraCenterWorld(created.camera, vw, vh);
      created.boxes = created.boxes.map((box) =>
        box.kind === "start" ? { ...box, x: center.x, y: center.y } : box,
      );
    } else if (vw > 0 && vh > 0) {
      created.boxes = created.boxes.map((box) =>
        box.kind === "start" ? { ...box, x: vw / 2, y: vh / 2 } : box,
      );
    }
    const nextSections = [...merged, created];
    sectionsRef.current = nextSections;
    setSections(nextSections);
    activeSectionIdRef.current = created.id;
    setActiveSectionId(created.id);
    setEditorView("section");
    loadSection(created);
    setSettingsPane("section");
    setSettingsOpen(true);
  }

  function deleteActiveSection() {
    const merged = getSectionsWithActive();
    if (merged.length <= 1) {
      setDeleteSectionConfirmOpen(false);
      return;
    }

    const deletedId = activeSectionIdRef.current;
    const deletedIndex = merged.findIndex((section) => section.id === deletedId);
    pushHistory();

    const remaining = merged
      .filter((section) => section.id !== deletedId)
      .map((section) => ({
        ...section,
        boxes: section.boxes.map((box) =>
          box.kind === "section-changer" && box.targetSection === deletedId
            ? { ...box, targetSection: "next" as const }
            : box,
        ),
      }));
    const next =
      remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)] ??
      remaining[0];

    sectionsRef.current = remaining;
    setSections(remaining);
    activeSectionIdRef.current = next.id;
    setActiveSectionId(next.id);
    setEditorView("section");
    loadSection(next);
    setSelectedId(null);
    setSelectedTransitionId(null);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setTransitionDraft(null);
    setMenu(null);
    setDeleteSectionConfirmOpen(false);
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
    const persistDelay = getToken() ? 500 : 200;
    const timeoutId = window.setTimeout(() => {
      persistQuiz(getPersistedQuiz());
    }, persistDelay);
    return () => window.clearTimeout(timeoutId);
  }, [projectName, sectionName, sections, activeSectionId, boxes, variables, localVariables, defaultAnswers, localDefaultAnswers, transitions, camera, results, listing]);

  useEffect(() => {
    const flush = () => persistQuiz(getPersistedQuiz(), { keepalive: true });
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
    if (editorViewRef.current === "results") return;
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
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      setViewportSize({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [editorView]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (quizScreenRef.current) {
          e.preventDefault();
          exitQuizPlayRef.current();
          return;
        }
        if (publishOpenRef.current) {
          e.preventDefault();
          setPublishOpen(false);
          return;
        }
        if (resultsPreviewRef.current) {
          e.preventDefault();
          setResultsPreview(false);
          return;
        }
        if (transitionDraftRef.current) {
          setTransitionDraft(null);
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (quizScreenRef.current) return;
      if (publishOpenRef.current) return;

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
      if (editorViewRef.current === "results") return;
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
        if (
          (drag.type === "box" ||
            drag.type === "results-text" ||
            drag.type === "results-resize") &&
          !drag.historyPushed &&
          drag.preDragSnapshot
        ) {
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

      if (drag.type === "results-text") {
        if (
          !drag.boxId ||
          drag.originX === undefined ||
          drag.originY === undefined ||
          drag.originWidth === undefined ||
          drag.originHeight === undefined
        ) {
          return;
        }
        if (document.activeElement instanceof HTMLElement) {
          const active = document.activeElement;
          if (active.closest("[data-results-text]")) active.blur();
        }
        const scale = Math.max(0.001, resultsScaleRef.current);
        const pageWidth = resultsBaseWidthRef.current;
        const viewportHeight = viewportRef.current?.clientHeight ?? 800;
        const totalDx = (e.clientX - drag.startX) / scale;
        const totalDy = (e.clientY - drag.startY) / scale;
        let nextX = drag.originX + totalDx;
        let nextY = drag.originY + totalDy;
        const width = drag.originWidth;
        const height = drag.originHeight;
        const el = viewportRef.current;
        const viewportRect = el?.getBoundingClientRect();
        const leftInset = resultsLeftInsetRef.current;
        const mouseX = viewportRect
          ? (e.clientX - viewportRect.left - leftInset + (el?.scrollLeft ?? 0)) / scale
          : nextX;
        const mouseY = viewportRect
          ? Math.max(0, (e.clientY - viewportRect.top + (el?.scrollTop ?? 0)) / scale)
          : nextY;
        const axisPad =
          drag.resultsItemKind === "axis"
            ? resultsAxisImagePad(
                resultsRef.current.axes.find((axis) => axis.id === drag.boxId),
              )
            : 0;
        if (e.ctrlKey) {
          const { stepX, stepY } = resultsGridSteps(
            pageWidth,
            viewportHeight,
            resultsRef.current.horizontalTicks,
            resultsRef.current.verticalTicks,
          );
          ({ x: nextX, y: nextY } = snapResultsBoxToGrid(
            nextX,
            nextY,
            width,
            height,
            mouseX,
            mouseY,
            stepX,
            stepY,
          ));
        }
        setResults((prev) => {
          const pageHeight = Math.max(
            resultsContentHeight(prev, viewportHeight),
            nextY + height + RESULTS_PAGE_BOTTOM_PAD,
          );
          const next = clampResultsTextBoxPosition(
            nextX,
            nextY,
            width,
            pageWidth - axisPad,
            pageHeight,
            height,
            drag.resultsItemKind === "text" && drag.boxId
              ? (() => {
                  const box = resultsRef.current.textBoxes.find(
                    (item) => item.id === drag.boxId,
                  );
                  return box?.showImage && box.imageAbove
                    ? box.imageHeight + RESULTS_TEXT_IMAGE_GAP
                    : 0;
                })()
              : (drag.resultsItemKind === "axis" ||
                  drag.resultsItemKind === "compass" ||
                  drag.resultsItemKind === "bar") &&
                  drag.boxId
                ? axisLabelMinY(drag.boxId)
                : 0,
            drag.resultsItemKind === "compass"
              ? RESULTS_COMPASS_SIDE_LABEL_WIDTH + RESULTS_COMPASS_LABEL_GAP
              : axisPad,
          );
          return patchResultsRect(prev, drag.boxId!, next);
        });
        return;
      }

      if (drag.type === "results-resize") {
        if (
          !drag.boxId ||
          !drag.resizeHandle ||
          drag.originX === undefined ||
          drag.originY === undefined ||
          drag.originWidth === undefined ||
          drag.originHeight === undefined
        ) {
          return;
        }
        const scale = Math.max(0.001, resultsScaleRef.current);
        const pageWidth = resultsBaseWidthRef.current;
        const viewportHeight = viewportRef.current?.clientHeight ?? 800;
        const totalDx = (e.clientX - drag.startX) / scale;
        const totalDy = (e.clientY - drag.startY) / scale;
        const el = viewportRef.current;
        const viewportRect = el?.getBoundingClientRect();
        const leftInset = resultsLeftInsetRef.current;
        const mouseX = viewportRect
          ? (e.clientX - viewportRect.left - leftInset + (el?.scrollLeft ?? 0)) / scale
          : drag.originX! + totalDx;
        const mouseY = viewportRect
          ? Math.max(0, (e.clientY - viewportRect.top + (el?.scrollTop ?? 0)) / scale)
          : drag.originY! + totalDy;
        const snapSteps = e.ctrlKey
          ? {
              ...resultsGridSteps(
                pageWidth,
                viewportHeight,
                resultsRef.current.horizontalTicks,
                resultsRef.current.verticalTicks,
              ),
              mouseX,
              mouseY,
            }
          : null;
        const kind = drag.resultsItemKind ?? "text";
        const axisPad =
          kind === "axis"
            ? resultsAxisImagePad(
                resultsRef.current.axes.find((axis) => axis.id === drag.boxId),
              )
            : 0;
        const limits = {
          ...resultsItemSizeLimits(kind),
          ...(kind === "axis" && drag.boxId
            ? {
                minY: axisLabelMinY(drag.boxId),
                ...(axisPad > 0 ? { minX: axisPad } : {}),
              }
            : {}),
          ...(kind === "compass" && drag.boxId
            ? { minY: axisLabelMinY(drag.boxId) }
            : {}),
          ...(kind === "bar" && drag.boxId
            ? { minY: axisLabelMinY(drag.boxId) }
            : {}),
          ...(kind === "text" && drag.boxId
            ? (() => {
                const box = resultsRef.current.textBoxes.find(
                  (item) => item.id === drag.boxId,
                );
                return box?.showImage && box.imageAbove
                  ? { minY: box.imageHeight + RESULTS_TEXT_IMAGE_GAP }
                  : {};
              })()
            : {}),
        };
        setResults((prev) => {
          const pageHeight = Math.max(
            resultsContentHeight(prev, viewportHeight),
            drag.originY! + drag.originHeight! + RESULTS_PAGE_BOTTOM_PAD,
            drag.originY! + limits.maxHeight + RESULTS_PAGE_BOTTOM_PAD,
          );
          const resized = resizeResultsTextBox(
            drag.resizeHandle!,
            {
              x: drag.originX!,
              y: drag.originY!,
              width: drag.originWidth!,
              height: drag.originHeight!,
            },
            totalDx,
            totalDy,
            pageWidth - axisPad,
            pageHeight,
            snapSteps,
            limits,
          );
          if (kind === "text-image") {
            return {
              ...prev,
              textBoxes: prev.textBoxes.map((item) =>
                item.id === drag.boxId
                  ? {
                      ...item,
                      imageWidth: resized.width,
                      imageHeight: resized.height,
                      imageOffsetX: resized.x - item.x,
                    }
                  : item,
              ),
            };
          }
          let next = patchResultsRect(prev, drag.boxId!, resized);
          if (kind === "axis") {
            const axis = next.axes.find((item) => item.id === drag.boxId);
            if (axis) {
              const clamped = clampResultsAxisForImages(axis, pageWidth);
              if (clamped !== axis) {
                next = patchResultsRect(next, drag.boxId!, {
                  x: clamped.x,
                  width: clamped.width,
                });
              }
            }
          }
          return next;
        });
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
      const resultsItemKind = drag.resultsItemKind;

      dragRef.current = null;
      setDragKind(null);
      setDraggingBoxId(null);
      document.body.style.cursor = "";

      if (type === "box" && wasClick && boxId) {
        setSelectedId(boxId);
        setSelectedTransitionId(null);
        return;
      }

      if (
        (type === "results-text" || type === "results-resize") &&
        wasClick &&
        boxId
      ) {
        if (resultsItemKind === "compass") {
          setSelectedResultsCompassId(boxId);
          setSelectedResultsTextId(null);
          setSelectedResultsAxisId(null);
          setSelectedResultsBarId(null);
          setSelectedResultsImageId(null);
        } else if (resultsItemKind === "bar") {
          setSelectedResultsBarId(boxId);
          setSelectedResultsTextId(null);
          setSelectedResultsAxisId(null);
          setSelectedResultsCompassId(null);
          setSelectedResultsImageId(null);
        } else if (resultsItemKind === "image") {
          setSelectedResultsImageId(boxId);
          setSelectedResultsTextId(null);
          setSelectedResultsAxisId(null);
          setSelectedResultsCompassId(null);
          setSelectedResultsBarId(null);
        } else if (resultsItemKind === "axis") {
          setSelectedResultsAxisId(boxId);
          setSelectedResultsTextId(null);
          setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
        } else {
          setSelectedResultsTextId(boxId);
          setSelectedResultsAxisId(null);
          setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
        }
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

  function onResultsContextMenu(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault();
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scale = Math.max(0.001, resultsScaleRef.current);
    const leftInset = resultsLeftInsetRef.current;
    const contentX =
      (e.clientX - rect.left - leftInset + el.scrollLeft) / scale;
    const contentY = Math.max(
      0,
      (e.clientY - rect.top + el.scrollTop) / scale,
    );
    setMenu({
      kind: "results-canvas",
      screenX: e.clientX,
      screenY: e.clientY,
      contentX,
      contentY,
    });
  }

  function onResultsTextContextMenu(
    e: React.MouseEvent<HTMLElement>,
    textId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedResultsTextId(textId);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setMenu({
      kind: "results-text",
      screenX: e.clientX,
      screenY: e.clientY,
      textId,
    });
  }

  function onResultsAxisContextMenu(
    e: React.MouseEvent<HTMLElement>,
    axisId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedResultsAxisId(axisId);
    setSelectedResultsTextId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setMenu({
      kind: "results-axis",
      screenX: e.clientX,
      screenY: e.clientY,
      axisId,
    });
  }

  function onResultsCompassContextMenu(
    e: React.MouseEvent<HTMLElement>,
    compassId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedResultsCompassId(compassId);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsBarId(null);
    setSelectedResultsImageId(null);
    setMenu({
      kind: "results-compass",
      screenX: e.clientX,
      screenY: e.clientY,
      compassId,
    });
  }

  function onResultsBarContextMenu(
    e: React.MouseEvent<HTMLElement>,
    barId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedResultsBarId(barId);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsImageId(null);
    setMenu({
      kind: "results-bar",
      screenX: e.clientX,
      screenY: e.clientY,
      barId,
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
    setDraggingBoxId(
      state.type === "box" ||
        state.type === "results-text" ||
        state.type === "results-resize"
        ? (state.boxId ?? null)
        : null,
    );
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

  function onResultsPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-results-text]")) return;
    if ((e.target as HTMLElement).closest("[data-results-axis]")) return;
    if ((e.target as HTMLElement).closest("[data-results-compass]")) return;
    if ((e.target as HTMLElement).closest("[data-results-bar]")) return;
    if ((e.target as HTMLElement).closest("[data-results-image]")) return;
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setMenu(null);
  }

  function onResultsTextPointerDown(
    e: React.PointerEvent<HTMLElement>,
    textId: string,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest("[data-results-resize]")) return;
    const inEditor = Boolean(target.closest("[data-results-editor]"));
    const alreadySelected = selectedResultsTextIdRef.current === textId;

    // Editing inside an already-selected box should not start a drag.
    if (inEditor && alreadySelected) return;

    e.preventDefault();
    const box = resultsRef.current.textBoxes.find((item) => item.id === textId);
    if (!box) return;
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    beginDrag({
      type: "results-text",
      pointerId: e.pointerId,
      boxId: textId,
      resultsItemKind: "text",
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      originX: box.x,
      originY: box.y,
      originWidth: box.width,
      originHeight: box.height,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
  }

  function onResultsAxisPointerDown(
    e: React.PointerEvent<HTMLElement>,
    axisId: string,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest("[data-results-resize]")) return;
    const alreadySelected = selectedResultsAxisIdRef.current === axisId;
    if (target.closest("[data-results-editor]") && alreadySelected) return;

    e.preventDefault();
    const axis = resultsRef.current.axes.find((item) => item.id === axisId);
    if (!axis) return;
    setSelectedResultsTextId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    beginDrag({
      type: "results-text",
      pointerId: e.pointerId,
      boxId: axisId,
      resultsItemKind: "axis",
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      originX: axis.x,
      originY: axis.y,
      originWidth: axis.width,
      originHeight: axis.height,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
  }

  function onResultsCompassPointerDown(
    e: React.PointerEvent<HTMLElement>,
    compassId: string,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest("[data-results-resize]")) return;
    const alreadySelected = selectedResultsCompassIdRef.current === compassId;
    if (target.closest("[data-results-editor]") && alreadySelected) return;

    e.preventDefault();
    const compass = resultsRef.current.compasses.find((item) => item.id === compassId);
    if (!compass) return;
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsBarId(null);
    setSelectedResultsImageId(null);
    beginDrag({
      type: "results-text",
      pointerId: e.pointerId,
      boxId: compassId,
      resultsItemKind: "compass",
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      originX: compass.x,
      originY: compass.y,
      originWidth: compass.width,
      originHeight: compass.height,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
  }

  function onResultsBarPointerDown(
    e: React.PointerEvent<HTMLElement>,
    barId: string,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest("[data-results-resize]")) return;
    const alreadySelected = selectedResultsBarIdRef.current === barId;
    if (target.closest("[data-results-editor]") && alreadySelected) return;

    e.preventDefault();
    const bar = (resultsRef.current.bars ?? []).find((item) => item.id === barId);
    if (!bar) return;
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsImageId(null);
    beginDrag({
      type: "results-text",
      pointerId: e.pointerId,
      boxId: barId,
      resultsItemKind: "bar",
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      originX: bar.x,
      originY: bar.y,
      originWidth: bar.width,
      originHeight: bar.height,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
  }

  function onResultsImagePointerDown(
    e: React.PointerEvent<HTMLElement>,
    imageId: string,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const target = e.target as HTMLElement;
    if (target.closest("[data-results-resize]")) return;

    e.preventDefault();
    const image = (resultsRef.current.images ?? []).find(
      (item) => item.id === imageId,
    );
    if (!image) return;
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsBarId(null);
    beginDrag({
      type: "results-text",
      pointerId: e.pointerId,
      boxId: imageId,
      resultsItemKind: "image",
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      originX: image.x,
      originY: image.y,
      originWidth: image.width,
      originHeight: image.height,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
  }

  function onResultsImageContextMenu(
    e: React.MouseEvent<HTMLElement>,
    imageId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedResultsImageId(imageId);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsBarId(null);
    setMenu({
      kind: "results-image",
      screenX: e.clientX,
      screenY: e.clientY,
      imageId,
    });
  }

  function onResultsResizePointerDown(
    e: React.PointerEvent<HTMLElement>,
    itemId: string,
    handle: ResultsResizeHandle,
    kindOverride?: ResultsItemKind,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    if (kindOverride === "text-image") {
      const box = resultsRef.current.textBoxes.find((item) => item.id === itemId);
      if (!box?.showImage) return;
      const rect = resultsTextAttachedImageRect(box);
      setSelectedResultsTextId(itemId);
      setSelectedResultsAxisId(null);
      setSelectedResultsCompassId(null);
      setSelectedResultsBarId(null);
      setSelectedResultsImageId(null);
      const cursor =
        RESULTS_RESIZE_HANDLES.find((entry) => entry.handle === handle)?.cursor ??
        "nwse-resize";
      beginDrag({
        type: "results-resize",
        pointerId: e.pointerId,
        boxId: itemId,
        resultsItemKind: "text-image",
        lastX: e.clientX,
        lastY: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        resizeHandle: handle,
        originX: rect.x,
        originY: rect.y,
        originWidth: rect.width,
        originHeight: rect.height,
        resizeCursor: cursor,
        historyPushed: false,
        preDragSnapshot: cloneSnapshot(getSnapshot()),
      });
      document.body.style.cursor = cursor;
      return;
    }

    const item = findResultsRect(resultsRef.current, itemId);
    if (!item) return;

    if (item.kind === "compass") {
      setSelectedResultsCompassId(itemId);
      setSelectedResultsTextId(null);
      setSelectedResultsAxisId(null);
      setSelectedResultsBarId(null);
      setSelectedResultsImageId(null);
    } else if (item.kind === "bar") {
      setSelectedResultsBarId(itemId);
      setSelectedResultsTextId(null);
      setSelectedResultsAxisId(null);
      setSelectedResultsCompassId(null);
      setSelectedResultsImageId(null);
    } else if (item.kind === "image") {
      setSelectedResultsImageId(itemId);
      setSelectedResultsTextId(null);
      setSelectedResultsAxisId(null);
      setSelectedResultsCompassId(null);
      setSelectedResultsBarId(null);
    } else if (item.kind === "axis") {
      setSelectedResultsAxisId(itemId);
      setSelectedResultsTextId(null);
      setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    } else {
      setSelectedResultsTextId(itemId);
      setSelectedResultsAxisId(null);
      setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    }
    const cursor =
      RESULTS_RESIZE_HANDLES.find((entry) => entry.handle === handle)?.cursor ??
      "nwse-resize";
    beginDrag({
      type: "results-resize",
      pointerId: e.pointerId,
      boxId: itemId,
      resultsItemKind: item.kind,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      resizeHandle: handle,
      originX: item.x,
      originY: item.y,
      originWidth: item.width,
      originHeight: item.height,
      resizeCursor: cursor,
      historyPushed: false,
      preDragSnapshot: cloneSnapshot(getSnapshot()),
    });
    document.body.style.cursor = cursor;
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

  function createResultsTextBox() {
    if (!menu || menu.kind !== "results-canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    const pageWidth = resultsBaseWidthRef.current;
    const pageHeight = resultsContentHeight(
      resultsRef.current,
      viewportRef.current?.clientHeight ?? 800,
    );
    const position = clampResultsTextBoxPosition(
      menu.contentX,
      menu.contentY,
      RESULTS_TEXT_DEFAULT_WIDTH,
      pageWidth,
      Math.max(
        pageHeight,
        menu.contentY + RESULTS_TEXT_DEFAULT_HEIGHT + RESULTS_PAGE_BOTTOM_PAD,
      ),
      RESULTS_TEXT_DEFAULT_HEIGHT,
    );
    setResults((prev) => ({
      ...prev,
      textBoxes: [
        ...prev.textBoxes,
        {
          id,
          x: position.x,
          y: position.y,
          width: RESULTS_TEXT_DEFAULT_WIDTH,
          height: RESULTS_TEXT_DEFAULT_HEIGHT,
          segments: emptyResultsSegments(),
          fontSize: RESULTS_FONT_SIZE_DEFAULT,
          textAlign: "left",
          showImage: false,
          image: "",
          imageAbove: false,
          imageWidth: RESULTS_TEXT_IMAGE_DEFAULT_SIZE,
          imageHeight: RESULTS_TEXT_IMAGE_DEFAULT_SIZE,
          imageOffsetX:
            (RESULTS_TEXT_DEFAULT_WIDTH - RESULTS_TEXT_IMAGE_DEFAULT_SIZE) / 2,
        },
      ],
    }));
    setSelectedResultsTextId(id);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setMenu(null);
  }

  function createResultsAxis() {
    if (!menu || menu.kind !== "results-canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    const pageWidth = resultsBaseWidthRef.current;
    const width = Math.min(
      RESULTS_AXIS_DEFAULT_WIDTH,
      Math.max(RESULTS_AXIS_MIN_WIDTH, pageWidth - 32),
    );
    const pageHeight = resultsContentHeight(
      resultsRef.current,
      viewportRef.current?.clientHeight ?? 800,
    );
    const position = clampResultsTextBoxPosition(
      menu.contentX,
      Math.max(menu.contentY, RESULTS_AXIS_LABEL_OFFSET),
      width,
      pageWidth,
      Math.max(
        pageHeight,
        menu.contentY + RESULTS_AXIS_DEFAULT_HEIGHT + RESULTS_PAGE_BOTTOM_PAD,
      ),
      RESULTS_AXIS_DEFAULT_HEIGHT,
      RESULTS_AXIS_LABEL_OFFSET,
    );
    setResults((prev) => ({
      ...prev,
      axes: [
        ...prev.axes,
        {
          id,
          x: position.x,
          y: position.y,
          width,
          height: RESULTS_AXIS_DEFAULT_HEIGHT,
          segments: emptyResultsSegments(),
          leftSegments: emptyResultsSegments(),
          rightSegments: emptyResultsSegments(),
          centerFontSize: RESULTS_FONT_SIZE_DEFAULT,
          leftFontSize: RESULTS_FONT_SIZE_DEFAULT,
          rightFontSize: RESULTS_FONT_SIZE_DEFAULT,
          percentageVariableId: "",
          leftColor: RESULTS_AXIS_LEFT_COLOR,
          rightColor: RESULTS_AXIS_RIGHT_COLOR,
          showImages: false,
          leftImage: "",
          rightImage: "",
        },
      ],
    }));
    setSelectedResultsAxisId(id);
    setSelectedResultsTextId(null);
    setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    setMenu(null);
  }

  function createResultsCompass() {
    if (!menu || menu.kind !== "results-canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    const pageWidth = resultsBaseWidthRef.current;
    const minX = RESULTS_COMPASS_SIDE_LABEL_WIDTH + RESULTS_COMPASS_LABEL_GAP;
    const size = Math.min(
      RESULTS_COMPASS_DEFAULT_SIZE,
      Math.max(RESULTS_COMPASS_MIN_SIZE, pageWidth - minX - 32),
    );
    const pageHeight = resultsContentHeight(
      resultsRef.current,
      viewportRef.current?.clientHeight ?? 800,
    );
    const position = clampResultsTextBoxPosition(
      menu.contentX,
      Math.max(menu.contentY, RESULTS_COMPASS_LABEL_OFFSET),
      size,
      pageWidth,
      Math.max(
        pageHeight,
        menu.contentY + size + RESULTS_COMPASS_LABEL_OFFSET + RESULTS_PAGE_BOTTOM_PAD,
      ),
      size,
      RESULTS_COMPASS_LABEL_OFFSET,
      minX,
    );
    setResults((prev) => ({
      ...prev,
      compasses: [
        ...prev.compasses,
        {
          id,
          x: position.x,
          y: position.y,
          width: size,
          height: size,
          topSegments: [{ id: crypto.randomUUID(), kind: "text", text: "Authoritarian" }],
          bottomSegments: [{ id: crypto.randomUUID(), kind: "text", text: "Libertarian" }],
          leftSegments: [{ id: crypto.randomUUID(), kind: "text", text: "Left" }],
          rightSegments: [{ id: crypto.randomUUID(), kind: "text", text: "Right" }],
          topFontSize: RESULTS_FONT_SIZE_DEFAULT,
          bottomFontSize: RESULTS_FONT_SIZE_DEFAULT,
          leftFontSize: RESULTS_FONT_SIZE_DEFAULT,
          rightFontSize: RESULTS_FONT_SIZE_DEFAULT,
          xVariableId: "",
          yVariableId: "",
          topLeftColor: RESULTS_COMPASS_TOP_LEFT_COLOR,
          topRightColor: RESULTS_COMPASS_TOP_RIGHT_COLOR,
          bottomLeftColor: RESULTS_COMPASS_BOTTOM_LEFT_COLOR,
          bottomRightColor: RESULTS_COMPASS_BOTTOM_RIGHT_COLOR,
        },
      ],
    }));
    setSelectedResultsCompassId(id);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsBarId(null);
    setSelectedResultsImageId(null);
    setMenu(null);
  }

  function createResultsBar() {
    if (!menu || menu.kind !== "results-canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    const pageWidth = resultsBaseWidthRef.current;
    const width = Math.min(
      RESULTS_BAR_DEFAULT_WIDTH,
      Math.max(RESULTS_BAR_MIN_WIDTH, pageWidth - 32),
    );
    const height = RESULTS_BAR_DEFAULT_HEIGHT;
    const pageHeight = resultsContentHeight(
      resultsRef.current,
      viewportRef.current?.clientHeight ?? 800,
    );
    const position = clampResultsTextBoxPosition(
      menu.contentX,
      Math.max(menu.contentY, RESULTS_BAR_LABEL_OFFSET),
      width,
      pageWidth,
      Math.max(
        pageHeight,
        menu.contentY + height + RESULTS_BAR_LABEL_OFFSET + RESULTS_PAGE_BOTTOM_PAD,
      ),
      height,
      RESULTS_BAR_LABEL_OFFSET,
    );
    setResults((prev) => ({
      ...prev,
      bars: [
        ...(prev.bars ?? []),
        {
          id,
          x: position.x,
          y: position.y,
          width,
          height,
          segments: emptyResultsSegments(),
          fontSize: RESULTS_FONT_SIZE_DEFAULT,
          variableId: "",
          asPercent: false,
          min: 0,
          max: 100,
          showImage: false,
          image: "",
        },
      ],
    }));
    setSelectedResultsBarId(id);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsImageId(null);
    setMenu(null);
  }

  function createResultsImage() {
    if (!menu || menu.kind !== "results-canvas") return;
    pushHistory();
    const id = crypto.randomUUID();
    const pageWidth = resultsBaseWidthRef.current;
    const size = RESULTS_IMAGE_DEFAULT_SIZE;
    const pageHeight = resultsContentHeight(
      resultsRef.current,
      viewportRef.current?.clientHeight ?? 800,
    );
    const position = clampResultsTextBoxPosition(
      menu.contentX,
      menu.contentY,
      size,
      pageWidth,
      Math.max(
        pageHeight,
        menu.contentY + size + RESULTS_PAGE_BOTTOM_PAD,
      ),
      size,
    );
    setResults((prev) => ({
      ...prev,
      images: [
        ...(prev.images ?? []),
        {
          id,
          x: position.x,
          y: position.y,
          width: size,
          height: size,
          src: "",
        },
      ],
    }));
    setSelectedResultsImageId(id);
    setSelectedResultsTextId(null);
    setSelectedResultsAxisId(null);
    setSelectedResultsCompassId(null);
    setSelectedResultsBarId(null);
    setMenu(null);
  }

  function deleteResultsTextBox() {
    if (!menu || menu.kind !== "results-text") return;
    const textId = menu.textId;
    pushHistory();
    setResults((prev) => ({
      ...prev,
      textBoxes: prev.textBoxes.filter((box) => box.id !== textId),
    }));
    if (selectedResultsTextIdRef.current === textId) {
      setSelectedResultsTextId(null);
    }
    setMenu(null);
  }

  function deleteResultsAxis() {
    if (!menu || menu.kind !== "results-axis") return;
    const axisId = menu.axisId;
    pushHistory();
    setResults((prev) => ({
      ...prev,
      axes: prev.axes.filter((axis) => axis.id !== axisId),
    }));
    if (selectedResultsAxisIdRef.current === axisId) {
      setSelectedResultsAxisId(null);
    }
    setMenu(null);
  }

  function deleteResultsCompass() {
    if (!menu || menu.kind !== "results-compass") return;
    const compassId = menu.compassId;
    pushHistory();
    setResults((prev) => ({
      ...prev,
      compasses: prev.compasses.filter((item) => item.id !== compassId),
    }));
    if (selectedResultsCompassIdRef.current === compassId) {
      setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
    }
    setMenu(null);
  }

  function deleteResultsBar() {
    if (!menu || menu.kind !== "results-bar") return;
    const barId = menu.barId;
    pushHistory();
    setResults((prev) => ({
      ...prev,
      bars: (prev.bars ?? []).filter((item) => item.id !== barId),
    }));
    if (selectedResultsBarIdRef.current === barId) {
      setSelectedResultsBarId(null);
    }
    setMenu(null);
  }

  function deleteResultsImage() {
    if (!menu || menu.kind !== "results-image") return;
    const imageId = menu.imageId;
    pushHistory();
    setResults((prev) => ({
      ...prev,
      images: (prev.images ?? []).filter((item) => item.id !== imageId),
    }));
    if (selectedResultsImageIdRef.current === imageId) {
      setSelectedResultsImageId(null);
    }
    setMenu(null);
  }

  function updateResultsTextBox(id: string, patch: Partial<ResultsTextBox>) {
    setResults((prev) => ({
      ...prev,
      textBoxes: prev.textBoxes.map((box) =>
        box.id === id ? { ...box, ...patch } : box,
      ),
    }));
  }

  function updateResultsAxis(id: string, patch: Partial<ResultsAxis>) {
    setResults((prev) => ({
      ...prev,
      axes: prev.axes.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function updateResultsCompass(id: string, patch: Partial<ResultsCompass>) {
    setResults((prev) => ({
      ...prev,
      compasses: prev.compasses.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function updateResultsBar(id: string, patch: Partial<ResultsBar>) {
    setResults((prev) => ({
      ...prev,
      bars: (prev.bars ?? []).map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function updateResultsImage(id: string, patch: Partial<ResultsImage>) {
    setResults((prev) => ({
      ...prev,
      images: (prev.images ?? []).map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function updateResultsSettings(
    patch: Partial<
      Pick<ResultsDocument, "gridVisible" | "horizontalTicks" | "verticalTicks">
    >,
  ) {
    setResults((prev) => ({
      ...prev,
      ...patch,
      horizontalTicks:
        patch.horizontalTicks !== undefined
          ? normalizeGridTicks(patch.horizontalTicks)
          : prev.horizontalTicks,
      verticalTicks:
        patch.verticalTicks !== undefined
          ? normalizeGridTicks(patch.verticalTicks)
          : prev.verticalTicks,
    }));
  }

  function addVariableToSelectedResultsText() {
    if (!selectedResultsText) return;
    pushHistory();
    const variableId = allVariables[0]?.id ?? "";
    updateResultsTextBox(selectedResultsText.id, {
      segments: [
        ...selectedResultsText.segments,
        { id: crypto.randomUUID(), kind: "variable", variableId },
        { id: crypto.randomUUID(), kind: "text", text: "" },
      ],
    });
  }

  function addVariableToSelectedResultsAxis(
    field: "segments" | "leftSegments" | "rightSegments" = "segments",
  ) {
    if (!selectedResultsAxis) return;
    pushHistory();
    const variableId = allVariables[0]?.id ?? "";
    updateResultsAxis(selectedResultsAxis.id, {
      [field]: [
        ...selectedResultsAxis[field],
        { id: crypto.randomUUID(), kind: "variable", variableId },
        { id: crypto.randomUUID(), kind: "text", text: "" },
      ],
    });
  }

  function addVariableToSelectedResultsCompass(
    field: "topSegments" | "bottomSegments" | "leftSegments" | "rightSegments",
  ) {
    if (!selectedResultsCompass) return;
    pushHistory();
    const variableId = allVariables[0]?.id ?? "";
    updateResultsCompass(selectedResultsCompass.id, {
      [field]: [
        ...selectedResultsCompass[field],
        { id: crypto.randomUUID(), kind: "variable", variableId },
        { id: crypto.randomUUID(), kind: "text", text: "" },
      ],
    });
  }

  function addVariableToSelectedResultsBar() {
    if (!selectedResultsBar) return;
    pushHistory();
    const variableId = allVariables[0]?.id ?? "";
    updateResultsBar(selectedResultsBar.id, {
      segments: [
        ...selectedResultsBar.segments,
        { id: crypto.randomUUID(), kind: "variable", variableId },
        { id: crypto.randomUUID(), kind: "text", text: "" },
      ],
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
        answers: cloneAnswersWithNewIds(
          localDefaultAnswersRef.current.length > 0
            ? localDefaultAnswersRef.current
            : defaultAnswersRef.current,
        ),
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
            fallback: false,
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
    setTransitions((prev) => {
      const moving = prev.find((t) => t.id === draft.transitionId);
      const conflict =
        Boolean(moving?.fallback) &&
        prev.some(
          (t) =>
            t.id !== draft.transitionId &&
            t.fromId === target.id &&
            t.fallback,
        );
      return prev.map((t) =>
        t.id === draft.transitionId
          ? { ...t, fromId: target.id, fallback: conflict ? false : t.fallback }
          : t,
      );
    });
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

  const resultsPageHeight = resultsContentHeight(
    results,
    viewportRef.current?.clientHeight ?? 800,
  );
  const resultsGrid = resultsGridSteps(
    resultsBaseWidth,
    viewportRef.current?.clientHeight ?? 800,
    results.horizontalTicks,
    results.verticalTicks,
  );

  const cursorClass = isResultsView
    ? "cursor-default"
    : dragKind === "pan"
      ? "cursor-grabbing"
      : dragKind === "box"
        ? "cursor-move"
        : "cursor-grab";

  const showProjectSettings = settingsPane === "project";
  const showResultsSettings = isResultsView && settingsPane === "results";
  const showSectionSettings = !isResultsView && settingsPane === "section";
  const quizQuestionBox =
    quizScreen?.kind === "question" && quizGraph
      ? findQuestionBox(quizGraph, quizScreen)
      : null;
  const quizAnswers = quizQuestionBox?.answers ?? [];
  const quizCanGoNext =
    Boolean(quizQuestionBox) &&
    (quizAnswers.length === 0 || quizSelectedAnswerId !== null);
  const quizCanGoBack = quizHistory.length > 0;

  function savePublishListing() {
    persistQuiz(getPersistedQuiz());
    setListingSaved(true);
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-white">
      <div
        className="pointer-events-none absolute top-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {!hideEditorChrome && (
          <>
        <select
          aria-label="Active section"
          value={isResultsView ? RESULTS_VIEW_ID : activeSectionId}
          onChange={(e) => onSectionSelectChange(e.target.value)}
          className="pointer-events-auto max-w-[220px] cursor-pointer rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black shadow-sm outline-none focus:border-[#2f5d76]"
        >
          {sectionList.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name.trim() || "Untitled Section"}
            </option>
          ))}
          <option value={RESULTS_VIEW_ID}>Results</option>
        </select>
        <button
          type="button"
          aria-label="Create section"
          onClick={createSection}
          className="pointer-events-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-black/15 bg-white text-lg leading-none text-black shadow-sm hover:bg-[#f5f5f5]"
        >
          +
        </button>
          </>
        )}
      </div>

      <main
        ref={viewportRef}
        className={`absolute inset-0 bg-white ${
          isResultsView
            ? "overflow-x-hidden overflow-y-auto overscroll-y-contain"
            : `touch-none overflow-hidden select-none ${transitionDraft ? "cursor-crosshair" : cursorClass}`
        }`}
        onContextMenu={
          isResultsView
            ? resultsPreview
              ? (e) => e.preventDefault()
              : onResultsContextMenu
            : onContextMenu
        }
        onPointerDown={
          isResultsView
            ? resultsPreview
              ? undefined
              : onResultsPointerDown
            : onViewportPointerDown
        }
      >
        {isResultsView ? (
          <div
            className="relative bg-white"
            style={{
              marginLeft: resultsLeftInset,
              width: resultsAvailableWidth,
              minHeight: "100%",
              height: resultsPageHeight * resultsScale,
              overflow: "hidden",
            }}
          >
            <div
              className="relative origin-top-left bg-white"
              style={{
                width: resultsBaseWidth,
                height: resultsPageHeight,
                transform: `scale(${resultsScale})`,
              }}
            >
              {results.gridVisible && !resultsPreview && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage: `
                      linear-gradient(to right, rgba(47, 93, 118, 0.18) 1px, transparent 1px),
                      linear-gradient(to bottom, rgba(47, 93, 118, 0.18) 1px, transparent 1px)
                    `,
                    backgroundSize: `${resultsGrid.stepX}px ${resultsGrid.stepY}px`,
                    backgroundPosition: "0 0",
                  }}
                />
              )}
              {results.axes.map((axis) => {
                const selected = selectedResultsAxisId === axis.id;
                const labelBoxes: {
                  key: "left" | "center" | "right";
                  align: "left" | "center" | "right";
                  segments: ResultsTextSegment[];
                  field: "leftSegments" | "segments" | "rightSegments";
                  fontSize: number;
                }[] = [
                  {
                    key: "left",
                    align: "left",
                    segments: axis.leftSegments,
                    field: "leftSegments",
                    fontSize: axis.leftFontSize,
                  },
                  {
                    key: "center",
                    align: "center",
                    segments: axis.segments,
                    field: "segments",
                    fontSize: axis.centerFontSize,
                  },
                  {
                    key: "right",
                    align: "right",
                    segments: axis.rightSegments,
                    field: "rightSegments",
                    fontSize: axis.rightFontSize,
                  },
                ];
                return (
                  <div
                    key={axis.id}
                    data-results-axis
                    className={`absolute overflow-visible ${
                      resultsPreview ? "" : "cursor-move"
                    }`}
                    style={{
                      left: axis.x,
                      top: axis.y,
                      width: axis.width,
                      height: axis.height,
                    }}
                    onPointerDown={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsAxisPointerDown(e, axis.id)
                    }
                    onContextMenu={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsAxisContextMenu(e, axis.id)
                    }
                  >
                    <AxisLabelGrowRow
                      axisId={axis.id}
                      onHeight={reportAxisLabelHeight}
                    >
                      {labelBoxes.map((label) => (
                        <div
                          key={label.key}
                          className="min-w-0 flex-1 overflow-visible"
                        >
                          <div
                            data-results-editor
                            className={
                              resultsPreview
                                ? "cursor-default"
                                : selected
                                  ? "cursor-text"
                                  : "cursor-move"
                            }
                          >
                            <ResultsRichTextEditor
                              segments={label.segments}
                              variables={allVariables}
                              compact
                              autoHeight
                              align={label.align}
                              preview={resultsPreview}
                              fontSize={label.fontSize}
                              onCheckpoint={pushHistory}
                              onChange={(segments) =>
                                updateResultsAxis(axis.id, {
                                  [label.field]: segments,
                                })
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </AxisLabelGrowRow>
                    {axis.showImages && (
                      <>
                        <AxisSideImage
                          side="left"
                          src={axis.leftImage}
                          size={axis.height}
                          showPlaceholder={!resultsPreview}
                        />
                        <AxisSideImage
                          side="right"
                          src={axis.rightImage}
                          size={axis.height}
                          showPlaceholder={!resultsPreview}
                        />
                      </>
                    )}
                    <div className="absolute inset-0 overflow-visible">
                      <div
                        className={`absolute inset-0 overflow-hidden rounded-full border ${
                          resultsPreview
                            ? "border-black/15"
                            : selected
                              ? "border-[#2f5d76] shadow-sm ring-2 ring-[#2f5d76]/ring-offset-1"
                              : "border-black/15 shadow-sm"
                        } ${
                          axis.percentageVariableId
                            ? "flex bg-white"
                            : "bg-[#eef4f7]"
                        }`}
                      >
                        {axis.percentageVariableId
                          ? (() => {
                              const pct = axisPercentageFromVariable(
                                allVariables.find(
                                  (variable) =>
                                    variable.id === axis.percentageVariableId,
                                ),
                              );
                              const rest = 100 - pct;
                              return (
                                <>
                                  {pct > 0 && (
                                    <div
                                      className="pointer-events-none flex min-w-0 items-center justify-center overflow-hidden px-1 text-xs font-semibold whitespace-nowrap"
                                      style={{
                                        width: `${pct}%`,
                                        backgroundColor: axis.leftColor,
                                        color: contrastTextOn(axis.leftColor),
                                      }}
                                    >
                                      {formatAxisPercent(pct)}
                                    </div>
                                  )}
                                  {pct > 0 && pct < 100 && (
                                    <div
                                      className="pointer-events-none w-px shrink-0 self-stretch bg-white"
                                      aria-hidden
                                    />
                                  )}
                                  {rest > 0 && (
                                    <div
                                      className="pointer-events-none flex min-w-0 items-center justify-center overflow-hidden px-1 text-xs font-semibold whitespace-nowrap"
                                      style={{
                                        width: `${rest}%`,
                                        backgroundColor: axis.rightColor,
                                        color: contrastTextOn(axis.rightColor),
                                      }}
                                    >
                                      {formatAxisPercent(rest)}
                                    </div>
                                  )}
                                </>
                              );
                            })()
                          : null}
                      </div>
                      {selected &&
                        !resultsPreview &&
                        RESULTS_RESIZE_HANDLES.map(
                          ({ handle, className, cursor }) => (
                            <div
                              key={handle}
                              data-results-resize={handle}
                              className={`absolute z-10 ${className}`}
                              style={{ cursor }}
                              onPointerDown={(e) =>
                                onResultsResizePointerDown(e, axis.id, handle)
                              }
                            />
                          ),
                        )}
                    </div>
                  </div>
                );
              })}
              {results.compasses.map((compass) => {
                const selected = selectedResultsCompassId === compass.id;
                const labelWidth = Math.max(
                  120,
                  Math.round(compass.width * 0.5),
                );
                const labelEditor = (
                  field:
                    | "topSegments"
                    | "bottomSegments"
                    | "leftSegments"
                    | "rightSegments",
                  segments: ResultsTextSegment[],
                  fontSize: number,
                ) => (
                  <div
                    data-results-editor
                    className={
                      resultsPreview
                        ? "cursor-default"
                        : selected
                          ? "cursor-text"
                          : "cursor-move"
                    }
                  >
                    <ResultsRichTextEditor
                      segments={segments}
                      variables={allVariables}
                      compact
                      autoHeight
                      align="center"
                      preview={resultsPreview}
                      fontSize={fontSize}
                      onCheckpoint={pushHistory}
                      onChange={(next) =>
                        updateResultsCompass(compass.id, { [field]: next })
                      }
                    />
                  </div>
                );
                return (
                  <div
                    key={compass.id}
                    data-results-compass
                    className={`absolute overflow-visible ${
                      resultsPreview ? "" : "cursor-move"
                    }`}
                    style={{
                      left: compass.x,
                      top: compass.y,
                      width: compass.width,
                      height: compass.height,
                    }}
                    onPointerDown={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsCompassPointerDown(e, compass.id)
                    }
                    onContextMenu={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsCompassContextMenu(e, compass.id)
                    }
                  >
                    <MeasuredGrowBox
                      id={compass.id}
                      onHeight={reportAxisLabelHeight}
                      className="absolute left-1/2 -translate-x-1/2"
                      style={{
                        bottom: "100%",
                        marginBottom: RESULTS_COMPASS_LABEL_GAP,
                        width: labelWidth,
                      }}
                    >
                      {labelEditor("topSegments", compass.topSegments, compass.topFontSize)}
                    </MeasuredGrowBox>
                    <div
                      className="absolute left-1/2 -translate-x-1/2"
                      style={{
                        top: "100%",
                        marginTop: RESULTS_COMPASS_LABEL_GAP,
                        width: labelWidth,
                      }}
                    >
                      {labelEditor(
                        "bottomSegments",
                        compass.bottomSegments,
                        compass.bottomFontSize,
                      )}
                    </div>
                    <div
                      className="absolute top-1/2 -translate-y-1/2"
                      style={{
                        right: "100%",
                        marginRight: RESULTS_COMPASS_LABEL_GAP,
                        width: RESULTS_COMPASS_SIDE_LABEL_WIDTH,
                      }}
                    >
                      {labelEditor(
                        "leftSegments",
                        compass.leftSegments,
                        compass.leftFontSize,
                      )}
                    </div>
                    <div
                      className="absolute top-1/2 -translate-y-1/2"
                      style={{
                        left: "100%",
                        marginLeft: RESULTS_COMPASS_LABEL_GAP,
                        width: RESULTS_COMPASS_SIDE_LABEL_WIDTH,
                      }}
                    >
                      {labelEditor(
                        "rightSegments",
                        compass.rightSegments,
                        compass.rightFontSize,
                      )}
                    </div>
                    <div
                      className={`absolute inset-0 overflow-hidden ${
                        selected && !resultsPreview
                          ? "ring-2 ring-[#2f5d76] ring-offset-1"
                          : ""
                      }`}
                    >
                      <div className="grid h-full w-full grid-cols-2 grid-rows-2">
                        <div style={{ backgroundColor: compass.topLeftColor }} />
                        <div style={{ backgroundColor: compass.topRightColor }} />
                        <div style={{ backgroundColor: compass.bottomLeftColor }} />
                        <div style={{ backgroundColor: compass.bottomRightColor }} />
                      </div>
                      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-black" />
                      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-black" />
                      <div
                        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black shadow-sm"
                        style={compassDotStyle(
                          allVariables.find(
                            (variable) => variable.id === compass.xVariableId,
                          ),
                          allVariables.find(
                            (variable) => variable.id === compass.yVariableId,
                          ),
                          compass.width,
                          compass.height,
                        )}
                        aria-hidden
                      />
                    </div>
                    {selected &&
                      !resultsPreview &&
                      RESULTS_RESIZE_HANDLES.map(
                        ({ handle, className, cursor }) => (
                          <div
                            key={handle}
                            data-results-resize={handle}
                            className={`absolute z-10 ${className}`}
                            style={{ cursor }}
                            onPointerDown={(e) =>
                              onResultsResizePointerDown(e, compass.id, handle)
                            }
                          />
                        ),
                      )}
                  </div>
                );
              })}
              {(results.bars ?? []).map((bar) => {
                const selected = selectedResultsBarId === bar.id;
                const variable = allVariables.find(
                  (item) => item.id === bar.variableId,
                );
                const fill = barFillGeometry(
                  variable,
                  bar.asPercent,
                  bar.min,
                  bar.max,
                );
                const negativeLayout = barUsesNegativeLayout(
                  variable,
                  bar.asPercent,
                  bar.min,
                  bar.max,
                );
                const negativeExtent =
                  fill.direction === "down" ? bar.height : 0;
                const labelWidth = Math.max(120, bar.width);
                const valueReadout = (
                  <div className="pointer-events-none px-1 text-center text-sm font-semibold text-black">
                    {formatBarReadout(variable, bar.asPercent)}
                  </div>
                );
                const labelBox = (
                  <div
                    data-results-editor
                    className={
                      resultsPreview
                        ? "cursor-default"
                        : selected
                          ? "cursor-text"
                          : "cursor-move"
                    }
                  >
                    <ResultsRichTextEditor
                      segments={bar.segments}
                      variables={allVariables}
                      compact
                      autoHeight
                      growFromEnd={negativeLayout}
                      align="center"
                      preview={resultsPreview}
                      fontSize={bar.fontSize}
                      onCheckpoint={pushHistory}
                      onChange={(segments) =>
                        updateResultsBar(bar.id, { segments })
                      }
                    />
                  </div>
                );
                const labelStack = (
                  <>
                    {labelBox}
                    {bar.showImage ? (
                      <BarLabelImage
                        src={bar.image}
                        size={bar.width}
                        showPlaceholder={!resultsPreview}
                      />
                    ) : null}
                  </>
                );
                const frameClass = `overflow-hidden rounded-lg border ${
                  resultsPreview
                    ? "border-black/15 bg-[#eef4f7]"
                    : selected
                      ? "border-[#2f5d76] bg-[#eef4f7] shadow-sm ring-2 ring-[#2f5d76]/ring-offset-1"
                      : "border-black/15 bg-[#eef4f7] shadow-sm"
                }`;
                return (
                  <div
                    key={bar.id}
                    data-results-bar
                    className={`absolute overflow-visible ${
                      resultsPreview ? "" : "cursor-move"
                    }`}
                    style={{
                      left: bar.x,
                      top: bar.y,
                      width: bar.width,
                      height: bar.height,
                    }}
                    onPointerDown={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsBarPointerDown(e, bar.id)
                    }
                    onContextMenu={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsBarContextMenu(e, bar.id)
                    }
                  >
                    {fill.direction === "up" ? (
                      <div
                        className={`absolute left-0 right-0 ${frameClass}`}
                        style={{ top: 0, height: bar.height }}
                      >
                        <div
                          className="absolute left-1/2 w-2/3 -translate-x-1/2 overflow-hidden rounded-md bg-black/10"
                          style={{
                            top: RESULTS_BAR_TRACK_INSET,
                            bottom: 0,
                          }}
                        >
                          {fill.ratio > 0 && (
                            <div
                              className="absolute right-0 bottom-0 left-0 rounded-t-md"
                              style={{
                                height: `${fill.ratio * 100}%`,
                                backgroundColor: RESULTS_AXIS_LEFT_COLOR,
                              }}
                            />
                          )}
                        </div>
                        <div
                          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-black"
                          aria-hidden
                        />
                      </div>
                    ) : (
                      <>
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-black"
                          style={{ top: Math.max(0, bar.height - 2) }}
                          aria-hidden
                        />
                        <div
                          className={`absolute left-0 right-0 ${frameClass}`}
                          style={{ top: bar.height, height: negativeExtent }}
                        >
                          <div
                            className="absolute left-1/2 w-2/3 -translate-x-1/2 overflow-hidden rounded-md bg-black/10"
                            style={{
                              top: 0,
                              bottom: RESULTS_BAR_TRACK_INSET,
                            }}
                          >
                            {fill.ratio > 0 && (
                              <div
                                className="absolute top-0 right-0 left-0 rounded-b-md"
                                style={{
                                  height: `${fill.ratio * 100}%`,
                                  backgroundColor: RESULTS_AXIS_LEFT_COLOR,
                                }}
                              />
                            )}
                          </div>
                        </div>
                      </>
                    )}
                    {!negativeLayout && (
                      <MeasuredGrowBox
                        id={bar.id}
                        onHeight={reportAxisLabelHeight}
                        className="absolute left-1/2 -translate-x-1/2"
                        style={{
                          bottom: "100%",
                          marginBottom: RESULTS_BAR_LABEL_GAP,
                          width: labelWidth,
                        }}
                      >
                        {valueReadout}
                      </MeasuredGrowBox>
                    )}
                    {negativeLayout ? (
                      <div
                        className="absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center"
                        style={{
                          bottom: RESULTS_BAR_LABEL_GAP,
                          width: labelWidth,
                        }}
                      >
                        {labelStack}
                      </div>
                    ) : (
                      <div
                        className="absolute left-1/2 flex -translate-x-1/2 flex-col items-center"
                        style={{
                          top: "100%",
                          marginTop: RESULTS_BAR_LABEL_GAP,
                          width: labelWidth,
                        }}
                      >
                        {labelStack}
                      </div>
                    )}
                    {negativeLayout && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2"
                        style={{
                          top: "100%",
                          marginTop: negativeExtent + RESULTS_BAR_LABEL_GAP,
                          width: labelWidth,
                        }}
                      >
                        {valueReadout}
                      </div>
                    )}
                    {selected &&
                      !resultsPreview &&
                      RESULTS_RESIZE_HANDLES.map(
                        ({ handle, className, cursor }) => (
                          <div
                            key={handle}
                            data-results-resize={handle}
                            className={`absolute z-10 ${className}`}
                            style={{ cursor }}
                            onPointerDown={(e) =>
                              onResultsResizePointerDown(e, bar.id, handle)
                            }
                          />
                        ),
                      )}
                  </div>
                );
              })}
              {results.textBoxes.map((box) => {
                const selected = selectedResultsTextId === box.id;
                return (
                  <div
                    key={box.id}
                    data-results-text
                    className={`absolute flex flex-col overflow-visible rounded-lg ${
                      resultsPreview
                        ? "border-0 bg-transparent p-2"
                        : `cursor-move border bg-white p-2 shadow-sm ${
                            selected
                              ? "border-[#2f5d76] ring-2 ring-[#2f5d76]/ring-offset-1"
                              : "border-black/15"
                          }`
                    }`}
                    style={{
                      left: box.x,
                      top: box.y,
                      width: box.width,
                      height: box.height,
                    }}
                    onPointerDown={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsTextPointerDown(e, box.id)
                    }
                    onContextMenu={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsTextContextMenu(e, box.id)
                    }
                  >
                    {box.showImage && (
                      <div
                        className="absolute"
                        style={{
                          left: box.imageOffsetX,
                          width: box.imageWidth,
                          height: box.imageHeight,
                          ...(box.imageAbove
                            ? {
                                bottom: "100%",
                                marginBottom: RESULTS_TEXT_IMAGE_GAP,
                              }
                            : {
                                top: "100%",
                                marginTop: RESULTS_TEXT_IMAGE_GAP,
                              }),
                        }}
                      >
                        <ResultsCanvasImage
                          src={box.image}
                          preview={resultsPreview}
                          selected={selected}
                          onResizePointerDown={
                            resultsPreview
                              ? undefined
                              : (e, handle) =>
                                  onResultsResizePointerDown(
                                    e,
                                    box.id,
                                    handle,
                                    "text-image",
                                  )
                          }
                        />
                      </div>
                    )}
                    <div
                      data-results-editor
                      className={`min-h-0 flex-1 overflow-hidden ${
                        resultsPreview
                          ? "cursor-default"
                          : selected
                            ? "cursor-text"
                            : "cursor-move"
                      }`}
                    >
                      <ResultsRichTextEditor
                        segments={box.segments}
                        variables={allVariables}
                        compact
                        align={box.textAlign}
                        preview={resultsPreview}
                        fontSize={box.fontSize}
                        onCheckpoint={pushHistory}
                        onChange={(segments) =>
                          updateResultsTextBox(box.id, { segments })
                        }
                      />
                    </div>
                    {selected &&
                      !resultsPreview &&
                      RESULTS_RESIZE_HANDLES.map(({ handle, className, cursor }) => (
                        <div
                          key={handle}
                          data-results-resize={handle}
                          className={`absolute z-10 ${className}`}
                          style={{ cursor }}
                          onPointerDown={(e) =>
                            onResultsResizePointerDown(e, box.id, handle)
                          }
                        />
                      ))}
                  </div>
                );
              })}
              {(results.images ?? []).map((image) => {
                const selected = selectedResultsImageId === image.id;
                return (
                  <div
                    key={image.id}
                    data-results-image
                    className={`absolute ${resultsPreview ? "" : "cursor-move"}`}
                    style={{
                      left: image.x,
                      top: image.y,
                      width: image.width,
                      height: image.height,
                    }}
                    onPointerDown={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsImagePointerDown(e, image.id)
                    }
                    onContextMenu={
                      resultsPreview
                        ? undefined
                        : (e) => onResultsImageContextMenu(e, image.id)
                    }
                  >
                    <ResultsCanvasImage
                      src={image.src}
                      preview={resultsPreview}
                      selected={selected}
                      onResizePointerDown={
                        resultsPreview
                          ? undefined
                          : (e, handle) =>
                              onResultsResizePointerDown(e, image.id, handle)
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
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
        )}

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
            {menu.kind === "results-canvas" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createResultsTextBox}
                >
                  Create Text Box
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createResultsImage}
                >
                  Create Image
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createResultsAxis}
                >
                  Create Axis
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createResultsCompass}
                >
                  Create Compass
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                  onClick={createResultsBar}
                >
                  Create Bar Graph
                </button>
              </>
            ) : menu.kind === "results-text" ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                onClick={deleteResultsTextBox}
              >
                Delete
              </button>
            ) : menu.kind === "results-axis" ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                onClick={deleteResultsAxis}
              >
                Delete
              </button>
            ) : menu.kind === "results-compass" ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                onClick={deleteResultsCompass}
              >
                Delete
              </button>
            ) : menu.kind === "results-bar" ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                onClick={deleteResultsBar}
              >
                Delete
              </button>
            ) : menu.kind === "results-image" ? (
              <button
                type="button"
                role="menuitem"
                className="block w-full cursor-pointer border-none bg-transparent px-4 py-2 text-left text-sm text-black hover:bg-black/5"
                onClick={deleteResultsImage}
              >
                Delete
              </button>
            ) : menu.kind === "canvas" ? (
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

      {selectedResultsText && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Text Box</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Font Size
            </h2>
            <FontSizeControl
              value={selectedResultsText.fontSize}
              onCheckpoint={pushHistory}
              onChange={(fontSize) =>
                updateResultsTextBox(selectedResultsText.id, { fontSize })
              }
            />
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Alignment
            </h2>
            <div className="mt-3 flex gap-2">
              {(
                [
                  ["left", "Left"],
                  ["center", "Center"],
                  ["right", "Right"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`Align ${label.toLowerCase()}`}
                  aria-pressed={selectedResultsText.textAlign === value}
                  onClick={() => {
                    if (selectedResultsText.textAlign === value) return;
                    pushHistory();
                    updateResultsTextBox(selectedResultsText.id, {
                      textAlign: value,
                    });
                  }}
                  className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium ${
                    selectedResultsText.textAlign === value
                      ? "border-[#2f5d76] bg-[#2f5d76] text-white"
                      : "border-black/15 bg-white text-black hover:bg-black/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Text
            </h2>
            <div className="mt-3">
              <ResultsRichTextEditor
                segments={selectedResultsText.segments}
                variables={allVariables}
                align={selectedResultsText.textAlign}
                fontSize={selectedResultsText.fontSize}
                onCheckpoint={pushHistory}
                onChange={(segments) =>
                  updateResultsTextBox(selectedResultsText.id, { segments })
                }
              />
            </div>
            <button
              type="button"
              onClick={addVariableToSelectedResultsText}
              disabled={allVariables.length === 0}
              className="mt-3 w-full cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
            >
              Add Variable
            </button>
            {allVariables.length === 0 && (
              <p className="mt-2 text-xs text-black/50">
                Create a project or local variable first.
              </p>
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Images
            </h2>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={selectedResultsText.showImage}
                aria-label="Show image"
                onChange={(e) => {
                  pushHistory();
                  const showImage = e.target.checked;
                  const imageWidth =
                    selectedResultsText.imageWidth ||
                    RESULTS_TEXT_IMAGE_DEFAULT_SIZE;
                  const imageHeight =
                    selectedResultsText.imageHeight ||
                    RESULTS_TEXT_IMAGE_DEFAULT_SIZE;
                  const imageOffsetX =
                    selectedResultsText.imageOffsetX ||
                    (selectedResultsText.width - imageWidth) / 2;
                  let y = selectedResultsText.y;
                  if (
                    showImage &&
                    selectedResultsText.imageAbove
                  ) {
                    y = Math.max(
                      y,
                      imageHeight + RESULTS_TEXT_IMAGE_GAP,
                    );
                  }
                  updateResultsTextBox(selectedResultsText.id, {
                    showImage,
                    imageWidth,
                    imageHeight,
                    imageOffsetX,
                    y,
                  });
                }}
                className="h-4 w-4 cursor-pointer"
              />
              Show image
            </label>
            {selectedResultsText.showImage && (
              <>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
                  <input
                    type="checkbox"
                    checked={selectedResultsText.imageAbove}
                    aria-label="Place image above text"
                    onChange={(e) => {
                      pushHistory();
                      const imageAbove = e.target.checked;
                      let y = selectedResultsText.y;
                      if (imageAbove) {
                        y = Math.max(
                          y,
                          selectedResultsText.imageHeight +
                            RESULTS_TEXT_IMAGE_GAP,
                        );
                      }
                      updateResultsTextBox(selectedResultsText.id, {
                        imageAbove,
                        y,
                      });
                    }}
                    className="h-4 w-4 cursor-pointer"
                  />
                  Place above text
                </label>
                <AxisImagePicker
                  label="Image"
                  value={selectedResultsText.image}
                  onCheckpoint={pushHistory}
                  onChange={(image) =>
                    updateResultsTextBox(selectedResultsText.id, { image })
                  }
                />
              </>
            )}
          </section>
          <button
            type="button"
            onClick={() => {
              pushHistory();
              const id = selectedResultsText.id;
              setResults((prev) => ({
                ...prev,
                textBoxes: prev.textBoxes.filter((box) => box.id !== id),
              }));
              setSelectedResultsTextId(null);
            }}
            className="mt-8 w-full cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226]"
          >
            Delete Text Box
          </button>
        </aside>
      )}

      {selectedResultsAxis && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Axis</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Percentage
            </h2>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={Boolean(selectedResultsAxis.percentageVariableId)}
                aria-label="Show percentage spectrum"
                onChange={(e) => {
                  pushHistory();
                  updateResultsAxis(selectedResultsAxis.id, {
                    percentageVariableId: e.target.checked
                      ? (allVariables[0]?.id ?? "")
                      : "",
                  });
                }}
                className="h-4 w-4 cursor-pointer"
              />
              Show as percentage
            </label>
            {Boolean(selectedResultsAxis.percentageVariableId) && (
              <label className="mt-3 block text-sm text-black">
                <span className="text-black/70">Variable</span>
                <select
                  aria-label="Percentage variable"
                  value={selectedResultsAxis.percentageVariableId}
                  disabled={allVariables.length === 0}
                  onFocus={() => pushHistory()}
                  onChange={(e) =>
                    updateResultsAxis(selectedResultsAxis.id, {
                      percentageVariableId: e.target.value,
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76] disabled:text-black/35"
                >
                  {allVariables.length === 0 ? (
                    <option value="">No variables</option>
                  ) : (
                    allVariables.map((variable) => (
                      <option key={variable.id} value={variable.id}>
                        {variable.name.trim() || "Untitled"}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
            {allVariables.length === 0 && (
              <p className="mt-2 text-xs text-black/50">
                Create a project or local variable first.
              </p>
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Colors
            </h2>
            <ResultsColorPicker
              label="Left"
              value={selectedResultsAxis.leftColor}
              onCheckpoint={pushHistory}
              onChange={(leftColor) =>
                updateResultsAxis(selectedResultsAxis.id, { leftColor })
              }
            />
            <ResultsColorPicker
              label="Right"
              value={selectedResultsAxis.rightColor}
              onCheckpoint={pushHistory}
              onChange={(rightColor) =>
                updateResultsAxis(selectedResultsAxis.id, { rightColor })
              }
            />
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Images
            </h2>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={selectedResultsAxis.showImages}
                aria-label="Show images"
                onChange={(e) => {
                  pushHistory();
                  const showImages = e.target.checked;
                  const pageWidth = resultsBaseWidthRef.current;
                  setResults((prev) => ({
                    ...prev,
                    axes: prev.axes.map((axis) => {
                      if (axis.id !== selectedResultsAxis.id) return axis;
                      return clampResultsAxisForImages(
                        { ...axis, showImages },
                        pageWidth,
                      );
                    }),
                  }));
                }}
                className="h-4 w-4 cursor-pointer"
              />
              Show images
            </label>
            {selectedResultsAxis.showImages && (
              <>
                <AxisImagePicker
                  label="Left image"
                  value={selectedResultsAxis.leftImage}
                  onCheckpoint={pushHistory}
                  onChange={(leftImage) =>
                    updateResultsAxis(selectedResultsAxis.id, { leftImage })
                  }
                />
                <AxisImagePicker
                  label="Right image"
                  value={selectedResultsAxis.rightImage}
                  onCheckpoint={pushHistory}
                  onChange={(rightImage) =>
                    updateResultsAxis(selectedResultsAxis.id, { rightImage })
                  }
                />
              </>
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Font Size
            </h2>
            <FontSizeControl
              label="All Labels"
              value={selectedResultsAxis.centerFontSize}
              onCheckpoint={pushHistory}
              onChange={(fontSize) =>
                updateResultsAxis(selectedResultsAxis.id, {
                  centerFontSize: fontSize,
                  leftFontSize: fontSize,
                  rightFontSize: fontSize,
                })
              }
            />
          </section>
          {(
            [
              ["leftSegments", "Left Label", "left", "leftFontSize"],
              ["segments", "Center Label", "center", "centerFontSize"],
              ["rightSegments", "Right Label", "right", "rightFontSize"],
            ] as const
          ).map(([field, title, align, fontField]) => (
            <section key={field} className="mt-6">
              <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                {title}
              </h2>
              <FontSizeControl
                value={selectedResultsAxis[fontField]}
                onCheckpoint={pushHistory}
                onChange={(fontSize) =>
                  updateResultsAxis(selectedResultsAxis.id, {
                    [fontField]: fontSize,
                  })
                }
              />
              <div className="mt-3">
                <ResultsRichTextEditor
                  segments={selectedResultsAxis[field]}
                  variables={allVariables}
                  align={align}
                  fontSize={selectedResultsAxis[fontField]}
                  onCheckpoint={pushHistory}
                  onChange={(segments) =>
                    updateResultsAxis(selectedResultsAxis.id, {
                      [field]: segments,
                    })
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => addVariableToSelectedResultsAxis(field)}
                disabled={allVariables.length === 0}
                className="mt-3 w-full cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
              >
                Add Variable
              </button>
              {allVariables.length === 0 && (
                <p className="mt-2 text-xs text-black/50">
                  Create a project or local variable first.
                </p>
              )}
            </section>
          ))}
          <button
            type="button"
            onClick={() => {
              pushHistory();
              const id = selectedResultsAxis.id;
              setResults((prev) => ({
                ...prev,
                axes: prev.axes.filter((axis) => axis.id !== id),
              }));
              setSelectedResultsAxisId(null);
            }}
            className="mt-8 w-full cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226]"
          >
            Delete Axis
          </button>
        </aside>
      )}

      {selectedResultsCompass && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Compass</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Position
            </h2>
            {(
              [
                ["xVariableId", "Horizontal (0 left, 100 right)"],
                ["yVariableId", "Vertical (0 bottom, 100 top)"],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="mt-3 block text-sm text-black">
                <span className="text-black/70">{label}</span>
                <select
                  aria-label={label}
                  value={selectedResultsCompass[field]}
                  disabled={allVariables.length === 0}
                  onFocus={() => pushHistory()}
                  onChange={(e) =>
                    updateResultsCompass(selectedResultsCompass.id, {
                      [field]: e.target.value,
                    })
                  }
                  className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76] disabled:text-black/35"
                >
                  {allVariables.length === 0 ? (
                    <option value="">No variables</option>
                  ) : (
                    <>
                      <option value="">Choose variable</option>
                      {allVariables.map((variable) => (
                        <option key={variable.id} value={variable.id}>
                          {variable.name.trim() || "Untitled"}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
            ))}
            {allVariables.length === 0 && (
              <p className="mt-2 text-xs text-black/50">
                Create a project or local variable first.
              </p>
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Colors
            </h2>
            <ResultsColorPicker
              label="Top left"
              value={selectedResultsCompass.topLeftColor}
              onCheckpoint={pushHistory}
              onChange={(topLeftColor) =>
                updateResultsCompass(selectedResultsCompass.id, { topLeftColor })
              }
            />
            <ResultsColorPicker
              label="Top right"
              value={selectedResultsCompass.topRightColor}
              onCheckpoint={pushHistory}
              onChange={(topRightColor) =>
                updateResultsCompass(selectedResultsCompass.id, {
                  topRightColor,
                })
              }
            />
            <ResultsColorPicker
              label="Bottom left"
              value={selectedResultsCompass.bottomLeftColor}
              onCheckpoint={pushHistory}
              onChange={(bottomLeftColor) =>
                updateResultsCompass(selectedResultsCompass.id, {
                  bottomLeftColor,
                })
              }
            />
            <ResultsColorPicker
              label="Bottom right"
              value={selectedResultsCompass.bottomRightColor}
              onCheckpoint={pushHistory}
              onChange={(bottomRightColor) =>
                updateResultsCompass(selectedResultsCompass.id, {
                  bottomRightColor,
                })
              }
            />
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Font Size
            </h2>
            <FontSizeControl
              label="All Labels"
              value={selectedResultsCompass.topFontSize}
              onCheckpoint={pushHistory}
              onChange={(fontSize) =>
                updateResultsCompass(selectedResultsCompass.id, {
                  topFontSize: fontSize,
                  bottomFontSize: fontSize,
                  leftFontSize: fontSize,
                  rightFontSize: fontSize,
                })
              }
            />
          </section>
          {(
            [
              ["topSegments", "Top Label", "topFontSize"],
              ["bottomSegments", "Bottom Label", "bottomFontSize"],
              ["leftSegments", "Left Label", "leftFontSize"],
              ["rightSegments", "Right Label", "rightFontSize"],
            ] as const
          ).map(([field, title, fontField]) => (
            <section key={field} className="mt-6">
              <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                {title}
              </h2>
              <FontSizeControl
                value={selectedResultsCompass[fontField]}
                onCheckpoint={pushHistory}
                onChange={(fontSize) =>
                  updateResultsCompass(selectedResultsCompass.id, {
                    [fontField]: fontSize,
                  })
                }
              />
              <div className="mt-3">
                <ResultsRichTextEditor
                  segments={selectedResultsCompass[field]}
                  variables={allVariables}
                  align="center"
                  fontSize={selectedResultsCompass[fontField]}
                  onCheckpoint={pushHistory}
                  onChange={(segments) =>
                    updateResultsCompass(selectedResultsCompass.id, {
                      [field]: segments,
                    })
                  }
                />
              </div>
              <button
                type="button"
                onClick={() => addVariableToSelectedResultsCompass(field)}
                disabled={allVariables.length === 0}
                className="mt-3 w-full cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
              >
                Add Variable
              </button>
              {allVariables.length === 0 && (
                <p className="mt-2 text-xs text-black/50">
                  Create a project or local variable first.
                </p>
              )}
            </section>
          ))}
          <button
            type="button"
            onClick={() => {
              pushHistory();
              const id = selectedResultsCompass.id;
              setResults((prev) => ({
                ...prev,
                compasses: prev.compasses.filter((item) => item.id !== id),
              }));
              setSelectedResultsCompassId(null); setSelectedResultsBarId(null); setSelectedResultsImageId(null);
            }}
            className="mt-8 w-full cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226]"
          >
            Delete Compass
          </button>
        </aside>
      )}

      {selectedResultsBar && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Bar Graph</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Value
            </h2>
            <label className="mt-3 block text-sm text-black">
              <span className="text-black/70">Variable</span>
              <select
                aria-label="Bar graph variable"
                value={selectedResultsBar.variableId}
                disabled={allVariables.length === 0}
                onFocus={() => pushHistory()}
                onChange={(e) =>
                  updateResultsBar(selectedResultsBar.id, {
                    variableId: e.target.value,
                  })
                }
                className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76] disabled:text-black/35"
              >
                {allVariables.length === 0 ? (
                  <option value="">No variables</option>
                ) : (
                  <>
                    <option value="">Choose variable</option>
                    {allVariables.map((variable) => (
                      <option key={variable.id} value={variable.id}>
                        {variable.name.trim() || "Untitled"}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
            {allVariables.length === 0 && (
              <p className="mt-2 text-xs text-black/50">
                Create a project or local variable first.
              </p>
            )}
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={selectedResultsBar.asPercent}
                aria-label="Show as percent"
                onChange={(e) => {
                  pushHistory();
                  updateResultsBar(selectedResultsBar.id, {
                    asPercent: e.target.checked,
                  });
                }}
                className="h-4 w-4 cursor-pointer"
              />
              Show as percent
            </label>
            {!selectedResultsBar.asPercent && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <BoundNumberInput
                  label="Lower bound"
                  value={selectedResultsBar.min}
                  onCheckpoint={pushHistory}
                  onChange={(min) =>
                    updateResultsBar(selectedResultsBar.id, { min })
                  }
                />
                <BoundNumberInput
                  label="Upper bound"
                  value={selectedResultsBar.max}
                  onCheckpoint={pushHistory}
                  onChange={(max) =>
                    updateResultsBar(selectedResultsBar.id, { max })
                  }
                />
              </div>
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Font Size
            </h2>
            <FontSizeControl
              value={selectedResultsBar.fontSize}
              onCheckpoint={pushHistory}
              onChange={(fontSize) =>
                updateResultsBar(selectedResultsBar.id, { fontSize })
              }
            />
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Label
            </h2>
            <div className="mt-3">
              <ResultsRichTextEditor
                segments={selectedResultsBar.segments}
                variables={allVariables}
                align="center"
                fontSize={selectedResultsBar.fontSize}
                onCheckpoint={pushHistory}
                onChange={(segments) =>
                  updateResultsBar(selectedResultsBar.id, { segments })
                }
              />
            </div>
            <button
              type="button"
              onClick={addVariableToSelectedResultsBar}
              disabled={allVariables.length === 0}
              className="mt-3 w-full cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:text-black/35"
            >
              Add Variable
            </button>
            {allVariables.length === 0 && (
              <p className="mt-2 text-xs text-black/50">
                Create a project or local variable first.
              </p>
            )}
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Images
            </h2>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
              <input
                type="checkbox"
                checked={selectedResultsBar.showImage}
                aria-label="Show image"
                onChange={(e) => {
                  pushHistory();
                  updateResultsBar(selectedResultsBar.id, {
                    showImage: e.target.checked,
                  });
                }}
                className="h-4 w-4 cursor-pointer"
              />
              Show image
            </label>
            {selectedResultsBar.showImage && (
              <AxisImagePicker
                label="Image"
                value={selectedResultsBar.image}
                onCheckpoint={pushHistory}
                onChange={(image) =>
                  updateResultsBar(selectedResultsBar.id, { image })
                }
              />
            )}
          </section>
          <button
            type="button"
            onClick={() => {
              pushHistory();
              const id = selectedResultsBar.id;
              setResults((prev) => ({
                ...prev,
                bars: (prev.bars ?? []).filter((item) => item.id !== id),
              }));
              setSelectedResultsBarId(null);
            }}
            className="mt-8 w-full cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226]"
          >
            Delete Bar Graph
          </button>
        </aside>
      )}

      {selectedResultsImage && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Image</h1>
          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              File
            </h2>
            <AxisImagePicker
              label="Image"
              value={selectedResultsImage.src}
              onCheckpoint={pushHistory}
              onChange={(src) =>
                updateResultsImage(selectedResultsImage.id, { src })
              }
            />
          </section>
          <button
            type="button"
            onClick={() => {
              pushHistory();
              const id = selectedResultsImage.id;
              setResults((prev) => ({
                ...prev,
                images: (prev.images ?? []).filter((item) => item.id !== id),
              }));
              setSelectedResultsImageId(null);
            }}
            className="mt-8 w-full cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226]"
          >
            Delete Image
          </button>
        </aside>
      )}

      {selectedQuestion && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-hidden border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="shrink-0">
            <label className="mb-2 block text-sm font-medium text-black" htmlFor="question-field">
              Question
            </label>
            <textarea
              id="question-field"
              value={selectedQuestion.question}
              onFocus={() => pushHistory()}
              onChange={(e) => updateQuestion(e.target.value)}
              rows={6}
              placeholder="Type your question…"
              className="min-h-32 w-full resize-y rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
              autoFocus
            />
          </div>

          <section className="mt-6 min-h-0 flex-1 overflow-y-auto">
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

      {selectedEffectBlock && !hideEditorChrome && (
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
                <option value={RESULTS_VIEW_ID}>Results</option>
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

      {selectedTransition && !selectedBox && !hideEditorChrome && (
        <aside
          className="absolute top-0 bottom-0 left-0 z-30 flex w-[320px] flex-col overflow-y-auto border-r border-black/10 bg-[#fafafa] p-5 shadow-[4px_0_24px_rgba(0,0,0,0.06)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <h1 className="text-lg font-semibold text-black">Transition</h1>
          <label className="mt-6 flex cursor-pointer items-start gap-2 text-sm text-black">
            <input
              type="checkbox"
              checked={selectedTransition.fallback}
              aria-label="Use if other transitions don't meet conditions"
              onChange={(e) => {
                pushHistory();
                const fallback = e.target.checked;
                const originId = selectedTransition.fromId;
                const transitionId = selectedTransition.id;
                setTransitions((prev) =>
                  prev.map((transition) => {
                    if (transition.id === transitionId) {
                      return { ...transition, fallback };
                    }
                    if (fallback && transition.fromId === originId) {
                      return { ...transition, fallback: false };
                    }
                    return transition;
                  }),
                );
              }}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
            />
            <span>Use If Other Transitions Dont Meet Conditions</span>
          </label>
          <section
            className={`mt-6 ${
              selectedTransition.fallback ? "pointer-events-none opacity-40" : ""
            }`}
            aria-disabled={selectedTransition.fallback}
          >
            <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
              Conditions
            </h2>
            <fieldset
              disabled={selectedTransition.fallback}
              className="min-w-0 border-0 p-0"
            >
              <ConditionsEditor
                conditions={selectedTransition.conditions}
                variables={allVariables}
                onCheckpoint={pushHistory}
                onAddCondition={addTransitionCondition}
                onUpdateCondition={updateTransitionCondition}
                onRemoveCondition={removeTransitionCondition}
              />
            </fieldset>
          </section>
        </aside>
      )}

      {(resultsPreview || quizScreen || publishOpen) && (
        <button
          type="button"
          aria-label={
            quizScreen ? "Exit quiz" : publishOpen ? "Back to editor" : "Exit preview"
          }
          onClick={() => {
            if (quizScreen) exitQuizPlay();
            else if (publishOpen) setPublishOpen(false);
            else exitResultsPreview();
          }}
          className="absolute top-4 right-4 z-[90] cursor-pointer rounded-md border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black shadow-sm hover:bg-[#f5f5f5]"
        >
          {quizScreen ? "Exit" : publishOpen ? "Back" : "Exit Preview"}
        </button>
      )}

      {publishOpen && (
        <div className="qh-page absolute inset-0 z-[80] overflow-y-auto bg-[#f4f1ea] px-6 py-16 font-[Poppins,sans-serif]">
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-[#1c2a33]/10 bg-white/90 p-8 shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
            <h1 className="text-2xl font-bold tracking-[-0.02em] text-[#1c2a33]">
              Publish quiz
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#4a5560]">
              Confirm how this quiz should appear. Saving keeps these details with the quiz.
            </p>

            <label className="mt-6 block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Name</span>
              <input
                type="text"
                value={projectName}
                aria-label="Quiz name"
                onChange={(e) => {
                  setListingSaved(false);
                  setProjectName(e.target.value);
                }}
                placeholder={DEFAULT_PROJECT_NAME}
                className="mt-1.5 w-full rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]"
              />
            </label>

            <label className="mt-4 block text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Description</span>
              <textarea
                value={listing.description}
                aria-label="Quiz description"
                rows={4}
                onChange={(e) => {
                  setListingSaved(false);
                  setListing((prev) => ({ ...prev, description: e.target.value }));
                }}
                placeholder="Tell people what this quiz is about"
                className="mt-1.5 w-full resize-y rounded-lg border border-[#1c2a33]/15 bg-white px-3 py-2.5 text-sm text-[#1c2a33] outline-none focus:border-[#2f5d76]"
              />
            </label>

            <div className="mt-4 text-sm text-[#1c2a33]">
              <span className="font-medium text-[#4a5560]">Front image</span>
              <div className="mt-1.5">
                <CoverImageField
                  value={listing.coverImage}
                  onCheckpoint={() => setListingSaved(false)}
                  onChange={(coverImage) =>
                    setListing((prev) => ({ ...prev, coverImage }))
                  }
                />
              </div>
            </div>

            <label className="mt-5 flex cursor-pointer items-center gap-2 text-sm text-[#1c2a33]">
              <input
                type="checkbox"
                checked={listing.unlisted}
                aria-label="Unlisted"
                onChange={(e) => {
                  setListingSaved(false);
                  setListing((prev) => ({ ...prev, unlisted: e.target.checked }));
                }}
                className="h-4 w-4 cursor-pointer"
              />
              Unlisted
            </label>
            <p className="mt-1 pl-6 text-xs text-[#5c6770]">
              Unlisted quizzes won&apos;t appear in public lists.
            </p>

            <div className="mt-8 flex flex-col gap-3">
              <button
                type="button"
                onClick={savePublishListing}
                className="w-full cursor-pointer rounded-full border-none bg-[#2f5d76] px-6 py-3 text-sm font-semibold text-[#f8fafc] shadow-[0_4px_14px_rgba(0,0,0,0.12)] hover:bg-[#244a5e]"
              >
                {listingSaved ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="w-full cursor-not-allowed rounded-full border-none bg-black/15 px-6 py-3 text-sm font-semibold text-black/40"
              >
                Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {!hideEditorChrome && (
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
                {showResultsSettings
                  ? "Results Settings"
                  : showSectionSettings
                    ? "Section Settings"
                    : "Project Settings"}
              </h1>
              {isResultsView ? (
                <button
                  type="button"
                  onClick={() =>
                    setSettingsPane((pane) =>
                      pane === "project" ? "results" : "project",
                    )
                  }
                  className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-left text-xs font-medium leading-snug text-[#2f5d76] hover:text-[#244a5e]"
                >
                  {showProjectSettings
                    ? "Switch To Results Settings"
                    : "Switch To Project Settings"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setSettingsPane((pane) =>
                      pane === "project" ? "section" : "project",
                    )
                  }
                  className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-left text-xs font-medium leading-snug text-[#2f5d76] hover:text-[#244a5e]"
                >
                  {settingsPane === "project"
                    ? "Switch To Section Settings"
                    : "Switch To Project Settings"}
                </button>
              )}
            </div>

            {showProjectSettings ? (
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

                <section className="mt-8">
                  <button
                    type="button"
                    onClick={startQuizPlay}
                    className="w-full cursor-pointer rounded-lg border border-[#2f5d76] bg-[#2f5d76] px-3 py-2 text-sm font-medium text-white hover:bg-[#244a5e]"
                  >
                    Preview Quiz
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setListingSaved(false);
                      setPublishOpen(true);
                    }}
                    className="mt-3 w-full cursor-pointer rounded-lg border border-[#2f5d76] bg-white px-3 py-2 text-sm font-medium text-[#2f5d76] hover:bg-[#2f5d76]/5"
                  >
                    Publish
                  </button>
                </section>
              </>
            ) : showResultsSettings ? (
              <>
                <section className="mt-6">
                  <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase">
                    Grid
                  </h2>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-black">
                    <input
                      type="checkbox"
                      checked={results.gridVisible}
                      aria-label="Show grid"
                      onChange={(e) => {
                        pushHistory();
                        updateResultsSettings({ gridVisible: e.target.checked });
                      }}
                      className="h-4 w-4 cursor-pointer"
                    />
                    Show grid
                  </label>

                  <label className="mt-4 block text-sm text-black">
                    <span className="text-black/70">Horizontal ticks</span>
                    <input
                      type="number"
                      min={RESULTS_GRID_TICKS_MIN}
                      max={RESULTS_GRID_TICKS_MAX}
                      step={1}
                      value={results.horizontalTicks}
                      aria-label="Horizontal grid ticks"
                      onFocus={() => pushHistory()}
                      onChange={(e) => {
                        const next =
                          e.target.value === ""
                            ? RESULTS_GRID_TICKS_MIN
                            : Number(e.target.value);
                        updateResultsSettings({
                          horizontalTicks: Number.isFinite(next)
                            ? next
                            : results.horizontalTicks,
                        });
                      }}
                      onBlur={() =>
                        updateResultsSettings({
                          horizontalTicks: normalizeGridTicks(results.horizontalTicks),
                        })
                      }
                      className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
                    />
                  </label>

                  <label className="mt-4 block text-sm text-black">
                    <span className="text-black/70">Vertical ticks</span>
                    <input
                      type="number"
                      min={RESULTS_GRID_TICKS_MIN}
                      max={RESULTS_GRID_TICKS_MAX}
                      step={1}
                      value={results.verticalTicks}
                      aria-label="Vertical grid ticks"
                      onFocus={() => pushHistory()}
                      onChange={(e) => {
                        const next =
                          e.target.value === ""
                            ? RESULTS_GRID_TICKS_MIN
                            : Number(e.target.value);
                        updateResultsSettings({
                          verticalTicks: Number.isFinite(next)
                            ? next
                            : results.verticalTicks,
                        });
                      }}
                      onBlur={() =>
                        updateResultsSettings({
                          verticalTicks: normalizeGridTicks(results.verticalTicks),
                        })
                      }
                      className="mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-[#2f5d76]"
                    />
                  </label>
                  <p className="mt-2 text-xs text-black/50">
                    1–{RESULTS_GRID_TICKS_MAX} ticks. Hold Ctrl while dragging or
                    resizing to snap.
                  </p>
                </section>

                <section className="mt-8">
                  <button
                    type="button"
                    onClick={enterResultsPreview}
                    className="w-full cursor-pointer rounded-lg border border-[#2f5d76] bg-[#2f5d76] px-3 py-2 text-sm font-medium text-white hover:bg-[#244a5e]"
                  >
                    Show Preview
                  </button>
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

                <section className="mt-10 border-t border-black/10 pt-6">
                  <button
                    type="button"
                    disabled={sections.length <= 1}
                    onClick={() => setDeleteSectionConfirmOpen(true)}
                    className="w-full cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226] disabled:cursor-not-allowed disabled:border-black/10 disabled:bg-black/10 disabled:text-black/40"
                  >
                    Delete Section
                  </button>
                </section>
              </>
            )}
          </div>
        </aside>
      </div>
      )}

      {deleteSectionConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onClick={() => setDeleteSectionConfirmOpen(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-section-title"
            aria-describedby="delete-section-desc"
            className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="delete-section-title"
              className="text-lg font-semibold text-black"
            >
              Delete this section?
            </h2>
            <p id="delete-section-desc" className="mt-2 text-sm leading-relaxed text-black/70">
              This cannot be undone from here, but you can restore it with Ctrl+Z.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteSectionConfirmOpen(false)}
                className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium text-black hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteActiveSection}
                className="cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a93226]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {quizScreen?.kind === "question" && quizQuestionBox && (
        <div className="absolute inset-0 z-[60] flex flex-col overflow-y-auto bg-[#f3f3f3]">
          <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-4 py-20">
            <div className="w-full rounded-2xl bg-[#e6e6e6] px-8 py-10 text-center text-xl leading-relaxed font-medium text-[#333333] shadow-sm">
              {quizQuestionBox.question?.trim() || "\u00a0"}
            </div>

            <div className="mt-6 flex w-full flex-col gap-3">
              {quizAnswers.map((answer) => {
                const selected = quizSelectedAnswerId === answer.id;
                return (
                  <button
                    key={answer.id}
                    type="button"
                    onClick={() => setQuizSelectedAnswerId(answer.id)}
                    className={`w-full cursor-pointer rounded-xl px-4 py-3 text-center text-base font-medium text-white shadow-sm transition ${
                      selected
                        ? "bg-[#6f6f6f] ring-2 ring-[#2f5d76] ring-offset-2 ring-offset-[#f3f3f3]"
                        : "bg-[#9a9a9a] hover:bg-[#8a8a8a]"
                    }`}
                  >
                    {answer.name.trim() || "Answer"}
                  </button>
                );
              })}
            </div>

            {quizCanGoNext && (
              <button
                type="button"
                onClick={quizGoNext}
                className="mt-6 w-full cursor-pointer rounded-xl bg-[#2f5d76] px-4 py-3 text-base font-medium text-white shadow-sm hover:bg-[#244a5e]"
              >
                Next
              </button>
            )}

            <button
              type="button"
              onClick={quizGoBack}
              disabled={!quizCanGoBack}
              className="mt-4 w-full rounded-xl border border-black/15 bg-[#ececec] px-4 py-3 text-base font-medium text-[#555555] shadow-sm hover:bg-[#e3e3e3] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#ececec]"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
