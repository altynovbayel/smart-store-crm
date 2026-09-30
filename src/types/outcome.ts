export type OutcomeReason =
  | 'damaged'
  | 'defective'
  | 'lost'
  | 'internal_use'
  | 'other';

export const OUTCOME_REASONS: Record<OutcomeReason, string> = {
  damaged: 'Повреждение',
  defective: 'Брак',
  lost: 'Потеря',
  internal_use: 'Для нужд магазина',
  other: 'Другое',
};

export interface OutcomeItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  purchasePrice: number;
  totalCost: number;
}

export type OutcomeStatus = 'completed';

export interface OutcomeDocument {
  id: string;
  outcomeNumber: string;
  reason: OutcomeReason;
  documentDate: string;
  createdAt: string;
  responsiblePerson: string;
  comment?: string;
  items: OutcomeItem[];
  totalQuantity: number;
  totalCost: number;
  status: OutcomeStatus;
}

export type OutcomePeriodFilter = 'all' | 'today' | 'week' | 'month';

export interface OutcomeFilters {
  searchQuery: string;
  period: OutcomePeriodFilter;
  reason: OutcomeReason | 'all';
}

export interface OutcomeItemInput {
  productId: string;
  quantity: number;
}

export interface OutcomeFormData {
  reason: OutcomeReason;
  documentDate: string;
  responsiblePerson: string;
  comment?: string;
  items: OutcomeItemInput[];
}

export interface OutcomeFormItemState {
  id: string;
  productId: string;
  rawQuantity: string;
}

export interface OutcomeSummary {
  todayCount: number;
  todayUnits: number;
  todayCost: number;
  monthCount: number;
}
