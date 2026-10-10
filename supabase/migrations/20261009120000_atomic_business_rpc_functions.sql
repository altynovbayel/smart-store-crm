-- ============================================================================
-- Migration: Atomic Business RPC Functions for Smart Store CRM
-- Version: 20261009120000
-- Description:
--   - Product price history table for exact historical cost resolution
--   - Security verification helpers in schema `private`
--   - Sequences for unique concurrent document numbers (sales, income, outcome)
--   - RPC functions:
--     1. rpc_create_product (admin only)
--     2. rpc_update_product (admin only)
--     3. rpc_adjust_product_stock (admin only, chronological balance integrity)
--     4. rpc_archive_product (admin only, unarchiving & archiving)
--     5. rpc_create_income_receipt (admin only, concurrent-safe idempotency, purchase price chronology & price ratio guard)
--     6. rpc_create_sale (active staff: admin / cashier, concurrent-safe idempotency, exact historical purchase price snapshot & chronology)
--     7. rpc_create_outcome_document (admin only, concurrent-safe idempotency, exact historical purchase price snapshot & chronology)
--   - Deterministic row locking (SELECT ... FOR UPDATE ORDER BY id ASC)
--   - Exact monetary arithmetic in integer minor units (BigInt tyiyn) with numeric intermediate operations
--   - Full chronology protection against negative historical stock balances and future-dated documents
--   - Strict exact privilege revocation from anon/public, execution granted only to authenticated for public RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PRODUCT PRICE HISTORY TABLE & AUDIT LOG
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  purchase_price_minor bigint NOT NULL,
  selling_price_minor bigint NOT NULL,
  effective_from timestamptz NOT NULL,
  source text NOT NULL, -- 'initial', 'update', 'income'
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS product_price_history_lookup_idx
ON public.product_price_history (product_id, effective_from DESC, created_at DESC);

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_price_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_price_history TO authenticated;

DROP POLICY IF EXISTS product_price_history_select_active_staff ON public.product_price_history;
CREATE POLICY product_price_history_select_active_staff ON public.product_price_history
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

-- Seed baseline initial price history for all existing catalog products
-- Seed price history from all existing completed income receipts
INSERT INTO public.product_price_history (
  product_id,
  purchase_price_minor,
  selling_price_minor,
  effective_from,
  source,
  created_at
)
SELECT DISTINCT ON (ii.product_id, ir.received_at, ii.purchase_price_minor)
  ii.product_id,
  ii.purchase_price_minor,
  p.selling_price_minor,
  ir.received_at,
  'income_receipt',
  COALESCE(ir.created_at, ir.received_at)
FROM public.income_items ii
JOIN public.income_receipts ir ON ir.id = ii.income_receipt_id
JOIN public.products p ON p.id = ii.product_id
WHERE ir.status = 'completed'::public.document_status
  AND NOT EXISTS (
    SELECT 1 FROM public.product_price_history ph
    WHERE ph.product_id = ii.product_id
      AND ph.effective_from = ir.received_at
      AND ph.purchase_price_minor = ii.purchase_price_minor
  )
ORDER BY ii.product_id, ir.received_at, ii.purchase_price_minor;

-- Seed price history points from historical sale item snapshots
INSERT INTO public.product_price_history (
  product_id,
  purchase_price_minor,
  selling_price_minor,
  effective_from,
  source,
  created_at
)
SELECT DISTINCT ON (si.product_id, s.sold_at, si.purchase_price_snapshot_minor)
  si.product_id,
  si.purchase_price_snapshot_minor,
  p.selling_price_minor,
  s.sold_at,
  'sale_snapshot',
  COALESCE(s.created_at, s.sold_at)
FROM public.sale_items si
JOIN public.sales s ON s.id = si.sale_id
JOIN public.products p ON p.id = si.product_id
WHERE s.status = 'completed'::public.document_status
  AND NOT EXISTS (
    SELECT 1 FROM public.product_price_history ph
    WHERE ph.product_id = si.product_id
      AND ph.effective_from = s.sold_at
      AND ph.purchase_price_minor = si.purchase_price_snapshot_minor
  )
ORDER BY si.product_id, s.sold_at, si.purchase_price_snapshot_minor;

-- Seed price history points from historical outcome item snapshots
INSERT INTO public.product_price_history (
  product_id,
  purchase_price_minor,
  selling_price_minor,
  effective_from,
  source,
  created_at
)
SELECT DISTINCT ON (oi.product_id, od.occurred_at, oi.purchase_price_snapshot_minor)
  oi.product_id,
  oi.purchase_price_snapshot_minor,
  p.selling_price_minor,
  od.occurred_at,
  'outcome_snapshot',
  COALESCE(od.created_at, od.occurred_at)
FROM public.outcome_items oi
JOIN public.outcome_documents od ON od.id = oi.outcome_document_id
JOIN public.products p ON p.id = oi.product_id
WHERE od.status = 'completed'::public.document_status
  AND NOT EXISTS (
    SELECT 1 FROM public.product_price_history ph
    WHERE ph.product_id = oi.product_id
      AND ph.effective_from = od.occurred_at
      AND ph.purchase_price_minor = oi.purchase_price_snapshot_minor
  )
ORDER BY oi.product_id, od.occurred_at, oi.purchase_price_snapshot_minor;

-- Seed baseline initial price history for catalog products that have no earlier baseline
INSERT INTO public.product_price_history (
  product_id,
  purchase_price_minor,
  selling_price_minor,
  effective_from,
  source,
  created_at
)
SELECT
  p.id,
  COALESCE(
    -- 1st priority: earliest price snapshot across all completed documents (sales, outcomes, receipts)
    (
      SELECT doc_prices.price_minor
      FROM (
        SELECT s.sold_at AS doc_time, s.created_at AS doc_created, si.purchase_price_snapshot_minor AS price_minor
        FROM public.sale_items si
        JOIN public.sales s ON s.id = si.sale_id
        WHERE si.product_id = p.id AND s.status = 'completed'::public.document_status
        UNION ALL
        SELECT od.occurred_at AS doc_time, od.created_at AS doc_created, oi.purchase_price_snapshot_minor AS price_minor
        FROM public.outcome_items oi
        JOIN public.outcome_documents od ON od.id = oi.outcome_document_id
        WHERE oi.product_id = p.id AND od.status = 'completed'::public.document_status
        UNION ALL
        SELECT ir.received_at AS doc_time, ir.created_at AS doc_created, ii.purchase_price_minor AS price_minor
        FROM public.income_items ii
        JOIN public.income_receipts ir ON ir.id = ii.income_receipt_id
        WHERE ii.product_id = p.id AND ir.status = 'completed'::public.document_status
      ) doc_prices
      ORDER BY doc_prices.doc_time ASC, doc_prices.doc_created ASC
      LIMIT 1
    ),
    -- 2nd priority: catalog purchase price
    p.purchase_price_minor
  ),
  p.selling_price_minor,
  COALESCE(p.created_at, timestamptz '1970-01-01 00:00:00+00'),
  'initial',
  COALESCE(p.created_at, timestamptz '1970-01-01 00:00:00+00')
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_price_history ph
  WHERE ph.product_id = p.id
    AND ph.effective_from <= COALESCE(p.created_at, timestamptz '1970-01-01 00:00:00+00')
);

-- Reconcile current catalog price if manually updated after income receipts or documents
INSERT INTO public.product_price_history (
  product_id,
  purchase_price_minor,
  selling_price_minor,
  effective_from,
  source,
  created_at
)
SELECT
  p.id,
  p.purchase_price_minor,
  p.selling_price_minor,
  COALESCE(p.updated_at, p.created_at, now()),
  'catalog_sync',
  COALESCE(p.updated_at, p.created_at, now())
FROM public.products p
WHERE EXISTS (
  SELECT 1 FROM (
    SELECT ph.purchase_price_minor
    FROM public.product_price_history ph
    WHERE ph.product_id = p.id
    ORDER BY ph.effective_from DESC, ph.created_at DESC
    LIMIT 1
  ) latest
  WHERE latest.purchase_price_minor != p.purchase_price_minor
)
AND NOT EXISTS (
  SELECT 1 FROM public.product_price_history ph
  WHERE ph.product_id = p.id
    AND ph.effective_from = COALESCE(p.updated_at, p.created_at, now())
    AND ph.purchase_price_minor = p.purchase_price_minor
);

-- ----------------------------------------------------------------------------
-- 2. DOCUMENT NUMBER SEQUENCES
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.sale_receipt_seq
  START WITH 1000
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.income_receipt_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

CREATE SEQUENCE IF NOT EXISTS public.outcome_document_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  CACHE 1;

