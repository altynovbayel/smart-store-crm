import type {
  DashboardMetric,
  RevenueDataPoint,
  PopularProductItem,
  Sale,
  LowStockItem,
} from '../types';
import { initialSales } from './mockSales';

export const mockDashboardMetrics: DashboardMetric[] = [
  {
    id: 'revenue',
    title: 'Выручка сегодня',
    value: '24 850 сом',
    trendText: '+12% к вчерашнему дню',
    trendType: 'positive',
    icon: 'revenue',
  },
  {
    id: 'sales',
    title: 'Продажи сегодня',
    value: '18',
    trendText: '+6% к вчерашнему дню',
    trendType: 'positive',
    icon: 'sales',
  },
  {
    id: 'warehouse',
    title: 'Товаров на складе',
    value: '1 248',
    trendText: '+3% к прошлой неделе',
    trendType: 'positive',
    icon: 'warehouse',
  },
  {
    id: 'low-stock',
    title: 'Заканчиваются',
    value: '12',
    trendText: '+4 к прошлой неделе',
    trendType: 'negative',
    icon: 'alert',
  },
];

export const mockWeeklyRevenue: RevenueDataPoint[] = [
  {
    date: '2026-09-17',
    label: '17 сен',
    revenue: 8000,
    formattedRevenue: '8 000 сом',
    fullDate: '17 сентября 2026',
  },
  {
    date: '2026-09-18',
    label: '18 сен',
    revenue: 13500,
    formattedRevenue: '13 500 сом',
    fullDate: '18 сентября 2026',
  },
  {
    date: '2026-09-19',
    label: '19 сен',
    revenue: 15400,
    formattedRevenue: '15 400 сом',
    fullDate: '19 сентября 2026',
  },
  {
    date: '2026-09-20',
    label: '20 сен',
    revenue: 18200,
    formattedRevenue: '18 200 сом',
    fullDate: '20 сентября 2026',
  },
  {
    date: '2026-09-21',
    label: '21 сен',
    revenue: 22600,
    formattedRevenue: '22 600 сом',
    fullDate: '21 сентября 2026',
  },
  {
    date: '2026-09-22',
    label: '22 сен',
    revenue: 27800,
    formattedRevenue: '27 800 сом',
    fullDate: '22 сентября 2026',
  },
  {
    date: '2026-09-23',
    label: '23 сен',
    revenue: 24850,
    formattedRevenue: '24 850 сом',
    fullDate: '23 сентября 2026',
  },
];

export const mock14DaysRevenue: RevenueDataPoint[] = [
  { date: '2026-09-10', label: '10 сен', revenue: 9500, formattedRevenue: '9 500 сом', fullDate: '10 сентября 2026' },
  { date: '2026-09-11', label: '11 сен', revenue: 11000, formattedRevenue: '11 000 сом', fullDate: '11 сентября 2026' },
  { date: '2026-09-12', label: '12 сен', revenue: 14200, formattedRevenue: '14 200 сом', fullDate: '12 сентября 2026' },
  { date: '2026-09-13', label: '13 сен', revenue: 16800, formattedRevenue: '16 800 сом', fullDate: '13 сентября 2026' },
  { date: '2026-09-14', label: '14 сен', revenue: 12500, formattedRevenue: '12 500 сом', fullDate: '14 сентября 2026' },
  { date: '2026-09-15', label: '15 сен', revenue: 19400, formattedRevenue: '19 400 сом', fullDate: '15 сентября 2026' },
  { date: '2026-09-16', label: '16 сен', revenue: 17200, formattedRevenue: '17 200 сом', fullDate: '16 сентября 2026' },
  ...mockWeeklyRevenue,
];

export const mock30DaysRevenue: RevenueDataPoint[] = [
  { date: '2026-08-25', label: '25 авг', revenue: 12000, formattedRevenue: '12 000 сом', fullDate: '25 августа 2026' },
  { date: '2026-08-27', label: '27 авг', revenue: 14500, formattedRevenue: '14 500 сом', fullDate: '27 августа 2026' },
  { date: '2026-08-29', label: '29 авг', revenue: 16000, formattedRevenue: '16 000 сом', fullDate: '29 августа 2026' },
  { date: '2026-08-31', label: '31 авг', revenue: 18500, formattedRevenue: '18 500 сом', fullDate: '31 августа 2026' },
  { date: '2026-09-02', label: '2 сен', revenue: 15200, formattedRevenue: '15 200 сом', fullDate: '2 сентября 2026' },
  { date: '2026-09-04', label: '4 сен', revenue: 17800, formattedRevenue: '17 800 сом', fullDate: '4 сентября 2026' },
  { date: '2026-09-06', label: '6 сен', revenue: 21000, formattedRevenue: '21 000 сом', fullDate: '6 сентября 2026' },
  { date: '2026-09-08', label: '8 сен', revenue: 19500, formattedRevenue: '19 500 сом', fullDate: '8 сентября 2026' },
  ...mock14DaysRevenue,
];

export const mockPopularProducts: PopularProductItem[] = [
  {
    id: 'pop-1',
    rank: 1,
    name: 'Чехол iPhone 15',
    categoryLabel: 'Аксессуары',
    salesCount: 48,
    totalRevenue: 124800,
    iconType: 'phone',
  },
  {
    id: 'pop-2',
    rank: 2,
    name: 'Кабель Type-C',
    categoryLabel: 'Кабели',
    salesCount: 42,
    totalRevenue: 29400,
    iconType: 'cable',
  },
  {
    id: 'pop-3',
    rank: 3,
    name: 'Защитное стекло',
    categoryLabel: 'Аксессуары',
    salesCount: 36,
    totalRevenue: 25200,
    iconType: 'glass',
  },
  {
    id: 'pop-4',
    rank: 4,
    name: 'Power Bank 20 000 mAh',
    categoryLabel: 'Внешние аккумуляторы',
    salesCount: 28,
    totalRevenue: 84000,
    iconType: 'powerbank',
  },
  {
    id: 'pop-5',
    rank: 5,
    name: 'Наушники TWS',
    categoryLabel: 'Наушники',
    salesCount: 24,
    totalRevenue: 72000,
    iconType: 'earphones',
  },
];

export const mockRecentSales: Sale[] = initialSales;

export const mockLowStockItems: LowStockItem[] = [
  {
    id: 'low-1',
    name: 'Чехол iPhone 14',
    stock: 3,
    threshold: 10,
    severity: 'critical',
    statusLabel: 'Критично',
  },
  {
    id: 'low-2',
    name: 'Кабель Lightning',
    stock: 4,
    threshold: 10,
    severity: 'critical',
    statusLabel: 'Критично',
  },
  {
    id: 'low-3',
    name: 'Защитное стекло iPhone 15',
    stock: 5,
    threshold: 10,
    severity: 'critical',
    statusLabel: 'Критично',
  },
  {
    id: 'low-4',
    name: 'Адаптер питания 20W',
    stock: 6,
    threshold: 10,
    severity: 'warning',
    statusLabel: 'Мало',
  },
  {
    id: 'low-5',
    name: 'Карта памяти 128GB',
    stock: 7,
    threshold: 10,
    severity: 'warning',
    statusLabel: 'Мало',
  },
];
