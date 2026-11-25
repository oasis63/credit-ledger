import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { formatRupees, OUTCOME_LABEL, timeAgo, type FieldToday, type VisitOutcome } from '@credit-ledger/shared';
import { Banner, Button, Card, Empty, Ionicons, Pill, Progress, SectionTitle, styles as ui } from '../../components/ui';
import { useSession } from '../../lib/session';
import { colors, radius, shadow, space } from '../../lib/theme';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Today() {
  const router = useRouter();
  const { user, loadToday, outboxItems, online } = useSession();
  const [data, setData] = useState<FieldToday | null>(null);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await loadToday();
      setData(r.data);
      setOfflineSince(r.offlineSince);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadToday]);
  useFocusEffect(useCallback(() => void load(), [load]));

  // Visits and collections saved on the phone but not yet synced still count.
  const local = useMemo(() => {
    const visits = new Map<string, VisitOutcome>();
    let collected = 0;
    for (const i of outboxItems) {
      if (i.status === 'synced') continue;
      if (i.kind === 'visit') visits.set(i.payload.customer_id, i.payload.outcome);
      else collected += Math.round(Number(i.payload.amount) * 100);
    }
    return { visits, collected };
  }, [outboxItems]);

  const stops = data?.stops ?? [];
  const visited = stops.filter((s) => s.visit || local.visits.has(s.id)).length;
  const collected = (data?.collected_paise ?? 0) + local.collected;
  const target = data?.target_paise ?? 0;
  const next = stops.find((s) => !s.visit && !local.visits.has(s.id));
  const hour = new Date().getHours();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: space.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => (setRefreshing(true), await load(), setRefreshing(false))} />}
    >
      <LinearGradient colors={[colors.brand, colors.brandDark, colors.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingBottom: 56 }}>
        <SafeAreaView edges={['top']} style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <Text style={{ color: '#ccfbf1', fontSize: 14, fontWeight: '600' }}>
            {data ? `${DAYS[data.weekday]} · ${data.beats.map((b) => b.name).join(', ') || 'No beat today'}` : 'Your day'}
          </Text>
          <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 4 }}>
            {hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {user?.name.split(' ')[0]}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? '#5eead4' : '#fbbf24' }} />
            <Text style={{ color: '#ccfbf1', fontSize: 13 }}>{online ? 'Online' : 'Offline: everything is saved on this phone'}</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

      <View style={{ paddingHorizontal: space.lg, marginTop: -40 }}>
        <View style={[ui.card, { padding: space.lg, ...shadow, shadowOpacity: 0.12 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={{ color: colors.muted, fontWeight: '600', fontSize: 13 }}>Collected today</Text>
              <Text style={{ fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 }}>{formatRupees(collected)}</Text>
            </View>
            {target > 0 && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Target</Text>
                <Text style={{ fontWeight: '800', color: colors.ink }}>{formatRupees(target)}</Text>
              </View>
            )}
          </View>
          {target > 0 && (
            <View style={{ marginTop: space.md }}>
              <Progress value={collected} max={target} color={collected >= target ? colors.good : colors.brand} height={10} />
              <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 6 }}>
                {collected >= target ? 'Target reached. Great work!' : `${formatRupees(target - collected)} to go · ${Math.round((collected / target) * 100)}%`}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', marginTop: space.lg, gap: space.sm }}>
            <Stat label="Shops visited" value={`${visited}/${stops.length}`} />
            <Stat label="Overdue on route" value={formatRupees(data?.to_collect_paise ?? 0)} bad={(data?.to_collect_paise ?? 0) > 0} />
          </View>
        </View>

        {offlineSince && <Banner tone="warn">Showing your route saved {timeAgo(offlineSince)}.</Banner>}
        {error && !data && <Banner tone="bad">{error}</Banner>}

        {next && (
          <>
            <SectionTitle>Next stop</SectionTitle>
            <Card style={{ borderColor: colors.brand, borderWidth: 1.5 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>{next.name}</Text>
              <Text style={{ color: colors.muted, marginTop: 2 }}>{[next.contact_name, next.address ?? next.area].filter(Boolean).join(' · ')}</Text>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
                {next.overdue_paise > 0 ? <Pill tone="bad" label={`Overdue ${formatRupees(next.overdue_paise)}`} /> : <Pill tone="neutral" label={`Owes ${formatRupees(next.balance_paise)}`} />}
              </View>
              <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                <View style={{ flex: 1 }}>
                  <Button title="Check in" icon="location" compact onPress={() => router.push({ pathname: '/visit/[id]', params: { id: next.id, name: next.name } })} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Collect" icon="wallet" variant="secondary" compact onPress={() => router.push({ pathname: '/collect', params: { customerId: next.id } })} />
                </View>
                {next.lat !== null && (
                  <Pressable accessibilityLabel="Directions" onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}`)} style={iconBtn}>
                    <Ionicons name="navigate" size={20} color={colors.brandDark} />
                  </Pressable>
                )}
              </View>
            </Card>
          </>
        )}

        <SectionTitle right={<Text style={{ color: colors.muted, fontSize: 13 }}>{stops.length} shops</Text>}>Route</SectionTitle>
        {data && stops.length === 0 && (
          <Card><Empty icon="map-outline" title="No route for today">{user?.role === 'salesman' ? 'Ask your office to add you to a beat for this day. You can still collect from any shop in Customers.' : 'Beats are planned on the web app under Field & beats.'}</Empty></Card>
        )}
        {stops.length > 0 && (
          <Card padded={false}>
            {stops.map((s, i) => {
              const outcome = s.visit?.outcome ?? local.visits.get(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => router.push({ pathname: '/customer/[id]', params: { id: s.id } })}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }, pressed && { backgroundColor: colors.sunken }]}
                >
                  <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: outcome ? colors.goodTint : colors.brandTint }}>
                    {outcome ? <Ionicons name="checkmark" size={17} color={colors.good} /> : <Text style={{ fontWeight: '800', color: colors.brandDark }}>{i + 1}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', fontSize: 15.5, color: outcome ? colors.muted : colors.ink }} numberOfLines={1}>{s.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                      {outcome ? `${OUTCOME_LABEL[outcome]}${s.visit ? '' : ' · not synced yet'}` : [s.contact_name, s.area].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontWeight: '800', color: s.overdue_paise > 0 ? colors.bad : colors.ink }}>{formatRupees(s.overdue_paise > 0 ? s.overdue_paise : s.balance_paise)}</Text>
                    <Text style={{ fontSize: 11.5, color: colors.muted }}>{s.overdue_paise > 0 ? 'overdue' : 'balance'}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}

        {(data?.overdue_elsewhere.length ?? 0) > 0 && (
          <>
            <SectionTitle>Overdue on your other beats</SectionTitle>
            <Card padded={false}>
              {data!.overdue_elsewhere.map((o, i) => (
                <Pressable key={o.id} onPress={() => router.push({ pathname: '/customer/[id]', params: { id: o.id } })} style={{ flexDirection: 'row', padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: colors.ink }}>{o.name}</Text>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{[o.area, o.beat_name].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Text style={{ fontWeight: '800', color: colors.bad }}>{formatRupees(o.overdue_paise)}</Text>
                </Pressable>
              ))}
            </Card>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const iconBtn = { width: 44, height: 38, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: '#fff' };

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.sunken, borderRadius: radius.sm, padding: space.md }}>
      <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '800', color: bad ? colors.bad : colors.ink, marginTop: 2 }}>{value}</Text>
    </View>
  );
}
