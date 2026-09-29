export interface RevenueDataPoint {
  date: string;
  label: string;
  revenue: number;
  formattedRevenue: string;
  fullDate: string;
}

export interface DashboardMetric {
  id: string;
  title: string;
  value: string;
  trendText: string;
  trendType: 'positive' | 'negative' | 'neutral';
  icon: 'revenue' | 'sales' | 'warehouse' | 'alert';
}

export interface DashboardData {
  metrics: DashboardMetric[];
  weeklyRevenue: RevenueDataPoint[];
}
