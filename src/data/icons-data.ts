// Minimal flat-icon glyph data for the 44 quiz symbols. viewBox is always "0 0 24 24".

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
};

export const SYMBOLS: IconSymbol[] = [
  { id: 1, name: "Hammer and sickle", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 11, fill: "#b91c1c" },
    { t: "path", d: "M15.5 7.2a4.3 4.3 0 1 1-4.1 6.4", stroke: "#fbbf24", sw: 1.7, fill: "none" },
    { t: "line", x1: 11.6, y1: 13.4, x2: 6.2, y2: 18.8, stroke: "#fbbf24", sw: 1.7 },
    { t: "line", x1: 7, y1: 18.5, x2: 15.5, y2: 10, stroke: "#fbbf24", sw: 1.7 },
    { t: "rect", x: 13.6, y: 6.3, w: 5.4, h: 2.6, rx: 0.4, fill: "#fbbf24", transform: "rotate(45 16.3 7.6)" },
  ]},
  { id: 2, name: "Red star", shapes: [
    { t: "polygon", points: "12,2.5 14.7,9.2 21.8,9.5 16.2,14 18.2,21 12,17 5.8,21 7.8,14 2.2,9.5 9.3,9.2", fill: "#dc2626" },
  ]},
  { id: 3, name: "Anarchist circle-A", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 10.5, stroke: "#111827", sw: 1.8, fill: "none" },
    { t: "path", d: "M12 5.5 6 18.5 M12 5.5 18 18.5 M8 14.5h8", stroke: "#111827", sw: 1.8, fill: "none" },
  ]},
  { id: 4, name: "Raised fist", shapes: [
    { t: "rect", x: 10, y: 13, w: 3, h: 6, fill: "#c68958" },
    { t: "rect", x: 6, y: 5, w: 12, h: 10, rx: 4, fill: "#c68958" },
    { t: "line", x1: 9, y1: 5.5, x2: 9, y2: 13, stroke: "#8a5a35", sw: 1 },
    { t: "line", x1: 12, y1: 5, x2: 12, y2: 13, stroke: "#8a5a35", sw: 1 },
    { t: "line", x1: 15, y1: 5.5, x2: 15, y2: 13, stroke: "#8a5a35", sw: 1 },
  ]},
  { id: 5, name: "Scales of justice", shapes: [
    { t: "line", x1: 12, y1: 3, x2: 12, y2: 19, stroke: "#6b7280", sw: 1.8 },
    { t: "line", x1: 5, y1: 7, x2: 19, y2: 7, stroke: "#6b7280", sw: 1.8 },
    { t: "path", d: "M5 7l-2.5 6a3 3 0 0 0 5 0z", stroke: "#6b7280", sw: 1.4, fill: "none" },
    { t: "path", d: "M19 7l-2.5 6a3 3 0 0 0 5 0z", stroke: "#6b7280", sw: 1.4, fill: "none" },
    { t: "rect", x: 8, y: 19, w: 8, h: 2, fill: "#6b7280" },
  ]},
  { id: 6, name: "Ballot box with slotted paper", shapes: [
    { t: "rect", x: 4, y: 9, w: 16, h: 11, rx: 1, fill: "#374151" },
    { t: "rect", x: 9, y: 3, w: 4, h: 9, fill: "#e5e7eb", stroke: "#9ca3af", sw: 0.8 },
    { t: "rect", x: 9, y: 12.5, w: 6, h: 1.2, fill: "#111827" },
  ]},
  { id: 7, name: "Dove carrying an olive branch", shapes: [
    { t: "ellipse", cx: 11, cy: 12, rx: 6.5, ry: 4, fill: "#f3f4f6" },
    { t: "polygon", points: "17,12 21,10.5 17,10", fill: "#f3f4f6" },
    { t: "circle", cx: 16, cy: 10.5, r: 0.7, fill: "#111827" },
    { t: "path", d: "M5 14c-2 1-3 3-3 5", stroke: "#4d7c0f", sw: 1.4, fill: "none" },
    { t: "circle", cx: 2.5, cy: 19.3, r: 1.1, fill: "#65a30d" },
  ]},
  { id: 8, name: "Wavy flag silhouette", shapes: [
    { t: "line", x1: 5, y1: 3, x2: 5, y2: 21, stroke: "#6b7280", sw: 1.6 },
    { t: "path", d: "M5 5c4-2 6 2 10 0v8c-4 2-6-2-10 0z", fill: "#3b82f6" },
  ]},
  { id: 9, name: "Eagle (national emblem style)", shapes: [
    { t: "polygon", points: "12,9 3,15 10,13 12,20 14,13 21,15", fill: "#78350f" },
    { t: "circle", cx: 12, cy: 8, r: 2.2, fill: "#78350f" },
  ]},
  { id: 10, name: "Crown", shapes: [
    { t: "polygon", points: "4,16 6,7 9,12 12,6 15,12 18,7 20,16", fill: "#eab308" },
    { t: "rect", x: 4, y: 16, w: 16, h: 3, fill: "#eab308" },
    { t: "circle", cx: 6, cy: 7, r: 1.1, fill: "#dc2626" },
    { t: "circle", cx: 12, cy: 6, r: 1.1, fill: "#dc2626" },
    { t: "circle", cx: 18, cy: 7, r: 1.1, fill: "#dc2626" },
  ]},
  { id: 11, name: "Gavel", shapes: [
    { t: "rect", x: 3, y: 17, w: 10, h: 2, rx: 1, fill: "#6b4423" },
    { t: "line", x1: 12, y1: 15, x2: 20, y2: 7, stroke: "#8a5a35", sw: 2 },
    { t: "rect", x: 13.2, y: 3.5, w: 6, h: 3.5, rx: 0.8, fill: "#6b4423", transform: "rotate(45 16.2 5.25)" },
  ]},
  { id: 12, name: "Classical/capitol building silhouette", shapes: [
    { t: "polygon", points: "12,3 20,9 4,9", fill: "#9ca3af" },
    { t: "rect", x: 4, y: 9, w: 16, h: 9, fill: "none", stroke: "#9ca3af", sw: 0.6 },
    { t: "line", x1: 6.5, y1: 9, x2: 6.5, y2: 18, stroke: "#9ca3af", sw: 1.6 },
    { t: "line", x1: 9.8, y1: 9, x2: 9.8, y2: 18, stroke: "#9ca3af", sw: 1.6 },
    { t: "line", x1: 13.1, y1: 9, x2: 13.1, y2: 18, stroke: "#9ca3af", sw: 1.6 },
    { t: "line", x1: 16.4, y1: 9, x2: 16.4, y2: 18, stroke: "#9ca3af", sw: 1.6 },
    { t: "line", x1: 19.7, y1: 9, x2: 19.7, y2: 18, stroke: "#9ca3af", sw: 1.6 },
    { t: "rect", x: 3, y: 18, w: 18, h: 2, fill: "#9ca3af" },
  ]},
  { id: 13, name: "Circle of stars (EU-style)", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 9, fill: "none", stroke: "#1d4ed8", sw: 3 },
    ...[0,30,60,90,120,150,180,210,240,270,300,330].map((a,i)=>({ t:"circle", cx: 12+8*Math.cos(a*Math.PI/180), cy: 12+8*Math.sin(a*Math.PI/180), r: 0.8, fill:"#facc15", key:i })),
  ]},
  { id: 14, name: "Wheat sheaf", shapes: [
    { t: "path", d: "M12 21V9", stroke: "#ca8a04", sw: 1.6, fill: "none" },
    { t: "path", d: "M12 9c-2-2-2-5-1-8 2 2 2 5 1 8z", fill: "#eab308" },
    { t: "path", d: "M12 12c-3-1-4-4-3.5-7 2.5 1.5 3.5 4 3.5 7z", fill: "#eab308" },
    { t: "path", d: "M12 12c3-1 4-4 3.5-7-2.5 1.5-3.5 4-3.5 7z", fill: "#eab308" },
    { t: "rect", x: 9, y: 15, w: 6, h: 1.6, fill: "#92400e" },
  ]},
  { id: 15, name: "Factory with smokestacks", shapes: [
    { t: "rect", x: 3, y: 12, w: 18, h: 8, fill: "#6b7280" },
    { t: "polygon", points: "3,12 8,7 8,12", fill: "#4b5563" },
    { t: "polygon", points: "10,12 15,8 15,12", fill: "#4b5563" },
    { t: "rect", x: 16, y: 4, w: 2.4, h: 8, fill: "#4b5563" },
    { t: "circle", cx: 17.2, cy: 3, r: 1.4, fill: "#d1d5db" },
  ]},
  { id: 16, name: "Gear/cog", shapes: [
    ...[0,45,90,135,180,225,270,315].map((a,i)=>({ t:"rect", x: 11, y: 1.5, w: 2, h: 4, fill:"#6b7280", transform:`rotate(${a} 12 12)`, key:i })),
    { t: "circle", cx: 12, cy: 12, r: 7, fill: "#6b7280" },
    { t: "circle", cx: 12, cy: 12, r: 3, fill: "#f3f4f6" },
  ]},
  { id: 17, name: "Dollar sign", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 10.5, fill: "#16a34a" },
    { t: "path", d: "M14.5 8.2c-.8-.5-1.7-.7-2.5-.7-1.9 0-3 .9-3 2.1 0 3 6 1.6 6 4.7 0 1.3-1.3 2.2-3.2 2.2-1 0-2-.3-2.8-.9", stroke: "#f0fdf4", sw: 1.6, fill: "none" },
    { t: "line", x1: 12, y1: 5.5, x2: 12, y2: 18.5, stroke: "#f0fdf4", sw: 1.6 },
  ]},
  { id: 18, name: "Stacked coins", shapes: [
    { t: "ellipse", cx: 12, cy: 17, rx: 8, ry: 3, fill: "#eab308" },
    { t: "ellipse", cx: 12, cy: 13.5, rx: 8, ry: 3, fill: "#facc15" },
    { t: "ellipse", cx: 12, cy: 10, rx: 8, ry: 3, fill: "#fde047" },
  ]},
  { id: 19, name: "Padlock", shapes: [
    { t: "path", d: "M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10", stroke: "#6b7280", sw: 1.8, fill: "none" },
    { t: "rect", x: 5.5, y: 10, w: 13, h: 10, rx: 1.6, fill: "#4b5563" },
    { t: "circle", cx: 12, cy: 14.5, r: 1.4, fill: "#e5e7eb" },
  ]},
  { id: 20, name: "Recycling arrows", shapes: [
    ...[0,120,240].map((a,i)=>({ t:"polygon", points:"12,4 15,9 9,9", fill:"#16a34a", transform:`rotate(${a} 12 12)`, key:i })),
    { t: "circle", cx: 12, cy: 12, r: 7, fill: "none", stroke: "#16a34a", sw: 1.6 },
  ]},
  { id: 21, name: "Progress pride flag", shapes: [
    { t: "rect", x: 3, y: 4, w: 18, h: 2.3, fill: "#dc2626" },
    { t: "rect", x: 3, y: 6.3, w: 18, h: 2.3, fill: "#f97316" },
    { t: "rect", x: 3, y: 8.6, w: 18, h: 2.3, fill: "#facc15" },
    { t: "rect", x: 3, y: 10.9, w: 18, h: 2.3, fill: "#16a34a" },
    { t: "rect", x: 3, y: 13.2, w: 18, h: 2.3, fill: "#2563eb" },
    { t: "rect", x: 3, y: 15.5, w: 18, h: 2.3, fill: "#7c3aed" },
    { t: "polygon", points: "3,4 3,18 9,11", fill: "#f8fafc" },
    { t: "polygon", points: "3,4 3,18 8,11", fill: "#93c5fd" },
    { t: "polygon", points: "3,4 3,18 7,11", fill: "#f9a8d4" },
  ]},
  { id: 22, name: "Mars Male symbol", shapes: [
    { t: "circle", cx: 10, cy: 14, r: 6, fill: "none", stroke: "#2563eb", sw: 1.8 },
    { t: "line", x1: 14.2, y1: 9.8, x2: 20, y2: 4, stroke: "#2563eb", sw: 1.8 },
    { t: "polyline", points: "14,4 20,4 20,10", fill: "none", stroke: "#2563eb", sw: 1.8 },
  ]},
  { id: 23, name: "Mars Female Symbol", shapes: [
    { t: "circle", cx: 12, cy: 9, r: 6, fill: "none", stroke: "#db2777", sw: 1.8 },
    { t: "line", x1: 12, y1: 15, x2: 12, y2: 21, stroke: "#db2777", sw: 1.8 },
    { t: "line", x1: 8.5, y1: 18, x2: 15.5, y2: 18, stroke: "#db2777", sw: 1.8 },
  ]},
  { id: 24, name: "UN Emblem", shapes: [
    { t: "circle", cx: 12, cy: 11.5, r: 10.5, fill: "#5b92e5" },
    { t: "circle", cx: 12, cy: 11, r: 6.4, fill: "none", stroke: "#f8fafc", sw: 0.7 },
    { t: "circle", cx: 12, cy: 11, r: 3.6, fill: "none", stroke: "#f8fafc", sw: 0.6 },
    { t: "circle", cx: 12, cy: 11, r: 0.9, fill: "#f8fafc" },
    ...[0,30,60,90,120,150].map((a,i)=>({ t:"line", x1:12, y1:4.6, x2:12, y2:17.4, stroke:"#f8fafc", sw:0.5, transform:`rotate(${a} 12 11)`, key:`m${i}` })),
    { t: "path", d: "M7.2 20c-2-2.6-2.4-6.4-1-9.6", stroke: "#f8fafc", sw: 1, fill: "none" },
    { t: "path", d: "M16.8 20c2-2.6 2.4-6.4 1-9.6", stroke: "#f8fafc", sw: 1, fill: "none" },
    ...[[6.9,18.6,-40],[6.2,15.6,-25],[6.1,12.6,-8],[6.7,10.2,10]].map((p,i)=>({ t:"ellipse", cx:p[0], cy:p[1], rx:1.1, ry:0.55, fill:"#f8fafc", transform:`rotate(${p[2]} ${p[0]} ${p[1]})`, key:`ll${i}` })),
    ...[[17.1,18.6,40],[17.8,15.6,25],[17.9,12.6,8],[17.3,10.2,-10]].map((p,i)=>({ t:"ellipse", cx:p[0], cy:p[1], rx:1.1, ry:0.55, fill:"#f8fafc", transform:`rotate(${p[2]} ${p[0]} ${p[1]})`, key:`rl${i}` })),
  ]},
  { id: 25, name: "Compass rose", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 10, fill: "none", stroke: "#374151", sw: 1.2 },
    { t: "polygon", points: "12,3 14,12 12,21 10,12", fill: "#dc2626" },
    { t: "polygon", points: "3,12 12,10 21,12 12,14", fill: "#e5e7eb", stroke: "#374151", sw: 0.6 },
  ]},
  { id: 26, name: "Radar/spider-chart outline", shapes: [
    { t: "polygon", points: "12,3 20,9 17,19 7,19 4,9", fill: "none", stroke: "#059669", sw: 1.2 },
    { t: "polygon", points: "12,7 16,10.5 14.5,16 9.5,16 8,10.5", fill: "none", stroke: "#059669", sw: 1.2 },
    { t: "line", x1: 12, y1: 3, x2: 12, y2: 12, stroke: "#059669", sw: 0.8 },
    { t: "line", x1: 20, y1: 9, x2: 12, y2: 12, stroke: "#059669", sw: 0.8 },
    { t: "line", x1: 17, y1: 19, x2: 12, y2: 12, stroke: "#059669", sw: 0.8 },
    { t: "line", x1: 7, y1: 19, x2: 12, y2: 12, stroke: "#059669", sw: 0.8 },
    { t: "line", x1: 4, y1: 9, x2: 12, y2: 12, stroke: "#059669", sw: 0.8 },
  ]},
  { id: 27, name: "Yin-yang", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 10, fill: "#111827" },
    { t: "path", d: "M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10z", fill: "#f8fafc" },
    { t: "circle", cx: 12, cy: 7, r: 1.6, fill: "#f8fafc" },
    { t: "circle", cx: 12, cy: 17, r: 1.6, fill: "#111827" },
  ]},
  { id: 28, name: "Brain outline", shapes: [
    { t: "path", d: "M9 4a4 4 0 0 0-4 4 4 4 0 0 0-1 7.8A4 4 0 0 0 8 20a4 4 0 0 0 4-4V6a2 2 0 0 0-3-2z", fill: "none", stroke: "#ec4899", sw: 1.4 },
    { t: "path", d: "M15 4a4 4 0 0 1 4 4 4 4 0 0 1 1 7.8A4 4 0 0 1 16 20a4 4 0 0 1-4-4V6a2 2 0 0 1 3-2z", fill: "none", stroke: "#ec4899", sw: 1.4 },
  ]},
  { id: 29, name: "Puzzle piece", shapes: [
    { t: "path", d: "M5 5h5.5a1.8 1.8 0 1 1 3 0H19v5.5a1.8 1.8 0 1 1 0 3V19h-5.5a1.8 1.8 0 1 0-3 0H5v-5.5a1.8 1.8 0 1 0 0-3z", fill: "#f97316" },
  ]},
  { id: 30, name: "Owl", shapes: [
    { t: "ellipse", cx: 12, cy: 14, rx: 7, ry: 7, fill: "#78350f" },
    { t: "polygon", points: "6,8 9,4 9,9", fill: "#78350f" },
    { t: "polygon", points: "18,8 15,4 15,9", fill: "#78350f" },
    { t: "circle", cx: 9, cy: 13, r: 2.6, fill: "#fef3c7" },
    { t: "circle", cx: 15, cy: 13, r: 2.6, fill: "#fef3c7" },
    { t: "circle", cx: 9, cy: 13, r: 1.1, fill: "#111827" },
    { t: "circle", cx: 15, cy: 13, r: 1.1, fill: "#111827" },
    { t: "polygon", points: "11,16 13,16 12,18.5", fill: "#f59e0b" },
  ]},
  { id: 31, name: "Infinity symbol", shapes: [
    { t: "path", d: "M6 12c0-2.2 1.8-4 4-4 1.6 0 2.7 1 3.4 2.2C14.1 8.9 15.2 8 16.8 8c2.2 0 4 1.8 4 4s-1.8 4-4 4c-1.6 0-2.7-1-3.4-2.2C12.7 15.1 11.6 16 10 16c-2.2 0-4-1.8-4-4z", fill: "none", stroke: "#4338ca", sw: 1.8 },
  ]},
  { id: 32, name: "Labyrinth/maze", shapes: [
    { t: "path", d: "M4 4h16v16H4V4zm3 3v10h10V9H9v6h3", fill: "none", stroke: "#57534e", sw: 1.4 },
  ]},
  { id: 33, name: "Om symbol", shapes: [
    { t: "path", d: "M5 14a4 4 0 1 1 6-5c1 1 1 3-1 4-1.5 1-1.5 3 1 3 2 0 3-1.5 3-3", fill: "none", stroke: "#ea580c", sw: 1.6 },
    { t: "path", d: "M16 8c1.5 0 3 1 3 3", fill: "none", stroke: "#ea580c", sw: 1.6 },
    { t: "circle", cx: 15.5, cy: 5.5, r: 1, fill: "#ea580c" },
    { t: "path", d: "M13.5 4.2c1 .6 1.8 1.6 1.8 1.6", fill: "none", stroke: "#ea580c", sw: 1.2 },
  ]},
  { id: 34, name: "Lotus flower", shapes: [
    ...[-60,-30,0,30,60].map((a,i)=>({ t:"path", d:"M12 20C12 14 10 9 12 5c2 4 0 9 0 15z", fill:"#f472b6", transform:`rotate(${a} 12 20)`, key:i })),
  ]},
  { id: 35, name: "Crescent moon and star", shapes: [
    { t: "path", d: "M18.5 12.5A7.5 7.5 0 1 1 10.2 3.3a6 6 0 0 0 8.3 9.2z", fill: "#fde68a" },
    { t: "polygon", points: "18.5,15 19.5,16.8 21.5,17.1 20.1,18.5 20.4,20.5 18.5,19.5 16.6,20.5 16.9,18.5 15.5,17.1 17.5,16.8", fill: "#fde68a" },
  ]},
  { id: 36, name: "Cross", shapes: [
    { t: "rect", x: 10, y: 3, w: 4, h: 18, rx: 1, fill: "#78716c" },
    { t: "rect", x: 4, y: 8, w: 16, h: 4, rx: 1, fill: "#78716c" },
  ]},
  { id: 37, name: "Star of David", shapes: [
    { t: "polygon", points: "12,3 20,17 4,17", fill: "none", stroke: "#2563eb", sw: 1.6 },
    { t: "polygon", points: "12,21 4,7 20,7", fill: "none", stroke: "#2563eb", sw: 1.6 },
  ]},
  { id: 38, name: "Dharma wheel", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 9, fill: "none", stroke: "#b45309", sw: 1.6 },
    { t: "circle", cx: 12, cy: 12, r: 2, fill: "#b45309" },
    ...[0,45,90,135,180,225,270,315].map((a,i)=>({ t:"line", x1:12, y1:12, x2:12, y2:3, stroke:"#b45309", sw:1.2, transform:`rotate(${a} 12 12)`, key:i })),
  ]},
  { id: 39, name: "Heart", shapes: [
    { t: "path", d: "M12 20s-7-4.4-9.5-8.7C1 8 2 4.2 5.5 4.2c2 0 3.5 1.3 4 2.5.5-1.2 2-2.5 4-2.5C17 4.2 18 8 16.5 11.3 14 15.6 12 20 12 20z", fill: "#e11d48" },
  ]},
  { id: 40, name: "Interlocking rings", shapes: [
    { t: "circle", cx: 8, cy: 10, r: 4.2, fill: "none", stroke: "#2563eb", sw: 1.8 },
    { t: "circle", cx: 12, cy: 14, r: 4.2, fill: "none", stroke: "#eab308", sw: 1.8 },
    { t: "circle", cx: 16, cy: 10, r: 4.2, fill: "none", stroke: "#111827", sw: 1.8 },
  ]},
  { id: 41, name: "Zodiac wheel", shapes: [
    { t: "circle", cx: 12, cy: 12, r: 9, fill: "none", stroke: "#7c3aed", sw: 1.4 },
    { t: "circle", cx: 12, cy: 12, r: 1.2, fill: "#7c3aed" },
    ...[0,30,60,90,120,150,180,210,240,270,300,330].map((a,i)=>({ t:"line", x1:12, y1:3, x2:12, y2:5.2, stroke:"#7c3aed", sw:1, transform:`rotate(${a} 12 12)`, key:i })),
  ]},
  { id: 42, name: "Crystal ball", shapes: [
    { t: "circle", cx: 12, cy: 11, r: 8, fill: "#c4b5fd" },
    { t: "ellipse", cx: 9.5, cy: 8, rx: 2.2, ry: 1.3, fill: "#ede9fe" },
    { t: "rect", x: 7, y: 19, w: 10, h: 2, rx: 1, fill: "#57534e" },
  ]},
  { id: 43, name: "Briefcase", shapes: [
    { t: "path", d: "M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6", fill: "none", stroke: "#78350f", sw: 1.6 },
    { t: "rect", x: 3, y: 6, w: 18, h: 12, rx: 1.5, fill: "#92400e" },
    { t: "rect", x: 10.5, y: 11, w: 3, h: 2.5, fill: "#78350f" },
  ]},
  { id: 44, name: "Artist's palette", shapes: [
    { t: "path", d: "M12 3a9 8 0 1 0 0 16c1.5 0 1-1.5 2.5-1.5S19 20 21 18c1-3-1-4-1-7a8 8 0 0 0-8-8z", fill: "#d6b98c" },
    { t: "ellipse", cx: 10, cy: 12, rx: 1.6, ry: 1.6, fill: "#ffffff" },
    { t: "circle", cx: 7, cy: 8, r: 1.3, fill: "#dc2626" },
    { t: "circle", cx: 11, cy: 6, r: 1.3, fill: "#2563eb" },
    { t: "circle", cx: 15.5, cy: 7, r: 1.3, fill: "#16a34a" },
    { t: "circle", cx: 17, cy: 11, r: 1.3, fill: "#eab308" },
  ]},
];
