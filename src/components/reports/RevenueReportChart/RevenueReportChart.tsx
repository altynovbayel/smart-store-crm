import { useState, useId } from 'react';
import type { DailySalesRevenuePoint } from '../../../types';
import { formatCurrency, formatNumber } from '../../../utils/formatUtils';
import styles from './RevenueReportChart.module.scss';

export interface RevenueReportChartProps {
  data: DailySalesRevenuePoint[];
}

export const RevenueReportChart = ({ data }: RevenueReportChartProps) => {
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const gradientId = useId();

  // SVG canvas dimensions
  const svgWidth = 800;
  const svgHeight = 260;
  const padding = { top: 24, right: 32, bottom: 44, left: 64 };

  const plotWidth = svgWidth - padding.left - padding.right;
  const plotHeight = svgHeight - padding.top - padding.bottom;

  // Find max revenue for scaling Y axis
  const rawMax = data.length > 0 ? Math.max(...data.map((d) => d.revenue), 0) : 0;
  // Round up to nice number for grid
  const getNiceMax = (val: number) => {
    if (val <= 0) return 10000;
    const mag = Math.pow(10, Math.floor(Math.log10(val)));
    const mult = val / mag;
    let ceilMult = 1;
    if (mult <= 1) ceilMult = 1;
    else if (mult <= 2) ceilMult = 2;
    else if (mult <= 5) ceilMult = 5;
    else ceilMult = 10;
    return ceilMult * mag;
  };

  const maxY = getNiceMax(rawMax);
  const yTicks = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY];

  // Coordinates calculation
  const getX = (index: number) => {
    if (data.length <= 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (data.length - 1)) * plotWidth;
  };

  const getY = (value: number) => {
    const ratio = Math.min(Math.max(value / maxY, 0), 1);
    return padding.top + plotHeight - ratio * plotHeight;
  };

  // Build SVG Path
  const points = data.map((d, i) => ({
    x: getX(i),
    y: getY(d.revenue),
    data: d,
  }));

  const linePath = points.length > 0
    ? points.reduce((acc, curr, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`, '')
    : '';

  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padding.top + plotHeight).toFixed(1)} Z`
    : '';

  // X-axis label display stride
  const maxLabels = 8;
  const stride = data.length > maxLabels ? Math.ceil(data.length / maxLabels) : 1;

  const activePoint = activePointIndex !== null && data[activePointIndex] ? points[activePointIndex] : null;

  return (
    <div className={styles.chartContainer}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>Динамика выручки</h3>
          <p className={styles.chartSubtitle}>
            {data.length === 1
              ? `За ${data[0].fullDate}`
              : data.length > 1
              ? `С ${data[0].fullDate} по ${data[data.length - 1].fullDate}`
              : 'Нет данных за выбранный период'}
          </p>
        </div>

        {activePoint && (
          <div className={styles.activeStatsBadge}>
            <span className={styles.badgeDate}>{activePoint.data.fullDate}:</span>
            <span className={styles.badgeRevenue}>{formatCurrency(activePoint.data.revenue)}</span>
            <span className={styles.badgeReceipts}>
              ({formatNumber(activePoint.data.receiptsCount)} чеков, {formatNumber(activePoint.data.unitsSold)} шт.)
            </span>
          </div>
        )}
      </div>

      <div className={styles.svgWrapper}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className={styles.chartSvg}
          role="img"
          aria-label="График динамики выручки по дням"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Y-axis Gridlines & Labels */}
          {yTicks.map((tick, i) => {
            const y = getY(tick);
            return (
              <g key={`y-grid-${i}`} className={styles.gridLineGroup}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  className={styles.gridLine}
                />
                <text
                  x={padding.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className={styles.axisLabel}
                >
                  {formatNumber(tick)}
                </text>
              </g>
            );
          })}

          {/* Area Fill */}
          {areaPath && (
            <path
              d={areaPath}
              fill={`url(#${gradientId})`}
              className={styles.areaFill}
            />
          )}

          {/* Main Line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#0ea5e9"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.chartLine}
            />
          )}

          {/* X-axis ticks & labels */}
          {points.map((p, i) => {
            const showLabel = i === 0 || i === points.length - 1 || i % stride === 0;
            return (
              <g key={`x-tick-${i}`}>
                {showLabel && (
                  <text
                    x={p.x}
                    y={svgHeight - padding.bottom + 20}
                    textAnchor="middle"
                    className={styles.axisLabel}
                  >
                    {p.data.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Interactive Data Points & Hit Areas */}
          {points.map((p, i) => {
            const isActive = activePointIndex === i;
            return (
              <g
                key={`point-${i}`}
                className={styles.pointGroup}
                tabIndex={0}
                role="button"
                aria-label={`Выручка за ${p.data.fullDate}: ${formatCurrency(p.data.revenue)} (${p.data.receiptsCount} чеков)`}
                onMouseEnter={() => setActivePointIndex(i)}
                onMouseLeave={() => setActivePointIndex(null)}
                onFocus={() => setActivePointIndex(i)}
                onBlur={() => setActivePointIndex(null)}
              >
                {/* Large transparent circle for easy hover/tap */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={16}
                  fill="transparent"
                  className={styles.hitArea}
                />
                {/* Visible inner point */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isActive ? 6 : 4}
                  className={`${styles.dataCircle} ${isActive ? styles.dataCircleActive : ''}`}
                />
              </g>
            );
          })}

          {/* Active tooltip on SVG */}
          {activePoint && (
            <g
              transform={`translate(${activePoint.x}, ${activePoint.y - 12})`}
              className={styles.tooltipGroup}
              pointerEvents="none"
            >
              <rect
                x={activePoint.x > svgWidth - 140 ? -120 : activePoint.x < 140 ? 0 : -60}
                y={-36}
                width={120}
                height={32}
                rx={6}
                className={styles.tooltipBg}
              />
              <text
                x={activePoint.x > svgWidth - 140 ? -60 : activePoint.x < 140 ? 60 : 0}
                y={-16}
                textAnchor="middle"
                className={styles.tooltipText}
              >
                {formatCurrency(activePoint.data.revenue)}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
};
