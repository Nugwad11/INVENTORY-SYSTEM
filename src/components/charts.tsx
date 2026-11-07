import { money } from '../lib/format';

export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const width = 120;
  if (!values.length) return <svg className="spark" viewBox={`0 0 ${width} ${height}`} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="fill" d={area} />
      <path d={line} />
    </svg>
  );
}

export function BarChart({
  data,
  format,
}: {
  data: { label: string; value: number; tone?: 'green' | 'muted' | 'red' }[];
  format?: (value: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="bars" role="img" aria-label="Bar chart">
      {data.map((item) => (
        <div className="bars__col" key={item.label} title={`${item.label}: ${format ? format(item.value) : item.value}`}>
          <div
            className={`bars__bar ${item.tone === 'muted' ? 'muted' : ''}`}
            style={{
              height: `${Math.max(3, (item.value / max) * 100)}%`,
              background: item.tone === 'red' ? 'linear-gradient(180deg,#c9524a,#a8332a)' : undefined,
            }}
          />
          <span className="bars__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: { value: number; color: string; label: string }[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let cursor = 0;
  const stops = segments
    .map((segment) => {
      const start = (cursor / total) * 100;
      cursor += segment.value;
      const end = (cursor / total) * 100;
      return `${segment.color} ${start}% ${end}%`;
    })
    .join(', ');
  return (
    <div className="flex gap-16">
      <div className="donut" style={{ background: `conic-gradient(${stops})` }} aria-hidden="true">
        <div className="donut__center">
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className="legend" style={{ flexDirection: 'column', gap: 7, justifyContent: 'center' }}>
        {segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: segment.color }} />
            {segment.label}
            <strong style={{ color: 'var(--ink)' }}>{segment.value > 1000 ? money(segment.value) : segment.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
