-- ============================================================================
-- Migration: RBAC step 4 — admin-only read RPC for historical purchase prices
-- Version: 20261020140000
-- Name: rbac_purchase_price_history_rpc
-- Description:
--   Additive step of the RBAC hardening plan. Adds one read-only RPC that resolves the
--   effective purchase price of a set of products at a document timestamp, so that a later
--   migration can revoke direct SELECT on public.product_price_history without breaking the
--   Outcome (write-off) form, its only client (src/api/shared/priceHistoryQuery.ts via
--   outcomeApi.fetchHistoricalPurchasePrices).
--
--   public.rpc_get_purchase_prices_at(p_product_ids uuid[], p_occurred_at timestamptz) → jsonb
--
--   Resolution is EXACTLY the one used by rpc_create_outcome_document (and rpc_create_sale)
--   for the cost snapshot, per product:
--   1. exact_history    — latest point with effective_from <= p_occurred_at
--                         ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1;
--   2. earliest_history — otherwise the earliest point
--                         ORDER BY effective_from ASC, created_at ASC, id ASC LIMIT 1;
--   3. catalog_fallback — otherwise the current products.purchase_price_minor.
--   The client therefore no longer needs the raw history: the response is one row per
--   requested product (bounded by the request), nothing needed for the form is lost.
--
--   Response (explicit fields, no SELECT * / row_to_json):
--   {
--     "occurred_at": timestamptz (echo of p_occurred_at, for stale-response checks),
--     "items": [ {                                   -- one per distinct id, ORDER BY product_id
--       "product_id": uuid,
--       "purchase_price_minor": bigint,
--       "source": 'exact_history' | 'earliest_history' | 'catalog_fallback',
--       "effective_from": timestamptz | null         -- null only for catalog_fallback
--     } ]
--   }
--   Never returned: selling prices, history source/created_at/id, other products.
--
--   Limits / validation (after the role check):
--   - p_occurred_at and p_product_ids must not be NULL; ids must be a one-dimensional array
--     without NULL elements (22023); duplicates are collapsed;
--   - at most 500 distinct products per call (22023) — the response size is bounded;
--   - every id must exist in public.products, archived included (P0002); an empty array
--     returns an empty items list.
--
--   Security:
--   - SECURITY DEFINER (must keep working after REVOKE SELECT), search_path = pg_catalog,
--     pg_temp, every object schema-qualified. The FIRST statement is private.is_admin()
--     (auth.uid(), role = admin, is_active): cashier / inactive / unknown → 42501 before any
--     argument validation or data access. anon has no EXECUTE.
--   - EXECUTE: authenticated only (revoked from PUBLIC and anon).
--
--   Tables, grants and RLS policies are NOT changed (direct SELECT on
--   public.product_price_history stays open until the frontend is migrated; this migration
--   alone does not protect purchase prices).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_purchase_prices_at(
  p_product_ids uuid[],
  p_occurred_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_found integer;
  v_items jsonb;
BEGIN
  -- 1. Role check first: only an active admin may read purchase prices
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges' USING ERRCODE = '42501';
  END IF;

  -- 2. Arguments
  IF p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'Validation error: Document timestamp is required' USING ERRCODE = '22023';
  END IF;

  IF p_product_ids IS NULL THEN
    RAISE EXCEPTION 'Validation error: Product id list is required' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.cardinality(p_product_ids) > 0 AND pg_catalog.array_ndims(p_product_ids) <> 1 THEN
    RAISE EXCEPTION 'Validation error: Product id list must be a one-dimensional array' USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_position(p_product_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Validation error: Product id list must not contain NULL' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT u.id ORDER BY u.id)
  INTO v_ids
  FROM pg_catalog.unnest(p_product_ids) AS u(id);

  IF v_ids IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('occurred_at', p_occurred_at, 'items', '[]'::jsonb);
  END IF;

  IF pg_catalog.cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'Validation error: At most 500 products per request' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO v_found
  FROM public.products p
  WHERE p.id = ANY (v_ids);

  IF v_found <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'Validation error: One or more products were not found in catalog' USING ERRCODE = 'P0002';
  END IF;

  -- 3. Resolution identical to rpc_create_outcome_document (exact → earliest → catalog)
  SELECT pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object(
             'product_id', p.id,
             'purchase_price_minor', COALESCE(ex.purchase_price_minor, ea.purchase_price_minor, p.purchase_price_minor),
             'source', CASE
                         WHEN ex.purchase_price_minor IS NOT NULL THEN 'exact_history'
                         WHEN ea.purchase_price_minor IS NOT NULL THEN 'earliest_history'
                         ELSE 'catalog_fallback'
                       END,
             'effective_from', COALESCE(ex.effective_from, ea.effective_from)
           )
           ORDER BY p.id
         )
  INTO v_items
  FROM public.products p
  LEFT JOIN LATERAL (
    SELECT pph.purchase_price_minor, pph.effective_from
    FROM public.product_price_history pph
    WHERE pph.product_id = p.id
      AND pph.effective_from <= p_occurred_at
    ORDER BY pph.effective_from DESC, pph.created_at DESC, pph.id DESC
    LIMIT 1
  ) ex ON true
  LEFT JOIN LATERAL (
    SELECT pph.purchase_price_minor, pph.effective_from
    FROM public.product_price_history pph
    WHERE pph.product_id = p.id
      AND ex.purchase_price_minor IS NULL
    ORDER BY pph.effective_from ASC, pph.created_at ASC, pph.id ASC
    LIMIT 1
  ) ea ON true
  WHERE p.id = ANY (v_ids);

  RETURN pg_catalog.jsonb_build_object(
    'occurred_at', p_occurred_at,
    'items', COALESCE(v_items, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_purchase_prices_at(uuid[], timestamptz) IS
  'Admin only (42501 otherwise, checked first). Effective purchase price per product at p_occurred_at, resolved exactly like rpc_create_outcome_document: latest history point with effective_from <= p_occurred_at (effective_from, created_at, id DESC), else earliest point (ASC), else products.purchase_price_minor. Returns {occurred_at, items:[{product_id, purchase_price_minor, source, effective_from}]}; at most 500 distinct ids.';

REVOKE ALL ON FUNCTION public.rpc_get_purchase_prices_at(uuid[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_purchase_prices_at(uuid[], timestamptz) TO authenticated;
