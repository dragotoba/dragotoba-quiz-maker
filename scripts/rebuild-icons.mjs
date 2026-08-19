/**
 * Fetches Lucide SVGs (and a few Wikimedia sources), converts them into
 * IconShape descriptors (viewBox 0 0 24 24), and writes icons-data.ts.
 *
 * Run: node scripts/rebuild-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CACHE = path.join(__dirname, "svg-cache");
const OUT = path.join(ROOT, "app", "src", "data", "icons-data.ts");
const REPORT = path.join(__dirname, "icon-rebuild-report.md");

fs.mkdirSync(CACHE, { recursive: true });

const LUCIDE = "https://cdn.jsdelivr.net/npm/lucide-static@0.460.0/icons";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function fetchCached(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const text = await fetchText(url);
  fs.writeFileSync(file, text);
  return text;
}

function num(v, fallback = 0) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(n, d = 3) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

/** Parse a Lucide (or similar) SVG into IconShape[]. */
function parseSvg(svg, { stroke, fill, sw = 1.75 } = {}) {
  const shapes = [];
  const tagRe =
    /<(path|circle|ellipse|rect|line|polyline|polygon)\b([^>]*)\/?>/gi;
  let m;
  while ((m = tagRe.exec(svg))) {
    const t = m[1].toLowerCase();
    const attrs = m[2];
    const get = (name) => {
      const am = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
      return am ? am[1] : undefined;
    };

    const shape = { t };
    const d = get("d");
    const points = get("points");
    const transform = get("transform");

    if (t === "path" && d) shape.d = d;
    if ((t === "polygon" || t === "polyline") && points) shape.points = points;
    if (t === "circle") {
      shape.cx = num(get("cx"));
      shape.cy = num(get("cy"));
      shape.r = num(get("r"));
    }
    if (t === "ellipse") {
      shape.cx = num(get("cx"));
      shape.cy = num(get("cy"));
      shape.rx = num(get("rx"));
      shape.ry = num(get("ry"));
    }
    if (t === "rect") {
      shape.x = num(get("x"));
      shape.y = num(get("y"));
      shape.w = num(get("width"));
      shape.h = num(get("height"));
      const rx = get("rx");
      if (rx != null) shape.rx = num(rx);
    }
    if (t === "line") {
      shape.x1 = num(get("x1"));
      shape.y1 = num(get("y1"));
      shape.x2 = num(get("x2"));
      shape.y2 = num(get("y2"));
    }
    if (transform) shape.transform = transform;

    const attrFill = get("fill");
    const attrStroke = get("stroke");
    const attrSw = get("stroke-width");

    // Lucide defaults: fill none, stroke currentColor
    if (fill != null) shape.fill = fill;
    else if (attrFill && attrFill !== "none" && attrFill !== "currentColor")
      shape.fill = attrFill;
    else shape.fill = "none";

    if (stroke != null) {
      shape.stroke = stroke;
      shape.sw = sw;
    } else if (attrStroke && attrStroke !== "none" && attrStroke !== "currentColor") {
      shape.stroke = attrStroke;
      shape.sw = num(attrSw, sw);
    } else if (shape.fill === "none") {
      // stroke icon with no explicit color → caller should have set stroke
      shape.stroke = "#111827";
      shape.sw = num(attrSw, sw);
    }

    shapes.push(shape);
  }
  return shapes;
}

function starPoints(cx, cy, spikes, outerR, innerR, rotationDeg = -90) {
  const pts = [];
  const rot = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rot + (i * Math.PI) / spikes;
    pts.push(`${round(cx + r * Math.cos(a))},${round(cy + r * Math.sin(a))}`);
  }
  return pts.join(" ");
}

function circleOfStars(count, cx, cy, orbitR, starOuter, starInner, fill) {
  const shapes = [];
  for (let i = 0; i < count; i++) {
    // Start at top (−90°)
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const sx = cx + orbitR * Math.cos(a);
    const sy = cy + orbitR * Math.sin(a);
    shapes.push({
      t: "polygon",
      points: starPoints(sx, sy, 5, starOuter, starInner),
      fill,
    });
  }
  return shapes;
}

