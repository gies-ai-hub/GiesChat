import React, { useMemo, useState, useCallback } from 'react';

/**
 * Both hues were run through the data-viz palette validator against the light and
 * dark chart surfaces. Series 2 exists only to call out one bucket; it is never a
 * second data series, so no legend is needed anywhere in this section.
 */
const SERIES_1 = 'text-[#2a78d6] dark:text-[#3987e5]';
const SERIES_2 = 'text-[#eb6834] dark:text-[#d95926]';

const AREA_WIDTH = 600;
const AREA_HEIGHT = 160;
const AREA_PAD_TOP = 10;
const AREA_PAD_BOTTOM = 18;
const COLUMN_WIDTH = 600;
const COLUMN_HEIGHT = 150;
const COLUMN_PAD_TOP = 18;
const COLUMN_PAD_BOTTOM = 20;
const COLUMN_GAP = 9;

/** Flips against the nearer edge so the bubble never leaves the card. */
function anchorFor(left: number): string {
  if (left > 70) {
    return 'translate(-100%, -50%)';
  }
  if (left < 30) {
    return 'translate(0, -50%)';
  }
  return 'translate(-50%, -50%)';
}

/**
 * Positioned in percentages of the chart box rather than pixels, so it lands on the
 * right mark at any width without measuring the DOM.
 */
function Tooltip({
  left,
  top,
  children,
}: {
  left: number;
  top: number;
  children: React.ReactNode;
}) {
  const anchor = anchorFor(left);
  return (
    <div
      data-testid="chart-tooltip"
      role="status"
      className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-border-light bg-surface-primary px-2.5 py-1.5 text-xs text-text-primary shadow-lg"
      style={{ left: `${left}%`, top: `${top}%`, transform: anchor }}
    >
      {children}
    </div>
  );
}

export interface AreaPoint {
  value: number;
  /** Already localized by the panel — charts stay free of translation concerns. */
  tooltip: string;
}

/**
 * Charts are hidden from assistive tech: each panel renders the same numbers in a
 * "Show data" table, which is also the keyboard route to what the tooltips show.
 */
interface AreaChartProps {
  points: AreaPoint[];
}