-- Synchronize sequences with existing document numbers if tables already contain data
DO $$
DECLARE
  v_max_sale bigint;
  v_max_income bigint;
  v_max_outcome bigint;
BEGIN
  -- Extract max numeric suffix from existing sales (e.g., 'ЧЕК-#0001256' or 'ЧЕК-2026-001000')
  SELECT COALESCE(MAX(NULLIF(substring(receipt_number from '\d+$'), '')::bigint), 999)
  INTO v_max_sale
  FROM public.sales;

  IF v_max_sale >= 1000 THEN
    PERFORM setval('public.sale_receipt_seq', v_max_sale, true);
  ELSE
    PERFORM setval('public.sale_receipt_seq', 1000, false);
  END IF;

  -- Extract max numeric suffix from existing income receipts (e.g., 'ПР-2026-001')
  SELECT COALESCE(MAX(NULLIF(substring(receipt_number from '\d+$'), '')::bigint), 0)
  INTO v_max_income
  FROM public.income_receipts;

  IF v_max_income >= 1 THEN
    PERFORM setval('public.income_receipt_seq', v_max_income, true);
  ELSE
    PERFORM setval('public.income_receipt_seq', 1, false);
  END IF;

  -- Extract max numeric suffix from existing outcome documents (e.g., 'СП-2026-001')
  SELECT COALESCE(MAX(NULLIF(substring(document_number from '\d+$'), '')::bigint), 0)
  INTO v_max_outcome
  FROM public.outcome_documents;

  IF v_max_outcome >= 1 THEN
    PERFORM setval('public.outcome_document_seq', v_max_outcome, true);
  ELSE
    PERFORM setval('public.outcome_document_seq', 1, false);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. SECURITY HELPER: GET AND VERIFY ACTIVE PROFILE
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.get_active_profile(p_require_admin boolean DEFAULT false)
RETURNS TABLE (
  profile_id uuid,
  full_name text,
  role public.app_role
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_profile RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User is not authenticated'
      USING ERRCODE = '28000';
  END IF;

  SELECT p.id, p.full_name, p.role, p.is_active
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_require_admin AND v_profile.role != 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_profile.id, v_profile.full_name, v_profile.role;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. PRODUCT RPC FUNCTIONS
-- ----------------------------------------------------------------------------

-- 4.1. Create Product (Admin only)
CREATE OR REPLACE FUNCTION public.rpc_create_product(
  p_sku text,
  p_barcode text,
  p_name text,
  p_category text,
  p_category_label text,
  p_purchase_price_minor bigint,
  p_selling_price_minor bigint,
  p_description text DEFAULT NULL,
  p_stock integer DEFAULT 0,
  p_min_stock_threshold integer DEFAULT 0
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_sku text;
  v_barcode text;
  v_name text;
  v_category text;
  v_category_label text;
  v_desc text;
  v_product public.products;
BEGIN
  -- 1. Security check: admin only
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  -- 2. Clean & normalize strings
  v_sku := upper(trim(p_sku));
  v_barcode := trim(p_barcode);
  v_name := trim(p_name);
  v_category := trim(p_category);
  v_category_label := trim(p_category_label);
  v_desc := NULLIF(trim(p_description), '');

  IF length(v_sku) = 0 THEN
    RAISE EXCEPTION 'Validation error: SKU cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(v_barcode) = 0 THEN
    RAISE EXCEPTION 'Validation error: Barcode cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'Validation error: Product name cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(v_category) = 0 OR length(v_category_label) = 0 THEN
    RAISE EXCEPTION 'Validation error: Category and category label cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- 3. Numeric bounds validation
  IF p_purchase_price_minor < 0 OR p_purchase_price_minor > 10000000000 THEN
    RAISE EXCEPTION 'Validation error: Purchase price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
  END IF;
  IF p_selling_price_minor < 0 OR p_selling_price_minor > 10000000000 THEN
    RAISE EXCEPTION 'Validation error: Selling price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
  END IF;
  IF p_selling_price_minor < p_purchase_price_minor THEN
    RAISE EXCEPTION 'Validation error: Selling price (%) cannot be less than purchase price (%)',
      p_selling_price_minor, p_purchase_price_minor
      USING ERRCODE = '22023';
  END IF;
  IF p_stock < 0 OR p_stock > 100000000 THEN
    RAISE EXCEPTION 'Validation error: Initial stock must be between 0 and 100 000 000' USING ERRCODE = '22003';
  END IF;
  IF p_min_stock_threshold < 0 OR p_min_stock_threshold > 100000000 THEN
    RAISE EXCEPTION 'Validation error: Min stock threshold must be between 0 and 100 000 000' USING ERRCODE = '22003';
  END IF;

  -- 4. Check uniqueness
  IF EXISTS (SELECT 1 FROM public.products WHERE lower(trim(sku)) = lower(v_sku)) THEN
    RAISE EXCEPTION 'Validation error: Product with SKU "%" already exists', v_sku USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE trim(barcode) = v_barcode) THEN
    RAISE EXCEPTION 'Validation error: Product with barcode "%" already exists', v_barcode USING ERRCODE = '23505';
  END IF;

  -- 5. Insert product
  INSERT INTO public.products (
    sku,
    barcode,
    name,
    category,
    category_label,
    description,
    purchase_price_minor,
    selling_price_minor,
    stock,
    min_stock_threshold,
    is_archived,
    created_by,
    updated_by
  ) VALUES (
    v_sku,
    v_barcode,
    v_name,
    v_category,
    v_category_label,
    v_desc,
    p_purchase_price_minor,
    p_selling_price_minor,
    p_stock,
    p_min_stock_threshold,
    false,
    v_profile.profile_id,
    v_profile.profile_id
  )
  RETURNING * INTO v_product;

  -- 6. Record initial price in price history
  INSERT INTO public.product_price_history (
    product_id,
    purchase_price_minor,
    selling_price_minor,
    effective_from,
    source
  ) VALUES (
    v_product.id,
    p_purchase_price_minor,
    p_selling_price_minor,
    v_product.created_at,
    'initial'
  );

  -- 7. If initial stock > 0, create opening_balance movement
  IF p_stock > 0 THEN
    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity_delta,
      balance_after,
      occurred_at,
      reference_id,
      reference_number,
      product_name_snapshot,
      sku_snapshot,
      responsible_id,
      responsible_name,
      note
    ) VALUES (
      v_product.id,
      'opening_balance'::public.movement_type,
      p_stock,
      p_stock,
      clock_timestamp(),
      v_product.id,
      'НАЧ-' || substr(v_product.id::text, 1, 8),
      v_product.name,
      v_product.sku,
      v_profile.profile_id,
      v_profile.full_name,
      'Ввод начального остатка при создании товара'
    );
  END IF;

  RETURN v_product;
END;
$$;

