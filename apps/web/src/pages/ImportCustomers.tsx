import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { readSheet } from 'read-excel-file/browser';
import { ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../api';
import { exportExcel } from '../exporting';
import { todayIso } from '../format';
import { ActionButton, Card, ErrorNote, Field, PageHeader, Pill } from '../ui';

/** Fields we can import, with header names we recognise automatically. */
const FIELDS: Array<{ key: string; label: string; required?: boolean; aliases: string[] }> = [
  { key: 'name', label: 'Shop name', required: true, aliases: ['name', 'shop', 'shop name', 'customer', 'customer name', 'party', 'party name', 'ledger', 'firm'] },
  { key: 'phone', label: 'WhatsApp / mobile', required: true, aliases: ['phone', 'mobile', 'whatsapp', 'mobile no', 'phone number', 'contact no', 'mob'] },
  { key: 'contact_name', label: 'Contact person', aliases: ['contact', 'contact name', 'owner', 'owner name', 'person', 'contact person'] },
  { key: 'area', label: 'Area', aliases: ['area', 'locality', 'city', 'route', 'location', 'town'] },
  { key: 'address', label: 'Address', aliases: ['address', 'addr', 'full address'] },
  { key: 'gstin', label: 'GSTIN', aliases: ['gstin', 'gst', 'gst no', 'gst number', 'gstin/uin'] },
  { key: 'opening_balance', label: 'Opening balance (₹)', aliases: ['opening balance', 'balance', 'outstanding', 'due', 'closing balance', 'amount due'] },
  { key: 'credit_limit', label: 'Credit limit (₹)', aliases: ['credit limit', 'limit'] },
  { key: 'credit_days', label: 'Credit days', aliases: ['credit days', 'days', 'credit period'] },
  { key: 'language', label: 'Language (en/hi)', aliases: ['language', 'lang'] },
  { key: 'tags', label: 'Tags', aliases: ['tags', 'tag', 'category', 'type'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/ ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Minimal RFC 4180 CSV parser (quotes, commas and newlines inside quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

interface Result {
  dry_run: boolean;
  created: number;
  updated: number;
  skipped: number;
  opening_balances: number;
  errors: Array<{ row: number; message: string }>;
}

export function ImportCustomers() {
  const nav = useNavigate();
  const [fileName, setFileName] = useState<string | null>(null);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [onDup, setOnDup] = useState<'skip' | 'update'>('skip');
  const [openingDate, setOpeningDate] = useState(todayIso());
  const [check, setCheck] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(file: File) {
    setError(null);
    setCheck(null);
    setDone(null);
    try {
      let rows: string[][];
      if (/\.csv$/i.test(file.name)) rows = parseCsv(await file.text());
      else {
        const data = (await readSheet(file)) as unknown[][];
        rows = data.map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))));
      }
      if (rows.length < 2) throw new Error('The file needs a header row and at least one customer');
      const headers = rows[0]!.map(norm);
      const auto: Record<string, number> = {};
      for (const f of FIELDS) {
        const i = headers.findIndex((h) => f.aliases.includes(h));
        if (i >= 0) auto[f.key] = i;
      }
      setFileName(file.name);
      setGrid(rows);
      setMapping(auto);
    } catch (e) {
      setError(`Could not read the file: ${(e as Error).message}`);
    }
  }

  const records = useMemo(() => {
    if (!grid) return [];
    return grid.slice(1).map((r) => {
      const o: Record<string, string> = {};
      for (const [k, i] of Object.entries(mapping)) if (i >= 0 && r[i] !== undefined && r[i]!.trim() !== '') o[k] = r[i]!.trim();
      return o;
    });
  }, [grid, mapping]);

  const missing = FIELDS.filter((f) => f.required && mapping[f.key] === undefined);
  const run = async (dry: boolean) => {
    const r = await api<Result>('/api/customers/import', { method: 'POST', body: { rows: records, on_duplicate: onDup, dry_run: dry, opening_date: openingDate } });
    if (dry) setCheck(r);
    else setDone(r);
  };

  return (
    <>
      <PageHeader
        back={<Link to="/customers" className="back"><ArrowLeft size={15} />Customers</Link>}
        title="Import customers"
        subtitle="Bring in your shops from Excel, Google Sheets (download as .xlsx or .csv) or a Tally export."
        actions={
          <button
            className="btn"
            onClick={() =>
              void exportExcel('customer-import-template', 'Customers', [{}], FIELDS.map((f) => ({ header: f.label.replace(' (₹)', ''), value: () => '' })))
            }
          >
            <Download size={16} />Download template
          </button>
        }
      />

      {done ? (
        <Card>
          <div className="success-block">
            <CheckCircle2 size={40} />
            <h2>Import finished</h2>
            <p>
              {done.created} added · {done.updated} updated · {done.skipped} skipped · {done.opening_balances} opening balances posted
            </p>
            {done.errors.length > 0 && <p className="muted">{done.errors.length} rows had problems and were not imported.</p>}
            <div className="row-gap">
              <button className="btn btn-primary" onClick={() => nav('/customers')}>See customers</button>
              <button className="btn" onClick={() => (setGrid(null), setDone(null), setCheck(null))}>Import another file</button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card title="1. Choose a file">
            <label className="dropzone">
              <FileSpreadsheet size={28} />
              <b>{fileName ?? 'Click to choose an .xlsx or .csv file'}</b>
              <span className="muted">First row must be column names. One shop per row.</span>
              <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
            </label>
            <ErrorNote error={error} />
          </Card>

          {grid && (
            <Card title="2. Match your columns" actions={<span className="muted">{records.length} rows found</span>}>
              <div className="map-grid">
                {FIELDS.map((f) => (
                  <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                    <select value={mapping[f.key] ?? -1} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                      <option value={-1}>— Don't import —</option>
                      {grid[0]!.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <div className="form-grid">
                <Field label="If a phone number already exists">
                  <select value={onDup} onChange={(e) => setOnDup(e.target.value as 'skip' | 'update')}>
                    <option value="skip">Skip that row</option>
                    <option value="update">Update the customer's details</option>
                  </select>
                </Field>
                <Field label="Date for opening balances" hint="Balances are only added for new customers, never twice">
                  <input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
                </Field>
              </div>
              <h3 className="sub-h">Preview</h3>
              <div className="table-wrap">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Row</th>
                      {FIELDS.filter((f) => (mapping[f.key] ?? -1) >= 0).map((f) => <th key={f.key}>{f.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {records.slice(0, 8).map((r, i) => (
                      <tr key={i}>
                        <td className="muted">{i + 2}</td>
                        {FIELDS.filter((f) => (mapping[f.key] ?? -1) >= 0).map((f) => <td key={f.key}>{r[f.key] ?? ''}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {records.length > 8 && <p className="muted small">…and {records.length - 8} more rows.</p>}
            </Card>
          )}

          {grid && (
            <Card title="3. Check and import">
              {missing.length > 0 && <ErrorNote error={`Choose a column for: ${missing.map((m) => m.label).join(', ')}`} />}
              {check && (
                <div className="check-summary">
                  <Pill tone="green">{check.created} new</Pill>
                  <Pill tone="blue">{check.updated} to update</Pill>
                  <Pill>{check.skipped} skipped</Pill>
                  <Pill tone="violet">{check.opening_balances} opening balances</Pill>
                  <Pill tone={check.errors.length ? 'red' : 'green'}>{check.errors.length} with problems</Pill>
                </div>
              )}
              {check && check.errors.length > 0 && (
                <div className="table-wrap error-table">
                  <table className="table table-compact">
                    <thead><tr><th>Row</th><th>Problem</th></tr></thead>
                    <tbody>
                      {check.errors.slice(0, 100).map((e) => <tr key={e.row}><td>{e.row}</td><td>{e.message}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="row-gap">
                <ActionButton className="btn" disabled={missing.length > 0} onClick={() => run(true)}><CheckCircle2 size={16} />Check file</ActionButton>
                <ActionButton className="btn btn-primary" disabled={missing.length > 0 || !check} onClick={() => run(false)} title={check ? '' : 'Check the file first'}>
                  <Upload size={16} />Import {check ? check.created + check.updated : ''} customers
                </ActionButton>
              </div>
              <p className="muted small">Rows with problems are skipped; fix them in your file and import again.</p>
            </Card>
          )}
        </>
      )}
    </>
  );
}
