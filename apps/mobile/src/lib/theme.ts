import type { RiskFlag } from '@credit-ledger/shared';

/** Same palette as the web app: clean, light, teal brand. */
export const colors = {
  brand: '#0d9488',
  brandDark: '#0f766e',
  brandDeep: '#0b3b3a',
  brandTint: '#e6f6f4',
  ink: '#0f172a',
  text2: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e5e9ef',
  lineStrong: '#d3d9e2',
  bg: '#f4f6f8',
  card: '#ffffff',
  sunken: '#eff2f5',
  bad: '#dc2626',
  badTint: '#fdeeee',
  warn: '#c2780a',
  warnTint: '#fff5e1',
  good: '#16a34a',
  goodTint: '#e9f8ef',
  blue: '#2563eb',
  blueTint: '#eaf1fe',
};

export const riskColors: Record<RiskFlag, { fg: string; bg: string }> = {
  green: { fg: colors.good, bg: colors.goodTint },
  amber: { fg: colors.warn, bg: colors.warnTint },
  red: { fg: colors.bad, bg: colors.badTint },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 10, md: 14, lg: 18, pill: 999 };

export const shadow = {
  shadowColor: '#0f172a',
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
};
