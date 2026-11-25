import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { formatDate, formatRupees, KIND_LABEL, MODE_LABEL, timeAgo, type CustomerDetail } from '@credit-ledger/shared';
import { Banner, Button, Card, Center, RiskBadge, styles as ui } from '../../components/ui';
import { isStaff, useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

const AGING: Array<[keyof CustomerDetail['aging'], string]> = [
  ['not_due', 'Not due'],
  ['d1_30', '1–30 days'],
  ['d31_60', '31–60 days'],
  ['d61_90', '61–90 days'],
  ['d90_plus', '90+ days'],
];

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { loadCustomer, api, user, outboxItems, online } = useSession();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'link' | 'remind' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await loadCustomer(id);
      setDetail(r.data);
      setOfflineSince(r.offlineSince);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, loadCustomer]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (error && !detail) return <Center><Banner tone="bad">{error}</Banner></Center>;
  if (!detail) return <Center><Text style={ui.muted}>Loading…</Text></Center>;

  const c = detail.customer;
  const pending = outboxItems.filter((i) => i.payload.customer_id === id && i.status !== 'synced');

  async function shareStatement() {
    setBusy('link');
    setNotice(null);
    try {
      const { url } = await api.statementLink(id);
      const text = `Namaste ${c.name}, your current balance is ${formatRupees(detail!.balance_paise)}. See your full statement and pay by UPI: ${url}`;
      await Linking.openURL(`https://wa.me/${c.phone}?text=${encodeURIComponent(text)}`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function confirmReminder() {
    Alert.alert('Send WhatsApp reminder?', `${c.name} will get the official payment reminder with their statement link.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: () => void sendReminder() },
    ]);
  }

  async function sendReminder() {
    setBusy('remind');
    setNotice(null);
    try {
      const r = await api.sendReminder(id);
      setNotice(r.reminder.status === 'sent' ? 'Reminder sent.' : `Reminder failed: ${r.reminder.error ?? 'unknown error'}`);
      void load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Stack.Screen options={{ title: c.name }} />
      {offlineSince && <Banner tone="warn">Offline. Showing data saved {timeAgo(offlineSince)}.</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.muted }}>Balance</Text>
          <RiskBadge flag={detail.risk.flag} />
        </View>
        <Text style={{ fontSize: 30, fontWeight: '800', color: colors.ink }}>{formatRupees(detail.balance_paise)}</Text>
        <Text style={{ color: colors.muted, marginTop: 2 }}>
          Credit limit: {c.credit_limit_paise ? formatRupees(c.credit_limit_paise) : 'none'} · {c.credit_days} days credit
        </Text>
        {detail.risk.reasons.length > 0 && (
          <View style={{ marginTop: space.md, padding: space.md, backgroundColor: colors.bg, borderRadius: 8 }}>
            {detail.risk.flag === 'red' && (
              <Text style={{ color: colors.bad, fontWeight: '700', marginBottom: 4 }}>Collect before giving more credit</Text>
            )}
            {detail.risk.reasons.map((r) => (
              <Text key={r} style={{ color: colors.ink, marginBottom: 2 }}>• {r}</Text>
            ))}
          </View>
        )}
      </Card>

      {pending.length > 0 && (
        <Banner tone="info">
          {pending.length} collection{pending.length > 1 ? 's' : ''} recorded on this phone ({formatRupees(pending.reduce((s, p) => s + Math.round(Number(p.payload.amount) * 100), 0))}) not yet in this balance.
        </Banner>
      )}

      <View style={{ gap: space.sm, marginBottom: space.md }}>
        <Button title="Record collection" onPress={() => router.push({ pathname: '/collect', params: { customerId: id } })} />
        <Button title="Send statement on WhatsApp" variant="secondary" onPress={shareStatement} busy={busy === 'link'} disabled={!online} />
        {isStaff(user) && (
          <Button title="Send official reminder" variant="secondary" onPress={confirmReminder} busy={busy === 'remind'} disabled={!online || detail.balance_paise <= 0} />
        )}
      </View>

      <Card>
        <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: space.sm, color: colors.ink }}>By age</Text>
        {AGING.map(([k, label]) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ color: colors.muted }}>{label}</Text>
            <Text style={{ color: k !== 'not_due' && detail.aging[k] > 0 ? colors.bad : colors.ink, fontWeight: '600' }}>
              {formatRupees(detail.aging[k])}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={{ fontWeight: '700', fontSize: 16, marginBottom: space.sm, color: colors.ink }}>Recent entries</Text>
        {detail.statement.length === 0 && <Text style={ui.muted}>No entries yet.</Text>}
        {[...detail.statement]
          .reverse()
          .slice(0, 30)
          .map((l) => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>
                  {KIND_LABEL[l.kind]} {l.reference ?? ''}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {formatDate(l.entry_date)}
                  {l.payment_mode ? ` · ${MODE_LABEL[l.payment_mode]}` : ''}
                  {l.due_date && l.debit_paise > 0 ? ` · due ${formatDate(l.due_date)}` : ''}
                </Text>
              </View>
              <Text style={{ fontWeight: '700', color: l.credit_paise ? colors.good : colors.ink }}>
                {l.credit_paise ? `−${formatRupees(l.credit_paise)}` : formatRupees(l.debit_paise)}
              </Text>
            </View>
          ))}
      </Card>
    </ScrollView>
  );
}
