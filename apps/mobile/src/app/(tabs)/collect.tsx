import { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { formatRupees, paiseToRupeeString, parseRupees, type CustomerSummary } from '@credit-ledger/shared';
import { Banner, Button, Card, Field, RiskBadge, Segmented, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

type Mode = 'cash' | 'cheque' | 'upi';

export default function Collect() {
  const params = useLocalSearchParams<{ customerId?: string }>();
  const { loadCustomers, recordCollection, online } = useSession();
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
      await recordCollection(
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
        {done && <Banner tone="good">{done}</Banner>}

        <Text style={ui.label}>Shop</Text>
        {customer ? (
          <Card style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <TextInput
              placeholder="Type shop name or phone"
              placeholderTextColor="#98a2a0"
              value={search}
              onChangeText={setSearch}
              style={[ui.input, errors.customer ? { borderColor: colors.bad } : null]}
              accessibilityLabel="Search shop"
            />
            {errors.customer && <Text style={ui.error}>{errors.customer}</Text>}
            {matches.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  setCustomerId(c.id);
                  setDone(null);
                  setErrors((e) => ({ ...e, customer: '' }));
                }}
                style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 16, color: colors.ink }}>{c.name}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>Owes {formatRupees(c.balance_paise)}</Text>
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
          style={{ fontSize: 24, fontWeight: '700' }}
        />

        <Text style={ui.label}>Paid by</Text>
        <Segmented<Mode>
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'cheque', label: 'Cheque' },
            { value: 'upi', label: 'UPI' },
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

        <Button title="Record and send receipt" onPress={submit} busy={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
