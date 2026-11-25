import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Stack, useLocalSearchParams } from 'expo-router';
import { formatDate, formatRupees, type BillDetail } from '@credit-ledger/shared';
import { Banner, Button, Card, Center, Pill, SectionTitle, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { esc, PDF_CSS, sharePdf } from '../../lib/share';
import { colors, radius, space } from '../../lib/theme';

function billHtml(d: BillDetail): string {
  const { bill: b, items, seller, upi, tax_summary } = d;
  const rows = items
    .map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.description)}</td><td>${esc(it.hsn)}</td><td class="num">${it.qty} ${esc(it.unit)}</td><td class="num">${formatRupees(it.rate_paise)}</td><td class="num">${it.gst_rate}%</td><td class="num">${formatRupees(it.amount_paise)}</td></tr>`)
    .join('');
  const tax = b.interstate ? `<tr><td>IGST</td><td class="num">${formatRupees(b.igst_paise)}</td></tr>` : `<tr><td>CGST</td><td class="num">${formatRupees(b.cgst_paise)}</td></tr><tr><td>SGST</td><td class="num">${formatRupees(b.sgst_paise)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>
  ${b.cancelled_at ? '<h2 style="color:#dc2626">CANCELLED</h2>' : ''}
  <div class="row"><div><h1>${esc(seller.name)}</h1><div class="muted">${esc(seller.address)}</div><div class="muted">${seller.gstin ? `GSTIN ${esc(seller.gstin)}` : ''}</div></div>
  <div style="text-align:right"><div class="label">Tax invoice</div><div style="font-size:18px;font-weight:800">${esc(b.bill_no)}</div><div class="muted">Date ${formatDate(b.bill_date)}<br>Due ${formatDate(b.due_date)}</div></div></div>
  <div class="box"><div class="label">Bill to</div><b>${esc(b.customer_name)}</b><div class="muted">${esc(b.customer_address)}${b.customer_gstin ? ` · GSTIN ${esc(b.customer_gstin)}` : ''}</div></div>
  <table><tr><th>#</th><th>Item</th><th>HSN</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">GST</th><th class="num">Amount</th></tr>${rows}</table>
  <div class="row" style="margin-top:14px"><div>
    <div class="label">Tax by rate</div>${tax_summary.map((t) => `<div class="muted">${t.gst_rate}%: ${formatRupees(t.taxable_paise)} + tax ${formatRupees(t.tax_paise)}</div>`).join('')}
    <p><span class="label">Amount in words</span><br>${esc(b.amount_in_words)}</p>
    ${upi ? `<div class="row" style="justify-content:flex-start;align-items:center"><div class="qr">${upi.qr_svg}</div><div><b>Scan to pay ${formatRupees(b.total_paise)}</b><div class="muted">Any UPI app</div></div></div>` : ''}
  </div><table style="width:260px"><tr><td>Taxable</td><td class="num">${formatRupees(b.taxable_paise)}</td></tr>${tax}
  ${b.round_off_paise ? `<tr><td>Round off</td><td class="num">${formatRupees(b.round_off_paise)}</td></tr>` : ''}<tr class="total"><td>Total</td><td class="num">${formatRupees(b.total_paise)}</td></tr></table></div>
  <p class="muted" style="margin-top:30px">Computer-generated invoice.</p></body></html>`;
}

export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const [d, setD] = useState<BillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.bill(id).then(setD).catch((e: Error) => setError(e.message));
  }, [api, id]);

  if (error) return <Center><Banner tone="bad">{error}</Banner></Center>;
  if (!d) return <Center><ActivityIndicator color={colors.brand} /></Center>;
  const b = d.bill;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Stack.Screen options={{ title: b.bill_no }} />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.muted, fontWeight: '600' }}>{b.customer_name}</Text>
          {b.cancelled_at ? <Pill tone="bad" label="Cancelled" /> : <Pill tone="brand" label={b.interstate ? 'IGST' : 'CGST + SGST'} />}
        </View>
        <Text style={{ fontSize: 32, fontWeight: '800', color: colors.ink }}>{formatRupees(b.total_paise)}</Text>
        <Text style={ui.muted}>Billed {formatDate(b.bill_date)} · due {formatDate(b.due_date)}</Text>
      </Card>
      <SectionTitle>Items</SectionTitle>
      <Card padded={false}>
        {d.items.map((it, i) => (
          <View key={i} style={{ flexDirection: 'row', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{it.description}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{it.qty} {it.unit} × {formatRupees(it.rate_paise)} · GST {it.gst_rate}%</Text>
            </View>
            <Text style={{ fontWeight: '800', color: colors.ink }}>{formatRupees(it.amount_paise)}</Text>
          </View>
        ))}
      </Card>
      <Card>
        {[
          ['Taxable value', b.taxable_paise],
          ...(b.interstate ? [['IGST', b.igst_paise]] : [['CGST', b.cgst_paise], ['SGST', b.sgst_paise]]),
          ...(b.round_off_paise ? [['Round off', b.round_off_paise]] : []),
        ].map(([label, v]) => (
          <View key={String(label)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={ui.muted}>{label}</Text>
            <Text style={{ color: colors.ink, fontWeight: '600' }}>{formatRupees(Number(v))}</Text>
          </View>
        ))}
        <Text style={[ui.muted, { marginTop: space.sm, fontSize: 12.5 }]}>{b.amount_in_words}</Text>
      </Card>
      {d.upi && !b.cancelled_at && (
        <Card style={{ alignItems: 'center' }}>
          <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: space.sm }}>Scan to pay this bill</Text>
          <View style={{ backgroundColor: '#fff', padding: 8, borderRadius: radius.md }}>
            <SvgXml xml={d.upi.qr_svg} width={200} height={200} />
          </View>
        </Card>
      )}
      <Button
        title="Share bill as PDF"
        icon="share-social"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await sharePdf(billHtml(d), `Bill ${b.bill_no}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </ScrollView>
  );
}
