-- ============================================================================
-- Migration: RBAC step 6 — admin-only read RPCs for income receipts
-- Version: 20261021120000
-- Name: rbac_income_read_rpcs
-- Description:
--   Additive step. Adds read-only RPCs returning income receipts with their lines, so that a
--   later migration can revoke direct SELECT on public.income_receipts / public.income_items
--   without breaking the Income page (incomeApi.fetchIncomeReceipts) and the recovery of an
--   unconfirmed receipt (incomeApi.fetchIncomeReceiptById: pending banner + 23505 replay).
--
--   1. public.rpc_list_income_receipts(p_after_received_at, p_after_id, p_limit) → jsonb
--      keyset pages, received_at DESC, id DESC (the order the page uses today)
--   2. public.rpc_get_income_receipt(p_receipt_id) → jsonb   ({ receipt: <receipt> | null })
--   3. private.income_receipts_json(uuid[]) — shared JSON builder, SECURITY INVOKER,
--      NOT executable by any client role (runs only inside the two DEFINER RPCs).
--
--   Field contract (explicit lists; exactly what the Income UI / recovery reads):
--   receipt: id, receipt_number, supplier, supplier_document_number, received_at, created_at,
--            created_by_name, comment, total_minor, items
--   line:    id, product_id, product_name_snapshot, sku_snapshot, quantity,
--            purchase_price_minor, subtotal_minor        (ordered by created_at, id ASC)
--   Never returned: income_receipts.status (always 'completed', not used by the UI),
--   income_receipts.created_by (internal profile id), income_items.income_receipt_id
--   (implicit), income_items.created_at (only used for ordering, done on the server).
--
--   List contract:
--   { "rows": [ <receipt> ... ],
--     "next_cursor": { "received_at": timestamptz, "id": uuid } | null }
--   - p_limit: 1..200 receipts (default 200);
--   - line budget: a page stops before the receipt that would push the page above 2000 lines;
--     the first receipt is always included whole (a receipt is never split), so a page holds at
--     most max(2000, lines of one receipt) lines;
--   - next_cursor is the last returned receipt and is non-null ONLY when more receipts exist
--     (no trailing empty page); pass both values back unchanged;
--   - cursor must be complete (both values) or absent.
--
--   Security:
--   - SECURITY DEFINER (must keep working after REVOKE SELECT), search_path = pg_catalog,
--     pg_temp, every object schema-qualified. The FIRST statement is private.is_admin()
--     (auth.uid(), role = admin, is_active): cashier / inactive / unknown → 42501 before any
--     validation or data access. anon has no EXECUTE.
--   - EXECUTE: rpc_* → authenticated only; private.income_receipts_json → nobody but the owner.
--
--   Tables, grants and RLS policies are NOT changed (direct SELECT stays open until the
--   frontend is migrated; this migration alone does not protect income data).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Shared JSON builder (receipts in received_at DESC, id DESC order)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.income_receipts_json(
  p_receipt_ids uuid[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', r.id,
        'receipt_number', r.receipt_number,
        'supplier', r.supplier,
        'supplier_document_number', r.supplier_document_number,
        'received_at', r.received_at,
        'created_at', r.created_at,
        'created_by_name', r.created_by_name,
        'comment', r.comment,
        'total_minor', r.total_minor,
        'items', COALESCE(
          (
            SELECT pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object(
                       'id', i.id,
                       'product_id', i.product_id,
                       'product_name_snapshot', i.product_name_snapshot,
                       'sku_snapshot', i.sku_snapshot,
                       'quantity', i.quantity,
                       'purchase_price_minor', i.purchase_price_minor,
                       'subtotal_minor', i.subtotal_minor
                     )
                     ORDER BY i.created_at, i.id
                   )
            FROM public.income_items AS i
            WHERE i.income_receipt_id = r.id
          ),
          '[]'::jsonb
        )
      )
      ORDER BY r.received_at DESC, r.id DESC
    ),
    '[]'::jsonb
  )
  FROM public.income_receipts AS r
  WHERE r.id = ANY (p_receipt_ids);