/** Single series over time. Hovering anywhere snaps to the nearest day. */
export function AreaChart({ points }: AreaChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const { line, area, x, y } = useMemo(() => {
    const highest = Math.max(1, ...points.map((point) => point.value));
    const step = points.length <= 1 ? 0 : AREA_WIDTH / (points.length - 1);
    const xAt = (index: number) => (points.length <= 1 ? AREA_WIDTH / 2 : index * step);
    const yAt = (value: number) =>
      AREA_HEIGHT -
      AREA_PAD_BOTTOM -
      (value / highest) * (AREA_HEIGHT - AREA_PAD_TOP - AREA_PAD_BOTTOM);

    if (points.length === 0) {
      return { line: '', area: '', x: xAt, y: yAt };
    }

    let path = '';
    let filled = `M ${xAt(0)} ${AREA_HEIGHT - AREA_PAD_BOTTOM} `;
    points.forEach((point, index) => {
      path += `${index === 0 ? 'M' : 'L'} ${xAt(index)} ${yAt(point.value)} `;
      filled += `L ${xAt(index)} ${yAt(point.value)} `;
    });
    filled += `L ${xAt(points.length - 1)} ${AREA_HEIGHT - AREA_PAD_BOTTOM} Z`;

    return { line: path.trim(), area: filled, x: xAt, y: yAt };
  }, [points]);

  /** Works for mouse, pen, and touch-drag alike — one handler, no device branching. */
  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      if (points.length === 0) {
        return;
      }
      const box = event.currentTarget.getBoundingClientRect();
      const ratio = box.width === 0 ? 0 : (event.clientX - box.left) / box.width;
      const index = Math.round(ratio * (points.length - 1));
      setHovered(Math.max(0, Math.min(points.length - 1, index)));
    },
    [points.length],
  );

  const clear = useCallback(() => setHovered(null), []);
  const active = hovered === null ? null : points[hovered];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${AREA_WIDTH} ${AREA_HEIGHT}`}
        className={`w-full ${SERIES_1}`}
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <path d={area} fill="currentColor" fillOpacity="0.13" />
        <path
          data-line
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {active != null && hovered != null && (
          <g data-hover-marker>
            <line
              x1={x(hovered)}
              x2={x(hovered)}
              y1={AREA_PAD_TOP}
              y2={AREA_HEIGHT - AREA_PAD_BOTTOM}
              stroke="currentColor"
              strokeWidth="1"
              strokeOpacity="0.45"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={x(hovered)}
              cy={y(active.value)}
              r="5"
              fill="currentColor"
              className="stroke-surface-primary"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
        <rect
          data-hover-surface
          x="0"
          y="0"
          width={AREA_WIDTH}
          height={AREA_HEIGHT}
          fill="transparent"
          onPointerMove={handlePointer}
          onPointerLeave={clear}
        />
      </svg>
      {active != null && hovered != null && (
        <Tooltip
          left={points.length <= 1 ? 50 : (hovered / (points.length - 1)) * 100}
          top={Math.max(6, (y(active.value) / AREA_HEIGHT) * 100 - 14)}
        >
          {active.tooltip}
        </Tooltip>
      )}
    </div>
  );
}

export interface ColumnBucket {
  label: string;
  count: number;
  /** Already localized by the panel. Omitted buckets simply have no tooltip. */
  tooltip?: string;
}

interface ColumnChartProps {
  buckets: ColumnBucket[];
  /** Index drawn in the second hue — used to call out the one-turn bucket. */
  emphasizeIndex?: number;
}

export function ColumnChart({ buckets, emphasizeIndex }: ColumnChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const barWidth =
    buckets.length === 0 ? 0 : (COLUMN_WIDTH - COLUMN_GAP * (buckets.length - 1)) / buckets.length;
  const active = hovered === null ? null : buckets[hovered];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${COLUMN_WIDTH} ${COLUMN_HEIGHT}`} className="w-full" aria-hidden="true">
        {buckets.map((bucket, index) => {
          const barHeight =
            (bucket.count / max) * (COLUMN_HEIGHT - COLUMN_PAD_TOP - COLUMN_PAD_BOTTOM);
          const x = index * (barWidth + COLUMN_GAP);
          const y = COLUMN_HEIGHT - COLUMN_PAD_BOTTOM - barHeight;
          const isHovered = hovered === index;
          return (
            <g key={bucket.label} className={index === emphasizeIndex ? SERIES_2 : SERIES_1}>
              <rect
                data-bar
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="4"
                fill="currentColor"
                fillOpacity={hovered === null || isHovered ? 1 : 0.55}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-text-secondary text-[11px] font-semibold tabular-nums"
              >
                {bucket.count}
              </text>
              <text
                x={x + barWidth / 2}
                y={COLUMN_HEIGHT - 5}
                textAnchor="middle"
                className="fill-text-secondary text-[11px]"
              >
                {bucket.label}
              </text>
              {/* Full-height target: a short bar should not be hard to hover. */}
              <rect
                data-hover-bar
                x={x}
                y="0"
                width={barWidth}
                height={COLUMN_HEIGHT}
                fill="transparent"
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
              />
            </g>
          );
        })}
      </svg>
      {active?.tooltip != null && hovered != null && (
        <Tooltip
          left={((hovered * (barWidth + COLUMN_GAP) + barWidth / 2) / COLUMN_WIDTH) * 100}
          top={12}
        >
          {active.tooltip}
        </Tooltip>
      )}
    </div>
  );
}

interface MeterProps {
  value: number;
  total: number;
  label: string;
}

export function Meter({ value, total, label }: MeterProps) {
  const percent = total === 0 ? 0 : Math.min(100, Math.round((value / total) * 100));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={total}
      className="h-3.5 w-full overflow-hidden rounded-full border border-border-light bg-surface-secondary"
    >
      <div className={`h-full ${SERIES_1} bg-current`} style={{ width: `${percent}%` }} />
    </div>
  );
}
