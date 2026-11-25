import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, FileText, Plus, Search } from 'lucide-react';
import { exportExcel } from '../exporting';
import { addDays, date, rupees, startOfMonth, todayIso } from '../format';
import { useApi } from '../hooks';
import { Card, Empty, ErrorNote, Kpi, Loading, Money, PageHeader, Pill, useToast } from '../ui';

interface BillRow {
  id: string; bill_no: string; bill_date: string; due_date: string; customer_id: string; customer_name: string;
  taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; total_paise: number; cancelled_at: string | null; interstate: boolean;
}

export function Bills() {
  const nav = useNavigate();
  const toast = useToast();
  const today = todayIso();
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const { data, error, loading } = useApi<{ bills: BillRow[] }>(`/api/bills?from=${from}&to=${to}&limit=1000`);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.bills ?? []).filter((b) => !s || b.bill_no.toLowerCase().includes(s) || b.customer_name.toLowerCase().includes(s));
  }, [data, q]);
  const live = list.filter((b) => !b.cancelled_at);
  const sum = (k: keyof BillRow) => live.reduce((s, b) => s + Number(b[k]), 0);

  return (
    <>
      <PageHeader
        title="Bills"
        subtitle="GST invoices. Every bill is added to the customer's ledger automatically."
        actions={
          <>
            <button
              className="btn"
              onClick={() =>
                void exportExcel(`bills-${from}-to-${to}`, 'Bills', list, [
                  { header: 'Bill no', value: (b) => b.bill_no },
                  { header: 'Date', value: (b) => b.bill_date },
                  { header: 'Customer', value: (b) => b.customer_name, width: 30 },
                  { header: 'Taxable (₹)', value: (b) => b.taxable_paise, money: true },
                  { header: 'CGST (₹)', value: (b) => b.cgst_paise, money: true },
                  { header: 'SGST (₹)', value: (b) => b.sgst_paise, money: true },
                  { header: 'IGST (₹)', value: (b) => b.igst_paise, money: true },
                  { header: 'Total (₹)', value: (b) => b.total_paise, money: true },
                  { header: 'Status', value: (b) => (b.cancelled_at ? 'Cancelled' : 'Active') },
                ]).catch((e: Error) => toast(e.message, 'error'))
              }
            >
              <Download size={16} />Export
            </button>
            <button className="btn btn-primary" onClick={() => nav('/bills/new')}><Plus size={16} />New bill</button>
          </>
        }
      />
      <div className="kpi-grid kpi-grid-3">
        <Kpi label="Bills" value={live.length} sub={list.length - live.length ? `${list.length - live.length} cancelled` : 'in this period'} icon={<FileText size={18} />} />
        <Kpi label="Billed" value={rupees(sum('total_paise'))} tone="brand" />
        <Kpi label="GST collected" value={rupees(sum('cgst_paise') + sum('sgst_paise') + sum('igst_paise'))} sub={`Taxable ${rupees(sum('taxable_paise'))}`} />
      </div>
      <Card pad={false}>
        <div className="toolbar">
          <label className="search"><Search size={16} /><input placeholder="Search bill no. or customer" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="date-range">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <span>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </div>
          <div className="chip-row">
            <button className="chip" onClick={() => (setFrom(today), setTo(today))}>Today</button>
            <button className="chip" onClick={() => (setFrom(startOfMonth(today)), setTo(today))}>This month</button>
            <button className="chip" onClick={() => (setFrom(addDays(today, -89)), setTo(today))}>90 days</button>
          </div>
        </div>
        <ErrorNote error={error} />
        {loading && !data ? <Loading /> : list.length === 0 ? (
          <Empty title="No bills in this period"><button className="btn btn-primary" onClick={() => nav('/bills/new')}><Plus size={16} />Create a bill</button></Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Bill</th><th>Customer</th><th>Date</th><th className="num hide-sm">Taxable</th><th className="num hide-sm">GST</th><th className="num">Total</th><th /></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id} className={`clickable ${b.cancelled_at ? 'row-muted' : ''}`} onClick={() => nav(`/bills/${b.id}`)}>
                    <td><b>{b.bill_no}</b></td>
                    <td><Link to={`/customers/${b.customer_id}`} onClick={(e) => e.stopPropagation()}>{b.customer_name}</Link></td>
                    <td className="nowrap">{date(b.bill_date)}<span className="cell-sub">due {date(b.due_date)}</span></td>
                    <td className="num hide-sm"><Money paise={b.taxable_paise} /></td>
                    <td className="num hide-sm"><Money paise={b.cgst_paise + b.sgst_paise + b.igst_paise} />{b.interstate && <span className="cell-sub">IGST</span>}</td>
                    <td className="num"><Money paise={b.total_paise} strong /></td>
                    <td>{b.cancelled_at && <Pill tone="red">Cancelled</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
