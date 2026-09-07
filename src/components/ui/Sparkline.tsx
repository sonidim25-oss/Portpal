interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ data, width = 64, height = 20 }: SparklineProps) {
  if (data.length < 2) {
    return <span className="secondary-sparkline-empty" style={{ width, height }} aria-hidden="true" />;
  }

  const max = Math.max(...data, 1);
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - (value / max) * (height - 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="secondary-sparkline" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
