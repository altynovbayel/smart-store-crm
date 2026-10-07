import type { OutcomeDocument } from '../types';
import { getRelativeDateISO, getGuaranteedPastDateISO } from '../utils/dateUtils';

export const initialOutcomeDocuments: OutcomeDocument[] = [
  {
    id: 'out-1',
    outcomeNumber: 'СП-2026-004',
    reason: 'defective',
    documentDate: getRelativeDateISO(9, 18, 0),
    createdAt: getRelativeDateISO(9, 18, 0),
    responsiblePerson: 'Администратор',
    comment: 'Заводской брак (не заряжается левый наушник)',
    items: [
      {
        id: 'out-item-1',
        productId: 'prod-5',
        productName: 'Наушники TWS Pro',
        sku: 'SS-TWS-PRO',
        quantity: 1,
        purchasePrice: 1500,
        totalCost: 1500,
      },
    ],
    totalQuantity: 1,
    totalCost: 1500,
    status: 'completed',
  },
  {
    id: 'out-2',
    outcomeNumber: 'СП-2026-005',
    reason: 'damaged',
    documentDate: getGuaranteedPastDateISO(20),
    createdAt: getGuaranteedPastDateISO(20),
    responsiblePerson: 'Администратор',
    comment: 'Повреждение упаковки и корпуса при падении с полки',
    items: [
      {
        id: 'out-item-2',
        productId: 'prod-8',
        productName: 'Автодержатель MagSafe Pro',
        sku: 'SS-HL-MAG',
        quantity: 1,
        purchasePrice: 650,
        totalCost: 650,
      },
    ],
    totalQuantity: 1,
    totalCost: 650,
    status: 'completed',
  },
];