/** Hand-authored / rebuilt flat icons that Lucide can't cover well. */
const HANDCRAFTED = {
  1: {
    name: "Hammer and sickle",
    note: "Uses `imports/hammer_sickle_circle.svg` via assetUrl (full imported artwork).",
    assetUrlVar: "hammerSickleUrl",
    shapes: [],
  },
  2: {
    name: "Red star",
    note: "Regenerated as a proper 5-point star polygon (was slightly uneven).",
    shapes: [
      {
        t: "polygon",
        points: starPoints(12, 12, 5, 10, 4.2),
        fill: "#dc2626",
      },
    ],
  },
  3: {
    name: "Anarchist circle-A",
    note: "Rebuilt A with separate strokes so the crossbar and legs render cleanly inside the circle.",
    shapes: [
      { t: "circle", cx: 12, cy: 12, r: 10.2, stroke: "#111827", sw: 1.9, fill: "none" },
      { t: "line", x1: 12, y1: 5.2, x2: 6.2, y2: 18.5, stroke: "#111827", sw: 1.9 },
      { t: "line", x1: 12, y1: 5.2, x2: 17.8, y2: 18.5, stroke: "#111827", sw: 1.9 },
      { t: "line", x1: 8.2, y1: 14.2, x2: 15.8, y2: 14.2, stroke: "#111827", sw: 1.9 },
    ],
  },
  4: {
    name: "Raised fist",
    note: "No good flat Lucide match. Rebuilt fist with thumb, finger ridges, and wrist cuff.",
    shapes: [
      { t: "rect", x: 9.5, y: 15, w: 5, h: 5.5, rx: 1, fill: "#c68958" },
      { t: "path", d: "M7 14.5V8.2a2 2 0 0 1 2-2h.8V14.5z", fill: "#c68958" },
      { t: "path", d: "M9.8 6.2h2.2V14.5H9.8z", fill: "#b67848" },
      { t: "path", d: "M12 5.5h2.2V14.5H12z", fill: "#c68958" },
      { t: "path", d: "M14.2 6.2h2.2a1.5 1.5 0 0 1 1.5 1.5V14.5h-3.7z", fill: "#b67848" },
      { t: "path", d: "M6.5 10.5c-1.8.2-2.8 1.6-2.8 3.2 0 1.4 1 2.5 2.6 2.5H9.5V12c0-.9.4-1.5 1-1.5", fill: "#c68958" },
      { t: "rect", x: 8.5, y: 19.5, w: 7, h: 1.8, rx: 0.4, fill: "#8a5a35" },
    ],
  },
  7: {
    name: "Dove carrying an olive branch",
    note: "No Lucide dove. Rebuilt as a white bird silhouette with beak, wing, eye, and green olive sprig.",
    shapes: [
      { t: "ellipse", cx: 11.5, cy: 12, rx: 6.2, ry: 3.8, fill: "#f3f4f6" },
      { t: "path", d: "M6.5 11.5c-2.5.2-4 2-4.5 3.8 1.6-.2 3.2-.8 4.2-1.8z", fill: "#e5e7eb" },
      { t: "polygon", points: "17.2,11.2 21.5,10.2 17.2,9.4", fill: "#f59e0b" },
      { t: "circle", cx: 15.8, cy: 10.6, r: 0.55, fill: "#111827" },
      { t: "path", d: "M4.2 15.2c-1.5 1.2-2.4 2.8-2.6 4.4", stroke: "#4d7c0f", sw: 1.3, fill: "none" },
      { t: "ellipse", cx: 1.8, cy: 19.6, rx: 1.3, ry: 0.8, fill: "#65a30d" },
      { t: "ellipse", cx: 3.2, cy: 18.4, rx: 1.1, ry: 0.7, fill: "#65a30d" },
    ],
  },
  9: {
    name: "Eagle (national emblem style)",
    note: "No suitable Lucide eagle. Rebuilt heraldic silhouette: head, spread wings, body, tail.",
    shapes: [
      { t: "polygon", points: "12,4.5 13.2,7.5 10.8,7.5", fill: "#78350f" },
      { t: "circle", cx: 12, cy: 8.2, r: 2, fill: "#92400e" },
      { t: "polygon", points: "12,9.5 2.5,13.5 6.5,12.2 8.5,14.5 10.5,12.8 12,20 13.5,12.8 15.5,14.5 17.5,12.2 21.5,13.5", fill: "#78350f" },
      { t: "polygon", points: "11.2,19.2 12,22 12.8,19.2", fill: "#f59e0b" },
    ],
  },
  13: {
    name: "Circle of stars (EU-style)",
    note: "Fixed: was yellow dots on a ring. Now EU blue disc with 12 proper 5-point gold stars (starts at top).",
    shapes: [
      { t: "circle", cx: 12, cy: 12, r: 11, fill: "#1d4ed8" },
      ...circleOfStars(12, 12, 12, 7.2, 1.55, 0.65, "#facc15"),
    ],
  },
  14: {
    name: "Wheat sheaf",
    note: "No Lucide wheat. Rebuilt sheaf with central stalk, three grain heads, and binding.",
    shapes: [
      { t: "line", x1: 12, y1: 21, x2: 12, y2: 10, stroke: "#92400e", sw: 1.6 },
      { t: "path", d: "M12 10c-2.2-1.8-2.8-4.5-1.6-7.2 2.2 1.6 2.6 4.2 1.6 7.2z", fill: "#eab308" },
      { t: "path", d: "M12 12.5c-3-1.2-4.4-3.8-3.6-6.8 2.4 1.2 3.4 3.6 3.6 6.8z", fill: "#facc15" },
      { t: "path", d: "M12 12.5c3-1.2 4.4-3.8 3.6-6.8-2.4 1.2-3.4 3.6-3.6 6.8z", fill: "#facc15" },
      { t: "path", d: "M12 14.5c-2.4-.6-3.6-2.4-3.2-4.5 1.8.8 2.8 2.4 3.2 4.5z", fill: "#eab308" },
      { t: "path", d: "M12 14.5c2.4-.6 3.6-2.4 3.2-4.5-1.8.8-2.8 2.4-3.2 4.5z", fill: "#eab308" },
      { t: "rect", x: 9.2, y: 16.2, w: 5.6, h: 1.5, rx: 0.4, fill: "#92400e" },
    ],
  },
  20: {
    name: "Recycling arrows",
    note: "Replaced crude triangle-on-ring with Lucide recycle paths (fetched).",
    // filled by Lucide below
    shapes: null,
  },
  21: {
    name: "Progress pride flag",
    note: "Uses `imports/pride_flag.svg` via assetUrl (full imported artwork).",
    assetUrlVar: "prideFlagUrl",
    shapes: [],
  },
  22: {
    name: "Mars Male symbol",
    note: "Tightened geometry so the arrowhead and circle proportions match the standard ♂ glyph.",
    shapes: [
      { t: "circle", cx: 10, cy: 14, r: 5.5, fill: "none", stroke: "#2563eb", sw: 1.9 },
      { t: "line", x1: 13.9, y1: 10.1, x2: 19.5, y2: 4.5, stroke: "#2563eb", sw: 1.9 },
      { t: "line", x1: 15.2, y1: 4.5, x2: 19.5, y2: 4.5, stroke: "#2563eb", sw: 1.9 },
      { t: "line", x1: 19.5, y1: 4.5, x2: 19.5, y2: 8.8, stroke: "#2563eb", sw: 1.9 },
    ],
  },
  23: {
    name: "Mars Female Symbol",
    note: "Renamed conceptually as Venus ♀; tightened circle/cross proportions.",
    shapes: [
      { t: "circle", cx: 12, cy: 9, r: 5.5, fill: "none", stroke: "#db2777", sw: 1.9 },
      { t: "line", x1: 12, y1: 14.5, x2: 12, y2: 21, stroke: "#db2777", sw: 1.9 },
      { t: "line", x1: 8.5, y1: 18, x2: 15.5, y2: 18, stroke: "#db2777", sw: 1.9 },
    ],
  },
  24: {
    name: "UN Emblem",
    note: "Simplified UN-style emblem: azure disc, latitude rings, meridians, olive branches (handcrafted; official emblem is trademarked so this is a non-official lookalike).",
    shapes: [
      { t: "circle", cx: 12, cy: 11.2, r: 10.2, fill: "#5b92e5" },
      { t: "circle", cx: 12, cy: 10.8, r: 6.6, fill: "none", stroke: "#f8fafc", sw: 0.7 },
      { t: "circle", cx: 12, cy: 10.8, r: 3.8, fill: "none", stroke: "#f8fafc", sw: 0.65 },
      { t: "circle", cx: 12, cy: 10.8, r: 1.1, fill: "#f8fafc" },
      ...[0, 30, 60, 90, 120, 150].map((a, i) => ({
        t: "line",
        x1: 12,
        y1: 4.2,
        x2: 12,
        y2: 17.4,
        stroke: "#f8fafc",
        sw: 0.55,
        transform: `rotate(${a} 12 10.8)`,
        key: `m${i}`,
      })),
      { t: "path", d: "M5.8 19.2c-1.8-2.4-2.2-5.6-1-8.4", stroke: "#f8fafc", sw: 1.05, fill: "none" },
      { t: "path", d: "M18.2 19.2c1.8-2.4 2.2-5.6 1-8.4", stroke: "#f8fafc", sw: 1.05, fill: "none" },
      { t: "ellipse", cx: 5.6, cy: 18.4, rx: 1.2, ry: 0.55, fill: "#f8fafc", transform: "rotate(-35 5.6 18.4)" },
      { t: "ellipse", cx: 5.1, cy: 15.6, rx: 1.2, ry: 0.55, fill: "#f8fafc", transform: "rotate(-20 5.1 15.6)" },
      { t: "ellipse", cx: 5.0, cy: 12.8, rx: 1.15, ry: 0.5, fill: "#f8fafc", transform: "rotate(-5 5 12.8)" },
      { t: "ellipse", cx: 5.5, cy: 10.4, rx: 1.1, ry: 0.5, fill: "#f8fafc", transform: "rotate(12 5.5 10.4)" },
      { t: "ellipse", cx: 18.4, cy: 18.4, rx: 1.2, ry: 0.55, fill: "#f8fafc", transform: "rotate(35 18.4 18.4)" },
      { t: "ellipse", cx: 18.9, cy: 15.6, rx: 1.2, ry: 0.55, fill: "#f8fafc", transform: "rotate(20 18.9 15.6)" },
      { t: "ellipse", cx: 19.0, cy: 12.8, rx: 1.15, ry: 0.5, fill: "#f8fafc", transform: "rotate(5 19 12.8)" },
      { t: "ellipse", cx: 18.5, cy: 10.4, rx: 1.1, ry: 0.5, fill: "#f8fafc", transform: "rotate(-12 18.5 10.4)" },
    ],
  },
  26: {
    name: "Radar/spider-chart outline",
    note: "Kept radar concept; cleaned pentagon rings and spokes with consistent stroke weight.",
    shapes: [
      { t: "polygon", points: "12,3 20.2,9 17,19.5 7,19.5 3.8,9", fill: "none", stroke: "#059669", sw: 1.25 },
      { t: "polygon", points: "12,7 16.4,10.4 14.6,16.2 9.4,16.2 7.6,10.4", fill: "none", stroke: "#059669", sw: 1.15 },
      { t: "polygon", points: "12,10.2 14.2,11.8 13.3,14.6 10.7,14.6 9.8,11.8", fill: "#a7f3d0", stroke: "#059669", sw: 1 },
      { t: "line", x1: 12, y1: 3, x2: 12, y2: 12, stroke: "#059669", sw: 0.85 },
      { t: "line", x1: 20.2, y1: 9, x2: 12, y2: 12, stroke: "#059669", sw: 0.85 },
      { t: "line", x1: 17, y1: 19.5, x2: 12, y2: 12, stroke: "#059669", sw: 0.85 },
      { t: "line", x1: 7, y1: 19.5, x2: 12, y2: 12, stroke: "#059669", sw: 0.85 },
      { t: "line", x1: 3.8, y1: 9, x2: 12, y2: 12, stroke: "#059669", sw: 0.85 },
    ],
  },
  27: {
    name: "Yin-yang",
    note: "Retuned classic taijitu: black disc, white S-curve, opposite eye dots (standard SVG construction).",
    shapes: [
      { t: "circle", cx: 12, cy: 12, r: 10, fill: "#111827" },
      {
        t: "path",
        d: "M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10z",
        fill: "#f8fafc",
      },
      { t: "circle", cx: 12, cy: 7, r: 1.7, fill: "#f8fafc" },
      { t: "circle", cx: 12, cy: 17, r: 1.7, fill: "#111827" },
    ],
  },
  30: {
    name: "Owl",
    note: "No Lucide owl. Rebuilt with body, ear tufts, eyes, beak, and chest highlight.",
    shapes: [
      { t: "ellipse", cx: 12, cy: 14.2, rx: 7.2, ry: 6.8, fill: "#78350f" },
      { t: "polygon", points: "5.5,9 8.5,3.8 9.2,9.5", fill: "#78350f" },
      { t: "polygon", points: "18.5,9 15.5,3.8 14.8,9.5", fill: "#78350f" },
      { t: "ellipse", cx: 12, cy: 15.5, rx: 4, ry: 3.2, fill: "#a16207" },
      { t: "circle", cx: 9, cy: 12.5, r: 2.7, fill: "#fef3c7" },
      { t: "circle", cx: 15, cy: 12.5, r: 2.7, fill: "#fef3c7" },
      { t: "circle", cx: 9, cy: 12.5, r: 1.15, fill: "#111827" },
      { t: "circle", cx: 15, cy: 12.5, r: 1.15, fill: "#111827" },
      { t: "polygon", points: "11,15.2 13,15.2 12,17.6", fill: "#f59e0b" },
    ],
  },
  32: {
    name: "Labyrinth/maze",
    note: "Rebuilt as concentric square maze paths (old single path looked broken with fill rules).",
    shapes: [
      { t: "rect", x: 3.5, y: 3.5, w: 17, h: 17, fill: "none", stroke: "#57534e", sw: 1.5 },
      { t: "rect", x: 6.5, y: 6.5, w: 11, h: 11, fill: "none", stroke: "#57534e", sw: 1.5 },
      { t: "rect", x: 9.5, y: 9.5, w: 5, h: 5, fill: "none", stroke: "#57534e", sw: 1.5 },
      { t: "line", x1: 12, y1: 3.5, x2: 12, y2: 6.5, stroke: "#f5f5f4", sw: 2 },
      { t: "line", x1: 17.5, y1: 12, x2: 20.5, y2: 12, stroke: "#f5f5f4", sw: 2 },
      { t: "line", x1: 12, y1: 14.5, x2: 12, y2: 17.5, stroke: "#f5f5f4", sw: 2 },
    ],
  },
  34: {
    name: "Lotus flower",
    note: "Rebuilt overlapping petals (5) with a center; old rotation pivot made petals look clipped.",
    shapes: [
      { t: "path", d: "M12 20c0-5-2.2-9.5 0-14 2.2 4.5 0 9 0 14z", fill: "#f9a8d4" },
      { t: "path", d: "M12 20c-3.2-4-5.5-7.5-4.2-12.2 3 2.8 3.8 7 4.2 12.2z", fill: "#f472b6" },
      { t: "path", d: "M12 20c3.2-4 5.5-7.5 4.2-12.2-3 2.8-3.8 7-4.2 12.2z", fill: "#f472b6" },
      { t: "path", d: "M12 20c-5-2.8-7.5-6-7-10.5 3.5 1.8 5.8 5.5 7 10.5z", fill: "#ec4899" },
      { t: "path", d: "M12 20c5-2.8 7.5-6 7-10.5-3.5 1.8-5.8 5.5-7 10.5z", fill: "#ec4899" },
      { t: "circle", cx: 12, cy: 18.2, r: 1.4, fill: "#fce7f3" },
    ],
  },
  35: {
    name: "Crescent moon and star",
    note: "Uses `imports/star_crescent.svg` via assetUrl (full imported artwork).",
    assetUrlVar: "starCrescentUrl",
    shapes: [],
  },
  37: {
    name: "Star of David",
    note: "Kept two overlapping triangles; slightly thicker stroke for legibility at 24px.",
    shapes: [
      { t: "polygon", points: "12,3.2 20.2,17.5 3.8,17.5", fill: "none", stroke: "#2563eb", sw: 1.7 },
      { t: "polygon", points: "12,20.8 3.8,6.5 20.2,6.5", fill: "none", stroke: "#2563eb", sw: 1.7 },
    ],
  },
  38: {
    name: "Dharma wheel",
    note: "Rebuilt as rim + hub + 8 spokes (classic Dharmachakra layout).",
    shapes: [
      { t: "circle", cx: 12, cy: 12, r: 9.2, fill: "none", stroke: "#b45309", sw: 1.7 },
      { t: "circle", cx: 12, cy: 12, r: 6.2, fill: "none", stroke: "#b45309", sw: 1.1 },
      { t: "circle", cx: 12, cy: 12, r: 2.1, fill: "#b45309" },
      ...[0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => ({
        t: "line",
        x1: 12,
        y1: 12,
        x2: 12,
        y2: 3.2,
        stroke: "#b45309",
        sw: 1.25,
        transform: `rotate(${a} 12 12)`,
        key: i,
      })),
    ],
  },
  40: {
    name: "Interlocking rings",
    note: "Adjusted to five Olympic-style rings (scaled into 24px) with classic colors.",
    shapes: [
      { t: "circle", cx: 6.2, cy: 9.2, r: 3.6, fill: "none", stroke: "#2563eb", sw: 1.5 },
      { t: "circle", cx: 12, cy: 9.2, r: 3.6, fill: "none", stroke: "#111827", sw: 1.5 },
      { t: "circle", cx: 17.8, cy: 9.2, r: 3.6, fill: "none", stroke: "#dc2626", sw: 1.5 },
      { t: "circle", cx: 9.1, cy: 12.8, r: 3.6, fill: "none", stroke: "#eab308", sw: 1.5 },
      { t: "circle", cx: 14.9, cy: 12.8, r: 3.6, fill: "none", stroke: "#16a34a", sw: 1.5 },
    ],
  },
  41: {
    name: "Zodiac wheel",
    note: "Rebuilt as outer ring, inner ring, hub, and 12 tick marks (flat astrology wheel).",
    shapes: [
      { t: "circle", cx: 12, cy: 12, r: 9.5, fill: "none", stroke: "#7c3aed", sw: 1.5 },
      { t: "circle", cx: 12, cy: 12, r: 6.5, fill: "none", stroke: "#7c3aed", sw: 1.1 },
      { t: "circle", cx: 12, cy: 12, r: 1.4, fill: "#7c3aed" },
      ...Array.from({ length: 12 }, (_, i) => {
        const a = i * 30;
        return {
          t: "line",
          x1: 12,
          y1: 2.8,
          x2: 12,
          y2: 5.2,
          stroke: "#7c3aed",
          sw: 1.15,
          transform: `rotate(${a} 12 12)`,
          key: i,
        };
      }),
    ],
  },
  42: {
    name: "Crystal ball",
    note: "Improved glass sphere with highlight, stand, and base plate.",
    shapes: [
      { t: "circle", cx: 12, cy: 10.5, r: 7.8, fill: "#c4b5fd" },
      { t: "ellipse", cx: 9.4, cy: 7.6, rx: 2.4, ry: 1.5, fill: "#ede9fe" },
      { t: "path", d: "M7.2 17.8c1.2 1.4 2.8 2.2 4.8 2.2s3.6-.8 4.8-2.2", stroke: "#7c3aed", sw: 1.1, fill: "none" },
      { t: "rect", x: 7.5, y: 19.2, w: 9, h: 2, rx: 0.6, fill: "#57534e" },
    ],
  },
};

