'use strict';

/**
 * Date handling for Thai POS / ERP exports.
 *
 * Three real-world traps this module exists for:
 *
 * 1. Excel serial dates + historical time zones.
 *    Excel stores dates as days since 1899-12-30. Converting that by building
 *    a *local* Date for the 1899 epoch picks up the zone rules of 1899. For
 *    Asia/Bangkok that is Local Mean Time (UTC+06:42:04), not UTC+07:00, so
 *    every converted date drifts by ~18 minutes. Depending on the library path
 *    the result lands at 23:42 the previous day — and a whole day of bills
 *    silently merges into the day before.
 *    Fix: do serial arithmetic in UTC only, then read the calendar parts.
 *
 * 2. Date objects that already carry that drift (e.g. produced by a spreadsheet
 *    library with cellDates:true). We snap them back to the intended calendar
 *    day: anything within 1 hour before midnight belongs to the next day.
 *
 * 3. Buddhist-era years (2569 = 2026) in text dates.
 *
 * All functions return a plain {y, m, d} or an ISO 'YYYY-MM-DD' string so no
 * caller ever has to reason about time zones again.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Excel serial -> 'YYYY-MM-DD', time-zone independent. */
function excelSerialToIso(serial) {
  const u = new Date(EXCEL_EPOCH_UTC + Math.round(serial) * DAY_MS);
  return iso(u.getUTCFullYear(), u.getUTCMonth() + 1, u.getUTCDate());
}

/**
 * The buggy conversion, kept on purpose so the regression test can prove the
 * drift exists in the current runtime/time zone.
 */
function naiveExcelSerialToLocalDate(serial) {
  return new Date(new Date(1899, 11, 30).getTime() + serial * DAY_MS);
}

/** A local Date that may carry the LMT drift -> intended calendar day. */
function snapLocalDateToIso(d) {
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sinceMidnight = d.getTime() - midnight.getTime();
  if (DAY_MS - sinceMidnight <= HOUR_MS) {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return iso(next.getFullYear(), next.getMonth() + 1, next.getDate());
  }
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIso(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return iso(y, m, d);
}

/**
 * Accepts: Excel serial number, Date, 'DD/MM/YYYY' (Gregorian or Buddhist era),
 * 'YYYY-MM-DD'. Returns 'YYYY-MM-DD' or null.
 */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : snapLocalDateToIso(value);
  if (typeof value === 'number') {
    return value > 0 && value < 2_958_466 ? excelSerialToIso(value) : null;
  }
  const s = String(value).trim();
  let m = s.match(DMY);
  if (m) {
    let y = Number(m[3]);
    if (y >= 2400) y -= 543;               // Buddhist era
    return validIso(y, Number(m[2]), Number(m[1]));
  }
  m = s.match(YMD);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return null;
}

module.exports = { parseDate, excelSerialToIso, naiveExcelSerialToLocalDate, snapLocalDateToIso };
