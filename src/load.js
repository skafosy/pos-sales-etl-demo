'use strict';

const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { from: copyFrom } = require('pg-copy-streams');

const { readSheet } = require('./readSheet');
const { toCsv } = require('./csv');
const { assertCompany } = require('./parsers/common');
const { parseSalesReport } = require('./parsers/sales');
const { parsePurchaseReport } = require('./parsers/purchase');

/**
 * Import pipeline (same shape for every report type):
 *
 *   parse + validate in memory      -> nothing touches the DB if the file is wrong
 *   BEGIN
 *     COPY rows into a temp stage   -> fast bulk load
 *     DELETE existing keys found in the stage   -> re-importing a file is idempotent
 *     INSERT ... SELECT from stage
 *   COMMIT                          -> all-or-nothing
 *   REFRESH MATERIALIZED VIEW CONCURRENTLY   -> dashboards never block
 */

async function copyRows(client, sql, rows) {
  const stream = client.query(copyFrom(sql));
  await pipeline(Readable.from(rows.map(r => toCsv([r]))), stream);
}

async function loadCompanies(client, code) {
  const { rows } = await client.query('SELECT code, name_match FROM companies');
  if (!rows.some(r => r.code === code)) {
    throw new Error(`Unknown company "${code}". Known: ${rows.map(r => r.code).join(', ')}`);
  }
  return rows;
}

async function startLog(client, kind, company, file) {
  const { rows } = await client.query(
    'INSERT INTO import_log (kind, company, file_name) VALUES ($1, $2, $3) RETURNING id',
    [kind, company, path.basename(file)]);
  return rows[0].id;
}

async function finishLog(client, id, fields) {
  await client.query(
    `UPDATE import_log SET rows_loaded = $2, amount = $3, replaced = $4,
            status = $5, message = $6, finished_at = now() WHERE id = $1`,
    [id, fields.rows ?? null, fields.amount ?? null, fields.replaced ?? null,
     fields.status, fields.message ?? null]);
}

async function inTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function importSales(client, { company, file }) {
  const parsed = parseSalesReport(readSheet(file));
  assertCompany(parsed.companyName, company, await loadCompanies(client, company));
  if (parsed.lines.length === 0) throw new Error('No sales lines found in file.');

  const logId = await startLog(client, 'sales', company, file);
  try {
    const replaced = await inTransaction(client, async () => {
      await client.query(`CREATE TEMP TABLE _stage_sales (
          bill_no TEXT, sales_date DATE, member_code TEXT, barcode TEXT,
          product_name TEXT, qty NUMERIC, amount NUMERIC) ON COMMIT DROP`);
      await copyRows(client,
        'COPY _stage_sales FROM STDIN WITH (FORMAT csv)',
        parsed.lines.map(l => [l.bill_no, l.sales_date, l.member_code, l.barcode,
                               l.product_name, l.qty, l.amount]));
      const del = await client.query(
        `DELETE FROM sales_line s
          USING (SELECT DISTINCT bill_no FROM _stage_sales) b
          WHERE s.company = $1 AND s.bill_no = b.bill_no`, [company]);
      await client.query(
        `INSERT INTO sales_line (company, bill_no, sales_date, member_code, barcode,
                                 product_name, qty, amount, import_id)
         SELECT $1::text, bill_no, sales_date, member_code, barcode, product_name, qty, amount, $2::bigint
         FROM _stage_sales`, [company, logId]);
      return del.rowCount;
    });
    await finishLog(client, logId, { rows: parsed.lines.length, amount: parsed.stats.amount,
                                     replaced, status: 'ok' });
    return { ...parsed.stats, replacedLines: replaced };
  } catch (e) {
    await finishLog(client, logId, { status: 'failed', message: e.message });
    throw e;
  }
}

async function importPurchase(client, { company, file }) {
  const parsed = parsePurchaseReport(readSheet(file));
  assertCompany(parsed.companyName, company, await loadCompanies(client, company));
  if (parsed.mismatches.length) {
    const m = parsed.mismatches.slice(0, 5)
      .map(x => `${x.doc_no}: report ${x.reported} vs parsed ${x.parsed}`).join('; ');
    throw new Error(`Document totals do not match their items (${parsed.mismatches.length}): ${m}`);
  }
  if (parsed.docs.length === 0) throw new Error('No purchase documents found in file.');

  const logId = await startLog(client, 'purchase', company, file);
  try {
    const replaced = await inTransaction(client, async () => {
      await client.query(`CREATE TEMP TABLE _stage_ph (
          doc_no TEXT, doc_date DATE, supplier_code TEXT, supplier_name TEXT,
          total_amount NUMERIC) ON COMMIT DROP`);
      await client.query(`CREATE TEMP TABLE _stage_pl (
          doc_no TEXT, barcode TEXT, product_name TEXT, unit TEXT, qty NUMERIC,
          free_qty NUMERIC, amount NUMERIC, location TEXT) ON COMMIT DROP`);
      await copyRows(client, 'COPY _stage_ph FROM STDIN WITH (FORMAT csv)',
        parsed.docs.map(d => [d.doc_no, d.doc_date, d.supplier_code, d.supplier_name, d.total_amount]));
      await copyRows(client, 'COPY _stage_pl FROM STDIN WITH (FORMAT csv)',
        parsed.docs.flatMap(d => d.lines.map(l =>
          [d.doc_no, l.barcode, l.product_name, l.unit, l.qty, l.free_qty, l.amount, l.location])));
      // Lines go with their header via ON DELETE CASCADE.
      const del = await client.query(
        `DELETE FROM purchase_header h USING _stage_ph s
          WHERE h.company = $1 AND h.doc_no = s.doc_no`, [company]);
      await client.query(
        `INSERT INTO purchase_header (company, doc_no, doc_date, supplier_code, supplier_name,
                                      total_amount, import_id)
         SELECT $1::text, doc_no, doc_date, supplier_code, supplier_name, total_amount, $2::bigint FROM _stage_ph`,
        [company, logId]);
      await client.query(
        `INSERT INTO purchase_line (company, doc_no, barcode, product_name, unit, qty,
                                    free_qty, amount, location)
         SELECT $1::text, doc_no, barcode, product_name, unit, qty, free_qty, amount, location
         FROM _stage_pl`, [company]);
      return del.rowCount;
    });
    await finishLog(client, logId, { rows: parsed.stats.lines, amount: parsed.stats.amount,
                                     replaced, status: 'ok' });
    return { ...parsed.stats, replacedDocs: replaced };
  } catch (e) {
    await finishLog(client, logId, { status: 'failed', message: e.message });
    throw e;
  }
}

async function refresh(client) {
  const t = Date.now();
  await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_buy_sell_monthly');
  return Date.now() - t;
}

module.exports = { importSales, importPurchase, refresh };
