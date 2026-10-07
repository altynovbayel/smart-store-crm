import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RevenueDataPoint } from '../../../types';
import styles from './RevenueChart.module.scss';

export interface RevenueChartProps {
  data: RevenueDataPoint[];
  data14?: RevenueDataPoint[];
  data30?: RevenueDataPoint[];
}

export const RevenueChart = ({ data, data14, data30 }: RevenueChartProps) => {
  const [filterOpen, setFilterOpen] = useState(false);
  const [currentFilter, setCurrentFilter] = useState('За 7 дней');
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLUListElement | null>(null);

  const activeData = useMemo(() => {
    if (currentFilter === 'За 14 дней') return data14 ?? data;
    if (currentFilter === 'За 30 дней') return data30 ?? data;
    return data;
  }, [currentFilter, data, data14, data30]);

  // Active point index (defaults to the last day of the current dataset)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const activeIndex =
    hoveredIndex !== null && hoveredIndex < activeData.length
      ? hoveredIndex
      : activeData.length - 1;

  const maxY = useMemo(() => {
    const maxVal = Math.max(...activeData.map((d) => d.revenue), 10000);
    return Math.ceil(maxVal / 10000) * 10000;
  }, [activeData]);

  const viewBoxWidth = 600;
  const viewBoxHeight = 220;
  const marginTop = 24;
  const marginBottom = 32;
  const marginLeft = 54;
  const marginRight = 36;

  const chartWidth = viewBoxWidth - marginLeft - marginRight;
  const chartHeight = viewBoxHeight - marginTop - marginBottom;

  const yTicks = useMemo(() => {
    const step = maxY / 4;
    return [maxY, maxY - step, maxY - step * 2, maxY - step * 3, 0];
  }, [maxY]);

  const points = useMemo(() => {
    const step = chartWidth / (activeData.length - 1);
    return activeData.map((d, index) => {
      const x = marginLeft + index * step;
      const y = marginTop + chartHeight * (1 - d.revenue / maxY);
      return { x, y, data: d, index };
    });
  }, [activeData, chartWidth, chartHeight, marginLeft, marginTop, maxY]);

  // Generate smooth SVG curve using cubic bezier control points
  const { linePath, areaPath } = useMemo(() => {
    if (points.length === 0) return { linePath: '', areaPath: '' };

    let line = `M ${points[0].x},${points[0].y}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? i : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      // Catmull-Rom to Cubic Bezier conversion
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;

      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      line += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
    }

    const baselineY = marginTop + chartHeight;
    const area = `${line} L ${points[points.length - 1].x},${baselineY} L ${points[0].x},${baselineY} Z`;

    return { linePath: line, areaPath: area };
  }, [points, chartHeight, marginTop]);

  const activePoint = points[activeIndex] ?? points[points.length - 1];

  // Calculate dynamic tooltip transform to stay safely within card bounds
  const xPercent = (activePoint.x / viewBoxWidth) * 100;
  const yPercent = (activePoint.y / viewBoxHeight) * 100;

  let tooltipTranslateX = '-50%';
  if (xPercent > 70) {
    tooltipTranslateX = '-90%';
  } else if (xPercent < 25) {
    tooltipTranslateX = '-10%';
  }

  const tooltipTranslateY = yPercent < 28 ? '15%' : '-120%';

  const filterOptions = ['За 7 дней', 'За 14 дней', 'За 30 дней'] as const;

  const handleFilterSelect = (filter: string) => {
    setCurrentFilter(filter);
    setHoveredIndex(null);
    setFilterOpen(false);
    filterBtnRef.current?.focus();
  };

  useEffect(() => {
    if (!filterOpen) return;
    const activeItem = dropdownRef.current?.querySelector<HTMLLIElement>('[aria-selected="true"]');
    const firstItem = dropdownRef.current?.querySelector<HTMLLIElement>('[role="option"]');
    (activeItem ?? firstItem)?.focus();
  }, [filterOpen]);

  const handleDropdownKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(dropdownRef.current?.querySelectorAll<HTMLLIElement>('[role="option"]') || []);
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLLIElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = currentIndex === -1 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setFilterOpen(false);
      filterBtnRef.current?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (currentIndex >= 0 && items[currentIndex]) {
        const val = items[currentIndex].dataset.value;
        if (val) handleFilterSelect(val);
      }
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>
          {currentFilter === 'За 7 дней'
            ? 'Выручка за неделю'
            : currentFilter === 'За 14 дней'
            ? 'Выручка за 14 дней'
            : 'Выручка за 30 дней'}
        </h2>

        <div className={styles.filterWrapper}>
          <button
            ref={filterBtnRef}
            type="button"
            className={styles.filterButton}
            onClick={() => setFilterOpen(!filterOpen)}
            aria-expanded={filterOpen}
            aria-haspopup="listbox"
            aria-label="Выбрать период выручки"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                if (!filterOpen) {
                  e.preventDefault();
                  setFilterOpen(true);
                }
              }
            }}
          >
            <span>{currentFilter}</span>
            <ChevronDown size={14} className={styles.filterChevron} />
          </button>

          {filterOpen && (
            <ul
              ref={dropdownRef}
              className={styles.filterDropdown}
              role="listbox"
              tabIndex={-1}
              aria-label="Период выручки"
              onKeyDown={handleDropdownKeyDown}
            >
              {filterOptions.map((opt) => (
                <li
                  key={opt}
                  role="option"
                  tabIndex={0}
                  data-value={opt}
                  aria-selected={opt === currentFilter}
                  className={`${styles.filterOption} ${
                    opt === currentFilter ? styles.filterOptionActive : ''
                  }`}
                  onClick={() => handleFilterSelect(opt)}
                >
                  {opt}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className={styles.chartWrapper}>
        {/* Floating Tooltip kept safely within bounds */}
        {activePoint && (
          <div
            className={styles.tooltipBadge}
            style={{
              left: `${xPercent}%`,
              top: `${yPercent}%`,
              transform: `translate(${tooltipTranslateX}, ${tooltipTranslateY})`,
            }}
          >
            <div className={styles.tooltipDate}>{activePoint.data.fullDate}</div>
            <div className={styles.tooltipAmount}>
              <span className={styles.tooltipDot} aria-hidden="true" />
              <span>{activePoint.data.formattedRevenue}</span>
            </div>
          </div>
        )}

        <svg
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          className={styles.svgChart}
          role="img"
          aria-label={`График выручки ${currentFilter.toLowerCase()}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Horizontal Grid lines and Y labels */}
          {yTicks.map((val) => {
            const y = marginTop + chartHeight * (1 - val / maxY);
            const isIntermediate = val === 10000 || val === 30000;
            return (
              <g key={val}>
                <text
                  x={marginLeft - 10}
                  y={y + 4}
                  className={`${styles.yAxisLabel} ${
                    isIntermediate ? styles.yAxisLabelIntermediate : ''
                  }`}
                  textAnchor="end"
                >
                  {val === 0 ? '0' : val.toLocaleString('ru-RU')}
                </text>
                <line
                  x1={marginLeft}
                  y1={y}
                  x2={viewBoxWidth - marginRight}
                  y2={y}
                  className={styles.gridLine}
                />
              </g>
            );
          })}

          {/* Area Fill */}
          <path d={areaPath} fill="url(#revenueGradient)" />

          {/* Line Stroke */}
          <path
            d={linePath}
            fill="none"
            stroke="#0ea5e9"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Interactive Data Points */}
          {points.map((pt) => {
            const isSelected = pt.index === activeIndex;
            return (
              <g key={pt.data.date} className={styles.pointGroup}>
                {/* Larger hit target for touch and mouse */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="14"
                  fill="transparent"
                  className={styles.hitArea}
                  onMouseEnter={() => setHoveredIndex(pt.index)}
                  onClick={() => setHoveredIndex(pt.index)}
                />
                {/* Visual circle dot */}
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isSelected ? 4.5 : 3.5}
                  fill="#ffffff"
                  stroke="#0ea5e9"
                  strokeWidth={isSelected ? 3 : 2}
                  className={styles.circleDot}
                />
              </g>
            );
          })}

          {/* X Axis Labels */}
          {points.map((pt, index) => {
            const step = points.length > 15 ? 4 : points.length > 8 ? 2 : 1;
            const isVisible = index % step === 0 || index === points.length - 1;
            if (!isVisible && pt.index !== activeIndex) return null;
            const isSecondary = index % 2 === 1;
            return (
              <text
                key={pt.data.date}
                x={pt.x}
                y={viewBoxHeight - 8}
                textAnchor="middle"
                className={`${styles.xAxisLabel} ${
                  pt.index === activeIndex ? styles.xAxisLabelActive : ''
                } ${isSecondary ? styles.xAxisLabelSecondary : ''}`}
              >
                {pt.data.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
