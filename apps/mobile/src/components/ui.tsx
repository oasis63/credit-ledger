import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { RISK_LABEL, type RiskFlag } from '@credit-ledger/shared';
import { colors, radius, riskColors, shadow, space } from '../lib/theme';

export type IconName = keyof typeof Ionicons.glyphMap;
export { Ionicons };

export function RiskBadge({ flag }: { flag: RiskFlag }) {
  const c = riskColors[flag];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]} accessibilityLabel={`Risk: ${RISK_LABEL[flag]}`}>
      <View style={[styles.badgeDot, { backgroundColor: c.fg }]} />
      <Text style={[styles.badgeText, { color: c.fg }]}>{RISK_LABEL[flag]}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'blue' | 'brand' }) {
  const map = {
    neutral: [colors.sunken, colors.text2],
    good: [colors.goodTint, colors.good],
    warn: [colors.warnTint, colors.warn],
    bad: [colors.badTint, colors.bad],
    blue: [colors.blueTint, colors.blue],
    brand: [colors.brandTint, colors.brandDark],
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: map[0] }]}>
      <Text style={[styles.pillText, { color: map[1] }]}>{label}</Text>
    </View>
  );
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: ViewStyle | ViewStyle[]; padded?: boolean }) {
  return <View style={[styles.card, !padded && { padding: 0 }, style as ViewStyle]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  icon,
  compact = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  compact?: boolean;
}) {
  const isDisabled = disabled || busy;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.bad : colors.brandDark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.dangerBtn,
        variant === 'ghost' && styles.ghost,
        (pressed || isDisabled) && { opacity: 0.7 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon && <Ionicons name={icon} size={compact ? 16 : 19} color={fg} />}
          <Text style={[styles.buttonText, compact && { fontSize: 14 }, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Square action tile with an icon, used in action grids. */
export function ActionTile({ icon, label, onPress, tone = 'brand' }: { icon: IconName; label: string; onPress: () => void; tone?: 'brand' | 'good' | 'blue' | 'warn' }) {
  const c = { brand: [colors.brandTint, colors.brandDark], good: [colors.goodTint, colors.good], blue: [colors.blueTint, colors.blue], warn: [colors.warnTint, colors.warn] }[tone];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}>
      <View style={[styles.tileIcon, { backgroundColor: c[0] }]}>
        <Ionicons name={icon} size={20} color={c[1]} />
      </View>
      <Text style={styles.tileText} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, error, hint, ...props }: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.faint} {...props} style={[styles.input, error ? { borderColor: colors.bad } : null, props.style]} />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function SearchBox(props: TextInputProps) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.faint} />
      <TextInput placeholderTextColor={colors.faint} {...props} style={styles.searchInput} />
    </View>
  );
}

export function Banner({ tone, children, icon }: { tone: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode; icon?: IconName }) {
  const map = {
    info: { bg: colors.brandTint, fg: colors.brandDark, i: 'information-circle' as IconName },
    warn: { bg: colors.warnTint, fg: colors.warn, i: 'cloud-offline' as IconName },
    bad: { bg: colors.badTint, fg: colors.bad, i: 'alert-circle' as IconName },
    good: { bg: colors.goodTint, fg: colors.good, i: 'checkmark-circle' as IconName },
  }[tone];
  return (
    <View style={[styles.banner, { backgroundColor: map.bg }]} accessibilityRole="alert">
      <Ionicons name={icon ?? map.i} size={18} color={map.fg} />
      <Text style={{ color: map.fg, fontSize: 14, flex: 1, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string; icon?: IconName }>; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.segment, on && styles.segmentOn]}>
            {o.icon && <Ionicons name={o.icon} size={16} color={on ? colors.ink : colors.muted} />}
            <Text style={[styles.segmentText, on && { color: colors.ink }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Progress({ value, max, color = colors.good, track = colors.sunken, height = 8 }: { value: number; max: number; color?: string; track?: string; height?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: color }} />
    </View>
  );
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: `hsl(${h}, 70%, 93%)` }}>
      <Text style={{ fontWeight: '800', fontSize: size * 0.36, color: `hsl(${h}, 45%, 32%)` }}>{initials || '?'}</Text>
    </View>
  );
}

export function Empty({ icon = 'file-tray-outline', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={26} color={colors.faint} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children ? <Text style={styles.emptyBody}>{children}</Text> : null}
    </View>
  );
}

export function Center({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  pillText: { fontSize: 11.5, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.lg, marginBottom: space.md, ...shadow },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm, marginBottom: space.sm },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  button: { minHeight: 50, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1 },
  buttonCompact: { minHeight: 38, paddingHorizontal: 12 },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primary: { backgroundColor: colors.brand, borderColor: colors.brand, ...shadow },
  secondary: { backgroundColor: '#fff', borderColor: colors.lineStrong },
  dangerBtn: { backgroundColor: '#fff', borderColor: colors.bad },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  tile: { flex: 1, minWidth: 96, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 8, ...shadow },
  tileIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 13, fontWeight: '700', color: colors.ink },
  label: { fontSize: 13, fontWeight: '600', color: colors.text2, marginBottom: 6 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, color: colors.ink, backgroundColor: '#fff' },
  error: { color: colors.bad, fontSize: 13, marginTop: 4 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm + 2, paddingHorizontal: 12, backgroundColor: '#fff', marginBottom: space.sm },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 16, color: colors.ink },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: space.md, borderRadius: radius.sm, marginBottom: space.md },
  segmented: { flexDirection: 'row', backgroundColor: colors.sunken, borderRadius: radius.sm + 2, padding: 4, gap: 4, marginBottom: space.md },
  segment: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentOn: { backgroundColor: '#fff', ...shadow },
  segmentText: { fontSize: 15, fontWeight: '700', color: colors.muted },
  empty: { alignItems: 'center', padding: space.xl, gap: 6 },
  emptyIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  muted: { color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center' },
});