/** Lucide icon name + color for stroke icons that map cleanly. */
const LUCIDE_MAP = {
  5: { file: "scale.svg", stroke: "#6b7280", name: "Scales of justice", note: "Fetched Lucide `scale` SVG → path shapes." },
  6: { file: "vote.svg", stroke: "#374151", name: "Ballot box with slotted paper", note: "Fetched Lucide `vote` SVG (ballot). Fallback handcraft if missing." },
  8: { file: "flag.svg", stroke: "#3b82f6", name: "Wavy flag silhouette", note: "Fetched Lucide `flag` SVG; recolored blue." },
  10: { file: "crown.svg", stroke: "#eab308", name: "Crown", note: "Fetched Lucide `crown` SVG; gold stroke." },
  11: { file: "gavel.svg", stroke: "#6b4423", name: "Gavel", note: "Fetched Lucide `gavel` SVG." },
  12: { file: "landmark.svg", stroke: "#9ca3af", name: "Classical/capitol building silhouette", note: "Fetched Lucide `landmark` SVG." },
  15: { file: "factory.svg", stroke: "#4b5563", name: "Factory with smokestacks", note: "Fetched Lucide `factory` SVG." },
  16: { file: "cog.svg", stroke: "#6b7280", name: "Gear/cog", note: "Fetched Lucide `cog` SVG (replaces rotated-rect hack)." },
  17: { file: "circle-dollar-sign.svg", stroke: "#16a34a", name: "Dollar sign", note: "Fetched Lucide `circle-dollar-sign` SVG." },
  18: { file: "coins.svg", stroke: "#eab308", name: "Stacked coins", note: "Fetched Lucide `coins` SVG." },
  19: { file: "lock.svg", stroke: "#4b5563", name: "Padlock", note: "Fetched Lucide `lock` SVG." },
  20: { file: "recycle.svg", stroke: "#16a34a", name: "Recycling arrows", note: "Fetched Lucide `recycle` SVG." },
  25: { file: "compass.svg", stroke: "#374151", name: "Compass rose", note: "Fetched Lucide `compass` SVG." },
  28: { file: "brain.svg", stroke: "#ec4899", name: "Brain outline", note: "Fetched Lucide `brain` SVG." },
  29: { file: "puzzle.svg", stroke: "#f97316", name: "Puzzle piece", note: "Fetched Lucide `puzzle` SVG." },
  31: { file: "infinity.svg", stroke: "#4338ca", name: "Infinity symbol", note: "Fetched Lucide `infinity` SVG." },
  36: { file: "plus.svg", stroke: "#78716c", name: "Cross", note: "Fetched Lucide `plus` as a clean cross; sized via stroke. (Christian cross kept as handcrafted alternative below if preferred.)" },
  39: { file: "heart.svg", stroke: "#e11d48", name: "Heart", note: "Fetched Lucide `heart` SVG; filled red." },
  43: { file: "briefcase.svg", stroke: "#92400e", name: "Briefcase", note: "Fetched Lucide `briefcase` SVG." },
  44: { file: "palette.svg", stroke: "#78350f", name: "Artist's palette", note: "Fetched Lucide `palette` SVG; added paint dots by hand after convert." },
};

