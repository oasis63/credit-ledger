import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatRupees, paiseToRupeeString, parseRupees, type CustomerSummary, type NewCollection } from '@credit-ledger/shared';
import { Avatar, Banner, Button, Card, Field, Ionicons, RiskBadge, SearchBox, Segmented, styles as ui } from '../../components/ui';
import { receiptHtml } from '../../lib/receipt';
import { sharePdf } from '../../lib/share';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

type Mode = 'cash' | 'cheque' | 'upi';

export default function Collect() {
  const params = useLocalSearchParams<{ customerId?: string }>();
  const { loadCustomers, recordCollection, online, user } = useSession();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(params.customerId ?? null);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<Mode>('cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [last, setLast] = useState<{ payload: NewCollection; name: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadCustomers()
        .then((r) => setCustomers(r.data))
        .catch(() => undefined);
    }, [loadCustomers]),
  );

  // Opening "Record collection" from a customer page preselects that shop.
  useEffect(() => {
    if (params.customerId) {
      setCustomerId(params.customerId);
      setDone(null);
    }
  }, [params.customerId]);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return customers.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)).slice(0, 8);
  }, [customers, search]);

  async function submit() {
    const next: Record<string, string> = {};
    const paise = parseRupees(amount);
    if (!customer) next.customer = 'Choose a shop';
    if (!paise || paise <= 0) next.amount = 'Enter an amount, e.g. 2500';
    if (mode !== 'cash' && !reference.trim()) next.reference = mode === 'cheque' ? 'Cheque number is required' : 'UPI reference (UTR) is required';
    setErrors(next);
    if (Object.keys(next).length > 0 || !customer || !paise) return;

    setBusy(true);
    try {
      const item = await recordCollection(
        {
          customer_id: customer.id,
          amount: paiseToRupeeString(paise),
          payment_mode: mode,
          payment_ref: reference.trim() || undefined,
          note: note.trim() || undefined,
        },
        customer.name,
      );
      setDone(
        online
          ? `${formatRupees(paise)} from ${customer.name} recorded. The shop will get a WhatsApp receipt.`
          : `${formatRupees(paise)} from ${customer.name} saved on this phone. It will sync and send the receipt when you're back online.`,
      );
      setLast({ payload: item.payload as NewCollection, name: customer.name });
      setAmount('');
      setReference('');
      setNote('');
      setCustomerId(null);
      setSearch('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
        {!online && <Banner tone="warn">You're offline. Collections are saved on this phone and sync automatically later.</Banner>}
        {done && (
          <Card style={{ borderColor: colors.good, borderWidth: 1.5 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <Ionicons name="checkmark-circle" size={26} color={colors.good} />
              <Text style={{ flex: 1, color: colors.ink, fontSize: 15, lineHeight: 21 }}>{done}</Text>
            </View>
            {last && (
              <View style={{ marginTop: space.md }}>
                <Button
                  title="Share receipt PDF"
                  icon="share-social"
                  variant="secondary"
                  compact
                  onPress={() => void sharePdf(receiptHtml(last.payload, last.name, user?.name ?? '', null), 'Payment receipt')}
                />
              </View>
            )}
          </Card>
        )}

        <Text style={ui.label}>Shop</Text>
        {customer ? (
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <Avatar name={customer.name} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{customer.name}</Text>
              <Text style={{ color: colors.muted }}>
                Owes {formatRupees(customer.balance_paise)}
                {customer.overdue_paise > 0 ? ` · ${formatRupees(customer.overdue_paise)} overdue` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <RiskBadge flag={customer.risk.flag} />
              <Text style={{ color: colors.brand }} onPress={() => setCustomerId(null)} accessibilityRole="button">
                Change
              </Text>
            </View>
          </Card>
        ) : (
          <View style={{ marginBottom: space.md }}>
            <SearchBox placeholder="Type shop name or phone" value={search} onChangeText={setSearch} accessibilityLabel="Search shop" />
            {errors.customer && <Text style={ui.error}>{errors.customer}</Text>}
            {matches.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  setCustomerId(c.id);
                  setDone(null);
                  setErrors((e) => ({ ...e, customer: '' }));
                }}
                style={{ paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', gap: 10, alignItems: 'center' }}
                accessibilityRole="button"
              >
                <Avatar name={c.name} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, color: colors.ink, fontWeight: '600' }}>{c.name}</Text>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Owes {formatRupees(c.balance_paise)}{c.area ? ` · ${c.area}` : ''}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        <Field
          label="Amount received (₹)"
          value={amount}
          onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          error={errors.amount}
          style={{ fontSize: 30, fontWeight: '800', paddingVertical: 14 }}
        />
        {customer && customer.overdue_paise > 0 && !amount && (
          <Pressable onPress={() => setAmount(paiseToRupeeString(customer.overdue_paise))} style={{ marginTop: -6, marginBottom: space.md }}>
            <Text style={{ color: colors.brandDark, fontWeight: '700' }}>Use overdue amount {formatRupees(customer.overdue_paise)}</Text>
          </Pressable>
        )}

        <Text style={ui.label}>Paid by</Text>
        <Segmented<Mode>
          options={[
            { value: 'cash', label: 'Cash', icon: 'cash-outline' },
            { value: 'upi', label: 'UPI', icon: 'phone-portrait-outline' },
            { value: 'cheque', label: 'Cheque', icon: 'document-text-outline' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode !== 'cash' && (
          <Field
            label={mode === 'cheque' ? 'Cheque number' : 'UPI reference (UTR)'}
            value={reference}
            onChangeText={setReference}
            keyboardType={mode === 'cheque' ? 'number-pad' : 'default'}
            autoCapitalize="characters"
            error={errors.reference}
          />
        )}
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. part payment for INV-140" />

        <Button title="Record and send receipt" icon="checkmark-circle" onPress={submit} busy={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
