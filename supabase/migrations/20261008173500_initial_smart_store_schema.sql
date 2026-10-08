-- ============================================================================
-- Migration: Initial Schema for Smart Store CRM
-- Version: 20261008173500
-- Description:
--   - Core PostgreSQL enums
--   - Helper security functions in schema `private`
--   - Tables: profiles, products, sales, sale_items, income_receipts,
--     income_items, outcome_documents, outcome_items, stock_movements
--   - Strict monetary bounds (bigint minor units / тыйыны) within JS MAX_SAFE_INTEGER
--   - Accounting integrity check constraints & non-cascade restrictions
--   - Triggers for updated_at and auth.users -> profiles provisioning
--   - Strict privilege revocation and Row Level Security (RLS)
--   - Read-only policies for active staff; direct CUD is blocked
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SCHEMAS & EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 2. POSTGRESQL ENUM TYPES
-- ----------------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM (
  'admin',
  'cashier'
);

CREATE TYPE public.payment_method AS ENUM (
  'cash',
  'card',
  'transfer'
);

CREATE TYPE public.discount_type AS ENUM (
  'none',
  'fixed',
  'percent'
);

CREATE TYPE public.movement_type AS ENUM (
  'opening_balance',
  'income',
  'sale',
  'write_off',
  'inventory_adjustment'
);

CREATE TYPE public.outcome_reason AS ENUM (
  'damaged',
  'defective',
  'lost',
  'internal_use',
  'other'
);

CREATE TYPE public.document_status AS ENUM (
  'completed'
);

-- ----------------------------------------------------------------------------
-- 3. UPDATED_AT TRIGGER FUNCTION
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. PROFILES TABLE & AUTH USER TRIGGER
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'cashier'::public.app_role,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_full_name_check CHECK (length(trim(full_name)) > 0)
);

CREATE INDEX profiles_role_idx ON public.profiles (role);
CREATE INDEX profiles_is_active_idx ON public.profiles (is_active);

CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Trigger to automatically create profile upon auth.users signup
-- NOTE: Always defaults role to 'cashier' and is_active to false.
-- Profile activation and admin promotion require explicit action by administrator in SQL/Dashboard.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_full_name text;
BEGIN
  v_full_name := trim(COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'Сотрудник'
  ));

  IF length(v_full_name) = 0 THEN
    v_full_name := 'Сотрудник';
  END IF;

  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES (NEW.id, v_full_name, 'cashier'::public.app_role, false)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. PRIVATE HELPER FUNCTIONS FOR SECURITY & RLS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_user_role()
RETURNS public.app_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  SELECT p.role INTO v_role
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid())
    AND p.is_active = true;

  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_active_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_active = true
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'admin'::public.app_role
      AND p.is_active = true
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. PRODUCTS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  barcode text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  category_label text NOT NULL,
  description text,
  purchase_price_minor bigint NOT NULL,
  selling_price_minor bigint NOT NULL,
  stock integer NOT NULL DEFAULT 0,
  min_stock_threshold integer NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT products_sku_not_empty CHECK (length(trim(sku)) > 0),
  CONSTRAINT products_barcode_not_empty CHECK (length(trim(barcode)) > 0),
  CONSTRAINT products_category_not_empty CHECK (length(trim(category)) > 0),
  CONSTRAINT products_category_label_not_empty CHECK (length(trim(category_label)) > 0),
  CONSTRAINT products_stock_range CHECK (stock >= 0 AND stock <= 100000000),
  CONSTRAINT products_min_stock_range CHECK (min_stock_threshold >= 0 AND min_stock_threshold <= 100000000),
  CONSTRAINT products_purchase_price_range CHECK (purchase_price_minor >= 0 AND purchase_price_minor <= 10000000000),
  CONSTRAINT products_selling_price_range CHECK (selling_price_minor >= 0 AND selling_price_minor <= 10000000000)
);

CREATE UNIQUE INDEX products_sku_unique_idx ON public.products (lower(trim(sku)));
CREATE UNIQUE INDEX products_barcode_unique_idx ON public.products (trim(barcode));

CREATE INDEX products_name_idx ON public.products (name);
CREATE INDEX products_category_idx ON public.products (category);
CREATE INDEX products_is_archived_idx ON public.products (is_archived);
CREATE INDEX products_stock_idx ON public.products (stock);