-- 4.2. Update Product (Admin only)
CREATE OR REPLACE FUNCTION public.rpc_update_product(
  p_product_id uuid,
  p_sku text,
  p_barcode text,
  p_name text,
  p_category text,
  p_category_label text,
  p_purchase_price_minor bigint,
  p_selling_price_minor bigint,
  p_description text DEFAULT NULL,
  p_min_stock_threshold integer DEFAULT 0
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_sku text;
  v_barcode text;
  v_name text;
  v_category text;
  v_category_label text;
  v_desc text;
  v_product public.products;
  v_old_product public.products;
  v_price_changed boolean;
BEGIN
  -- 1. Security check: admin only
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  -- 2. Clean strings
  v_sku := upper(trim(p_sku));
  v_barcode := trim(p_barcode);
  v_name := trim(p_name);
  v_category := trim(p_category);
  v_category_label := trim(p_category_label);
  v_desc := NULLIF(trim(p_description), '');

  IF length(v_sku) = 0 THEN
    RAISE EXCEPTION 'Validation error: SKU cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(v_barcode) = 0 THEN
    RAISE EXCEPTION 'Validation error: Barcode cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) = 0 THEN
    RAISE EXCEPTION 'Validation error: Product name cannot be empty' USING ERRCODE = '22023';
  END IF;
  IF length(v_category) = 0 OR length(v_category_label) = 0 THEN
    RAISE EXCEPTION 'Validation error: Category and category label cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- 3. Validate bounds
  IF p_purchase_price_minor < 0 OR p_purchase_price_minor > 10000000000 THEN
    RAISE EXCEPTION 'Validation error: Purchase price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
  END IF;
  IF p_selling_price_minor < 0 OR p_selling_price_minor > 10000000000 THEN
    RAISE EXCEPTION 'Validation error: Selling price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
  END IF;
  IF p_selling_price_minor < p_purchase_price_minor THEN
    RAISE EXCEPTION 'Validation error: Selling price (%) cannot be less than purchase price (%)',
      p_selling_price_minor, p_purchase_price_minor
      USING ERRCODE = '22023';
  END IF;
  IF p_min_stock_threshold < 0 OR p_min_stock_threshold > 100000000 THEN
    RAISE EXCEPTION 'Validation error: Min stock threshold must be between 0 and 100 000 000' USING ERRCODE = '22003';
  END IF;

  -- 4. Lock row and check existence
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product with ID "%" not found', p_product_id USING ERRCODE = 'P0002';
  END IF;

  -- 5. Check uniqueness (excluding current product)
  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE lower(trim(sku)) = lower(v_sku) AND id != p_product_id
  ) THEN
    RAISE EXCEPTION 'Validation error: Product with SKU "%" already exists', v_sku USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products
    WHERE trim(barcode) = v_barcode AND id != p_product_id
  ) THEN
    RAISE EXCEPTION 'Validation error: Product with barcode "%" already exists', v_barcode USING ERRCODE = '23505';
  END IF;

  v_price_changed := (v_product.purchase_price_minor != p_purchase_price_minor) OR (v_product.selling_price_minor != p_selling_price_minor);
  v_old_product := v_product;

  -- 6. Update product
  UPDATE public.products
  SET
    sku = v_sku,
    barcode = v_barcode,
    name = v_name,
    category = v_category,
    category_label = v_category_label,
    description = v_desc,
    purchase_price_minor = p_purchase_price_minor,
    selling_price_minor = p_selling_price_minor,
    min_stock_threshold = p_min_stock_threshold,
    updated_by = v_profile.profile_id,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  -- 7. If prices changed, record in price history
  IF v_price_changed THEN
    -- If no baseline price history exists for this product, record the original price first
    IF NOT EXISTS (
      SELECT 1 FROM public.product_price_history WHERE product_id = p_product_id
    ) THEN
      INSERT INTO public.product_price_history (
        product_id,
        purchase_price_minor,
        selling_price_minor,
        effective_from,
        source,
        created_at
      ) VALUES (
        p_product_id,
        v_old_product.purchase_price_minor,
        v_old_product.selling_price_minor,
        COALESCE(v_old_product.created_at, timestamptz '1970-01-01 00:00:00+00'),
        'initial',
        COALESCE(v_old_product.created_at, timestamptz '1970-01-01 00:00:00+00')
      );
    END IF;

    INSERT INTO public.product_price_history (
      product_id,
      purchase_price_minor,
      selling_price_minor,
      effective_from,
      source
    ) VALUES (
      p_product_id,
      p_purchase_price_minor,
      p_selling_price_minor,
      clock_timestamp(),
      'update'
    );
  END IF;

  RETURN v_product;
END;
$$;

