/**
 * Minimal product shape the document forms (Income / Outcome) need for the shared
 * "search or scan" field. The barcode is always a string: leading zeros are preserved and it
 * is never converted to number.
 */
export interface SearchableProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  stock: number;
  unit: string;
  isArchived?: boolean;
}

/** Outcome of picking a product (scan / selection) into a document form. */
export type ProductPickResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** Pure line-item update of a document form: the next rows or a user-facing refusal. */
export type ProductLineAddResult<TItem> =
  | { ok: true; items: TItem[]; message: string }
  | { ok: false; error: string };