CREATE TRIGGER set_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. SALES & SALE_ITEMS TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  sold_at timestamptz NOT NULL,
  payment_method public.payment_method NOT NULL,
  subtotal_minor bigint NOT NULL,
  item_discount_total_minor bigint NOT NULL,
  receipt_discount_type public.discount_type NOT NULL,
  receipt_discount_value bigint NOT NULL,
  receipt_discount_minor bigint NOT NULL,
  total_discount_minor bigint NOT NULL,
  total_minor bigint NOT NULL,
  received_minor bigint,
  change_minor bigint,
  profit_minor bigint NOT NULL,
  status public.document_status NOT NULL DEFAULT 'completed'::public.document_status,
  comment text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_receipt_number_not_empty CHECK (length(trim(receipt_number)) > 0),
  CONSTRAINT sales_created_by_name_not_empty CHECK (length(trim(created_by_name)) > 0),
  CONSTRAINT sales_subtotal_range CHECK (subtotal_minor >= 0 AND subtotal_minor <= 9007199254740991),
  CONSTRAINT sales_item_discount_total_range CHECK (item_discount_total_minor >= 0 AND item_discount_total_minor <= subtotal_minor),
  CONSTRAINT sales_receipt_discount_value_positive CHECK (receipt_discount_value >= 0),
  CONSTRAINT sales_receipt_discount_percent_bound CHECK (receipt_discount_type != 'percent'::public.discount_type OR receipt_discount_value <= 10000),
  CONSTRAINT sales_receipt_discount_none_zero CHECK (receipt_discount_type != 'none'::public.discount_type OR (receipt_discount_value = 0 AND receipt_discount_minor = 0)),
  CONSTRAINT sales_receipt_discount_minor_bound CHECK (receipt_discount_minor >= 0 AND receipt_discount_minor <= (subtotal_minor - item_discount_total_minor)),
  CONSTRAINT sales_total_discount_sum CHECK (total_discount_minor = item_discount_total_minor + receipt_discount_minor),
  CONSTRAINT sales_total_minor_calc CHECK (total_minor = subtotal_minor - total_discount_minor AND total_minor >= 0 AND total_minor <= 9007199254740991),
  CONSTRAINT sales_received_minor_range CHECK (received_minor IS NULL OR (received_minor >= 0 AND received_minor <= 9007199254740991)),
  CONSTRAINT sales_change_minor_range CHECK (change_minor IS NULL OR (change_minor >= 0 AND change_minor <= 9007199254740991)),
  CONSTRAINT sales_cash_payment_consistency CHECK (
    (payment_method = 'cash'::public.payment_method AND received_minor IS NOT NULL AND change_minor IS NOT NULL AND received_minor >= total_minor AND change_minor = (received_minor - total_minor))
    OR
    (payment_method != 'cash'::public.payment_method AND received_minor IS NULL AND change_minor IS NULL)
  )
);

CREATE INDEX sales_sold_at_idx ON public.sales (sold_at DESC);
CREATE INDEX sales_receipt_number_idx ON public.sales (receipt_number);
CREATE INDEX sales_payment_method_idx ON public.sales (payment_method);
CREATE INDEX sales_created_by_idx ON public.sales (created_by);

CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  barcode_snapshot text,
  quantity integer NOT NULL,
  purchase_price_snapshot_minor bigint NOT NULL,
  selling_price_snapshot_minor bigint NOT NULL,
  discount_type public.discount_type NOT NULL,
  discount_value bigint NOT NULL,
  gross_minor bigint NOT NULL,
  item_discount_minor bigint NOT NULL,
  receipt_discount_allocated_minor bigint NOT NULL,
  net_total_minor bigint NOT NULL,
  cost_total_minor bigint NOT NULL,
  profit_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_items_product_name_not_empty CHECK (length(trim(product_name_snapshot)) > 0),
  CONSTRAINT sale_items_sku_not_empty CHECK (length(trim(sku_snapshot)) > 0),
  CONSTRAINT sale_items_quantity_range CHECK (quantity > 0 AND quantity <= 100000000),
  CONSTRAINT sale_items_purchase_price_range CHECK (purchase_price_snapshot_minor >= 0 AND purchase_price_snapshot_minor <= 10000000000),
  CONSTRAINT sale_items_selling_price_range CHECK (selling_price_snapshot_minor >= 0 AND selling_price_snapshot_minor <= 10000000000),
  CONSTRAINT sale_items_discount_value_positive CHECK (discount_value >= 0),
  CONSTRAINT sale_items_discount_percent_bound CHECK (discount_type != 'percent'::public.discount_type OR discount_value <= 10000),
  CONSTRAINT sale_items_discount_none_zero CHECK (discount_type != 'none'::public.discount_type OR (discount_value = 0 AND item_discount_minor = 0)),
  CONSTRAINT sale_items_gross_calc CHECK (gross_minor = quantity * selling_price_snapshot_minor),
  CONSTRAINT sale_items_item_discount_bound CHECK (item_discount_minor >= 0 AND item_discount_minor <= gross_minor),
  CONSTRAINT sale_items_receipt_disc_alloc_bound CHECK (receipt_discount_allocated_minor >= 0 AND receipt_discount_allocated_minor <= (gross_minor - item_discount_minor)),
  CONSTRAINT sale_items_net_total_calc CHECK (net_total_minor = gross_minor - item_discount_minor - receipt_discount_allocated_minor),
  CONSTRAINT sale_items_cost_total_calc CHECK (cost_total_minor = quantity * purchase_price_snapshot_minor),
  CONSTRAINT sale_items_profit_calc CHECK (profit_minor = net_total_minor - cost_total_minor),
  CONSTRAINT sale_items_unique_product_per_sale UNIQUE (sale_id, product_id)
);

