'use strict';

const fs = require('fs');
const path = require('path');
const { parseCsv } = require('./csv');

/**
 * Read a report as an array of rows.
 * .csv is handled natively; .xls/.xlsx need the optional SheetJS package
 * (see README — installed from the SheetJS CDN, not the stale npm build).
 */
function readSheet(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv') return parseCsv(fs.readFileSync(file, 'utf8'));
  if (ext === '.xls' || ext === '.xlsx') {
    let XLSX;
    try { XLSX = require('xlsx'); }
    catch { throw new Error('Reading Excel needs the optional "xlsx" package — see README.'); }
    // cellDates:false keeps raw serials; src/dates.js converts them safely.
    const wb = XLSX.readFile(file, { cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }
  throw new Error(`Unsupported file type: ${ext}`);
}

module.exports = { readSheet };
