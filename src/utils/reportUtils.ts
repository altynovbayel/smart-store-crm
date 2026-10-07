import type {
  Product,
  Sale,
  ProductCategory,
  StockStatus,
  ReportPeriod,
  ReportDateRange,
  ReportDateRangeErrors,
  SalesReportSummary,
  DailySalesRevenuePoint,
  PaymentReportItem,
  ProductSalesReportItem,
  WarehouseReportSummary,
  CategoryStockReportItem,
  StockStatusReportItem,
  AttentionProductItem,
  CSVCellValue,
} from '../types';
import { PAYMENT_METHODS } from '../types/sale';
import {
  parseCustomDate,
  isToday,
  isWithinDays,
  formatCalendarDateKey,
} from './dateUtils';
import { toCents, fromCents } from './incomeCalculations';
import { getSaleUnitsCount, getSaleTotalDiscount } from './salesHistoryUtils';
import { getStockStatusLabel } from './productUtils';
import { buildCSVContent, downloadCSVFile } from './csvUtils';

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  cases: 'Чехлы',
  cables: 'Кабели',
  glass: 'Защитные стёкла',
  powerbanks: 'Power Bank',
  headphones: 'Наушники',
  adapters: 'Адаптеры',
  memory: 'Карты памяти',
  holders: 'Автодержатели',
};

export const ALL_CATEGORIES: readonly ProductCategory[] = [
  'cases',
  'cables',
  'glass',
  'powerbanks',
  'headphones',
  'adapters',
  'memory',
  'holders',
];

/**
 * Validates report custom date range.
 */
export const validateReportDateRange = (
  from: string,
  to: string,
  maxDateKey?: string
): ReportDateRangeErrors => {
  const errors: ReportDateRangeErrors = {};
  const todayKey = maxDateKey || formatCalendarDateKey(new Date());

  if (from && from > todayKey) {
    errors.from = 'Дата не может быть в будущем';
  }

  if (to && to > todayKey) {
    errors.to = 'Дата не может быть в будущем';
  }

  if (from && to && from > to) {
    errors.from = 'Начальная дата не может быть позже конечной';
  }

  if (from && to && from <= to) {
    const dFrom = parseCustomDate(from);
    const dTo = parseCustomDate(to);
    if (dFrom && dTo) {
      const diffTime = Math.abs(dTo.getTime() - dFrom.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays > 366) {
        errors.to = 'Максимальный диапазон отчёта — 366 дней';
      }
    }
  }

  return errors;
};

/**
 * Filters sales by selected report period.
 */
export const filterSalesByReportPeriod = (
  sales: readonly Sale[],
  period: ReportPeriod,
  dateRange: ReportDateRange,
  referenceDateKey?: string
): Sale[] => {
  return sales.filter((sale) => {
    if (period === 'today') {
      return isToday(sale.soldAt, referenceDateKey);
    }

    if (period === 'week') {
      return isWithinDays(sale.soldAt, 7, referenceDateKey);
    }

    if (period === 'month') {
      return isWithinDays(sale.soldAt, 30, referenceDateKey);
    }

    if (period === 'custom') {
      const errors = validateReportDateRange(
        dateRange.from,
        dateRange.to,
        referenceDateKey
      );
      if (errors.from || errors.to) {
        return false;
      }

      const saleDate = parseCustomDate(sale.soldAt);
      if (!saleDate) return false;

      const saleDateKey = formatCalendarDateKey(saleDate);

      if (dateRange.from && saleDateKey < dateRange.from) {
        return false;
      }
      if (dateRange.to && saleDateKey > dateRange.to) {
        return false;
      }

      const todayKey = referenceDateKey || formatCalendarDateKey(new Date());
      if (saleDateKey > todayKey) {
        return false;
      }

      return true;
    }

    return true;
  });
};

/**
 * Computes sales report summary metrics with safe integer arithmetic and snapshot verification.
 */