CREATE INDEX sale_items_sale_id_idx ON public.sale_items (sale_id);
CREATE INDEX sale_items_product_id_idx ON public.sale_items (product_id);

-- ----------------------------------------------------------------------------
-- 8. INCOME_RECEIPTS & INCOME_ITEMS TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE public.income_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL UNIQUE,
  supplier text NOT NULL,
  supplier_document_number text,
  received_at timestamptz NOT NULL,
  total_minor bigint NOT NULL,
  status public.document_status NOT NULL DEFAULT 'completed'::public.document_status,
  comment text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_receipts_number_not_empty CHECK (length(trim(receipt_number)) > 0),
  CONSTRAINT income_receipts_supplier_not_empty CHECK (length(trim(supplier)) > 0),
  CONSTRAINT income_receipts_created_by_name_not_empty CHECK (length(trim(created_by_name)) > 0),
  CONSTRAINT income_receipts_total_range CHECK (total_minor >= 0 AND total_minor <= 9007199254740991)
);

CREATE INDEX income_receipts_received_at_idx ON public.income_receipts (received_at DESC);
CREATE INDEX income_receipts_receipt_number_idx ON public.income_receipts (receipt_number);
CREATE INDEX income_receipts_created_by_idx ON public.income_receipts (created_by);

CREATE TABLE public.income_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  income_receipt_id uuid NOT NULL REFERENCES public.income_receipts(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity integer NOT NULL,
  purchase_price_minor bigint NOT NULL,
  subtotal_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT income_items_product_name_not_empty CHECK (length(trim(product_name_snapshot)) > 0),
  CONSTRAINT income_items_sku_not_empty CHECK (length(trim(sku_snapshot)) > 0),
  CONSTRAINT income_items_quantity_range CHECK (quantity > 0 AND quantity <= 100000000),
  CONSTRAINT income_items_price_range CHECK (purchase_price_minor >= 0 AND purchase_price_minor <= 10000000000),
  CONSTRAINT income_items_subtotal_calc CHECK (subtotal_minor = quantity * purchase_price_minor AND subtotal_minor <= 9007199254740991),
  CONSTRAINT income_items_unique_product_per_receipt UNIQUE (income_receipt_id, product_id)
);

CREATE INDEX income_items_receipt_id_idx ON public.income_items (income_receipt_id);
CREATE INDEX income_items_product_id_idx ON public.income_items (product_id);

-- ----------------------------------------------------------------------------
-- 9. OUTCOME_DOCUMENTS & OUTCOME_ITEMS TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE public.outcome_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  reason public.outcome_reason NOT NULL,
  reason_comment text,
  total_cost_minor bigint NOT NULL,
  status public.document_status NOT NULL DEFAULT 'completed'::public.document_status,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outcome_docs_number_not_empty CHECK (length(trim(document_number)) > 0),
  CONSTRAINT outcome_docs_created_by_name_not_empty CHECK (length(trim(created_by_name)) > 0),
  CONSTRAINT outcome_docs_total_cost_range CHECK (total_cost_minor >= 0 AND total_cost_minor <= 9007199254740991),
  CONSTRAINT outcome_docs_other_reason_comment CHECK (
    reason != 'other'::public.outcome_reason OR (reason_comment IS NOT NULL AND length(trim(reason_comment)) > 0)
  )
);

CREATE INDEX outcome_docs_occurred_at_idx ON public.outcome_documents (occurred_at DESC);
CREATE INDEX outcome_docs_number_idx ON public.outcome_documents (document_number);
CREATE INDEX outcome_docs_created_by_idx ON public.outcome_documents (created_by);

