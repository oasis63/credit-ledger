import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatRupees, timeAgo, type CustomerSummary } from '@credit-ledger/shared';
import { Banner, Center, RiskBadge, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

type Sort = 'overdue' | 'name';

export default function Customers() {
  const { loadCustomers, pendingCount } = useSession();
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerSummary[] | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('overdue');

  const load = useCallback(async () => {
    try {
      const r = await loadCustomers();
      setCustomers(r.data);
      setOfflineSince(r.offlineSince);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadCustomers]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (customers ?? []).filter((c) => !q || c.name.toLowerCase().includes(q) || c.phone.includes(q));
    return filtered.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b.overdue_paise - a.overdue_paise || b.balance_paise - a.balance_paise));
  }, [customers, query, sort]);

  const totalOverdue = (customers ?? []).reduce((s, c) => s + c.overdue_paise, 0);

  if (!customers && !error) return <Center><Text style={ui.muted}>Loading customers…</Text></Center>;

  return (
    <FlatList
      data={list}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: space.lg }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        <View>
          {offlineSince && <Banner tone="warn">Offline. Showing data saved {timeAgo(offlineSince)}.</Banner>}
          {pendingCount > 0 && <Banner tone="info">{pendingCount} collection{pendingCount > 1 ? 's' : ''} waiting to sync.</Banner>}
          {error && <Banner tone="bad">{error}</Banner>}
          <Text style={{ fontSize: 14, color: colors.muted }}>Overdue across all shops</Text>
          <Text style={{ fontSize: 26, fontWeight: '800', color: totalOverdue > 0 ? colors.bad : colors.ink, marginBottom: space.md }}>
            {formatRupees(totalOverdue)}
          </Text>
          <TextInput
            placeholder="Search shop or phone"
            placeholderTextColor="#98a2a0"
            value={query}
            onChangeText={setQuery}
            style={[ui.input, { marginBottom: space.sm }]}
            accessibilityLabel="Search customers"
          />
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
            {(['overdue', 'name'] as Sort[]).map((s) => (
              <Pressable key={s} onPress={() => setSort(s)} accessibilityRole="button" accessibilityState={{ selected: sort === s }}>
                <Text style={{ color: sort === s ? colors.brand : colors.muted, fontWeight: sort === s ? '700' : '400' }}>
                  {s === 'overdue' ? 'Most overdue' : 'A–Z'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      }
      ListEmptyComponent={<Text style={ui.muted}>{query ? 'No matching shops.' : 'No customers yet. The office adds them on the web app.'}</Text>}
      renderItem={({ item: c }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/customer/[id]', params: { id: c.id } })}
          accessibilityRole="button"
          accessibilityLabel={`${c.name}, owes ${formatRupees(c.balance_paise)}`}
          style={({ pressed }) => [ui.card, { paddingVertical: space.md }, pressed && { opacity: 0.8 }]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{c.name}</Text>
              <Text style={{ color: colors.muted, marginTop: 2 }}>Owes {formatRupees(c.balance_paise)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <RiskBadge flag={c.risk.flag} />
              {c.overdue_paise > 0 && <Text style={{ color: colors.bad, fontWeight: '700' }}>{formatRupees(c.overdue_paise)} overdue</Text>}
            </View>
          </View>
        </Pressable>
      )}
    />
  );
}
