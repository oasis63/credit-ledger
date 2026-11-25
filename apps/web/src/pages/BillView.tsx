import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, MessageCircle, Printer } from 'lucide-react';
import type { BillDetail } from '@credit-ledger/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { date, phone, rupees } from '../format';
import { useApi } from '../hooks';
import { ErrorNote, Field, Loading, Modal, PageHeader, Pill, useToast } from '../ui';

const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, ''));

export function BillView({ printOnly }: { printOnly?: boolean }) {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<BillDetail>(`/api/bills/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;
  const { bill: b, items, seller, upi, tax_summary } = data;
  const staff = user?.role !== 'salesman';

  const invoice = (
    <article className={`invoice ${b.cancelled_at ? 'invoice-cancelled' : ''}`}>
      {b.cancelled_at && <div className="stamp">CANCELLED</div>}
      <header className="inv-head">
        <div>
          <h2 className="inv-seller">{seller.name}</h2>
          {seller.address && <p>{seller.address}</p>}
          <p>{[seller.phone && `Ph ${seller.phone}`, seller.gstin && `GSTIN ${seller.gstin}`].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="inv-title">
          <span>TAX INVOICE</span>
          <b>{b.bill_no}</b>
          <small>Date {date(b.bill_date)}</small>
          <small>Due {date(b.due_date)}</small>
        </div>
      </header>
      <section className="inv-parties">
        <div>
          <span className="inv-label">Bill to</span>
          <b>{b.customer_name}</b>
          {b.customer_address && <p>{b.customer_address}</p>}
          <p>{phone(b.customer_phone)}{b.customer_gstin ? ` · GSTIN ${b.customer_gstin}` : ''}</p>
        </div>
        <div>
          <span className="inv-label">Supply</span>
          <p>{b.interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}</p>
          {seller.state_code && <p>Seller state code {seller.state_code}</p>}
        </div>
      </section>
      <table className="inv-table">
        <thead>
          <tr><th>#</th><th>Item</th><th>HSN</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">Amount</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{it.description}</td>
              <td>{it.hsn ?? ''}</td>
              <td className="num">{qtyText(it.qty)} {it.unit}</td>
              <td className="num">{rupees(it.rate_paise)}</td>
              <td className="num">{it.discount_pct ? `${it.discount_pct}%` : ''}</td>
              <td className="num">{rupees(it.taxable_paise)}</td>
              <td className="num">{it.gst_rate}%</td>
              <td className="num">{rupees(it.amount_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="inv-bottom">
        <div className="inv-left">
          <table className="inv-tax">
            <thead><tr><th>GST rate</th><th className="num">Taxable</th>{b.interstate ? <th className="num">IGST</th> : <><th className="num">CGST</th><th className="num">SGST</th></>}</tr></thead>
            <tbody>
              {tax_summary.map((t) => (
                <tr key={t.gst_rate}>
                  <td>{t.gst_rate}%</td>
                  <td className="num">{rupees(t.taxable_paise)}</td>
                  {b.interstate ? <td className="num">{rupees(t.tax_paise)}</td> : <><td className="num">{rupees(Math.round(t.tax_paise / 2))}</td><td className="num">{rupees(t.tax_paise - Math.round(t.tax_paise / 2))}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="inv-words"><span className="inv-label">Amount in words</span>{b.amount_in_words}</p>
          {b.notes && <p className="inv-notes"><span className="inv-label">Notes</span>{b.notes}</p>}
          {upi && (
            <div className="inv-upi">
              <div className="qr" dangerouslySetInnerHTML={{ __html: upi.qr_svg }} />
              <div>
                <b>Scan to pay {rupees(b.total_paise)}</b>
                <span>Any UPI app: GPay, PhonePe, Paytm, BHIM</span>
              </div>
            </div>
          )}
        </div>
        <dl className="totals inv-totals">
          <dt>Subtotal</dt><dd>{rupees(b.subtotal_paise)}</dd>
          {b.discount_paise > 0 && (<><dt>Discount</dt><dd>−{rupees(b.discount_paise)}</dd></>)}
          <dt>Taxable value</dt><dd>{rupees(b.taxable_paise)}</dd>
          {b.interstate ? (<><dt>IGST</dt><dd>{rupees(b.igst_paise)}</dd></>) : (<><dt>CGST</dt><dd>{rupees(b.cgst_paise)}</dd><dt>SGST</dt><dd>{rupees(b.sgst_paise)}</dd></>)}
          {b.round_off_paise !== 0 && (<><dt>Round off</dt><dd>{b.round_off_paise > 0 ? '+' : '−'}{rupees(Math.abs(b.round_off_paise))}</dd></>)}
          <dt className="total">Total</dt><dd className="total">{rupees(b.total_paise)}</dd>
        </dl>
      </section>
      <footer className="inv-foot">
        <span>This is a computer-generated invoice.</span>
        <span className="inv-sign">For {seller.name}<br /><br />Authorised signatory</span>
      </footer>
    </article>
  );

  if (printOnly) return <div className="print-page">{invoice}</div>;

  return (
    <>
      <PageHeader
        back={<Link to="/bills" className="back no-print"><ArrowLeft size={15} />Bills</Link>}
        title={<>Bill {b.bill_no} {b.cancelled_at && <Pill tone="red">Cancelled</Pill>}</>}
        subtitle={<>For <Link to={`/customers/${b.customer_id}`}>{b.customer_name}</Link> · {rupees(b.total_paise)}{b.cancel_reason ? ` · Cancelled: ${b.cancel_reason}` : ''}</>}
        actions={
          <>
            <button className="btn" onClick={() => window.print()}><Printer size={16} />Print / Save PDF</button>
            <button
              className="btn"
              onClick={() => {
                const text = `Bill ${b.bill_no} from ${seller.name}: ${rupees(b.total_paise)}, due ${date(b.due_date)}.${upi ? ` Pay by UPI: ${upi.link}` : ''}`;
                window.open(`https://wa.me/${b.customer_phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
              }}
            >
              <MessageCircle size={16} />WhatsApp
            </button>
            {staff && !b.cancelled_at && <button className="btn btn-danger-ghost" onClick={() => setCancelling(true)}><Ban size={16} />Cancel bill</button>}
          </>
        }
      />
      <div className="invoice-wrap">{invoice}</div>
      {cancelling && (
        <Modal
          title={`Cancel bill ${b.bill_no}?`}
          onClose={() => setCancelling(false)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setCancelling(false)}>Keep bill</button>
              <button
                className="btn btn-danger"
                disabled={busy || reason.trim().length < 3}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/api/bills/${b.id}/cancel`, { method: 'POST', body: { reason } });
                    toast('Bill cancelled and a credit note posted');
                    setCancelling(false);
                    reload();
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cancel bill
              </button>
            </>
          }
        >
          <p>A credit note of {rupees(b.total_paise)} will be posted to {b.customer_name}'s ledger. The bill stays on record, marked cancelled.</p>
          <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong quantity, re-issued as next bill" autoFocus /></Field>
        </Modal>
      )}
    </>
  );
}