CREATE TABLE public.outcome_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_document_id uuid NOT NULL REFERENCES public.outcome_documents(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  product_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity integer NOT NULL,
  purchase_price_snapshot_minor bigint NOT NULL,
  subtotal_minor bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outcome_items_product_name_not_empty CHECK (length(trim(product_name_snapshot)) > 0),
  CONSTRAINT outcome_items_sku_not_empty CHECK (length(trim(sku_snapshot)) > 0),
  CONSTRAINT outcome_items_quantity_range CHECK (quantity > 0 AND quantity <= 100000000),
  CONSTRAINT outcome_items_price_range CHECK (purchase_price_snapshot_minor >= 0 AND purchase_price_snapshot_minor <= 10000000000),
  CONSTRAINT outcome_items_subtotal_calc CHECK (subtotal_minor = quantity * purchase_price_snapshot_minor AND subtotal_minor <= 9007199254740991),
  CONSTRAINT outcome_items_unique_product_per_doc UNIQUE (outcome_document_id, product_id)
);

CREATE INDEX outcome_items_doc_id_idx ON public.outcome_items (outcome_document_id);
CREATE INDEX outcome_items_product_id_idx ON public.outcome_items (product_id);

-- ----------------------------------------------------------------------------
-- 10. STOCK_MOVEMENTS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type public.movement_type NOT NULL,
  quantity_delta integer NOT NULL,
  balance_after integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  reference_id uuid,
  reference_number text,
  product_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  responsible_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  responsible_name text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_delta_non_zero CHECK (quantity_delta != 0 AND quantity_delta >= -100000000 AND quantity_delta <= 100000000),
  CONSTRAINT stock_movements_balance_after_range CHECK (balance_after >= 0 AND balance_after <= 100000000),
  CONSTRAINT stock_movements_prod_name_not_empty CHECK (length(trim(product_name_snapshot)) > 0),
  CONSTRAINT stock_movements_sku_not_empty CHECK (length(trim(sku_snapshot)) > 0),
  CONSTRAINT stock_movements_resp_name_not_empty CHECK (length(trim(responsible_name)) > 0),
  CONSTRAINT stock_movements_positive_delta CHECK (
    movement_type NOT IN ('opening_balance'::public.movement_type, 'income'::public.movement_type) OR quantity_delta > 0
  ),
  CONSTRAINT stock_movements_negative_delta CHECK (
    movement_type NOT IN ('sale'::public.movement_type, 'write_off'::public.movement_type) OR quantity_delta < 0
  )
);

CREATE INDEX stock_movements_prod_occurred_idx ON public.stock_movements (product_id, occurred_at DESC);
CREATE INDEX stock_movements_movement_type_idx ON public.stock_movements (movement_type);
CREATE INDEX stock_movements_reference_id_idx ON public.stock_movements (reference_id);
CREATE INDEX stock_movements_occurred_at_idx ON public.stock_movements (occurred_at DESC);

-- ----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY (RLS) & ACCESS CONTROL
-- ----------------------------------------------------------------------------

-- Enable RLS on all public tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Revoke all default table, function, and sequence privileges from authenticated, anon, and public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated, anon, public;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated, anon, public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated, anon, public;
REVOKE ALL ON SCHEMA private FROM authenticated, anon, public;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated, anon, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated, anon, public;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated, anon, public;

-- Grant minimal necessary schema usage to authenticated
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Grant SELECT ONLY to authenticated staff
GRANT SELECT ON public.profiles TO authenticated;
GRANT SELECT ON public.products TO authenticated;
GRANT SELECT ON public.sales TO authenticated;
GRANT SELECT ON public.sale_items TO authenticated;
GRANT SELECT ON public.income_receipts TO authenticated;
GRANT SELECT ON public.income_items TO authenticated;
GRANT SELECT ON public.outcome_documents TO authenticated;
GRANT SELECT ON public.outcome_items TO authenticated;
GRANT SELECT ON public.stock_movements TO authenticated;

-- Grant execute on security helper functions
GRANT EXECUTE ON FUNCTION private.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_active_user() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- RLS Policies for profiles (non-recursive via private schema)
CREATE POLICY profiles_select_own ON public.profiles
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_select_admin ON public.profiles
FOR SELECT
TO authenticated
USING ((SELECT private.is_admin()) = true);

-- RLS Policies for business tables (read-only for active staff; direct CUD is blocked)
CREATE POLICY products_select_active_staff ON public.products
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY sales_select_active_staff ON public.sales
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY sale_items_select_active_staff ON public.sale_items
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY income_receipts_select_active_staff ON public.income_receipts
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY income_items_select_active_staff ON public.income_items
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY outcome_docs_select_active_staff ON public.outcome_documents
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY outcome_items_select_active_staff ON public.outcome_items
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

CREATE POLICY stock_movements_select_active_staff ON public.stock_movements
FOR SELECT
TO authenticated
USING ((SELECT private.is_active_user()) = true);

-- ============================================================================
-- End of Initial Schema Migration
-- ============================================================================
