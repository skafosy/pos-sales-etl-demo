-- ===========================================================================
-- Views — business rules live here, not in the importer.
-- ===========================================================================

-- Sales with branch / channel / supplier resolved.
CREATE OR REPLACE VIEW v_sales AS
SELECT s.id,
       s.company,
       s.bill_no,
       s.sales_date,
       s.member_code,
       s.barcode,
       s.qty,
       s.amount,
       COALESCE(bp.branch, 'HQ')                                         AS branch,
       CASE WHEN wm.member_code IS NOT NULL THEN 'wholesale' ELSE 'retail' END AS channel,
       -- Rows with no supplier (services, unknown barcodes) are KEPT in an
       -- explicit bucket so report totals always tie back to raw sales.
       COALESCE(p.supplier_code, '(unassigned)')                          AS supplier_code
FROM sales_line s
LEFT JOIN branch_prefix bp
       ON bp.company = s.company
      AND bp.prefix  = LEFT(s.bill_no, 4)
      AND s.sales_date >= bp.valid_from
      AND (bp.valid_to IS NULL OR s.sales_date < bp.valid_to)
LEFT JOIN wholesale_members wm ON wm.member_code = s.member_code
LEFT JOIN products p           ON p.barcode = s.barcode;


-- Purchases flattened, with location (where the stock was received).
CREATE OR REPLACE VIEW v_purchase AS
SELECT h.company,
       h.doc_no,
       h.doc_date,
       COALESCE(NULLIF(h.supplier_code, ''), '(unassigned)') AS supplier_code,
       l.barcode,
       l.product_name,
       l.unit,
       l.qty,
       l.free_qty,
       l.amount,
       COALESCE(l.location, '(none)')                       AS location
FROM purchase_header h
JOIN purchase_line   l ON l.company = h.company AND l.doc_no = h.doc_no;


-- Buy vs sell per company x month x supplier group.
DROP MATERIALIZED VIEW IF EXISTS mv_buy_sell_monthly CASCADE;  -- also drops v_reconcile, recreated below
CREATE MATERIALIZED VIEW mv_buy_sell_monthly AS
WITH buy AS (
    SELECT company,
           date_trunc('month', doc_date)::date AS month,
           supplier_code,
           SUM(amount)         AS buy_amt,
           SUM(qty + free_qty) AS buy_qty
    FROM v_purchase
    GROUP BY 1, 2, 3
),
sell AS (
    SELECT company,
           date_trunc('month', sales_date)::date AS month,
           supplier_code,
           SUM(amount) FILTER (WHERE channel = 'retail')    AS sell_retail,
           SUM(amount) FILTER (WHERE channel = 'wholesale') AS sell_wholesale,
           SUM(amount)                                      AS sell_total,
           SUM(qty)                                         AS sell_qty
    FROM v_sales
    GROUP BY 1, 2, 3
),
per_code AS (
    SELECT COALESCE(b.company, s.company)             AS company,
           COALESCE(b.month, s.month)                 AS month,
           COALESCE(b.supplier_code, s.supplier_code) AS supplier_code,
           COALESCE(b.buy_amt, 0)        AS buy_amt,
           COALESCE(b.buy_qty, 0)        AS buy_qty,
           COALESCE(s.sell_retail, 0)    AS sell_retail,
           COALESCE(s.sell_wholesale, 0) AS sell_wholesale,
           COALESCE(s.sell_total, 0)     AS sell_total,
           COALESCE(s.sell_qty, 0)       AS sell_qty
    FROM buy b
    FULL OUTER JOIN sell s
      ON s.company = b.company AND s.month = b.month AND s.supplier_code = b.supplier_code
)
SELECT pc.company,
       pc.month,
       COALESCE(sa.canonical_code, pc.supplier_code)                AS sup_group_code,
       MAX(COALESCE(sa.canonical_name, sp.name, pc.supplier_code))  AS sup_group_name,
       -- EXISTS instead of JOIN: a supplier flagged under both its own code and
       -- its group code must not be counted twice.
       bool_or(EXISTS (SELECT 1 FROM supplier_flags f
                       WHERE f.is_affiliate
                         AND f.code IN (pc.supplier_code, sa.canonical_code))) AS is_affiliate,
       SUM(pc.buy_amt)::numeric(16,2)        AS buy_amt,
       SUM(pc.buy_qty)::numeric(16,3)        AS buy_qty,
       SUM(pc.sell_retail)::numeric(16,2)    AS sell_retail,
       SUM(pc.sell_wholesale)::numeric(16,2) AS sell_wholesale,
       SUM(pc.sell_total)::numeric(16,2)     AS sell_total,
       SUM(pc.sell_qty)::numeric(16,3)       AS sell_qty,
       CASE WHEN SUM(pc.buy_amt) > 0
            THEN ROUND(100.0 * SUM(pc.sell_total) / SUM(pc.buy_amt), 1) END AS cover_pct
FROM per_code pc
LEFT JOIN supplier_alias sa ON sa.code = pc.supplier_code
LEFT JOIN suppliers      sp ON sp.code = pc.supplier_code
GROUP BY 1, 2, 3;

-- Natural-key unique index: required for REFRESH ... CONCURRENTLY (readers are
-- never blocked) and doubles as a guard against duplicated rows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_buy_sell_monthly
    ON mv_buy_sell_monthly (company, month, sup_group_code);


-- Reconciliation: report totals must equal raw totals, per company x month.
CREATE OR REPLACE VIEW v_reconcile AS
WITH raw_s AS (
    SELECT company, date_trunc('month', sales_date)::date AS month, SUM(amount) AS raw_sales
    FROM sales_line GROUP BY 1, 2
),
raw_p AS (
    SELECT h.company, date_trunc('month', h.doc_date)::date AS month, SUM(l.amount) AS raw_purchase
    FROM purchase_header h
    JOIN purchase_line l ON l.company = h.company AND l.doc_no = h.doc_no
    GROUP BY 1, 2
),
mv AS (
    SELECT company, month, SUM(sell_total) AS mv_sales, SUM(buy_amt) AS mv_purchase
    FROM mv_buy_sell_monthly GROUP BY 1, 2
)
SELECT company,
       month,
       COALESCE(raw_sales, 0)                              AS raw_sales,
       COALESCE(mv_sales, 0)                               AS mv_sales,
       COALESCE(mv_sales, 0) - COALESCE(raw_sales, 0)      AS diff_sales,
       COALESCE(raw_purchase, 0)                           AS raw_purchase,
       COALESCE(mv_purchase, 0)                            AS mv_purchase,
       COALESCE(mv_purchase, 0) - COALESCE(raw_purchase, 0) AS diff_purchase
FROM raw_s
FULL OUTER JOIN raw_p USING (company, month)
FULL OUTER JOIN mv    USING (company, month);


-- Data-quality checks that should always return zero rows.
CREATE OR REPLACE VIEW v_dq_issues AS
SELECT 'purchase header total <> sum of lines' AS issue, h.company || ' ' || h.doc_no AS detail
FROM purchase_header h
JOIN (SELECT company, doc_no, SUM(amount) AS s FROM purchase_line GROUP BY 1, 2) l
  ON l.company = h.company AND l.doc_no = h.doc_no
WHERE l.s <> h.total_amount
UNION ALL
SELECT 'overlapping branch_prefix ranges', a.company || ' ' || a.prefix
FROM branch_prefix a
JOIN branch_prefix b
  ON a.company = b.company AND a.prefix = b.prefix AND a.valid_from < b.valid_from
 AND (a.valid_to IS NULL OR a.valid_to > b.valid_from);
