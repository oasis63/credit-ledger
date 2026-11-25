import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { formatDate, formatRupees, KIND_LABEL, MODE_LABEL, OUTCOME_LABEL, timeAgo, type CustomerDetail } from '@credit-ledger/shared';
import { ActionTile, Avatar, Banner, Card, Center, Ionicons, Pill, Progress, RiskBadge, SectionTitle, styles as ui } from '../../components/ui';
import { isStaff, useSession } from '../../lib/session';
import { colors, radius, space } from '../../lib/theme';

const AGING: Array<[keyof CustomerDetail['aging'], string, string]> = [
  ['not_due', 'Not due', '#5eead4'],
  ['d1_30', '1–30', '#fcd34d'],
  ['d31_60', '31–60', '#fb923c'],
  ['d61_90', '61–90', '#f87171'],
  ['d90_plus', '90+', '#b91c1c'],
];

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { loadCustomer, api, user, outboxItems, online } = useSession();
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qr, setQr] = useState<{ svg: string; amount_paise: number; vpa: string } | 'loading' | null>(null);
  const [tab, setTab] = useState<'entries' | 'bills' | 'visits'>('entries');

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
  useFocusEffect(useCallback(() => void load(), [load]));

  if (error && !detail) return <Center><Banner tone="bad">{error}</Banner></Center>;
  if (!detail) return <Center><ActivityIndicator color={colors.brand} /></Center>;

  const c = detail.customer;
  const pendingPay = outboxItems.filter((i) => i.kind !== 'visit' && i.payload.customer_id === id && i.status !== 'synced');
  const pendingPaise = pendingPay.reduce((s, p) => s + (p.kind === 'visit' ? 0 : Math.round(Number(p.payload.amount) * 100)), 0);
  const agingTotal = AGING.reduce((s, [k]) => s + detail.aging[k], 0);

  async function shareStatement() {
    setNotice(null);
    try {
      const { url } = await api.statementLink(id);
      const hello = c.contact_name ? `Namaste ${c.contact_name} ji` : `Namaste ${c.name}`;
      const text = `${hello}, your current balance is ${formatRupees(detail!.balance_paise)}. See your full statement and pay by UPI: ${url}`;
      await Linking.openURL(`https://wa.me/${c.phone}?text=${encodeURIComponent(text)}`);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function showQr() {
    setQr('loading');
    try {
      setQr(await api.upiQr(id));
    } catch (e) {
      setQr(null);
      setNotice((e as Error).message);
    }
  }

  function confirmReminder() {
    Alert.alert('Send WhatsApp reminder?', `${c.name} will get the official payment reminder with their statement link.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          try {
            const r = await api.sendReminder(id);
            setNotice(r.reminder.status === 'sent' ? 'Reminder sent.' : `Reminder failed: ${r.reminder.error ?? 'unknown error'}`);
            void load();
          } catch (e) {
            setNotice((e as Error).message);
          }
        },
      },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Stack.Screen options={{ title: '' }} />
      {offlineSince && <Banner tone="warn">Offline. Showing data saved {timeAgo(offlineSince)}.</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}

      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: space.lg }}>
        <Avatar name={c.name} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{c.name}</Text>
          <Text style={{ color: colors.muted }}>{[c.contact_name, c.area].filter(Boolean).join(' · ') || `+${c.phone}`}</Text>
          {detail.beat && <Text style={{ color: colors.brandDark, fontSize: 13, fontWeight: '600', marginTop: 2 }}>{detail.beat.name}</Text>}
        </View>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.muted, fontWeight: '600' }}>Balance</Text>
          <RiskBadge flag={detail.risk.flag} />
        </View>
        <Text style={{ fontSize: 34, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 }}>{formatRupees(detail.balance_paise)}</Text>
        {c.overdue_paise > 0 && <Text style={{ color: colors.bad, fontWeight: '700' }}>{formatRupees(c.overdue_paise)} overdue · oldest {detail.risk.max_days_overdue} days</Text>}
        {agingTotal > 0 && (
          <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: space.md, gap: 2 }}>
            {AGING.map(([k, , color]) => (detail.aging[k] > 0 ? <View key={k} style={{ flex: detail.aging[k], backgroundColor: color }} /> : null))}
          </View>
        )}
        {agingTotal > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            {AGING.filter(([k]) => detail.aging[k] > 0).map(([k, label, color]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
                <Text style={{ fontSize: 12, color: colors.muted }}>{label}: {formatRupees(detail.aging[k])}</Text>
              </View>
            ))}
          </View>
        )}
        {c.credit_limit_paise > 0 && (
          <View style={{ marginTop: space.md }}>
            <Progress value={detail.balance_paise} max={c.credit_limit_paise} color={detail.balance_paise > c.credit_limit_paise ? colors.bad : colors.brand} />
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
              {Math.round((detail.balance_paise / c.credit_limit_paise) * 100)}% of {formatRupees(c.credit_limit_paise)} limit · {c.credit_days} days credit
            </Text>
          </View>
        )}
        {detail.risk.flag === 'red' && <View style={{ marginTop: space.md }}><Pill tone="bad" label="Collect before giving more credit" /></View>}
      </Card>

      {pendingPay.length > 0 && (
        <Banner tone="info">{formatRupees(pendingPaise)} recorded on this phone is not in this balance yet (waiting to sync).</Banner>
      )}

      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.sm }}>
        <ActionTile icon="wallet" label="Collect" tone="good" onPress={() => router.push({ pathname: '/collect', params: { customerId: id } })} />
        <ActionTile icon="location" label="Check in" onPress={() => router.push({ pathname: '/visit/[id]', params: { id, name: c.name } })} />
        <ActionTile icon="qr-code" label="UPI QR" tone="blue" onPress={() => void showQr()} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
        <ActionTile icon="call" label="Call" onPress={() => void Linking.openURL(`tel:+${c.phone}`)} />
        <ActionTile icon="logo-whatsapp" label="Statement" tone="good" onPress={() => void shareStatement()} />
        {c.lat !== null && c.lng !== null ? (
          <ActionTile icon="navigate" label="Directions" tone="blue" onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`)} />
        ) : isStaff(user) ? (
          <ActionTile icon="notifications" label="Remind" tone="warn" onPress={confirmReminder} />
        ) : (
          <ActionTile icon="navigate" label="Search map" tone="blue" onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name} ${c.address ?? c.area ?? ''}`)}`)} />
        )}
      </View>

      {qr && (
        <Card style={{ alignItems: 'center' }}>
          {qr === 'loading' ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: space.sm }}>Scan with any UPI app</Text>
              <View style={{ backgroundColor: '#fff', padding: 8, borderRadius: radius.md }}>
                <SvgXml xml={qr.svg} width={220} height={220} />
              </View>
              <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink, marginTop: space.sm }}>{formatRupees(qr.amount_paise)}</Text>
              <Text style={ui.muted}>to {qr.vpa}</Text>
              <Pressable onPress={() => setQr(null)} style={{ marginTop: space.md }}><Text style={{ color: colors.brandDark, fontWeight: '700' }}>Close</Text></Pressable>
            </>
          )}
        </Card>
      )}
      {!online && <Text style={[ui.muted, { fontSize: 12.5, marginBottom: space.md }]}>UPI QR, statement links and reminders need internet.</Text>}

      <View style={{ flexDirection: 'row', backgroundColor: colors.sunken, borderRadius: radius.sm + 2, padding: 4, gap: 4, marginBottom: space.md }}>
        {([['entries', 'Statement'], ['bills', `Bills (${detail.bills.length})`], ['visits', `Visits (${detail.visits.length})`]] as const).map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center', backgroundColor: tab === k ? '#fff' : 'transparent' }}>
            <Text style={{ fontWeight: '700', color: tab === k ? colors.ink : colors.muted }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'entries' && (
        <Card padded={false}>
          {detail.statement.length === 0 && <Text style={[ui.muted, { padding: space.lg }]}>No entries yet.</Text>}
          {[...detail.statement].reverse().slice(0, 40).map((l, i) => (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <View style={{ flex: 1, paddingRight: space.sm }}>
                <Text style={{ color: colors.ink, fontWeight: '700' }}>{KIND_LABEL[l.kind]} {l.reference ?? ''}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>
                  {formatDate(l.entry_date)}{l.payment_mode ? ` · ${MODE_LABEL[l.payment_mode]}` : ''}{l.due_date && l.debit_paise > 0 ? ` · due ${formatDate(l.due_date)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontWeight: '800', color: l.credit_paise ? colors.good : colors.ink }}>
                  {l.credit_paise ? `−${formatRupees(l.credit_paise)}` : formatRupees(l.debit_paise)}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>bal {formatRupees(l.running_balance_paise)}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}
      {tab === 'bills' && (
        <Card padded={false}>
          {detail.bills.length === 0 && <Text style={[ui.muted, { padding: space.lg }]}>No GST bills yet.</Text>}
          {detail.bills.map((b, i) => (
            <Pressable key={b.id} onPress={() => router.push({ pathname: '/bill/[id]', params: { id: b.id } })} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }, pressed && { backgroundColor: colors.sunken }]}>
              <Ionicons name="document-text-outline" size={20} color={colors.brand} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontWeight: '700', color: b.cancelled_at ? colors.muted : colors.ink }}>{b.bill_no}{b.cancelled_at ? ' · cancelled' : ''}</Text>
                <Text style={{ color: colors.muted, fontSize: 13 }}>{formatDate(b.bill_date)} · due {formatDate(b.due_date)}</Text>
              </View>
              <Text style={{ fontWeight: '800', color: colors.ink }}>{formatRupees(b.total_paise)}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Pressable>
          ))}
        </Card>
      )}
      {tab === 'visits' && (
        <Card padded={false}>
          {detail.visits.length === 0 && <Text style={[ui.muted, { padding: space.lg }]}>No visits yet.</Text>}
          {detail.visits.map((v, i) => (
            <View key={v.id} style={{ padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <Text style={{ fontWeight: '700', color: colors.ink }}>{OUTCOME_LABEL[v.outcome]}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{v.salesman_name} · {timeAgo(v.created_at)}{v.note ? ` · “${v.note}”` : ''}</Text>
            </View>
          ))}
        </Card>
      )}
      <SectionTitle>Details</SectionTitle>
      <Card>
        <Text style={ui.muted}>Phone: +{c.phone}{c.gstin ? `  ·  GSTIN ${c.gstin}` : ''}</Text>
        {c.address && <Text style={[ui.muted, { marginTop: 4 }]}>{c.address}</Text>}
      </Card>
    </ScrollView>
  );
}
