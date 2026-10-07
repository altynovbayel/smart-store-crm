import { useState, useEffect, useMemo } from 'react';
import { StatCard } from '../../components/dashboard/StatCard/StatCard';
import { RevenueChart } from '../../components/dashboard/RevenueChart/RevenueChart';
import { PopularProducts } from '../../components/dashboard/PopularProducts/PopularProducts';
import { RecentSales } from '../../components/dashboard/RecentSales/RecentSales';
import { LowStock } from '../../components/dashboard/LowStock/LowStock';
import { useInventory } from '../../context';
import type {
  DashboardMetric,
  PopularProductItem,
  RevenueDataPoint,
  LowStockItem,
  Product,
  ProductIconType,
  Sale,
} from '../../types';
import { formatCurrency, formatNumber } from '../../utils/formatUtils';
import { isToday, parseCustomDate, formatCalendarDateKey } from '../../utils/dateUtils';
import { toCents, fromCents } from '../../utils/incomeCalculations';
import styles from './DashboardPage.module.scss';

const MONTH_NAMES_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

const MONTH_NAMES_FULL = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

const buildRevenueData = (
  sales: Sale[],
  days: number,
  referenceDateStr: string
): RevenueDataPoint[] => {
  const points: RevenueDataPoint[] = [];
  const refDate = parseCustomDate(referenceDateStr) ?? new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(
      refDate.getFullYear(),
      refDate.getMonth(),
      refDate.getDate() - i
    );
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    let dayRevenue = 0;
    for (const sale of sales) {
      if (isToday(sale.soldAt, dateStr)) {
        dayRevenue += sale.totalAmount;
      }
    }

    points.push({
      date: dateStr,
      label: `${day} ${MONTH_NAMES_SHORT[month]}`,
      revenue: dayRevenue,
      formattedRevenue: `${dayRevenue.toLocaleString('ru-RU')} сом`,
      fullDate: `${day} ${MONTH_NAMES_FULL[month]} ${year}`,
    });
  }

  return points;
};

const buildPopularProducts = (
  sales: Sale[],
  allProducts: Product[]
): PopularProductItem[] => {
  const statsByProductId = new Map<
    string,
    {
      count: number;
      revenueCents: number;
      fallbackName: string;
      fallbackSku: string;
    }
  >();

  for (const s of sales) {
    const itemsFinalTotalCents = s.items.reduce(
      (acc, it) => acc + toCents(it.finalAmount),
      0
    );
    const receiptDiscountCents = toCents(s.receiptDiscountAmount || 0);
    const clampedDiscountCents = Math.min(
      receiptDiscountCents,
      itemsFinalTotalCents
    );

    // Distribute receipt discount using Largest Remainder Method (Hare-Niemeyer)
    const discountByItemIdx = new Map<number, number>();
    if (clampedDiscountCents > 0 && itemsFinalTotalCents > 0) {
      const parts = s.items.map((it, idx) => {
        const itemFinalCents = toCents(it.finalAmount);
        const exact =
          (clampedDiscountCents * itemFinalCents) / itemsFinalTotalCents;
        const base = Math.floor(exact);
        const remainder = exact - base;
        return { idx, base, remainder };
      });

      const sumBase = parts.reduce((acc, p) => acc + p.base, 0);
      let centsLeft = clampedDiscountCents - sumBase;

      // Sort by remainder descending, tie-break by index ascending
      parts.sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);

      for (const part of parts) {
        let add = 0;
        if (centsLeft > 0) {
          add = 1;
          centsLeft--;
        }
        discountByItemIdx.set(part.idx, part.base + add);
      }
    }

    s.items.forEach((item, idx) => {
      const itemFinalCents = toCents(item.finalAmount);
      const allocatedDiscountCents = discountByItemIdx.get(idx) ?? 0;
      const effectiveRevenueCents = Math.max(
        0,
        itemFinalCents - allocatedDiscountCents
      );

      const existing = statsByProductId.get(item.productId) || {
        count: 0,
        revenueCents: 0,
        fallbackName: item.productName,
        fallbackSku: item.sku,
      };
      existing.count += item.quantity;
      existing.revenueCents += effectiveRevenueCents;
      statsByProductId.set(item.productId, existing);
    });
  }

  const ranked = Array.from(statsByProductId.entries())
    .map(([productId, stat]) => {
      const prod = allProducts.find((p) => p.id === productId);
      const iconType: ProductIconType = prod?.iconType ?? 'phone';
      return {
        id: productId,
        name: prod?.name || stat.fallbackName || 'Товар',
        categoryLabel: prod?.categoryLabel || 'Аксессуары',
        salesCount: stat.count,
        totalRevenue: fromCents(stat.revenueCents),
        iconType,
      };
    })
    .sort((a, b) => b.salesCount - a.salesCount || b.totalRevenue - a.totalRevenue);

  if (ranked.length > 0) {
    return ranked.slice(0, 4).map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }

  return allProducts.slice(0, 4).map((p, index) => ({
    id: p.id,
    rank: index + 1,
    name: p.name,
    categoryLabel: p.categoryLabel,
    salesCount: 0,
    totalRevenue: 0,
    iconType: p.iconType,
  }));
};