export const calculateSalesReportSummary = (
  sales: readonly Sale[]
): SalesReportSummary => {
  let revenueCents = 0;
  let unitsSold = 0;
  let totalDiscountCents = 0;
  let grossProfitCents = 0;
  let hasIncompleteCostSnapshot = false;

  for (const sale of sales) {
    revenueCents += toCents(sale.totalAmount);
    unitsSold += getSaleUnitsCount(sale);
    totalDiscountCents += toCents(getSaleTotalDiscount(sale));
    grossProfitCents += toCents(sale.profitAmount);

    for (const item of sale.items) {
      if (
        typeof item.purchasePriceSnapshot !== 'number' ||
        isNaN(item.purchasePriceSnapshot) ||
        item.purchasePriceSnapshot < 0
      ) {
        hasIncompleteCostSnapshot = true;
      }
    }
  }

  const receiptsCount = sales.length;
  const averageCheck =
    receiptsCount > 0
      ? fromCents(Math.round(revenueCents / receiptsCount))
      : 0;

  const isGrossProfitAvailable = !hasIncompleteCostSnapshot;

  return {
    revenue: fromCents(revenueCents),
    receiptsCount,
    unitsSold,
    averageCheck,
    totalDiscount: fromCents(totalDiscountCents),
    grossProfit: isGrossProfitAvailable ? fromCents(grossProfitCents) : null,
    isGrossProfitAvailable,
  };
};

/**
 * Generates continuous daily timeline data points for sales revenue chart and CSV export.
 */
export const generateDailyRevenueDataPoints = (
  sales: readonly Sale[],
  period: ReportPeriod,
  dateRange: ReportDateRange,
  referenceDateKey?: string
): DailySalesRevenuePoint[] => {
  const today = referenceDateKey
    ? parseCustomDate(referenceDateKey) ?? new Date()
    : new Date();
  const todayKey = formatCalendarDateKey(today);

  let startDate: Date;
  let endDate: Date;

  if (period === 'today') {
    startDate = new Date(today);
    endDate = new Date(today);
  } else if (period === 'week') {
    startDate = new Date(today);
    startDate.setDate(today.getDate() - 6);
    endDate = new Date(today);
  } else if (period === 'month') {
    startDate = new Date(today);
    startDate.setDate(today.getDate() - 29);
    endDate = new Date(today);
  } else {
    // Custom period
    const parsedFrom = dateRange.from ? parseCustomDate(dateRange.from) : null;
    const parsedTo = dateRange.to ? parseCustomDate(dateRange.to) : null;

    if (parsedFrom && parsedTo && dateRange.from <= dateRange.to) {
      startDate = new Date(parsedFrom);
      endDate = new Date(parsedTo);
    } else if (parsedFrom) {
      startDate = new Date(parsedFrom);
      endDate = new Date(today);
    } else if (parsedTo) {
      startDate = new Date(parsedTo);
      startDate.setDate(parsedTo.getDate() - 6);
      endDate = new Date(parsedTo);
    } else {
      startDate = new Date(today);
      startDate.setDate(today.getDate() - 6);
      endDate = new Date(today);
    }

    if (endDate > today) {
      endDate = new Date(today);
    }
  }

  // Generate date keys list with safety cap to avoid hanging on extreme ranges
  const dateKeys: string[] = [];
  const current = new Date(startDate);
  const MAX_TIMELINE_DAYS = 366;

  while (current <= endDate && dateKeys.length < MAX_TIMELINE_DAYS) {
    const key = formatCalendarDateKey(current);
    if (key <= todayKey) {
      dateKeys.push(key);
    }
    current.setDate(current.getDate() + 1);
  }

  if (dateKeys.length === 0) {
    dateKeys.push(todayKey);
  }

  // Pre-group sales by calendar date key
  const salesByDate: Record<string, Sale[]> = {};
  for (const sale of sales) {
    const d = parseCustomDate(sale.soldAt);
    if (d) {
      const k = formatCalendarDateKey(d);
      if (!salesByDate[k]) {
        salesByDate[k] = [];
      }
      salesByDate[k].push(sale);
    }
  }

  // Build daily points
  return dateKeys.map((k) => {
    const daySales = salesByDate[k] || [];
    let revenueCents = 0;
    let unitsSold = 0;
    let discountCents = 0;
    let cashCents = 0;
    let cardCents = 0;
    let transferCents = 0;

    for (const sale of daySales) {
      const saleCents = toCents(sale.totalAmount);
      revenueCents += saleCents;
      unitsSold += getSaleUnitsCount(sale);
      discountCents += toCents(getSaleTotalDiscount(sale));

      if (sale.paymentMethod === 'cash') cashCents += saleCents;
      else if (sale.paymentMethod === 'card') cardCents += saleCents;
      else if (sale.paymentMethod === 'transfer') transferCents += saleCents;
    }

    const receiptsCount = daySales.length;
    const averageCheck =
      receiptsCount > 0
        ? fromCents(Math.round(revenueCents / receiptsCount))
        : 0;

    const [yyyy, mm, dd] = k.split('-');
    const label = `${dd}.${mm}`;
    const fullDate = `${dd}.${mm}.${yyyy}`;

    return {
      date: k,
      label,
      fullDate,
      revenue: fromCents(revenueCents),
      receiptsCount,
      unitsSold,
      averageCheck,
      totalDiscount: fromCents(discountCents),
      cashAmount: fromCents(cashCents),
      cardAmount: fromCents(cardCents),
      transferAmount: fromCents(transferCents),
    };
  });
};