$$;

COMMENT ON FUNCTION private.income_receipts_json(uuid[]) IS
  'Internal: income receipts with lines as JSON (explicit fields). Not executable by client roles; used by rpc_list_income_receipts / rpc_get_income_receipt.';

-- ----------------------------------------------------------------------------
-- 2. Receipt list (Income page)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_income_receipts(
  p_after_received_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_has_cursor boolean;
  v_ids uuid[];
  v_candidates integer;
  v_last_received_at timestamptz;
  v_last_id uuid;
BEGIN
  -- 1. Role check first: only an active admin may read income documents
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges' USING ERRCODE = '42501';
  END IF;

  -- 2. Arguments
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Validation error: Page size must be between 1 and 200' USING ERRCODE = '22023';
  END IF;

  v_has_cursor := p_after_received_at IS NOT NULL;
  IF (p_after_id IS NOT NULL) IS DISTINCT FROM v_has_cursor THEN
    RAISE EXCEPTION 'Validation error: Cursor must contain received_at and id together' USING ERRCODE = '22023';
  END IF;

  -- 3. Page: up to p_limit receipts after the cursor, cut by the 2000-line budget
  --    (one extra candidate tells whether more receipts exist)
  WITH candidates AS (
    SELECT r.id, r.received_at
    FROM public.income_receipts AS r
    WHERE NOT v_has_cursor
       OR (r.received_at, r.id) < (p_after_received_at, p_after_id)
    ORDER BY r.received_at DESC, r.id DESC
    LIMIT p_limit + 1
  ),
  ranked AS (
    SELECT
      c.id,
      c.received_at,
      pg_catalog.row_number() OVER w AS rn,
      pg_catalog.sum(
        (SELECT pg_catalog.count(*) FROM public.income_items AS i WHERE i.income_receipt_id = c.id)
      ) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS lines_so_far
    FROM candidates AS c
    WINDOW w AS (ORDER BY c.received_at DESC, c.id DESC)
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.array_agg(rk.id ORDER BY rk.rn) FILTER (
      WHERE rk.rn <= p_limit AND (rk.rn = 1 OR rk.lines_so_far <= 2000)
    )
  INTO v_candidates, v_ids
  FROM ranked AS rk;

  IF v_ids IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('rows', '[]'::jsonb, 'next_cursor', NULL);
  END IF;

  SELECT r.received_at, r.id
  INTO v_last_received_at, v_last_id
  FROM public.income_receipts AS r
  WHERE r.id = v_ids[pg_catalog.cardinality(v_ids)];

  RETURN pg_catalog.jsonb_build_object(
    'rows', private.income_receipts_json(v_ids),
    'next_cursor',
      CASE
        WHEN v_candidates > pg_catalog.cardinality(v_ids) THEN
          pg_catalog.jsonb_build_object('received_at', v_last_received_at, 'id', v_last_id)
        ELSE NULL
      END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_list_income_receipts(timestamptz, uuid, integer) IS
  'Admin only (42501 otherwise, checked first). Income receipts with lines, keyset on received_at, id DESC; <= p_limit (1..200) receipts and <= 2000 lines per page (a receipt is never split). next_cursor only when more receipts exist.';

-- ----------------------------------------------------------------------------
-- 3. One receipt (recovery of an unconfirmed receipt)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_income_receipt(
  p_receipt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges' USING ERRCODE = '42501';
  END IF;

  IF p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'Validation error: Receipt id is required' USING ERRCODE = '22023';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'receipt', private.income_receipts_json(ARRAY[p_receipt_id]) -> 0
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_income_receipt(uuid) IS
  'Admin only (42501 otherwise, checked first). One income receipt with lines, or receipt = null when it does not exist (absence does not prove an unconfirmed creation failed).';

-- ----------------------------------------------------------------------------
-- 4. EXECUTE
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.income_receipts_json(uuid[]) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rpc_list_income_receipts(timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_income_receipt(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_income_receipts(timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_income_receipt(uuid) TO authenticated;