-- 4.3. Adjust Product Stock (Admin only, for inventory audit)
CREATE OR REPLACE FUNCTION public.rpc_adjust_product_stock(
  p_product_id uuid,
  p_new_stock integer,
  p_reason text
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_product public.products;
  v_old_stock integer;
  v_delta integer;
  v_clean_reason text;
  v_occurred_at timestamptz;
  v_historical_balance_before integer;
  v_historical_balance_after integer;
  v_min_future_balance integer;
BEGIN
  -- 1. Security check: admin only
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Validation error: Reason for stock adjustment cannot be empty' USING ERRCODE = '22023';
  END IF;
  v_clean_reason := trim(p_reason);

  IF p_new_stock < 0 OR p_new_stock > 100000000 THEN
    RAISE EXCEPTION 'Validation error: Stock must be between 0 and 100 000 000' USING ERRCODE = '22003';
  END IF;

  -- 2. Lock product
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product with ID "%" not found', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF v_product.is_archived THEN
    RAISE EXCEPTION 'Validation error: Cannot adjust stock for an archived product' USING ERRCODE = '22023';
  END IF;

  v_old_stock := v_product.stock;
  v_delta := p_new_stock - v_old_stock;

  -- If no change in quantity, return product as is
  IF v_delta = 0 THEN
    RETURN v_product;
  END IF;

  v_occurred_at := clock_timestamp();

  -- 3. Chronology and future balance validation
  IF v_delta > 0 THEN
    v_historical_balance_before := v_old_stock - (
      SELECT COALESCE(sum(quantity_delta), 0)::integer
      FROM public.stock_movements
      WHERE product_id = p_product_id
        AND (occurred_at > v_occurred_at OR (occurred_at = v_occurred_at AND quantity_delta < 0))
    );
    v_historical_balance_after := v_historical_balance_before + v_delta;

    -- Shift future movements' balance_after by v_delta (including outflows at the same timestamp)
    UPDATE public.stock_movements
    SET balance_after = balance_after + v_delta
    WHERE product_id = p_product_id
      AND (occurred_at > v_occurred_at OR (occurred_at = v_occurred_at AND quantity_delta < 0));
  ELSE
    v_historical_balance_before := v_old_stock - (
      SELECT COALESCE(sum(quantity_delta), 0)::integer
      FROM public.stock_movements
      WHERE product_id = p_product_id AND occurred_at > v_occurred_at
    );
    v_historical_balance_after := v_historical_balance_before + v_delta;

    IF v_historical_balance_after < 0 THEN
      RAISE EXCEPTION 'Validation error: Stock adjustment would cause negative historical balance (%) for product "%"',
        v_historical_balance_after, v_product.name
        USING ERRCODE = '22023';
    END IF;

    SELECT min(balance_after)
    INTO v_min_future_balance
    FROM public.stock_movements
    WHERE product_id = p_product_id AND occurred_at > v_occurred_at;

    IF v_min_future_balance IS NOT NULL AND (v_min_future_balance + v_delta) < 0 THEN
      RAISE EXCEPTION 'Validation error: Stock adjustment would cause negative subsequent historical stock for product "%"',
        v_product.name
        USING ERRCODE = '22023';
    END IF;

    -- Shift future movements' balance_after by v_delta
    UPDATE public.stock_movements
    SET balance_after = balance_after + v_delta
    WHERE product_id = p_product_id AND occurred_at > v_occurred_at;
  END IF;

  -- 4. Update stock
  UPDATE public.products
  SET
    stock = p_new_stock,
    updated_by = v_profile.profile_id,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  -- 5. Create movement record
  INSERT INTO public.stock_movements (
    product_id,
    movement_type,
    quantity_delta,
    balance_after,
    occurred_at,
    reference_id,
    reference_number,
    product_name_snapshot,
    sku_snapshot,
    responsible_id,
    responsible_name,
    note
  ) VALUES (
    v_product.id,
    'inventory_adjustment'::public.movement_type,
    v_delta,
    v_historical_balance_after,
    v_occurred_at,
    v_product.id,
    'КОРР-' || substr(v_product.id::text, 1, 8),
    v_product.name,
    v_product.sku,
    v_profile.profile_id,
    v_profile.full_name,
    v_clean_reason
  );

  RETURN v_product;
END;
$$;

-- 4.4. Archive Product (Admin only, archiving requires stock = 0)
CREATE OR REPLACE FUNCTION public.rpc_archive_product(
  p_product_id uuid,
  p_is_archived boolean DEFAULT true
)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_product public.products;
BEGIN
  -- 1. Security check: admin only
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  -- 2. Lock product
  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product with ID "%" not found', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF p_is_archived IS TRUE THEN
    IF v_product.is_archived THEN
      RETURN v_product;
    END IF;

    -- Strict business rule: Cannot archive product with positive stock
    IF v_product.stock > 0 THEN
      RAISE EXCEPTION 'Validation error: Cannot archive product "%" with positive stock (%)', v_product.name, v_product.stock
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.products
    SET
      is_archived = true,
      updated_by = v_profile.profile_id,
      updated_at = clock_timestamp()
    WHERE id = p_product_id
    RETURNING * INTO v_product;
  ELSE
    IF NOT v_product.is_archived THEN
      RETURN v_product;
    END IF;

    UPDATE public.products
    SET
      is_archived = false,
      updated_by = v_profile.profile_id,
      updated_at = clock_timestamp()
    WHERE id = p_product_id
    RETURNING * INTO v_product;
  END IF;

  RETURN v_product;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. INCOME RECEIPT RPC FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_income_receipt(
  p_supplier text,
  p_supplier_document_number text DEFAULT NULL,
  p_received_at timestamptz DEFAULT now(),
  p_comment text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_existing RECORD;
  v_supplier text;
  v_supplier_doc text;
  v_comment text;
  v_received_at timestamptz;
  v_receipt_id uuid;
  v_receipt_number text;
  v_seq_val bigint;
  v_year text;
  v_total_minor bigint := 0;
  v_item_count integer;
  
  -- Iteration variables
  v_item jsonb;
  v_prod_id uuid;
  v_qty integer;
  v_price_minor bigint;
  v_subtotal_minor bigint;
  
  -- Array of product IDs for deterministic sorting and locking
  v_product_ids uuid[];
  v_product_map jsonb := '{}'::jsonb;
  v_product RECORD;
  v_new_stock integer;
  v_future_delta_sum integer;
  v_historical_balance_after integer;
  v_next_price_time timestamptz;
BEGIN
  -- 1. Security check: admin only
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  -- 2. Idempotency check: if p_id is provided, serialize and check if it already exists
  IF p_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_id::text));

    SELECT r.id, r.receipt_number, r.total_minor, (SELECT count(*) FROM public.income_items WHERE income_receipt_id = r.id)::integer AS items_count
    INTO v_existing
    FROM public.income_receipts r
    WHERE r.id = p_id;

    IF v_existing.id IS NOT NULL THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'receipt_number', v_existing.receipt_number,
        'total_cost_minor', v_existing.total_minor,
        'total_minor', v_existing.total_minor,
        'items_count', v_existing.items_count
      )::jsonb;
    END IF;
  END IF;

  -- 3. Validate input arguments
  v_received_at := COALESCE(p_received_at, clock_timestamp());
  IF v_received_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Validation error: Receipt date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  v_supplier := trim(p_supplier);
  v_supplier_doc := NULLIF(trim(p_supplier_document_number), '');
  v_comment := NULLIF(trim(p_comment), '');

  IF length(v_supplier) = 0 THEN
    RAISE EXCEPTION 'Validation error: Supplier name cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Validation error: Receipt must contain at least one line item in a JSON array' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  -- 4. Extract and check product IDs for duplicates
  SELECT array_agg(DISTINCT (item->>'product_id')::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(p_items) AS item;

  IF array_length(v_product_ids, 1) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: Duplicate product in income receipt items' USING ERRCODE = '22023';
  END IF;

  -- 5. Lock affected products in deterministic ascending order to prevent deadlocks
  FOR v_product IN
    SELECT p.id, p.name, p.sku, p.stock, p.purchase_price_minor, p.selling_price_minor, p.is_archived
    FROM public.products p
    WHERE p.id = ANY(v_product_ids)
    ORDER BY p.id ASC
    FOR UPDATE
  LOOP
    IF v_product.is_archived THEN
      RAISE EXCEPTION 'Validation error: Cannot receive archived product "%"', v_product.name USING ERRCODE = '22023';
    END IF;
    v_product_map := jsonb_set(
      v_product_map,
      ARRAY[v_product.id::text],
      json_build_object(
        'name', v_product.name,
        'sku', v_product.sku,
        'stock', v_product.stock,
        'purchase_price_minor', v_product.purchase_price_minor,
        'selling_price_minor', v_product.selling_price_minor
      )::jsonb
    );
  END LOOP;

  IF (SELECT count(*) FROM jsonb_object_keys(v_product_map)) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: One or more products were not found in catalog' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Calculate line totals and overall document total
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_price_minor := (v_item->>'purchase_price_minor')::bigint;

    IF v_qty <= 0 OR v_qty > 100000000 THEN
      RAISE EXCEPTION 'Validation error: Quantity must be positive and <= 100 000 000' USING ERRCODE = '22003';
    END IF;
    IF v_price_minor < 0 OR v_price_minor > 10000000000 THEN
      RAISE EXCEPTION 'Validation error: Purchase price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
    END IF;

    -- Strict Price Ratio Guard: incoming purchase price cannot exceed current catalog selling price
    IF v_price_minor > (v_product_map->v_prod_id::text->>'selling_price_minor')::bigint THEN
      RAISE EXCEPTION 'Validation error: Incoming purchase price (%) exceeds selling price (%) for product "%"',
        v_price_minor,
        (v_product_map->v_prod_id::text->>'selling_price_minor')::bigint,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    v_subtotal_minor := v_qty * v_price_minor;
    IF v_subtotal_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Line total exceeds maximum safe number bounds' USING ERRCODE = '22003';
    END IF;

    v_total_minor := v_total_minor + v_subtotal_minor;
    IF v_total_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Receipt total exceeds maximum safe number bounds' USING ERRCODE = '22003';
    END IF;
  END LOOP;

  -- 7. Generate sequential receipt number without truncation
  v_seq_val := nextval('public.income_receipt_seq');
  v_year := to_char(v_received_at, 'YYYY');
  v_receipt_number := 'ПР-' || v_year || '-' || lpad(v_seq_val::text, GREATEST(3, length(v_seq_val::text)), '0');

  -- 8. Insert into public.income_receipts
  v_receipt_id := COALESCE(p_id, gen_random_uuid());
  INSERT INTO public.income_receipts (
    id,
    receipt_number,
    supplier,
    supplier_document_number,
    received_at,
    total_minor,
    status,
    comment,
    created_by,
    created_by_name,
    created_at
  ) VALUES (
    v_receipt_id,
    v_receipt_number,
    v_supplier,
    v_supplier_doc,
    v_received_at,
    v_total_minor,
    'completed'::public.document_status,
    v_comment,
    v_profile.profile_id,
    v_profile.full_name,
    clock_timestamp()
  );

  -- 9. Process items: insert income_items, update products stock & price, create movements & price history
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_price_minor := (v_item->>'purchase_price_minor')::bigint;
    v_subtotal_minor := v_qty * v_price_minor;

    SELECT
      (v_product_map->v_prod_id::text->>'name') AS name,
      (v_product_map->v_prod_id::text->>'sku') AS sku,
      (v_product_map->v_prod_id::text->>'stock')::integer AS stock
    INTO v_product;

    v_new_stock := v_product.stock + v_qty;
    IF v_new_stock > 100000000 THEN
      RAISE EXCEPTION 'Validation error: Resulting stock for product "%" exceeds maximum limit', v_product.name
        USING ERRCODE = '22003';
    END IF;

    -- Calculate chronologically accurate balance_after at document time
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id
      AND (occurred_at > v_received_at OR (occurred_at = v_received_at AND quantity_delta < 0));

    v_historical_balance_after := (v_product.stock - v_future_delta_sum) + v_qty;

    -- Find next chronological price history event after v_received_at
    SELECT ph.effective_from
    INTO v_next_price_time
    FROM public.product_price_history ph
    WHERE ph.product_id = v_prod_id
      AND ph.effective_from > v_received_at
    ORDER BY ph.effective_from ASC, ph.created_at ASC
    LIMIT 1;

    -- Check if there are already sales or write-offs within the effective interval of this incoming price [v_received_at, v_next_price_time)
    -- that were conducted with a different historical cost snapshot
    IF EXISTS (
      SELECT 1
      FROM public.sale_items si
      JOIN public.sales s ON s.id = si.sale_id
      WHERE si.product_id = v_prod_id
        AND s.sold_at >= v_received_at
        AND (v_next_price_time IS NULL OR s.sold_at < v_next_price_time)
        AND si.purchase_price_snapshot_minor != v_price_minor
    ) THEN
      RAISE EXCEPTION 'Validation error: Cannot backdate income receipt for product "%" with price % before existing sales conducted with different cost',
        v_product.name, v_price_minor
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.outcome_items oi
      JOIN public.outcome_documents od ON od.id = oi.outcome_document_id
      WHERE oi.product_id = v_prod_id
        AND od.occurred_at >= v_received_at
        AND (v_next_price_time IS NULL OR od.occurred_at < v_next_price_time)
        AND oi.purchase_price_snapshot_minor != v_price_minor
    ) THEN
      RAISE EXCEPTION 'Validation error: Cannot backdate income receipt for product "%" with price % before existing write-off documents conducted with different cost',
        v_product.name, v_price_minor
        USING ERRCODE = '22023';
    END IF;

    -- Shift future movements' balance_after by +v_qty (including outflows at the same timestamp)
    UPDATE public.stock_movements
    SET balance_after = balance_after + v_qty
    WHERE product_id = v_prod_id
      AND (occurred_at > v_received_at OR (occurred_at = v_received_at AND quantity_delta < 0));

    -- Insert income item
    INSERT INTO public.income_items (
      income_receipt_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      quantity,
      purchase_price_minor,
      subtotal_minor
    ) VALUES (
      v_receipt_id,
      v_prod_id,
      v_product.name,
      v_product.sku,
      v_qty,
      v_price_minor,
      v_subtotal_minor
    );

    -- Record in price history for historical cost lookups
    INSERT INTO public.product_price_history (
      product_id,
      purchase_price_minor,
      selling_price_minor,
      effective_from,
      source
    ) VALUES (
      v_prod_id,
      v_price_minor,
      (v_product_map->v_prod_id::text->>'selling_price_minor')::bigint,
      v_received_at,
      'income'
    );

    -- Update product stock and ensure catalog purchase_price_minor reflects the latest price in history
    UPDATE public.products
    SET
      stock = v_new_stock,
      purchase_price_minor = (
        SELECT ph.purchase_price_minor
        FROM public.product_price_history ph
        WHERE ph.product_id = v_prod_id
        ORDER BY ph.effective_from DESC, ph.created_at DESC
        LIMIT 1
      ),
      updated_by = v_profile.profile_id,
      updated_at = clock_timestamp()
    WHERE id = v_prod_id;

    -- Create stock movement
    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity_delta,
      balance_after,
      occurred_at,
      reference_id,
      reference_number,
      product_name_snapshot,
      sku_snapshot,
      responsible_id,
      responsible_name,
      note
    ) VALUES (
      v_prod_id,
      'income'::public.movement_type,
      v_qty,
      v_historical_balance_after,
      v_received_at,
      v_receipt_id,
      v_receipt_number,
      v_product.name,
      v_product.sku,
      v_profile.profile_id,
      v_profile.full_name,
      CASE
        WHEN v_comment IS NOT NULL THEN 'Приход от поставщика «' || v_supplier || '» (' || v_comment || ')'
        ELSE 'Поступление от поставщика «' || v_supplier || '»'
      END
    );
  END LOOP;

  RETURN json_build_object(
    'id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'total_cost_minor', v_total_minor,
    'total_minor', v_total_minor,
    'items_count', v_item_count
  )::jsonb;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. SALE RPC FUNCTION (ATOMIC RECALCULATION & STOCK UPDATE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_sale(
  p_payment_method public.payment_method,
  p_receipt_discount_type public.discount_type DEFAULT 'none',
  p_receipt_discount_value bigint DEFAULT 0,
  p_received_minor bigint DEFAULT NULL,
  p_sold_at timestamptz DEFAULT now(),
  p_comment text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_existing RECORD;
  v_comment text;
  v_sold_at timestamptz;
  v_sale_id uuid;
  v_receipt_number text;
  v_seq_val bigint;
  v_year text;
  v_item_count integer;

  -- Totals
  v_subtotal_minor bigint := 0;
  v_item_discount_total_minor bigint := 0;
  v_eligible_subtotal_minor bigint := 0;
  v_receipt_discount_minor bigint := 0;
  v_total_discount_minor bigint := 0;
  v_total_minor bigint := 0;
  v_total_cost_minor bigint := 0;
  v_profit_minor bigint := 0;
  v_received_minor bigint := NULL;
  v_change_minor bigint := NULL;

  -- Array of product IDs for locking
  v_product_ids uuid[];
  v_product_map jsonb := '{}'::jsonb;
  v_product RECORD;

  -- Iteration and line item variables
  v_item jsonb;
  v_prod_id uuid;
  v_qty integer;
  v_unit_price_minor bigint;
  v_cost_price_minor bigint;
  v_historical_cost_minor bigint;
  v_item_disc_type public.discount_type;
  v_item_disc_val bigint;
  v_line_gross_minor bigint;
  v_line_cost_minor bigint;
  v_line_item_disc_minor bigint;
  v_line_final_before_receipt_disc bigint;
  v_line_net_total_minor bigint;
  v_line_profit_minor bigint;
  v_allocated_receipt_disc bigint;
  v_new_stock integer;

  -- Array for processed items
  v_processed_items jsonb := '[]'::jsonb;
  v_allocated_sum bigint := 0;
  v_remainder bigint := 0;
  v_allocations bigint[];
  v_headrooms bigint[];
  v_idx integer := 0;

  -- Chronology variables
  v_min_future_balance integer;
  v_future_delta_sum integer;
  v_historical_balance_before integer;
  v_historical_balance_after integer;
BEGIN
  -- 1. Security check: active staff member (cashier or admin)
  SELECT * INTO v_profile FROM private.get_active_profile(false);

  -- 2. Idempotency check: if p_id is provided, serialize and check if it already exists
  IF p_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_id::text));

    SELECT s.id, s.receipt_number, s.total_minor, s.profit_minor, s.change_minor, (SELECT count(*) FROM public.sale_items WHERE sale_id = s.id)::integer AS items_count
    INTO v_existing
    FROM public.sales s
    WHERE s.id = p_id;

    IF v_existing.id IS NOT NULL THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'receipt_number', v_existing.receipt_number,
        'total_minor', v_existing.total_minor,
        'profit_minor', v_existing.profit_minor,
        'change_minor', v_existing.change_minor,
        'items_count', v_existing.items_count
      )::jsonb;
    END IF;
  END IF;

  -- 3. Validate input arguments
  v_sold_at := COALESCE(p_sold_at, clock_timestamp());
  IF v_sold_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Validation error: Sale date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  v_comment := NULLIF(trim(p_comment), '');

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Validation error: Sale must contain at least one line item in a JSON array' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  IF p_payment_method IS NULL THEN
    RAISE EXCEPTION 'Validation error: Payment method is required' USING ERRCODE = '22023';
  END IF;

  IF p_receipt_discount_value < 0 OR p_receipt_discount_value > 9007199254740991 THEN
    RAISE EXCEPTION 'Validation error: Receipt discount value is out of safe bounds (0..9007199254740991)' USING ERRCODE = '22003';
  END IF;
  IF p_receipt_discount_type = 'percent'::public.discount_type AND p_receipt_discount_value > 10000 THEN
    RAISE EXCEPTION 'Validation error: Receipt percent discount cannot exceed 100.00%% (10000 bps)' USING ERRCODE = '22003';
  END IF;

  -- 4. Extract and check product IDs for duplicates
  SELECT array_agg(DISTINCT (item->>'product_id')::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(p_items) AS item;

  IF array_length(v_product_ids, 1) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: Duplicate product in sale items' USING ERRCODE = '22023';
  END IF;

  -- 5. Lock affected products in deterministic ascending order to prevent deadlocks
  FOR v_product IN
    SELECT p.id, p.name, p.sku, p.barcode, p.stock, p.purchase_price_minor, p.selling_price_minor, p.is_archived
    FROM public.products p
    WHERE p.id = ANY(v_product_ids)
    ORDER BY p.id ASC
    FOR UPDATE
  LOOP
    IF v_product.is_archived THEN
      RAISE EXCEPTION 'Validation error: Cannot sell archived product "%"', v_product.name USING ERRCODE = '22023';
    END IF;
    v_product_map := jsonb_set(
      v_product_map,
      ARRAY[v_product.id::text],
      json_build_object(
        'name', v_product.name,
        'sku', v_product.sku,
        'barcode', v_product.barcode,
        'stock', v_product.stock,
        'purchase_price_minor', v_product.purchase_price_minor,
        'selling_price_minor', v_product.selling_price_minor
      )::jsonb
    );
  END LOOP;

  IF (SELECT count(*) FROM jsonb_object_keys(v_product_map)) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: One or more products were not found in catalog' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Pass 1: Validate stock, chronology, prices, item discounts and accumulate subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price_minor := COALESCE(
      (v_item->>'unit_price_minor')::bigint,
      (v_product_map->v_prod_id::text->>'selling_price_minor')::bigint
    );
    v_item_disc_type := COALESCE((v_item->>'discount_type')::public.discount_type, 'none'::public.discount_type);
    v_item_disc_val := COALESCE((v_item->>'discount_value')::bigint, 0);

    -- Check available current stock
    IF v_qty <= 0 OR v_qty > 100000000 THEN
      RAISE EXCEPTION 'Validation error: Quantity must be positive and <= 100 000 000' USING ERRCODE = '22003';
    END IF;
    IF (v_product_map->v_prod_id::text->>'stock')::integer < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for product "%" (available: %, requested: %)',
        (v_product_map->v_prod_id::text->>'name'),
        (v_product_map->v_prod_id::text->>'stock')::integer,
        v_qty
        USING ERRCODE = '22023';
    END IF;

    -- Strict Chronology Guard: verify balance at document date and all strictly subsequent movements
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    v_historical_balance_before := (v_product_map->v_prod_id::text->>'stock')::integer - v_future_delta_sum;
    v_historical_balance_after := v_historical_balance_before - v_qty;

    IF v_historical_balance_after < 0 THEN
      RAISE EXCEPTION 'Validation error: Sale at "%" would cause negative historical stock (%) for product "%"',
        v_sold_at,
        v_historical_balance_after,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    SELECT min(balance_after)
    INTO v_min_future_balance
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    IF v_min_future_balance IS NOT NULL AND (v_min_future_balance - v_qty) < 0 THEN
      RAISE EXCEPTION 'Validation error: Sale at "%" would cause negative subsequent historical stock for product "%"',
        v_sold_at,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    IF v_unit_price_minor < 0 OR v_unit_price_minor > 10000000000 THEN
      RAISE EXCEPTION 'Validation error: Unit selling price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
    END IF;

    -- Look up exact effective purchase price from price history at historical document timestamp
    SELECT pph.purchase_price_minor
    INTO v_historical_cost_minor
    FROM public.product_price_history pph
    WHERE pph.product_id = v_prod_id
      AND pph.effective_from <= v_sold_at
    ORDER BY pph.effective_from DESC, pph.created_at DESC, pph.id DESC
    LIMIT 1;

    -- If no price history entry exists at or before v_sold_at, pick the earliest known historical price
    IF v_historical_cost_minor IS NULL THEN
      SELECT pph.purchase_price_minor
      INTO v_historical_cost_minor
      FROM public.product_price_history pph
      WHERE pph.product_id = v_prod_id
      ORDER BY pph.effective_from ASC, pph.created_at ASC, pph.id ASC
      LIMIT 1;
    END IF;

    v_cost_price_minor := COALESCE(v_historical_cost_minor, (v_product_map->v_prod_id::text->>'purchase_price_minor')::bigint);

    -- Arithmetic calculation for item gross and cost
    v_line_gross_minor := v_qty * v_unit_price_minor;
    v_line_cost_minor := v_qty * v_cost_price_minor;

    IF v_line_gross_minor > 9007199254740991 OR v_line_cost_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Line monetary amounts exceed safe number bounds' USING ERRCODE = '22003';
    END IF;

    -- Calculate and strictly validate item discount
    IF v_item_disc_val < 0 OR v_item_disc_val > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Item discount value is out of safe bounds (0..9007199254740991)' USING ERRCODE = '22003';
    END IF;

    IF v_item_disc_type = 'percent'::public.discount_type THEN
      IF v_item_disc_val > 10000 THEN
        RAISE EXCEPTION 'Validation error: Item percent discount cannot exceed 100.00%% (10000 bps)' USING ERRCODE = '22003';
      END IF;
      -- Intermediate numeric calculation avoids any bigint overflow
      v_line_item_disc_minor := trunc((v_line_gross_minor::numeric * v_item_disc_val::numeric + 5000::numeric) / 10000::numeric)::bigint;
    ELSIF v_item_disc_type = 'fixed'::public.discount_type THEN
      IF v_item_disc_val > v_line_gross_minor THEN
        RAISE EXCEPTION 'Validation error: Item discount (%) exceeds item gross price (%)',
          v_item_disc_val, v_line_gross_minor
          USING ERRCODE = '22023';
      END IF;
      v_line_item_disc_minor := v_item_disc_val;
    ELSE
      v_line_item_disc_minor := 0;
    END IF;

    v_line_final_before_receipt_disc := v_line_gross_minor - v_line_item_disc_minor;

    v_subtotal_minor := v_subtotal_minor + v_line_gross_minor;
    v_item_discount_total_minor := v_item_discount_total_minor + v_line_item_disc_minor;
    v_eligible_subtotal_minor := v_eligible_subtotal_minor + v_line_final_before_receipt_disc;
    v_total_cost_minor := v_total_cost_minor + v_line_cost_minor;

    IF v_subtotal_minor > 9007199254740991 OR v_total_cost_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Document total amounts exceed safe number bounds' USING ERRCODE = '22003';
    END IF;

    v_processed_items := v_processed_items || json_build_object(
      'product_id', v_prod_id,
      'quantity', v_qty,
      'unit_price_minor', v_unit_price_minor,
      'cost_price_minor', v_cost_price_minor,
      'gross_minor', v_line_gross_minor,
      'cost_minor', v_line_cost_minor,
      'discount_type', v_item_disc_type,
      'discount_value', v_item_disc_val,
      'item_discount_minor', v_line_item_disc_minor,
      'line_final_before_receipt_disc', v_line_final_before_receipt_disc
    )::jsonb;
  END LOOP;

  -- 7. Calculate and strictly validate receipt-level discount
  IF p_receipt_discount_type = 'percent'::public.discount_type THEN
    IF p_receipt_discount_value > 0 THEN
      IF p_receipt_discount_value >= 10000 THEN
        RAISE EXCEPTION 'Validation error: Receipt discount of 100%% is not allowed (total sale price must be > 0)' USING ERRCODE = '22023';
      END IF;
      -- Intermediate numeric calculation avoids any bigint overflow
      v_receipt_discount_minor := trunc((v_eligible_subtotal_minor::numeric * p_receipt_discount_value::numeric + 5000::numeric) / 10000::numeric)::bigint;
    ELSE
      v_receipt_discount_minor := 0;
    END IF;
  ELSIF p_receipt_discount_type = 'fixed'::public.discount_type THEN
    IF p_receipt_discount_value >= v_eligible_subtotal_minor THEN
      RAISE EXCEPTION 'Validation error: Receipt fixed discount (%) must be strictly less than total eligible amount (%)',
        p_receipt_discount_value, v_eligible_subtotal_minor
        USING ERRCODE = '22023';
    END IF;
    v_receipt_discount_minor := p_receipt_discount_value;
  ELSE
    v_receipt_discount_minor := 0;
  END IF;

  v_total_discount_minor := v_item_discount_total_minor + v_receipt_discount_minor;
  v_total_minor := v_eligible_subtotal_minor - v_receipt_discount_minor;
  v_profit_minor := v_total_minor - v_total_cost_minor;

  -- Total sale amount must be strictly greater than 0 som
  IF v_total_minor <= 0 THEN
    RAISE EXCEPTION 'Validation error: Sale total amount must be strictly greater than 0' USING ERRCODE = '22023';
  END IF;

  IF abs(v_profit_minor) > 9007199254740991 OR v_total_minor > 9007199254740991 THEN
    RAISE EXCEPTION 'Validation error: Resulting profit or total exceeds safe number bounds' USING ERRCODE = '22003';
  END IF;

  -- 8. Payment consistency validation
  IF p_payment_method = 'cash'::public.payment_method THEN
    IF p_received_minor IS NULL OR p_received_minor < v_total_minor THEN
      RAISE EXCEPTION 'Validation error: Received cash amount (%) is less than total price (%)',
        COALESCE(p_received_minor, 0),
        v_total_minor
        USING ERRCODE = '22023';
    END IF;
    IF p_received_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Received cash amount exceeds safe number bounds' USING ERRCODE = '22003';
    END IF;
    v_received_minor := p_received_minor;
    v_change_minor := p_received_minor - v_total_minor;
  ELSE
    -- For card and transfer, schema consistency constraint requires both received_minor and change_minor to be NULL
    v_received_minor := NULL;
    v_change_minor := NULL;
  END IF;

  -- 9. Pre-calculate receipt discount allocation per item with safe remainder distribution
  v_allocations := ARRAY[]::bigint[];
  v_headrooms := ARRAY[]::bigint[];
  v_allocated_sum := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_processed_items)
  LOOP
    v_line_final_before_receipt_disc := (v_item->>'line_final_before_receipt_disc')::bigint;

    IF v_receipt_discount_minor > 0 AND v_eligible_subtotal_minor > 0 THEN
      -- Floor allocation using numeric math
      v_allocated_receipt_disc := floor((v_line_final_before_receipt_disc::numeric * v_receipt_discount_minor::numeric) / v_eligible_subtotal_minor::numeric)::bigint;
      v_allocated_receipt_disc := LEAST(v_allocated_receipt_disc, v_line_final_before_receipt_disc);
    ELSE
      v_allocated_receipt_disc := 0;
    END IF;

    v_allocations := array_append(v_allocations, v_allocated_receipt_disc);
    v_headrooms := array_append(v_headrooms, v_line_final_before_receipt_disc - v_allocated_receipt_disc);
    v_allocated_sum := v_allocated_sum + v_allocated_receipt_disc;
  END LOOP;

  -- Distribute leftover 1-tyiyn units to items that have available headroom
  v_remainder := v_receipt_discount_minor - v_allocated_sum;
  IF v_remainder > 0 THEN
    FOR i IN 1..v_item_count
    LOOP
      IF v_remainder <= 0 THEN
        EXIT;
      END IF;
      IF v_headrooms[i] > 0 THEN
        v_allocations[i] := v_allocations[i] + 1;
        v_headrooms[i] := v_headrooms[i] - 1;
        v_remainder := v_remainder - 1;
      END IF;
    END LOOP;
  END IF;

  -- 10. Generate sequential receipt number without truncation
  v_seq_val := nextval('public.sale_receipt_seq');
  v_year := to_char(v_sold_at, 'YYYY');
  v_receipt_number := 'ЧЕК-' || v_year || '-' || lpad(v_seq_val::text, GREATEST(6, length(v_seq_val::text)), '0');

  -- 11. Insert master record into public.sales
  v_sale_id := COALESCE(p_id, gen_random_uuid());
  INSERT INTO public.sales (
    id,
    receipt_number,
    sold_at,
    payment_method,
    subtotal_minor,
    item_discount_total_minor,
    receipt_discount_type,
    receipt_discount_value,
    receipt_discount_minor,
    total_discount_minor,
    total_minor,
    received_minor,
    change_minor,
    profit_minor,
    status,
    comment,
    created_by,
    created_by_name,
    created_at
  ) VALUES (
    v_sale_id,
    v_receipt_number,
    v_sold_at,
    p_payment_method,
    v_subtotal_minor,
    v_item_discount_total_minor,
    p_receipt_discount_type,
    p_receipt_discount_value,
    v_receipt_discount_minor,
    v_total_discount_minor,
    v_total_minor,
    v_received_minor,
    v_change_minor,
    v_profit_minor,
    'completed'::public.document_status,
    v_comment,
    v_profile.profile_id,
    v_profile.full_name,
    clock_timestamp()
  );

  -- 12. Insert sale_items, update products stock, and record stock_movements
  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_processed_items)
  LOOP
    v_idx := v_idx + 1;
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price_minor := (v_item->>'unit_price_minor')::bigint;
    v_cost_price_minor := (v_item->>'cost_price_minor')::bigint;
    v_line_gross_minor := (v_item->>'gross_minor')::bigint;
    v_line_cost_minor := (v_item->>'cost_minor')::bigint;
    v_item_disc_type := (v_item->>'discount_type')::public.discount_type;
    v_item_disc_val := (v_item->>'discount_value')::bigint;
    v_line_item_disc_minor := (v_item->>'item_discount_minor')::bigint;
    v_line_final_before_receipt_disc := (v_item->>'line_final_before_receipt_disc')::bigint;

    v_allocated_receipt_disc := v_allocations[v_idx];
    v_line_net_total_minor := v_line_final_before_receipt_disc - v_allocated_receipt_disc;
    v_line_profit_minor := v_line_net_total_minor - v_line_cost_minor;

    IF abs(v_line_profit_minor) > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Line profit exceeds safe number bounds' USING ERRCODE = '22003';
    END IF;

    -- Fetch current stock info from product map
    v_new_stock := (v_product_map->v_prod_id::text->>'stock')::integer - v_qty;

    -- Calculate chronologically accurate balance_after at document time
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    v_historical_balance_after := ((v_product_map->v_prod_id::text->>'stock')::integer - v_future_delta_sum) - v_qty;

    -- Shift future movements' balance_after by -v_qty
    UPDATE public.stock_movements
    SET balance_after = balance_after - v_qty
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    -- Insert sale item
    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      barcode_snapshot,
      quantity,
      purchase_price_snapshot_minor,
      selling_price_snapshot_minor,
      discount_type,
      discount_value,
      gross_minor,
      item_discount_minor,
      receipt_discount_allocated_minor,
      net_total_minor,
      cost_total_minor,
      profit_minor
    ) VALUES (
      v_sale_id,
      v_prod_id,
      (v_product_map->v_prod_id::text->>'name'),
      (v_product_map->v_prod_id::text->>'sku'),
      (v_product_map->v_prod_id::text->>'barcode'),
      v_qty,
      v_cost_price_minor,
      v_unit_price_minor,
      v_item_disc_type,
      v_item_disc_val,
      v_line_gross_minor,
      v_line_item_disc_minor,
      v_allocated_receipt_disc,
      v_line_net_total_minor,
      v_line_cost_minor,
      v_line_profit_minor
    );

    -- Update product stock
    UPDATE public.products
    SET
      stock = v_new_stock,
      updated_by = v_profile.profile_id,
      updated_at = clock_timestamp()
    WHERE id = v_prod_id;

    -- Create negative stock movement
    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity_delta,
      balance_after,
      occurred_at,
      reference_id,
      reference_number,
      product_name_snapshot,
      sku_snapshot,
      responsible_id,
      responsible_name,
      note
    ) VALUES (
      v_prod_id,
      'sale'::public.movement_type,
      -v_qty,
      v_historical_balance_after,
      v_sold_at,
      v_sale_id,
      v_receipt_number,
      (v_product_map->v_prod_id::text->>'name'),
      (v_product_map->v_prod_id::text->>'sku'),
      v_profile.profile_id,
      v_profile.full_name,
      'Продажа по чеку ' || v_receipt_number
    );
  END LOOP;

  RETURN json_build_object(
    'id', v_sale_id,
    'receipt_number', v_receipt_number,
    'total_minor', v_total_minor,
    'profit_minor', v_profit_minor,
    'change_minor', v_change_minor,
    'items_count', v_item_count
  )::jsonb;
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. OUTCOME DOCUMENT RPC FUNCTION (ADMIN ONLY)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_outcome_document(
  p_reason public.outcome_reason,
  p_reason_comment text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_items jsonb DEFAULT '[]'::jsonb,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_existing RECORD;
  v_reason_comment text;
  v_occurred_at timestamptz;
  v_doc_id uuid;
  v_doc_number text;
  v_seq_val bigint;
  v_year text;
  v_total_cost_minor bigint := 0;
  v_item_count integer;
  v_reason_label text;

  -- Iteration variables
  v_item jsonb;
  v_prod_id uuid;
  v_qty integer;
  v_price_minor bigint;
  v_historical_cost_minor bigint;
  v_subtotal_minor bigint;

  -- Array of product IDs for locking
  v_product_ids uuid[];
  v_product_map jsonb := '{}'::jsonb;
  v_product RECORD;
  v_new_stock integer;

  -- Chronology variables
  v_min_future_balance integer;
  v_future_delta_sum integer;
  v_historical_balance_before integer;
  v_historical_balance_after integer;
BEGIN
  -- 1. Security check: admin only (strict role model)
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  -- 2. Idempotency check: if p_id is provided, serialize and check if it already exists
  IF p_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_id::text));

    SELECT o.id, o.document_number, o.total_cost_minor, (SELECT count(*) FROM public.outcome_items WHERE outcome_document_id = o.id)::integer AS items_count
    INTO v_existing
    FROM public.outcome_documents o
    WHERE o.id = p_id;

    IF v_existing.id IS NOT NULL THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'document_number', v_existing.document_number,
        'total_cost_minor', v_existing.total_cost_minor,
        'items_count', v_existing.items_count
      )::jsonb;
    END IF;
  END IF;

  -- 3. Validate input arguments
  v_occurred_at := COALESCE(p_occurred_at, clock_timestamp());
  IF v_occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Validation error: Outcome document date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'Validation error: Outcome reason is required' USING ERRCODE = '22023';
  END IF;

  v_reason_comment := NULLIF(trim(p_reason_comment), '');
  IF p_reason = 'other'::public.outcome_reason AND v_reason_comment IS NULL THEN
    RAISE EXCEPTION 'Validation error: Reason comment is required when reason is "other"' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Validation error: Outcome document must contain at least one line item in a JSON array' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  -- 4. Extract and check product IDs for duplicates
  SELECT array_agg(DISTINCT (item->>'product_id')::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(p_items) AS item;

  IF array_length(v_product_ids, 1) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: Duplicate product in outcome document items' USING ERRCODE = '22023';
  END IF;

  -- 5. Lock affected products in deterministic ascending order to prevent deadlocks
  FOR v_product IN
    SELECT p.id, p.name, p.sku, p.stock, p.purchase_price_minor, p.is_archived
    FROM public.products p
    WHERE p.id = ANY(v_product_ids)
    ORDER BY p.id ASC
    FOR UPDATE
  LOOP
    IF v_product.is_archived THEN
      RAISE EXCEPTION 'Validation error: Cannot write off archived product "%"', v_product.name USING ERRCODE = '22023';
    END IF;
    v_product_map := jsonb_set(
      v_product_map,
      ARRAY[v_product.id::text],
      json_build_object(
        'name', v_product.name,
        'sku', v_product.sku,
        'stock', v_product.stock,
        'purchase_price_minor', v_product.purchase_price_minor
      )::jsonb
    );
  END LOOP;

  IF (SELECT count(*) FROM jsonb_object_keys(v_product_map)) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: One or more products were not found in catalog' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Pass 1: Validate stock, chronology and calculate total cost
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    IF v_qty <= 0 OR v_qty > 100000000 THEN
      RAISE EXCEPTION 'Validation error: Quantity must be positive and <= 100 000 000' USING ERRCODE = '22003';
    END IF;

    IF (v_product_map->v_prod_id::text->>'stock')::integer < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for write-off of product "%" (available: %, requested: %)',
        (v_product_map->v_prod_id::text->>'name'),
        (v_product_map->v_prod_id::text->>'stock')::integer,
        v_qty
        USING ERRCODE = '22023';
    END IF;

    -- Strict Chronology Guard: verify balance at document date and all strictly subsequent movements
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_occurred_at;

    v_historical_balance_before := (v_product_map->v_prod_id::text->>'stock')::integer - v_future_delta_sum;
    v_historical_balance_after := v_historical_balance_before - v_qty;

    IF v_historical_balance_after < 0 THEN
      RAISE EXCEPTION 'Validation error: Write-off at "%" would cause negative historical stock (%) for product "%"',
        v_occurred_at,
        v_historical_balance_after,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    SELECT min(balance_after)
    INTO v_min_future_balance
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_occurred_at;

    IF v_min_future_balance IS NOT NULL AND (v_min_future_balance - v_qty) < 0 THEN
      RAISE EXCEPTION 'Validation error: Write-off at "%" would cause negative subsequent historical stock for product "%"',
        v_occurred_at,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    -- Look up exact effective purchase price from price history at historical document timestamp
    SELECT pph.purchase_price_minor
    INTO v_historical_cost_minor
    FROM public.product_price_history pph
    WHERE pph.product_id = v_prod_id
      AND pph.effective_from <= v_occurred_at
    ORDER BY pph.effective_from DESC, pph.created_at DESC, pph.id DESC
    LIMIT 1;

    -- If no price history entry exists at or before v_occurred_at, pick the earliest known historical price
    IF v_historical_cost_minor IS NULL THEN
      SELECT pph.purchase_price_minor
      INTO v_historical_cost_minor
      FROM public.product_price_history pph
      WHERE pph.product_id = v_prod_id
      ORDER BY pph.effective_from ASC, pph.created_at ASC, pph.id ASC
      LIMIT 1;
    END IF;

    v_price_minor := COALESCE(v_historical_cost_minor, (v_product_map->v_prod_id::text->>'purchase_price_minor')::bigint);
    v_subtotal_minor := v_qty * v_price_minor;
    IF v_subtotal_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Line cost exceeds safe number bounds' USING ERRCODE = '22003';
    END IF;

    v_total_cost_minor := v_total_cost_minor + v_subtotal_minor;
    IF v_total_cost_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Outcome total cost exceeds safe number bounds' USING ERRCODE = '22003';
    END IF;
  END LOOP;

  -- 7. Generate sequential outcome document number without truncation
  v_seq_val := nextval('public.outcome_document_seq');
  v_year := to_char(v_occurred_at, 'YYYY');
  v_doc_number := 'СП-' || v_year || '-' || lpad(v_seq_val::text, GREATEST(3, length(v_seq_val::text)), '0');

  -- Reason human readable label
  v_reason_label := CASE p_reason
    WHEN 'damaged'::public.outcome_reason THEN 'Повреждение'
    WHEN 'defective'::public.outcome_reason THEN 'Брак'
    WHEN 'lost'::public.outcome_reason THEN 'Потеря'
    WHEN 'internal_use'::public.outcome_reason THEN 'Для нужд магазина'
    ELSE 'Другое'
  END;

  -- 8. Insert into public.outcome_documents
  v_doc_id := COALESCE(p_id, gen_random_uuid());
  INSERT INTO public.outcome_documents (
    id,
    document_number,
    occurred_at,
    reason,
    reason_comment,
    total_cost_minor,
    status,
    created_by,
    created_by_name,
    created_at
  ) VALUES (
    v_doc_id,
    v_doc_number,
    v_occurred_at,
    p_reason,
    v_reason_comment,
    v_total_cost_minor,
    'completed'::public.document_status,
    v_profile.profile_id,
    v_profile.full_name,
    clock_timestamp()
  );

  -- 9. Process items: insert outcome_items, update products stock, create movements
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;

    -- Look up exact effective purchase price from price history at historical document timestamp
    SELECT pph.purchase_price_minor
    INTO v_historical_cost_minor
    FROM public.product_price_history pph
    WHERE pph.product_id = v_prod_id
      AND pph.effective_from <= v_occurred_at
    ORDER BY pph.effective_from DESC, pph.created_at DESC, pph.id DESC
    LIMIT 1;

    -- If no price history entry exists at or before v_occurred_at, pick the earliest known historical price
    IF v_historical_cost_minor IS NULL THEN
      SELECT pph.purchase_price_minor
      INTO v_historical_cost_minor
      FROM public.product_price_history pph
      WHERE pph.product_id = v_prod_id
      ORDER BY pph.effective_from ASC, pph.created_at ASC, pph.id ASC
      LIMIT 1;
    END IF;

    v_price_minor := COALESCE(v_historical_cost_minor, (v_product_map->v_prod_id::text->>'purchase_price_minor')::bigint);
    v_subtotal_minor := v_qty * v_price_minor;
    v_new_stock := (v_product_map->v_prod_id::text->>'stock')::integer - v_qty;

    -- Calculate chronologically accurate balance_after at document time
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_occurred_at;

    v_historical_balance_after := ((v_product_map->v_prod_id::text->>'stock')::integer - v_future_delta_sum) - v_qty;

    -- Shift future movements' balance_after by -v_qty
    UPDATE public.stock_movements
    SET balance_after = balance_after - v_qty
    WHERE product_id = v_prod_id AND occurred_at > v_occurred_at;

    -- Insert outcome item
    INSERT INTO public.outcome_items (
      outcome_document_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      quantity,
      purchase_price_snapshot_minor,
      subtotal_minor
    ) VALUES (
      v_doc_id,
      v_prod_id,
      (v_product_map->v_prod_id::text->>'name'),
      (v_product_map->v_prod_id::text->>'sku'),
      v_qty,
      v_price_minor,
      v_subtotal_minor
    );

    -- Update product stock
    UPDATE public.products
    SET
      stock = v_new_stock,
      updated_by = v_profile.profile_id,
      updated_at = clock_timestamp()
    WHERE id = v_prod_id;

    -- Create negative stock movement
    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity_delta,
      balance_after,
      occurred_at,
      reference_id,
      reference_number,
      product_name_snapshot,
      sku_snapshot,
      responsible_id,
      responsible_name,
      note
    ) VALUES (
      v_prod_id,
      'write_off'::public.movement_type,
      -v_qty,
      v_historical_balance_after,
      v_occurred_at,
      v_doc_id,
      v_doc_number,
      (v_product_map->v_prod_id::text->>'name'),
      (v_product_map->v_prod_id::text->>'sku'),
      v_profile.profile_id,
      v_profile.full_name,
      CASE
        WHEN v_reason_comment IS NOT NULL THEN v_reason_label || ' (' || v_reason_comment || ')'
        ELSE v_reason_label
      END
    );
  END LOOP;

  RETURN json_build_object(
    'id', v_doc_id,
    'document_number', v_doc_number,
    'total_cost_minor', v_total_cost_minor,
    'items_count', v_item_count
  )::jsonb;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. ACCESS CONTROL & PERMISSIONS FOR RPC FUNCTIONS & SEQUENCES
