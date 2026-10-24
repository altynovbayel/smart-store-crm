-- ============================================================================
-- Migration: RBAC step 8 — admin-only read RPCs for outcome (write-off) documents
-- Version: 20261022100000
-- Name: rbac_outcome_read_rpcs
-- Description:
--   Additive step. Adds read-only RPCs returning write-off documents with their lines, so that
--   a later migration can revoke direct SELECT on public.outcome_documents /
--   public.outcome_items without breaking the Outcome page (outcomeApi.fetchOutcomeDocuments),
--   the act view and the recovery of an unconfirmed write-off
--   (outcomeApi.fetchOutcomeDocumentById: pending banner + 23505 replay).
--
--   1. public.rpc_list_outcome_documents(p_after_occurred_at, p_after_id, p_limit) → jsonb
--      keyset pages, occurred_at DESC, id DESC (the order the page uses today)
--   2. public.rpc_get_outcome_document(p_document_id) → jsonb   ({ document: <document> | null })
--   3. private.outcome_documents_json(uuid[]) — shared JSON builder, SECURITY INVOKER,
--      NOT executable by any client role (runs only inside the two DEFINER RPCs).
--
--   Field contract (explicit lists; exactly what the Outcome UI / recovery reads):
--   document: id, document_number, reason, reason_comment, occurred_at, created_at,
--             created_by_name, total_cost_minor, items
--   line:     id, product_id, product_name_snapshot, sku_snapshot, quantity,
--             purchase_price_snapshot_minor, subtotal_minor      (ordered by id ASC, as the
--             act view shows them today)
--   Never returned: outcome_documents.status (always 'completed', not used by the UI),
--   outcome_documents.created_by (internal profile id), outcome_items.outcome_document_id
--   (implicit), outcome_items.created_at (not used).
--
--   List contract:
--   { "rows": [ <document> ... ],
--     "next_cursor": { "occurred_at": timestamptz, "id": uuid } | null }
--   - p_limit: 1..200 documents (default 200);
--   - line budget: a page stops before the document that would push the page above 2000 lines;
--     the first document is always included whole (a document is never split), so a page holds
--     at most max(2000, lines of one document) lines;
--   - next_cursor is the last returned document and is non-null ONLY when more documents exist
--     (no trailing empty page); pass both values back unchanged;
--   - cursor must be complete (both values) or absent.
--
--   Security:
--   - SECURITY DEFINER (must keep working after REVOKE SELECT), search_path = pg_catalog,
--     pg_temp, every object schema-qualified. The FIRST statement is private.is_admin()
--     (auth.uid(), role = admin, is_active): cashier / inactive / unknown → 42501 before any
--     validation or data access. anon has no EXECUTE.
--   - EXECUTE: rpc_* → authenticated only; private.outcome_documents_json → nobody but the owner.
--
--   Tables, grants and RLS policies are NOT changed (direct SELECT stays open until the
--   frontend is migrated; this migration alone does not protect write-off data).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Shared JSON builder (documents in occurred_at DESC, id DESC order)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.outcome_documents_json(
  p_document_ids uuid[]
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
        'id', d.id,
        'document_number', d.document_number,
        'reason', d.reason,
        'reason_comment', d.reason_comment,
        'occurred_at', d.occurred_at,
        'created_at', d.created_at,
        'created_by_name', d.created_by_name,
        'total_cost_minor', d.total_cost_minor,
        'items', COALESCE(
          (
            SELECT pg_catalog.jsonb_agg(
                     pg_catalog.jsonb_build_object(
                       'id', i.id,
                       'product_id', i.product_id,
                       'product_name_snapshot', i.product_name_snapshot,
                       'sku_snapshot', i.sku_snapshot,
                       'quantity', i.quantity,
                       'purchase_price_snapshot_minor', i.purchase_price_snapshot_minor,
                       'subtotal_minor', i.subtotal_minor
                     )
                     ORDER BY i.id
                   )
            FROM public.outcome_items AS i
            WHERE i.outcome_document_id = d.id
          ),
          '[]'::jsonb
        )
      )
      ORDER BY d.occurred_at DESC, d.id DESC
    ),
    '[]'::jsonb
  )
  FROM public.outcome_documents AS d
  WHERE d.id = ANY (p_document_ids);
