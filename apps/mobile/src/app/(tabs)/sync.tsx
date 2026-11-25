import { useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { formatDate, formatRupees, MODE_LABEL, OUTCOME_LABEL, timeAgo, type OutboxItem } from '@credit-ledger/shared';
import { Banner, Button, Card, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

const STATUS: Record<OutboxItem['status'], { label: string; color: string }> = {
  pending: { label: 'Waiting to sync', color: colors.warn },
  synced: { label: 'Synced', color: colors.good },
  failed: { label: 'Rejected by server', color: colors.bad },
};

export default function SyncScreen() {
  const { outboxItems, pendingCount, online, lastSync, syncNow, retryItem, discardItem } = useSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await syncNow();
      if (r) setMessage(r.stoppedEarly ? 'Could not reach the server. Will retry automatically.' : `Synced ${r.synced}. ${r.remaining} waiting.`);
    } finally {
      setBusy(false);
    }
  }

  function confirmDiscard(item: OutboxItem) {
    const what = item.kind === 'visit' ? `The visit to ${item.customer_name}` : `${formatRupees(Math.round(Number(item.payload.amount) * 100))} from ${item.customer_name}`;
    Alert.alert('Discard this item?', `${what} will be removed from this phone. Only do this if it was entered by mistake.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void discardItem(item.client_ref) },
    ]);
  }

  const items = [...outboxItems].reverse();

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.client_ref}
      contentContainerStyle={{ padding: space.lg }}
      ListHeaderComponent={
        <View style={{ marginBottom: space.md }}>
          <Banner tone={online ? 'good' : 'warn'}>{online ? 'Online' : 'Offline: collections are safe on this phone.'}</Banner>
          <Text style={{ fontSize: 16, color: colors.ink, marginBottom: space.sm }}>
            {pendingCount === 0 ? 'Everything is synced.' : `${pendingCount} item${pendingCount > 1 ? 's' : ''} waiting to sync.`}
          </Text>
          {lastSync && <Text style={[ui.muted, { marginBottom: space.sm }]}>Last sync: {timeAgo(lastSync.at)}</Text>}
          {message && <Banner tone="info">{message}</Banner>}
          <Button title="Sync now" onPress={run} busy={busy} disabled={pendingCount === 0} />
        </View>
      }
      ListEmptyComponent={<Text style={ui.muted}>Collections and visits you record appear here until they reach the office.</Text>}
      renderItem={({ item }) => {
        const s = STATUS[item.status];
        return (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink, flex: 1 }}>{item.customer_name}</Text>
              <Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink }}>
                {item.kind === 'visit' ? 'Visit' : formatRupees(Math.round(Number(item.payload.amount) * 100))}
              </Text>
            </View>
            <Text style={ui.muted}>
              {item.kind === 'visit'
                ? `${OUTCOME_LABEL[item.payload.outcome]} · ${formatDate(item.payload.visited_on)}${item.payload.lat !== undefined ? ' · with location' : ''}`
                : `${MODE_LABEL[item.payload.payment_mode]}${item.payload.payment_ref ? ` ${item.payload.payment_ref}` : ''} · ${formatDate(item.payload.collected_on)}`}
            </Text>
            <Text style={{ color: s.color, fontWeight: '600', marginTop: 4 }}>
              {s.label}
              {item.receipt_no ? ` · #${item.receipt_no}` : ''}
            </Text>
            {item.last_error && item.status !== 'synced' && <Text style={[ui.muted, { fontSize: 13 }]}>{item.last_error}</Text>}
            {item.status === 'failed' && (
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Button title="Retry" variant="secondary" onPress={() => void retryItem(item.client_ref)} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Discard" variant="danger" onPress={() => confirmDiscard(item)} />
                </View>
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}
