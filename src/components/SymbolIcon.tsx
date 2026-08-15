import type { IconShape, IconSymbol } from "@/data/icons-data";

function renderShape(shape: IconShape, key: string | number) {
  const fill = shape.fill || "none";
  const strokeProps = shape.stroke
    ? { stroke: shape.stroke, strokeWidth: shape.sw || 1 }
    : {};
  const transformProp = shape.transform ? { transform: shape.transform } : {};

  switch (shape.t) {
    case "circle":
      return (
        <circle
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          cx={shape.cx}
          cy={shape.cy}
          r={shape.r}
        />
      );
    case "ellipse":
      return (
        <ellipse
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
        />
      );
    case "rect":
      return (
        <rect
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.rx || 0}
        />
      );
    case "path":
      return (
        <path
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          d={shape.d}
        />
      );
    case "polygon":
      return (
        <polygon
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          points={shape.points}
        />
      );
    case "polyline":
      return (
        <polyline
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          points={shape.points}
        />
      );
    case "line":
      return (
        <line
          key={key}
          fill={fill}
          {...strokeProps}
          {...transformProp}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
        />
      );
    default:
      return null;
  }
}

type SymbolIconProps = {
  symbol: IconSymbol;
  className?: string;
};

export function SymbolIcon({ symbol, className }: SymbolIconProps) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" className={className} aria-hidden>
      {symbol.shapes.map((shape, i) => renderShape(shape, shape.key ?? i))}
    </svg>
  );
}
