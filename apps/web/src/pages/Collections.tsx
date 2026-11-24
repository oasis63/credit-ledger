import { useState } from 'react';
import { api, type CustomerSummary } from '../api';
import { useAuth } from '../auth';
import { AsyncForm, ErrorNote } from '../components';
import { date, rupees } from '../format';
import { useApi } from '../hooks';

interface Pending {
  salesman_id: string;
  salesman_name: string;
  entry_count: number;
  total_paise: number;
  cash_paise: number;
  cheque_paise: number;
}

export function Collections() {
  const { user } = useAuth();
  const staff = user?.role !== 'salesman';
  const customers = useApi<{ customers: CustomerSummary[] }>('/api/customers');
  const pending = useApi<{ pending: Pending[] }>('/api/collections/pending');
  const closes = useApi<{ day_closes: Array<Record<string, string | number>> }>(staff ? '/api/collections/day-closes' : null);
  const [mode, setMode] = useState('cash');
  const [receipt, setReceipt] = useState<string | null>(null);

  return (
    <>
      <h1>Collections</h1>

      <section className="card">
        <h2>Record a collection</h2>
        <p className="muted small">The shop gets an instant WhatsApp receipt with the amount and your name.</p>
        {receipt && <p className="note">{receipt}</p>}
        <AsyncForm
          className="form grid"
          submitLabel="Record and send receipt"
          onSubmit={async (f) => {
            const r = await api<{ receipt: { number: string; sent: boolean; error: string | null } }>('/api/collections', {
              method: 'POST',
              body: {
                customer_id: f.get('customer_id'),
                amount: f.get('amount'),
                payment_mode: f.get('payment_mode'),
                payment_ref: f.get('payment_ref') || undefined,
                note: f.get('note') || undefined,
              },
            });
            setReceipt(
              r.receipt.sent
                ? `Recorded. Receipt #${r.receipt.number} sent on WhatsApp.`
                : `Recorded as receipt #${r.receipt.number}, but the WhatsApp message failed: ${r.receipt.error}`,
            );
            pending.reload();
          }}
        >
          <label>
            Customer
            <select name="customer_id" required defaultValue="">
              <option value="" disabled>
                Choose a shop
              </option>
              {(customers.data?.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (owes {rupees(c.balance_paise)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount (₹) <input name="amount" inputMode="decimal" required />
          </label>
          <label>
            Mode
            <select name="payment_mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="upi">UPI</option>
            </select>
          </label>
          {mode !== 'cash' && (
            <label>
              {mode === 'cheque' ? 'Cheque number' : 'UPI reference (UTR)'} <input name="payment_ref" required />
            </label>
          )}
          <label className="wide">
            Note <input name="note" />
          </label>
        </AsyncForm>
      </section>

      <section className="card">
        <h2>Cash and cheques not yet handed over</h2>
        <ErrorNote error={pending.error} />
        {(pending.data?.pending ?? []).length === 0 ? (
          <p className="muted">Nothing pending.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Salesman</th>
                <th className="num">Entries</th>
                <th className="num">Cash</th>
                <th className="num">Cheques</th>
                {staff && <th>Close the day</th>}
              </tr>
            </thead>
            <tbody>
              {pending.data!.pending.map((p) => (
                <tr key={p.salesman_id}>
                  <td>{p.salesman_name}</td>
                  <td className="num">{p.entry_count}</td>
                  <td className="num">{rupees(p.cash_paise)}</td>
                  <td className="num">{rupees(p.cheque_paise)}</td>
                  {staff && (
                    <td>
                      <AsyncForm
                        className="inline"
                        submitLabel="Close"
                        onSubmit={async (f) => {
                          await api('/api/collections/day-close', {
                            method: 'POST',
                            body: { salesman_id: p.salesman_id, declared: f.get('declared') },
                          });
                          pending.reload();
                          closes.reload();
                        }}
                      >
                        <input name="declared" inputMode="decimal" placeholder="Amount handed in ₹" required />
                      </AsyncForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {staff && (
        <section className="card">
          <h2>Recent day closes</h2>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Salesman</th>
                <th className="num">Expected</th>
                <th className="num">Handed in</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {(closes.data?.day_closes ?? []).map((d) => (
                <tr key={String(d.id)}>
                  <td>{date(String(d.created_at))}</td>
                  <td>{String(d.salesman_name)}</td>
                  <td className="num">{rupees(Number(d.expected_paise))}</td>
                  <td className="num">{rupees(Number(d.declared_paise))}</td>
                  <td className={`num ${Number(d.variance_paise) < 0 ? 'bad' : ''}`}>{rupees(Number(d.variance_paise))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
