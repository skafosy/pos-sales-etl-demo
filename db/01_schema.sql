-- ===========================================================================
-- Schema — raw facts are stored exactly as imported; every business rule
-- (branch, channel, supplier grouping) is resolved in views from small
-- reference tables. Changing a rule = update a row + refresh, never re-import.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS companies (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    name_match  TEXT NOT NULL            -- substring used by the wrong-file guard
);

CREATE TABLE IF NOT EXISTS suppliers (
    code  TEXT PRIMARY KEY,
    name  TEXT NOT NULL
);

-- Several codes can belong to one real supplier (legacy codes, subsidiaries).
CREATE TABLE IF NOT EXISTS supplier_alias (
    code            TEXT PRIMARY KEY,
    canonical_code  TEXT NOT NULL,
    canonical_name  TEXT NOT NULL
);

-- Affiliates = inter-company transfers, not real external purchases.
CREATE TABLE IF NOT EXISTS supplier_flags (
    code          TEXT PRIMARY KEY,
    is_affiliate  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS products (
    barcode        TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    unit           TEXT,
    supplier_code  TEXT                  -- NULL = services / unassigned
);

CREATE TABLE IF NOT EXISTS wholesale_members (
    member_code  TEXT PRIMARY KEY
);

-- Bill-number prefix (POS terminal) -> branch, scoped by company and time:
-- terminals move between branches, and two companies may reuse the same prefix.
CREATE TABLE IF NOT EXISTS branch_prefix (
    company     TEXT NOT NULL REFERENCES companies(code),
    prefix      TEXT NOT NULL,
    branch      TEXT NOT NULL,
    valid_from  DATE NOT NULL DEFAULT DATE '2000-01-01',
    valid_to    DATE,                    -- exclusive; NULL = open-ended
    PRIMARY KEY (company, prefix, valid_from)
);

CREATE TABLE IF NOT EXISTS sales_line (
    id            BIGSERIAL PRIMARY KEY,
    company       TEXT NOT NULL REFERENCES companies(code),
    bill_no       TEXT NOT NULL,
    sales_date    DATE NOT NULL,
    member_code   TEXT,
    barcode       TEXT NOT NULL,
    product_name  TEXT,
    qty           NUMERIC(14,3) NOT NULL,
    amount        NUMERIC(14,2) NOT NULL,
    import_id     BIGINT
);
CREATE INDEX IF NOT EXISTS ix_sales_company_bill ON sales_line (company, bill_no);
CREATE INDEX IF NOT EXISTS ix_sales_company_date ON sales_line (company, sales_date);

-- Document numbers restart per company, so the key is (company, doc_no).
CREATE TABLE IF NOT EXISTS purchase_header (
    company        TEXT NOT NULL REFERENCES companies(code),
    doc_no         TEXT NOT NULL,
    doc_date       DATE NOT NULL,
    supplier_code  TEXT,
    supplier_name  TEXT,
    total_amount   NUMERIC(14,2) NOT NULL,
    import_id      BIGINT,
    PRIMARY KEY (company, doc_no)
);

CREATE TABLE IF NOT EXISTS purchase_line (
    id            BIGSERIAL PRIMARY KEY,
    company       TEXT NOT NULL,
    doc_no        TEXT NOT NULL,
    barcode       TEXT NOT NULL,
    product_name  TEXT,
    unit          TEXT,
    qty           NUMERIC(14,3) NOT NULL,
    free_qty      NUMERIC(14,3) NOT NULL DEFAULT 0,
    amount        NUMERIC(14,2) NOT NULL,
    location      TEXT,
    FOREIGN KEY (company, doc_no) REFERENCES purchase_header(company, doc_no) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_pline_doc ON purchase_line (company, doc_no);

CREATE TABLE IF NOT EXISTS import_log (
    id           BIGSERIAL PRIMARY KEY,
    kind         TEXT NOT NULL,          -- sales | purchase
    company      TEXT NOT NULL,
    file_name    TEXT NOT NULL,
    rows_loaded  INT,
    amount       NUMERIC(16,2),
    replaced     INT,                    -- bills/docs deleted before insert
    started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at  TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'running',
    message      TEXT
);