-- ----------------------------------------------------------------------------

-- Revoke schema CREATE privileges from PUBLIC, anon, authenticated
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- Revoke all permissions on internal security helper in schema private
REVOKE ALL ON FUNCTION private.get_active_profile(boolean) FROM PUBLIC, anon, authenticated;

-- Revoke all direct permissions on sequence generators
REVOKE ALL ON SEQUENCE public.sale_receipt_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.income_receipt_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.outcome_document_seq FROM PUBLIC, anon, authenticated;

-- Revoke execute from PUBLIC and anon for exact public RPC signatures
REVOKE ALL ON FUNCTION public.rpc_create_product(text, text, text, text, text, bigint, bigint, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_update_product(uuid, text, text, text, text, text, bigint, bigint, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_adjust_product_stock(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_archive_product(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_income_receipt(text, text, timestamptz, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_sale(public.payment_method, public.discount_type, bigint, bigint, timestamptz, text, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_create_outcome_document(public.outcome_reason, text, timestamptz, jsonb, uuid) FROM PUBLIC, anon;

-- Grant EXECUTE exclusively to authenticated staff for exact public RPC signatures
GRANT EXECUTE ON FUNCTION public.rpc_create_product(text, text, text, text, text, bigint, bigint, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_product(uuid, text, text, text, text, text, bigint, bigint, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_adjust_product_stock(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_archive_product(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_income_receipt(text, text, timestamptz, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_sale(public.payment_method, public.discount_type, bigint, bigint, timestamptz, text, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_outcome_document(public.outcome_reason, text, timestamptz, jsonb, uuid) TO authenticated;

-- ============================================================================
-- End of Atomic Business RPC Migration
-- ============================================================================