function serializeShape(shape) {
  const parts = [`t: "${shape.t}"`];
  for (const [k, v] of Object.entries(shape)) {
    if (k === "t" || v === undefined) continue;
    if (typeof v === "string") parts.push(`${k}: "${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    else parts.push(`${k}: ${v}`);
  }
  return `{ ${parts.join(", ")} }`;
}

function serializeSymbol(sym) {
  if (sym.assetUrlVar) {
    return `  { id: ${sym.id}, name: "${sym.name.replace(/"/g, '\\"')}", assetUrl: ${sym.assetUrlVar}, shapes: [] },`;
  }
  const shapes = sym.shapes.map((s) => `    ${serializeShape(s)},`).join("\n");
  return `  { id: ${sym.id}, name: "${sym.name.replace(/"/g, '\\"')}", shapes: [\n${shapes}\n  ] },`;
}

async function main() {
  const report = [];
  const symbols = [];

  // Prefer a true Christian cross for id 36 (not a plus)
  const crossHand = {
    id: 36,
    name: "Cross",
    shapes: [
      { t: "rect", x: 10.2, y: 2.8, w: 3.6, h: 18.4, rx: 0.6, fill: "#78716c" },
      { t: "rect", x: 4.2, y: 7.5, w: 15.6, h: 3.6, rx: 0.6, fill: "#78716c" },
    ],
    note: "Kept as a Latin cross (filled bars). Lucide only has `plus`, which is the wrong proportions for a religious cross.",
  };

  for (let id = 1; id <= 44; id++) {
    if (id === 33) continue;
    if (id === 36) {
      symbols.push({ id, name: crossHand.name, shapes: crossHand.shapes });
      report.push(`| ${id} | ${crossHand.name} | ${crossHand.note} |`);
      continue;
    }

    if (HANDCRAFTED[id]?.shapes || HANDCRAFTED[id]?.assetUrlVar) {
      const h = HANDCRAFTED[id];
      symbols.push({
        id,
        name: h.name,
        shapes: h.shapes || [],
        ...(h.assetUrlVar ? { assetUrlVar: h.assetUrlVar } : {}),
      });
      report.push(`| ${id} | ${h.name} | ${h.note} |`);
      continue;
    }

    const lucide = LUCIDE_MAP[id];
    if (!lucide) {
      report.push(`| ${id} | (unknown) | No source found; left unchanged. |`);
      continue;
    }

    try {
      const svg = await fetchCached(lucide.file, `${LUCIDE}/${lucide.file}`);
      let shapes = parseSvg(svg, { stroke: lucide.stroke, sw: 1.75 });

      // Heart looks better filled
      if (id === 39) {
        shapes = shapes.map((s) => ({
          ...s,
          fill: "#e11d48",
          stroke: undefined,
          sw: undefined,
        }));
      }

      // Palette: keep stroke body, add color dots
      if (id === 44) {
        shapes = [
          ...shapes,
          { t: "circle", cx: 9, cy: 10, r: 1.2, fill: "#dc2626" },
          { t: "circle", cx: 12.5, cy: 8, r: 1.2, fill: "#2563eb" },
          { t: "circle", cx: 15.5, cy: 10.5, r: 1.2, fill: "#16a34a" },
          { t: "circle", cx: 11, cy: 13.5, r: 1.2, fill: "#eab308" },
        ];
      }

      if (!shapes.length) throw new Error("no shapes parsed");

      symbols.push({ id, name: lucide.name, shapes });
      report.push(`| ${id} | ${lucide.name} | ${lucide.note} |`);
    } catch (err) {
      // Ballot box fallback if vote.svg missing
      if (id === 6) {
        const shapes = [
          { t: "rect", x: 4, y: 9, w: 16, h: 11, rx: 1.2, fill: "#374151" },
          { t: "rect", x: 9.5, y: 3, w: 5, h: 8, rx: 0.4, fill: "#f3f4f6", stroke: "#9ca3af", sw: 0.8 },
          { t: "rect", x: 8.5, y: 12.8, w: 7, h: 1.4, fill: "#111827" },
        ];
        symbols.push({ id, name: lucide.name, shapes });
        report.push(
          `| ${id} | ${lucide.name} | Lucide fetch failed (${err.message}); used handcrafted ballot box. |`,
        );
      } else {
        report.push(`| ${id} | ${lucide.name} | FAILED to fetch (${err.message}). |`);
      }
    }
  }

  symbols.sort((a, b) => a.id - b.id);

  const header = `// Minimal flat-icon glyph data for the 44 quiz symbols. viewBox is always "0 0 24 24".
// Regenerated by scripts/rebuild-icons.mjs (Lucide CDN + handcrafted symbolic glyphs).

import hammerSickleUrl from "../../imports/hammer_sickle_circle.svg";
import prideFlagUrl from "../../imports/pride_flag.svg";
import starCrescentUrl from "../../imports/star_crescent.svg";

export type IconShape = {
  t: string;
  fill?: string;
  stroke?: string;
  sw?: number;
  transform?: string;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  d?: string;
  points?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  key?: string | number;
};

export type IconSymbol = {
  id: number;
  name: string;
  shapes: IconShape[];
  /** Optional full SVG asset (used instead of shapes when set). */
  assetUrl?: string;
};

export const SYMBOLS: IconSymbol[] = [
`;

  const body = symbols.map(serializeSymbol).join("\n");
  const footer = `\n];\n`;
  fs.writeFileSync(OUT, header + body + footer);

  const md = `# Icon rebuild report

Generated by \`scripts/rebuild-icons.mjs\`.

Sources:
- Lucide Static SVG CDN (\`cdn.jsdelivr.net/npm/lucide-static@0.460.0/icons\`) for object/UI glyphs
- Handcrafted flat shapes for political/religious/symbolic glyphs with no good Lucide match

| ID | Name | Change |
|----|------|--------|
${report.join("\n")}
`;
  fs.writeFileSync(REPORT, md);
  console.log(`Wrote ${symbols.length} icons → ${OUT}`);
  console.log(`Report → ${REPORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
