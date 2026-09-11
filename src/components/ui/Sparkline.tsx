interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ data, width = 64, height = 20 }: SparklineProps) {
  if (data.length < 2) {
    return (
      <span className="secondary-sparkline-empty" style={{ width, height }} aria-hidden="true" />
    );
  }

  const max = Math.max(...data, 1);
  const strokeWidth = 1.5;
  // Inset the y-range by half the stroke so the extreme points sit fully
  // inside the viewport instead of having half their stroke clipped.
  const halfStroke = strokeWidth / 2;
  const top = halfStroke;
  const bottom = height - halfStroke;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = bottom - (value / max) * (bottom - top);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="secondary-sparkline" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
