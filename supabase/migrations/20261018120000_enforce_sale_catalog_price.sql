-- ============================================================================
-- Migration: Enforce current catalog selling price for sale line items
-- Version: 20261018120000
-- Name: enforce_sale_catalog_price
-- Description:
--   public.rpc_create_sale accepts an optional client-provided `unit_price_minor`
--   per line item and stores it as sale_items.selling_price_snapshot_minor without
--   comparing it with the catalog. This migration adds a server-side invariant:
--
--     A sale line can only be recorded at the CURRENT products.selling_price_minor.
--     Price reductions must be expressed through item / receipt discounts.
--
--   Implementation: a BEFORE INSERT trigger on public.sale_items.
--   - rpc_create_sale is not modified (signature, idempotency and grants unchanged).
--   - Idempotent replays of an existing p_id return the stored receipt BEFORE any
--     sale_items insert, so the new check never affects already conducted sales.
--   - rpc_create_sale locks the affected products FOR UPDATE before inserting items,
--     so the compared catalog price is the locked, current value.
--   - Raising inside the trigger aborts the whole RPC transaction: the sale header,
--     all items, stock updates and stock movements are rolled back together.
--   - Existing sale_items rows are not touched (INSERT-only trigger, no backfill).
--
--   Error contract:
--     SQLSTATE 'SSP01' (custom class "SS" — Smart Store), HTTP 400 via PostgREST.
--     MESSAGE  'Price changed: Selling price of product "<name>" changed (expected: <minor>, current: <minor>)'
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Trigger function (schema private, not callable through the Data API)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.enforce_sale_item_catalog_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_current_price_minor bigint;
  v_product_name text;
BEGIN
  SELECT p.selling_price_minor, p.name
  INTO v_current_price_minor, v_product_name
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Validation error: One or more products were not found in catalog'
      USING ERRCODE = 'P0002';
  END IF;

  IF NEW.selling_price_snapshot_minor IS DISTINCT FROM v_current_price_minor THEN
    RAISE EXCEPTION 'Price changed: Selling price of product "%" changed (expected: %, current: %)',
      v_product_name,
      NEW.selling_price_snapshot_minor,
      v_current_price_minor
      USING
        ERRCODE = 'SSP01',
        HINT = 'Reload the catalog and confirm the new total before retrying the sale.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.enforce_sale_item_catalog_price() IS
  'BEFORE INSERT trigger on public.sale_items: a sale line must use the current products.selling_price_minor (SQLSTATE SSP01 otherwise).';

-- Trigger functions are never invoked directly; keep them unreachable for API roles
REVOKE ALL ON FUNCTION private.enforce_sale_item_catalog_price() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Trigger (idempotent re-creation)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS enforce_sale_item_catalog_price ON public.sale_items;

CREATE TRIGGER enforce_sale_item_catalog_price
BEFORE INSERT ON public.sale_items
FOR EACH ROW
EXECUTE FUNCTION private.enforce_sale_item_catalog_price();

-- ============================================================================
-- End of Migration
-- ============================================================================