$$;

COMMENT ON FUNCTION private.outcome_documents_json(uuid[]) IS
  'Internal: write-off documents with lines as JSON (explicit fields). Not executable by client roles; used by rpc_list_outcome_documents / rpc_get_outcome_document.';

-- ----------------------------------------------------------------------------
-- 2. Document list (Outcome page)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_outcome_documents(
  p_after_occurred_at timestamptz DEFAULT NULL,
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
  v_last_occurred_at timestamptz;
  v_last_id uuid;
BEGIN
  -- 1. Role check first: only an active admin may read write-off documents
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges' USING ERRCODE = '42501';
  END IF;

  -- 2. Arguments
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Validation error: Page size must be between 1 and 200' USING ERRCODE = '22023';
  END IF;

  v_has_cursor := p_after_occurred_at IS NOT NULL;
  IF (p_after_id IS NOT NULL) IS DISTINCT FROM v_has_cursor THEN
    RAISE EXCEPTION 'Validation error: Cursor must contain occurred_at and id together' USING ERRCODE = '22023';
  END IF;

  -- 3. Page: up to p_limit documents after the cursor, cut by the 2000-line budget
  --    (one extra candidate tells whether more documents exist)
  WITH candidates AS (
    SELECT d.id, d.occurred_at
    FROM public.outcome_documents AS d
    WHERE NOT v_has_cursor
       OR (d.occurred_at, d.id) < (p_after_occurred_at, p_after_id)
    ORDER BY d.occurred_at DESC, d.id DESC
    LIMIT p_limit + 1
  ),
  ranked AS (
    SELECT
      c.id,
      c.occurred_at,
      pg_catalog.row_number() OVER w AS rn,
      pg_catalog.sum(
        (SELECT pg_catalog.count(*) FROM public.outcome_items AS i WHERE i.outcome_document_id = c.id)
      ) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS lines_so_far
    FROM candidates AS c
    WINDOW w AS (ORDER BY c.occurred_at DESC, c.id DESC)
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

  SELECT d.occurred_at, d.id
  INTO v_last_occurred_at, v_last_id
  FROM public.outcome_documents AS d
  WHERE d.id = v_ids[pg_catalog.cardinality(v_ids)];

  RETURN pg_catalog.jsonb_build_object(
    'rows', private.outcome_documents_json(v_ids),
    'next_cursor',
      CASE
        WHEN v_candidates > pg_catalog.cardinality(v_ids) THEN
          pg_catalog.jsonb_build_object('occurred_at', v_last_occurred_at, 'id', v_last_id)
        ELSE NULL
      END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_list_outcome_documents(timestamptz, uuid, integer) IS
  'Admin only (42501 otherwise, checked first). Write-off documents with lines, keyset on occurred_at, id DESC; <= p_limit (1..200) documents and <= 2000 lines per page (a document is never split). next_cursor only when more documents exist.';

-- ----------------------------------------------------------------------------
-- 3. One document (act view / recovery of an unconfirmed write-off)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_outcome_document(
  p_document_id uuid
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

  IF p_document_id IS NULL THEN
    RAISE EXCEPTION 'Validation error: Document id is required' USING ERRCODE = '22023';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'document', private.outcome_documents_json(ARRAY[p_document_id]) -> 0
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_outcome_document(uuid) IS
  'Admin only (42501 otherwise, checked first). One write-off document with lines, or document = null when it does not exist (absence does not prove an unconfirmed write-off failed).';

-- ----------------------------------------------------------------------------
-- 4. EXECUTE
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION private.outcome_documents_json(uuid[]) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rpc_list_outcome_documents(timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_outcome_document(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_outcome_documents(timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_outcome_document(uuid) TO authenticated;
