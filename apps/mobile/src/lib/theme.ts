import type { RiskFlag } from '@credit-ledger/shared';

export const colors = {
  brand: '#0f766e',
  brandDark: '#115e59',
  brandTint: '#e6f4f1',
  ink: '#1c2321',
  muted: '#5f6b68',
  line: '#e2e8e6',
  bg: '#f6f8f7',
  card: '#ffffff',
  bad: '#b42318',
  badTint: '#fee4e2',
  warn: '#b54708',
  warnTint: '#fef0c7',
  good: '#067647',
  goodTint: '#dcfae6',
};

export const riskColors: Record<RiskFlag, { fg: string; bg: string }> = {
  green: { fg: colors.good, bg: colors.goodTint },
  amber: { fg: colors.warn, bg: colors.warnTint },
  red: { fg: colors.bad, bg: colors.badTint },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
