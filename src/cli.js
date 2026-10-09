#!/usr/bin/env node
'use strict';

/**
 * Usage:
 *   node src/cli.js import sales    <file...> --company DEMO [--no-refresh]
 *   node src/cli.js import purchase <file...> --company DEMO [--no-refresh]
 *   node src/cli.js refresh
 *   node src/cli.js check [--expected samples/expected_totals.json]
 */

const fs = require('fs');

const USAGE = `Usage:
  node src/cli.js import sales    <file...> --company DEMO [--no-refresh]
  node src/cli.js import purchase <file...> --company DEMO [--no-refresh]
  node src/cli.js refresh
  node src/cli.js check [--expected samples/expected_totals.json]`;
const { connect } = require('./db');
const { importSales, importPurchase, refresh } = require('./load');

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-refresh') opt.noRefresh = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { pos, opt };
}

const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function cmdImport(client, kind, files, opt) {
  if (!opt.company) throw new Error('--company is required');
  const fn = kind === 'sales' ? importSales : kind === 'purchase' ? importPurchase : null;
  if (!fn) throw new Error('import kind must be "sales" or "purchase"');
  for (const file of files) {
    const r = await fn(client, { company: opt.company, file });
    console.log(`✔ ${kind} ${opt.company} ${file}: ${r.lines} lines, ${fmt(r.amount)} THB` +
      (r.replacedLines ? `, replaced ${r.replacedLines} existing lines` : '') +
      (r.replacedDocs ? `, replaced ${r.replacedDocs} existing docs` : ''));
  }
  if (!opt.noRefresh) console.log(`✔ refreshed mv_buy_sell_monthly in ${await refresh(client)} ms`);
}

async function cmdCheck(client, opt) {
  let ok = true;
  // to_char, not r.month.toISOString(): pg turns DATE into a *local* midnight Date,
  // and toISOString() would print the previous day in UTC+7.
  const { rows } = await client.query(
    "SELECT *, to_char(month, 'YYYY-MM') AS ym FROM v_reconcile ORDER BY company, month");
  for (const r of rows) {
    const bad = Number(r.diff_sales) !== 0 || Number(r.diff_purchase) !== 0;
    if (bad) ok = false;
    console.log(`${bad ? '✘' : '✔'} ${r.company} ${r.ym}  ` +
      `sales ${fmt(r.raw_sales)} (diff ${fmt(r.diff_sales)})  purchase ${fmt(r.raw_purchase)} (diff ${fmt(r.diff_purchase)})`);
  }
  const dq = await client.query('SELECT * FROM v_dq_issues');
  for (const r of dq.rows) { ok = false; console.log(`✘ data quality: ${r.issue} — ${r.detail}`); }

  if (opt.expected) {
    const exp = JSON.parse(fs.readFileSync(opt.expected, 'utf8'));
    const { rows: act } = await client.query(`
      SELECT company, SUM(raw_sales) AS sales, SUM(raw_purchase) AS purchase
      FROM v_reconcile GROUP BY company`);
    for (const [company, e] of Object.entries(exp)) {
      const a = act.find(x => x.company === company) || { sales: 0, purchase: 0 };
      const match = Number(a.sales) === e.sales && Number(a.purchase) === e.purchase;
      if (!match) ok = false;
      console.log(`${match ? '✔' : '✘'} ${company} totals vs source files: ` +
        `sales ${fmt(a.sales)} / ${fmt(e.sales)}, purchase ${fmt(a.purchase)} / ${fmt(e.purchase)}`);
    }
  }
  if (!ok) { console.error('Reconciliation FAILED'); process.exitCode = 1; }
  else console.log('Reconciliation OK — every report total ties back to the source.');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  const client = await connect();
  try {
    if (cmd === 'import') await cmdImport(client, pos[0], pos.slice(1), opt);
    else if (cmd === 'refresh') console.log(`✔ refreshed in ${await refresh(client)} ms`);
    else if (cmd === 'check') await cmdCheck(client, opt);
    else { console.log(USAGE); process.exitCode = 2; }
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error('✘', e.message); process.exitCode = 1; });