/**
 * Computes payment methods distribution with amounts, receipt counts, and revenue shares.
 */
export const calculatePaymentBreakdown = (
  sales: readonly Sale[]
): PaymentReportItem[] => {
  let totalRevenueCents = 0;
  const methodsData: Record<
    'cash' | 'card' | 'transfer',
    { amountCents: number; receiptsCount: number }
  > = {
    cash: { amountCents: 0, receiptsCount: 0 },
    card: { amountCents: 0, receiptsCount: 0 },
    transfer: { amountCents: 0, receiptsCount: 0 },
  };

  for (const sale of sales) {
    const saleCents = toCents(sale.totalAmount);
    totalRevenueCents += saleCents;
    if (methodsData[sale.paymentMethod]) {
      methodsData[sale.paymentMethod].amountCents += saleCents;
      methodsData[sale.paymentMethod].receiptsCount += 1;
    }
  }

  const result: PaymentReportItem[] = (
    ['cash', 'card', 'transfer'] as const
  ).map((pm) => {
    const data = methodsData[pm];
    const percentage =
      totalRevenueCents > 0
        ? Math.round((data.amountCents / totalRevenueCents) * 1000) / 10
        : 0;

    return {
      method: pm,
      label: PAYMENT_METHODS[pm],
      amount: fromCents(data.amountCents),
      receiptsCount: data.receiptsCount,
      percentage,
    };
  });

  return result;
};

/**
 * Computes popular products rating with deterministic receipt discount distribution in integer cents.
 */
export const calculatePopularProductsReport = (
  sales: readonly Sale[],
  topN = 5
): ProductSalesReportItem[] => {
  let totalPeriodRevenueCents = 0;
  for (const sale of sales) {
    totalPeriodRevenueCents += toCents(sale.totalAmount);
  }

  const itemsMap: Record<
    string,
    {
      productId: string;
      productName: string;
      sku: string;
      unitsSold: number;
      revenueCents: number;
    }
  > = {};

  for (const sale of sales) {
    const saleTotalCents = toCents(sale.totalAmount);
    const itemsFinalCentsSum = sale.items.reduce(
      (acc, it) => acc + toCents(it.finalAmount),
      0
    );

    let remainingSaleRevenueCents = saleTotalCents;
    let remainingItemsFinalCents = itemsFinalCentsSum;

    sale.items.forEach((item, index) => {
      const itemFinalCents = toCents(item.finalAmount);
      let itemNetRevCents = 0;

      if (index === sale.items.length - 1) {
        itemNetRevCents = Math.max(0, remainingSaleRevenueCents);
      } else if (remainingItemsFinalCents > 0) {
        itemNetRevCents = Math.max(
          0,
          Math.round(
            (itemFinalCents / remainingItemsFinalCents) * remainingSaleRevenueCents
          )
        );
        remainingSaleRevenueCents -= itemNetRevCents;
        remainingItemsFinalCents -= itemFinalCents;
      }

      const key = item.productId || item.sku || item.productName;
      if (!itemsMap[key]) {
        itemsMap[key] = {
          productId: item.productId,
          productName: item.productName,
          sku: item.sku,
          unitsSold: 0,
          revenueCents: 0,
        };
      }
      itemsMap[key].unitsSold += item.quantity;
      itemsMap[key].revenueCents += itemNetRevCents;
    });
  }

  const allAggregated = Object.values(itemsMap).sort((a, b) => {
    if (b.unitsSold !== a.unitsSold) return b.unitsSold - a.unitsSold;
    if (b.revenueCents !== a.revenueCents) return b.revenueCents - a.revenueCents;
    return a.productName.localeCompare(b.productName);
  });

  return allAggregated.slice(0, topN).map((it, index) => {
    const share =
      totalPeriodRevenueCents > 0
        ? Math.round((it.revenueCents / totalPeriodRevenueCents) * 1000) / 10
        : 0;

    return {
      rank: index + 1,
      productId: it.productId,
      productName: it.productName,
      sku: it.sku,
      unitsSold: it.unitsSold,
      revenue: fromCents(it.revenueCents),
      revenueShare: share,
    };
  });
};

