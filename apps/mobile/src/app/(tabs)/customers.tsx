import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatRupees, timeAgo, type CustomerSummary } from '@credit-ledger/shared';
import { Avatar, Banner, Center, Empty, RiskBadge, SearchBox, Segmented, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, radius, shadow, space } from '../../lib/theme';

type Sort = 'overdue' | 'name' | 'area';

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
  useFocusEffect(useCallback(() => void load(), [load]));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (customers ?? []).filter(
      (c) => !q || [c.name, c.phone, c.contact_name ?? '', c.area ?? ''].some((x) => x.toLowerCase().includes(q)),
    );
    return filtered.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'area' ? (a.area ?? '~').localeCompare(b.area ?? '~') || a.name.localeCompare(b.name) : b.overdue_paise - a.overdue_paise || b.balance_paise - a.balance_paise,
    );
  }, [customers, query, sort]);

  const total = (customers ?? []).reduce((s, c) => s + Math.max(0, c.balance_paise), 0);
  const overdue = (customers ?? []).reduce((s, c) => s + c.overdue_paise, 0);

  if (!customers && !error) return <Center><Text style={ui.muted}>Loading customers…</Text></Center>;

  return (
    <FlatList
      data={list}
      keyExtractor={(c) => c.id}
      contentContainerStyle={{ padding: space.lg, paddingTop: space.sm }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} />}
      ListHeaderComponent={
        <View>
          {offlineSince && <Banner tone="warn">Offline. Showing data saved {timeAgo(offlineSince)}.</Banner>}
          {pendingCount > 0 && <Banner tone="info">{pendingCount} item{pendingCount > 1 ? 's' : ''} waiting to sync.</Banner>}
          {error && <Banner tone="bad">{error}</Banner>}
          <View style={{ flexDirection: 'row', gap: space.sm, marginBottom: space.md }}>
            <View style={[tile, { backgroundColor: colors.brandTint }]}>
              <Text style={tileLabel}>They owe</Text>
              <Text style={[tileValue, { color: colors.brandDark }]}>{formatRupees(total)}</Text>
            </View>
            <View style={[tile, { backgroundColor: colors.badTint }]}>
              <Text style={tileLabel}>Overdue</Text>
              <Text style={[tileValue, { color: colors.bad }]}>{formatRupees(overdue)}</Text>
            </View>
          </View>
          <SearchBox placeholder="Search shop, owner, phone or area" value={query} onChangeText={setQuery} accessibilityLabel="Search customers" />
          <Segmented<Sort>
            options={[{ value: 'overdue', label: 'Overdue' }, { value: 'area', label: 'Area' }, { value: 'name', label: 'A–Z' }]}
            value={sort}
            onChange={setSort}
          />
        </View>
      }
      ListEmptyComponent={<Empty icon="people-outline" title={query ? 'No matching shops' : 'No customers yet'}>{query ? undefined : 'The office adds customers on the web app.'}</Empty>}
      renderItem={({ item: c }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/customer/[id]', params: { id: c.id } })}
          accessibilityRole="button"
          accessibilityLabel={`${c.name}, owes ${formatRupees(c.balance_paise)}`}
          style={({ pressed }) => [row, pressed && { opacity: 0.8 }]}
        >
          <Avatar name={c.name} size={42} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }} numberOfLines={1}>{c.name}</Text>
            <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>{[c.contact_name, c.area].filter(Boolean).join(' · ') || `+${c.phone}`}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={{ fontWeight: '800', fontSize: 15.5, color: c.overdue_paise > 0 ? colors.bad : colors.ink }}>{formatRupees(c.overdue_paise > 0 ? c.overdue_paise : c.balance_paise)}</Text>
            {c.balance_paise > 0 ? <RiskBadge flag={c.risk.flag} /> : <Text style={{ fontSize: 12, color: colors.good, fontWeight: '700' }}>Settled</Text>}
          </View>
        </Pressable>
      )}
    />
  );
}

const tile = { flex: 1, borderRadius: radius.md, padding: space.md };
const tileLabel = { fontSize: 12.5, fontWeight: '600' as const, color: colors.text2 };
const tileValue = { fontSize: 20, fontWeight: '800' as const, marginTop: 2 };
const row = {
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, backgroundColor: colors.card, padding: space.md,
  borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginBottom: space.sm, ...shadow,
};
