# Case studies

Real incidents from the production version of this pipeline, rewritten without company data.
Each one left something behind in this repo: a test, a guard, or a design rule.

---

## 1. A whole day of sales merged into the day before

**Symptom.** The daily report showed one day with roughly double the normal sales and the next
day empty — but only for files exported as `.xlsx`. The same days exported as `.xls` were fine.

**Diagnosis.** `.xls` stored dates as text; `.xlsx` stored Excel serial numbers. The spreadsheet
library converted serials relative to a *local* 1899-12-30 epoch. In 1899, `Asia/Bangkok` was on
Local Mean Time, **UTC+06:42:04**, not UTC+07:00. Every date came out ~18 minutes off — landing at
23:42 the previous day.

**Fix.** Convert serials with UTC arithmetic only; snap any already-drifted `Date` within an hour
of midnight to the next day. Verified day-by-day against the ERP: difference 0.00.

**Left behind.** `src/dates.js`; `test/dates.test.js` proves the drift exists in the runtime and
that the fix removes it.

---

## 2. Wholesale sales disappeared for four days

**Symptom.** Every bill for several days was classified as retail.

**Diagnosis.** Channel is decided by the member column. Someone exported a look-alike report
(bill summary) that has no member column; the old parser read a fixed column position, found a
product name there, matched no member, and called everything retail — silently.

**Fix.** Locate columns by header label; if the member column is missing, refuse the file with a
message that names the correct report.

**Left behind.** `parseSalesReport` header mapping; `samples/bad/`; a test and a CI step.

---

## 3. Two reports disagreed — and the fix was *not* "find the missing supplier"

**Symptom.** Sales-by-supplier didn't match the ERP's daily total by a five-figure amount.

**Diagnosis.** Decomposed the gap into two parts that matched exactly: (a) marketplace refund
bills, flagged as cancelled, that the ERP *does* net off; (b) items with no supplier (services,
unregistered barcodes) dropped by an inner join.

**Fix.** Include marketplace refunds; keep supplier-less rows in an explicit `(unassigned)` bucket.
Chasing 100% supplier coverage was impossible by nature — making the gap *visible* was the fix.

**Left behind.** `COALESCE(..., '(unassigned)')` in `v_sales`; `v_reconcile`; `npm run check`.

---

## 4. The dashboard hung

**Symptom.** Metabase questions on a supplier view spun until timeout.

**Fix.** Plain view → materialized view with indexes (~200 ms). Then refreshes started blocking
dashboards: `REFRESH … CONCURRENTLY` needs a unique index. One MV had been rebuilt by a script that
didn't create it, so refresh fell back to a full lock. Rule now: the unique index lives next to
the `CREATE MATERIALIZED VIEW`, on the natural key.

---

## 5. Company B's file uploaded into company A

**Symptom.** One company's purchases appeared under another — and some of the real documents
vanished.

**Diagnosis.** Document numbers restart per company. The importer deletes existing documents
with the same numbers before inserting (to make re-imports idempotent), so the wrong file
*overwrote* real documents that happened to share numbers.

**Fix.** Key everything by `(company, doc_no)`. Read the company name from the report banner
and refuse a file that clearly belongs to another company — before any delete. Recovery used
the import timestamp to remove exactly the wrong batch, inside a transaction, with a count check
before `COMMIT`.

**Left behind.** `assertCompany` (fail-open for unknown names), composite keys, `import_log`.

---

## 6. "The upload is stuck" — three different causes

1. **Windows console QuickEdit.** Clicking inside the server's `cmd` window pauses the process
   on its next log write. Title bar says *Select*. Fix: disable QuickEdit.
2. **An open transaction in a SQL client.** `BEGIN; DELETE …` without `COMMIT`. Clue:
   `now()` in that session was *earlier* than other sessions' `query_start`, so durations
   showed as negative.
3. **Lock wait on a non-concurrent refresh.**

The query that told them apart:

```sql
SELECT pid, application_name, state, wait_event_type,
       pg_blocking_pids(pid) AS blocked_by, LEFT(query, 80)
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid();
```

---

## 7. Bugs caught by checks, not by reading

I write much of this code with an AI assistant. Two bugs from the same week — one from AI-written
SQL, one from an older rule — were both caught by checks with a known answer:

- **Duplicated rows (AI-written view).** A flags table joined with `ON f.code = x OR f.code = y`. When both codes
  were flagged, each row matched twice. Caught by comparing the new MV against the previous one
  month by month (27 mismatches). Fix: `EXISTS`.
- **A rule applied too broadly.** POS bill prefixes map to branches — for one company. The rule
  was applied to all companies, so another company's bills showed up in branches it doesn't have.
  Fix: `branch_prefix` is keyed by company (and date range).

The habit that matters: every change to a reporting view is followed by a reconciliation query
whose correct answer is known in advance (usually `0.00`).