/**
 * Computes warehouse summary metrics for active products.
 */
export const calculateWarehouseReportSummary = (
  products: readonly Product[]
): WarehouseReportSummary => {
  const activeProducts = products.filter((p) => !p.isArchived);

  let totalUnits = 0;
  let totalPurchaseValueCents = 0;
  let totalPotentialRevenueCents = 0;
  let attentionItemsCount = 0;
  let isOverflow = false;

  for (const p of activeProducts) {
    totalUnits += p.stock;

    const purchaseCents = toCents(p.purchasePrice) * p.stock;
    const sellingCents = toCents(p.sellingPrice) * p.stock;

    if (
      !Number.isSafeInteger(purchaseCents) ||
      !Number.isSafeInteger(sellingCents)
    ) {
      isOverflow = true;
    }

    totalPurchaseValueCents += purchaseCents;
    totalPotentialRevenueCents += sellingCents;

    if (
      p.status === 'low_stock' ||
      p.status === 'out_of_stock' ||
      p.stock <= p.minStockThreshold
    ) {
      attentionItemsCount += 1;
    }
  }

  if (
    !Number.isSafeInteger(totalPurchaseValueCents) ||
    !Number.isSafeInteger(totalPotentialRevenueCents)
  ) {
    isOverflow = true;
  }

  const potentialProfitCents =
    totalPotentialRevenueCents - totalPurchaseValueCents;

  return {
    activePositionsCount: activeProducts.length,
    totalUnitsInStock: totalUnits,
    totalPurchaseValue: fromCents(totalPurchaseValueCents),
    totalPotentialRevenue: fromCents(totalPotentialRevenueCents),
    potentialProfit: fromCents(potentialProfitCents),
    attentionItemsCount,
    isOverflow,
  };
};

/**
 * Groups active products inventory by category.
 */
export const calculateCategoryStockReport = (
  products: readonly Product[]
): CategoryStockReportItem[] => {
  const activeProducts = products.filter((p) => !p.isArchived);

  const categoryMap: Record<
    ProductCategory,
    {
      positionsCount: number;
      totalUnits: number;
      purchaseValueCents: number;
      potentialRevenueCents: number;
    }
  > = {
    cases: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    cables: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    glass: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    powerbanks: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    headphones: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    adapters: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    memory: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
    holders: { positionsCount: 0, totalUnits: 0, purchaseValueCents: 0, potentialRevenueCents: 0 },
  };

  for (const p of activeProducts) {
    if (categoryMap[p.category]) {
      categoryMap[p.category].positionsCount += 1;
      categoryMap[p.category].totalUnits += p.stock;
      categoryMap[p.category].purchaseValueCents += toCents(p.purchasePrice) * p.stock;
      categoryMap[p.category].potentialRevenueCents += toCents(p.sellingPrice) * p.stock;
    }
  }

  return ALL_CATEGORIES.map((cat) => ({
    category: cat,
    categoryLabel: CATEGORY_LABELS[cat] || cat,
    positionsCount: categoryMap[cat].positionsCount,
    totalUnits: categoryMap[cat].totalUnits,
    purchaseValue: fromCents(categoryMap[cat].purchaseValueCents),
    potentialRevenue: fromCents(categoryMap[cat].potentialRevenueCents),
  }));
};

/**
 * Computes stock status distribution for active products.
 */
export const calculateStockStatusReport = (
  products: readonly Product[]
): StockStatusReportItem[] => {
  const activeProducts = products.filter((p) => !p.isArchived);
  const totalActive = activeProducts.length;

  const counts: Record<StockStatus, number> = {
    in_stock: 0,
    low_stock: 0,
    out_of_stock: 0,
  };

  for (const p of activeProducts) {
    if (counts[p.status] !== undefined) {
      counts[p.status] += 1;
    }
  }

  const statuses: StockStatus[] = ['in_stock', 'low_stock', 'out_of_stock'];

  return statuses.map((st) => {
    const c = counts[st];
    const percentage =
      totalActive > 0 ? Math.round((c / totalActive) * 1000) / 10 : 0;

    return {
      status: st,
      label: getStockStatusLabel(st),
      count: c,
      percentage,
    };
  });
};