const buildLowStockItems = (products: Product[]): LowStockItem[] => {
  return products
    .filter((p) => p.status === 'low_stock' || p.status === 'out_of_stock')
    .map((p) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      threshold: p.minStockThreshold,
      statusLabel: p.status === 'out_of_stock' ? 'Нет в наличии' : 'Мало',
      severity: p.status === 'out_of_stock' ? 'critical' : 'warning',
    }));
};

export const DashboardPage = () => {
  const { sales, activeProducts, products } = useInventory();

  // Keep track of current calendar date (YYYY-MM-DD)
  const [currentDateKey, setCurrentDateKey] = useState(() => formatCalendarDateKey(new Date()));

  useEffect(() => {
    const updateDate = () => {
      const newKey = formatCalendarDateKey(new Date());
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    const handleFocus = () => updateDate();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    const interval = setInterval(updateDate, 30_000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      clearInterval(interval);
    };
  }, []);

  const lowStockItems = useMemo(
    () => buildLowStockItems(activeProducts),
    [activeProducts]
  );

  const metrics = useMemo<DashboardMetric[]>(() => {
    const refDate = parseCustomDate(currentDateKey) ?? new Date();
    const yesterdayDate = new Date(
      refDate.getFullYear(),
      refDate.getMonth(),
      refDate.getDate() - 1
    );
    const yesterdayKey = formatCalendarDateKey(yesterdayDate);

    let todayRevenue = 0;
    let todaySalesCount = 0;
    let yesterdayRevenue = 0;
    let yesterdaySalesCount = 0;

    for (const s of sales) {
      if (isToday(s.soldAt, currentDateKey)) {
        todayRevenue += s.totalAmount;
        todaySalesCount += 1;
      } else if (isToday(s.soldAt, yesterdayKey)) {
        yesterdayRevenue += s.totalAmount;
        yesterdaySalesCount += 1;
      }
    }

    const totalActiveStock = activeProducts.reduce(
      (sum, p) => sum + p.stock,
      0
    );

    let revenueTrendText = 'Нет данных за вчера';
    let revenueTrendType: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (yesterdayRevenue > 0) {
      const pct = Math.round(
        ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
      );
      if (pct > 0) {
        revenueTrendText = `+${pct}% к вчерашнему дню`;
        revenueTrendType = 'positive';
      } else if (pct < 0) {
        revenueTrendText = `${pct}% к вчерашнему дню`;
        revenueTrendType = 'negative';
      } else {
        revenueTrendText = '0% к вчерашнему дню';
        revenueTrendType = 'neutral';
      }
    } else if (todayRevenue > 0) {
      revenueTrendText = 'Рост с 0 сом вчера';
      revenueTrendType = 'positive';
    }

    let salesTrendText = 'Нет данных за вчера';
    let salesTrendType: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (yesterdaySalesCount > 0) {
      const pct = Math.round(
        ((todaySalesCount - yesterdaySalesCount) / yesterdaySalesCount) * 100
      );
      if (pct > 0) {
        salesTrendText = `+${pct}% к вчерашнему дню`;
        salesTrendType = 'positive';
      } else if (pct < 0) {
        salesTrendText = `${pct}% к вчерашнему дню`;
        salesTrendType = 'negative';
      } else {
        salesTrendText = '0% к вчерашнему дню';
        salesTrendType = 'neutral';
      }
    } else if (todaySalesCount > 0) {
      salesTrendText = 'Первые чеки за день';
      salesTrendType = 'positive';
    }

    return [
      {
        id: 'revenue',
        title: 'Выручка сегодня',
        value: formatCurrency(todayRevenue),
        trendText: revenueTrendText,
        trendType: revenueTrendType,
        icon: 'revenue',
      },
      {
        id: 'sales',
        title: 'Продажи сегодня',
        value: formatNumber(todaySalesCount),
        trendText: salesTrendText,
        trendType: salesTrendType,
        icon: 'sales',
      },
      {
        id: 'warehouse',
        title: 'Товаров на складе',
        value: `${formatNumber(totalActiveStock)} шт.`,
        trendText: `${activeProducts.length} наименований`,
        trendType: 'positive',
        icon: 'warehouse',
      },
      {
        id: 'alert',
        title: 'Заканчиваются',
        value: String(lowStockItems.length),
        trendText:
          lowStockItems.length > 0
            ? 'Требуется закупка'
            : 'Все остатки в норме',
        trendType: lowStockItems.length > 0 ? 'negative' : 'positive',
        icon: 'alert',
      },
    ];
  }, [sales, activeProducts, lowStockItems.length, currentDateKey]);

  const revenue7Days = useMemo(
    () => buildRevenueData(sales, 7, currentDateKey),
    [sales, currentDateKey]
  );
  const revenue14Days = useMemo(
    () => buildRevenueData(sales, 14, currentDateKey),
    [sales, currentDateKey]
  );
  const revenue30Days = useMemo(
    () => buildRevenueData(sales, 30, currentDateKey),
    [sales, currentDateKey]
  );

  const popularProducts = useMemo(
    () => buildPopularProducts(sales, products),
    [sales, products]
  );
  const recentSales = useMemo(() => {
    return [...sales]
      .sort((a, b) => {
        const da = parseCustomDate(a.soldAt)?.getTime() ?? 0;
        const db = parseCustomDate(b.soldAt)?.getTime() ?? 0;
        if (da !== db) return db - da;
        const ca = parseCustomDate(a.createdAt)?.getTime() ?? 0;
        const cb = parseCustomDate(b.createdAt)?.getTime() ?? 0;
        if (ca !== cb) return cb - ca;
        return b.id.localeCompare(a.id);
      })
      .slice(0, 5);
  }, [sales]);

  return (
    <div className={styles.dashboard}>
      {/* 4 Metric Cards */}
      <section className={styles.metricsGrid} aria-label="Ключевые показатели">
        {metrics.map((metric) => (
          <StatCard key={metric.id} metric={metric} />
        ))}
      </section>

      {/* Middle Grid: Revenue Chart + Popular Products */}
      <section
        className={styles.twoColumnGrid}
        aria-label="Выручка и популярные товары"
      >
        <div className={styles.chartCol}>
          <RevenueChart
            data={revenue7Days}
            data14={revenue14Days}
            data30={revenue30Days}
          />
        </div>
        <div className={styles.sideCol}>
          <PopularProducts products={popularProducts} />
        </div>
      </section>

      {/* Bottom Grid: Recent Sales + Low Stock Items */}
      <section
        className={styles.twoColumnGrid}
        aria-label="Последние продажи и остатки"
      >
        <div className={styles.salesCol}>
          <RecentSales sales={recentSales} />
        </div>
        <div className={styles.sideCol}>
          <LowStock items={lowStockItems} />
        </div>
      </section>
    </div>
  );
};
