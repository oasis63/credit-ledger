import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { RISK_LABEL, type RiskFlag } from '@credit-ledger/shared';
import { colors, riskColors, space } from '../lib/theme';

export function RiskBadge({ flag }: { flag: RiskFlag }) {
  const c = riskColors[flag];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]} accessibilityLabel={`Risk: ${RISK_LABEL[flag]}`}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{RISK_LABEL[flag]}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.dangerBtn,
        (pressed || isDisabled) && { opacity: 0.7 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.brand} />
      ) : (
        <Text style={[styles.buttonText, variant !== 'primary' && { color: variant === 'danger' ? colors.bad : colors.brand }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#98a2a0" {...props} style={[styles.input, error ? { borderColor: colors.bad } : null, props.style]} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const map = {
    info: { bg: colors.brandTint, fg: colors.brandDark },
    warn: { bg: colors.warnTint, fg: colors.warn },
    bad: { bg: colors.badTint, fg: colors.bad },
    good: { bg: colors.goodTint, fg: colors.good },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg }]} accessibilityRole="alert">
      <Text style={{ color: map.fg, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export const styles = StyleSheet.create({
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: space.lg, marginBottom: space.md },
  button: { minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1 },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand },
  secondary: { backgroundColor: '#fff', borderColor: colors.brand },
  dangerBtn: { backgroundColor: '#fff', borderColor: colors.bad },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  label: { fontSize: 14, color: colors.muted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#c9d3d0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 17, color: colors.ink, backgroundColor: '#fff' },
  error: { color: colors.bad, fontSize: 13, marginTop: 4 },
  banner: { padding: space.md, borderRadius: 10, marginBottom: space.md },
  segmented: { flexDirection: 'row', borderWidth: 1, borderColor: colors.brand, borderRadius: 10, overflow: 'hidden', marginBottom: space.md },
  segment: { flex: 1, paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff' },
  segmentOn: { backgroundColor: colors.brand },
  segmentText: { fontSize: 15, fontWeight: '600', color: colors.brand },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  muted: { color: colors.muted },
});