/**
 * Filters and sorts active products that require attention (out of stock or low stock).
 */
export const getAttentionProducts = (
  products: readonly Product[]
): AttentionProductItem[] => {
  const activeProducts = products.filter((p) => !p.isArchived);

  const attention = activeProducts.filter(
    (p) =>
      p.status === 'out_of_stock' ||
      p.status === 'low_stock' ||
      p.stock <= p.minStockThreshold
  );

  return attention
    .map((p) => {
      const stockPurchaseValueCents = toCents(p.purchasePrice) * p.stock;
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        category: p.category,
        categoryLabel: p.categoryLabel,
        stock: p.stock,
        minStockThreshold: p.minStockThreshold,
        unit: p.unit,
        purchasePrice: p.purchasePrice,
        stockPurchaseValue: fromCents(stockPurchaseValueCents),
        status: p.status,
        severity: (p.stock === 0 ? 'critical' : 'warning') as 'critical' | 'warning',
      };
    })
    .sort((a, b) => {
      // 1. Zero stock first
      if (a.stock === 0 && b.stock > 0) return -1;
      if (b.stock === 0 && a.stock > 0) return 1;

      // 2. Relative stock ratio (stock / minStockThreshold) ascending
      const ratioA = a.minStockThreshold > 0 ? a.stock / a.minStockThreshold : 1;
      const ratioB = b.minStockThreshold > 0 ? b.stock / b.minStockThreshold : 1;
      if (ratioA !== ratioB) return ratioA - ratioB;

      // 3. Alphabetical name
      return a.name.localeCompare(b.name);
    });
};

/**
 * Exports daily aggregated sales report to CSV.
 */
export const exportSalesReportToCSV = (
  dailyPoints: readonly DailySalesRevenuePoint[],
  currentDateKey?: string
): void => {
  const headers = [
    'Дата',
    'Выручка (сом)',
    'Количество чеков',
    'Продано товаров (шт.)',
    'Средний чек (сом)',
    'Скидки (сом)',
    'Наличные (сом)',
    'Карта (сом)',
    'Перевод (сом)',
  ] as const;

  const rows: CSVCellValue[][] = dailyPoints.map((pt) => [
    pt.fullDate,
    pt.revenue,
    pt.receiptsCount,
    pt.unitsSold,
    pt.averageCheck,
    pt.totalDiscount,
    pt.cashAmount,
    pt.cardAmount,
    pt.transferAmount,
  ]);

  const dateSuffix = currentDateKey || formatCalendarDateKey(new Date());
  const fileName = `smart-store-sales-report-${dateSuffix}.csv`;

  downloadCSVFile(buildCSVContent(headers, rows), fileName);
};

/**
 * Exports active warehouse inventory report to CSV.
 */
export const exportWarehouseReportToCSV = (
  products: readonly Product[],
  currentDateKey?: string
): void => {
  const activeProducts = products.filter((p) => !p.isArchived);

  const headers = [
    'Артикул',
    'Штрихкод',
    'Наименование товара',
    'Категория',
    'Цена закупки (сом)',
    'Цена продажи (сом)',
    'Остаток (шт.)',
    'Мин. остаток (шт.)',
    'Закупочная стоимость остатка (сом)',
    'Потенциальная выручка (сом)',
    'Статус',
  ] as const;

  const rows: CSVCellValue[][] = activeProducts.map((p) => {
    const purchaseValueCents = toCents(p.purchasePrice) * p.stock;
    const potentialRevCents = toCents(p.sellingPrice) * p.stock;

    return [
      p.sku,
      p.barcode,
      p.name,
      p.categoryLabel,
      p.purchasePrice,
      p.sellingPrice,
      p.stock,
      p.minStockThreshold,
      fromCents(purchaseValueCents),
      fromCents(potentialRevCents),
      getStockStatusLabel(p.status),
    ];
  });

  const dateSuffix = currentDateKey || formatCalendarDateKey(new Date());
  const fileName = `smart-store-warehouse-report-${dateSuffix}.csv`;

  downloadCSVFile(buildCSVContent(headers, rows), fileName);
};
