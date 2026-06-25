/**
 * Inflata design tokens.
 * Light-mode-first, warm cream background with a bold red-orange "rage" accent.
 * Ported faithfully from the source web app's CSS custom properties.
 */
export const Colors = {
  background: "#F9FAFB", // cold off-white — clinical & professional
  foreground: "#121212", // hsl(0 0% 7%) near-black
  surface: "#FFFFFF",
  surface2: "#F3F1EE",
  muted: "#F5F5F5",
  mutedForeground: "#737373", // hsl(0 0% 45%)
  accent: "#F5481B", // hsl(12 92% 52%) red-orange
  accentForeground: "#FFFFFF",
  accentSoft: "#FEEAE3", // hsl(12 92% 96%)
  destructive: "#E63535", // hsl(0 84% 55%)
  destructiveForeground: "#FFFFFF",
  border: "rgba(0,0,0,0.18)",
  borderStrong: "rgba(0,0,0,0.16)",
  success: "#10B981",
  successSoft: "#ECFDF5",
  amber: "#D97706",
  amberSoft: "rgba(217,119,6,0.10)",
  white: "#FFFFFF",
  black: "#121212",
  overlay: "rgba(0,0,0,0.5)",
} as const;

export const Fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extrabold: "Inter_800ExtraBold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 10,
  xl: 14,
  xxl: 24,
  full: 999,
} as const;
