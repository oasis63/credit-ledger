import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { OUTCOME_LABEL, type VisitOutcome } from '@credit-ledger/shared';
import { Banner, Button, Field, Ionicons, type IconName } from '../../components/ui';
import { currentFix, type Fix } from '../../lib/location';
import { useSession } from '../../lib/session';
import { colors, radius, space } from '../../lib/theme';

const OPTIONS: Array<{ value: VisitOutcome; icon: IconName; tone: string }> = [
  { value: 'collected', icon: 'cash-outline', tone: colors.good },
  { value: 'promised', icon: 'calendar-outline', tone: colors.blue },
  { value: 'order_taken', icon: 'cart-outline', tone: colors.brand },
  { value: 'no_payment', icon: 'close-circle-outline', tone: colors.warn },
  { value: 'owner_absent', icon: 'person-remove-outline', tone: colors.muted },
  { value: 'shop_closed', icon: 'lock-closed-outline', tone: colors.muted },
];

/** Check in at a shop: what happened, plus a GPS fix (saved offline if needed). */
export default function VisitScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const router = useRouter();
  const { recordVisit, online } = useSession();
  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [note, setNote] = useState('');
  const [fix, setFix] = useState<Fix | null | 'pending'>('pending');
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void currentFix().then((f) => alive && setFix(f));
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    if (!outcome) return;
    setBusy(true);
    try {
      const f = fix && fix !== 'pending' ? fix : null;
      await recordVisit(
        { customer_id: id, outcome, note: note.trim() || undefined, ...(f ? { lat: f.lat, lng: f.lng, accuracy_m: Math.round(f.accuracy_m) } : {}), pin_shop: pin || undefined },
        name ?? 'Shop',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      if (outcome === 'collected') router.replace({ pathname: '/collect', params: { customerId: id } });
      else router.back();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: name ? `Visit · ${name}` : 'Check in' }} />
      {!online && <Banner tone="warn">Offline. The visit is saved on this phone and syncs later.</Banner>}
      <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: space.sm }}>What happened?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg }}>
        {OPTIONS.map((o) => {
          const on = outcome === o.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setOutcome(o.value)}
              style={{
                width: '48%', flexGrow: 1, padding: space.md, borderRadius: radius.md, borderWidth: on ? 2 : 1,
                borderColor: on ? o.tone : colors.line, backgroundColor: on ? '#fff' : colors.card, gap: 8,
              }}
            >
              <Ionicons name={o.icon} size={24} color={o.tone} />
              <Text style={{ fontWeight: '700', color: colors.ink }}>{OUTCOME_LABEL[o.value]}</Text>
            </Pressable>
          );
        })}
      </View>
      <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder={outcome === 'promised' ? 'e.g. Will pay ₹5,000 on Saturday' : 'Anything the office should know'} multiline />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: space.md, borderRadius: radius.sm, backgroundColor: colors.sunken, marginBottom: space.md }}>
        <Ionicons name={fix && fix !== 'pending' ? 'location' : 'location-outline'} size={20} color={fix && fix !== 'pending' ? colors.good : colors.muted} />
        <Text style={{ flex: 1, color: colors.text2 }}>
          {fix === 'pending' ? 'Getting your location…' : fix ? `Location found (±${Math.round(fix.accuracy_m)} m)` : 'No location. The visit is saved without it.'}
        </Text>
        {fix && fix !== 'pending' && fix.accuracy_m <= 100 && (
          <Pressable onPress={() => setPin((p) => !p)} accessibilityRole="checkbox" accessibilityState={{ checked: pin }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name={pin ? 'checkbox' : 'square-outline'} size={20} color={colors.brand} />
            <Text style={{ color: colors.brandDark, fontWeight: '600', fontSize: 13 }}>Pin shop here</Text>
          </Pressable>
        )}
      </View>
      <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: space.lg }}>The first check-in at a shop pins it on the office map. Tick “Pin shop here” to correct a wrong pin.</Text>

      <Button title={outcome === 'collected' ? 'Save and record payment' : 'Save visit'} icon="checkmark-circle" onPress={save} busy={busy} disabled={!outcome} />
    </ScrollView>
  );
}
