import { Platform } from 'react-native';

// Philoi brand kit — see philoi_brand_kit.md for source of truth.
export const Colors = {
  coral: '#E0612C',
  amber: '#F2A33C',
  ember: '#FFD27A',
  green: '#3DA85C',
  sky: '#4FB0E5',
  plum: '#3A2E5C',
  ink: '#2C2538',
  muted: '#766A88',
  cream: '#FFF6EC',
  card: '#FFFFFF',
  line: '#EFE7DB',

  disabled: '#D8C9BC',
  achieverBg: '#FFF3D6',
  achieverText: '#9A6A12',
} as const;

export type ThemeColor = keyof typeof Colors;

export const Fonts = Platform.select({
  default: {
    display: 'Fredoka_600SemiBold',
    displayMedium: 'Fredoka_500Medium',
    body: 'Nunito_400Regular',
    bodySemiBold: 'Nunito_600SemiBold',
    bodyBold: 'Nunito_700Bold',
    bodyExtraBold: 'Nunito_800ExtraBold',
  },
})!;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  input: 14,
  button: 16,
  card: 18,
  pill: 999,
} as const;

export const Shadow = {
  primaryButton: {
    shadowColor: Colors.coral,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 6,
  },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
