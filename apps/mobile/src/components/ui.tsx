import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { colors, radius, space, type } from "../theme";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}) {
  const v = buttonVariants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, v.box, (pressed || off) && styles.dim, style]}
    >
      {loading ? <ActivityIndicator color={v.text.color} /> : null}
      <Text style={[styles.buttonText, v.text]}>{label}</Text>
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { box: ViewStyle; text: { color: string } }> = {
  primary: { box: { backgroundColor: colors.lime }, text: { color: colors.ink } },
  secondary: { box: { backgroundColor: colors.ink }, text: { color: colors.paper } },
  ghost: {
    box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    text: { color: colors.ink },
  },
  danger: { box: { backgroundColor: colors.dangerSoft }, text: { color: colors.danger } },
};

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Eyebrow({ children }: { children: string }) {
  return <Text style={type.eyebrow}>{children.toUpperCase()}</Text>;
}

type PillTone = "lime" | "verify" | "muted" | "danger" | "warn" | "ink";

export function Pill({ label, tone = "muted" }: { label: string; tone?: PillTone }) {
  const t = pillTones[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      <Text style={[styles.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const pillTones: Record<PillTone, { bg: string; fg: string }> = {
  lime: { bg: colors.lime, fg: colors.ink },
  verify: { bg: colors.verifySoft, fg: colors.verify },
  muted: { bg: colors.surface2, fg: colors.muted },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  warn: { bg: colors.warnSoft, fg: colors.warn },
  ink: { bg: colors.ink, fg: colors.paper },
};

export function Banner({
  tone,
  children,
}: {
  tone: "error" | "success" | "warn" | "info";
  children: string;
}) {
  const map = {
    error: { bg: colors.dangerSoft, fg: colors.danger },
    success: { bg: colors.verifySoft, fg: colors.verify },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    info: { bg: colors.surface2, fg: colors.ink },
  }[tone];
  return (
    <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: map.bg }]}>
      <Text style={[type.body, { color: map.fg }]}>{children}</Text>
    </View>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={styles.track}
    >
      <View style={[styles.fill, { width: `${pct}%` }]} />
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={type.muted}>{label}</Text>
      <Text style={[type.body, styles.rowValue]}>{value}</Text>
    </View>
  );
}

/** The Seenit mark: aperture ring with a check, same as the web logo. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityLabel="Seenit">
      <Rect width={32} height={32} rx={9} fill={colors.ink} />
      <Circle cx={16} cy={16} r={8.5} fill="none" stroke={colors.lime} strokeWidth={3} />
      <Path
        d="M12.4 16.2l2.6 2.5 4.8-5.2"
        fill="none"
        stroke={colors.paper}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

type IconName =
  "map" | "clock" | "shield" | "lock" | "pin" | "camera" | "video" | "close" | "refresh" | "link";

/** Small line icons drawn for Seenit (24px grid). */
export function Icon({
  name,
  size = 22,
  color = colors.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IconName, React.ReactNode> = {
    map: <Path {...p} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
    clock: (
      <>
        <Circle {...p} cx={12} cy={12} r={9} />
        <Path {...p} d="M12 7v5l3 2" />
      </>
    ),
    shield: <Path {...p} d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3zM9 12l2 2 4-4" />,
    lock: (
      <>
        <Rect {...p} x={5} y={11} width={14} height={10} rx={2} />
        <Path {...p} d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
    pin: (
      <>
        <Path {...p} d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
        <Circle {...p} cx={12} cy={9.5} r={2.5} />
      </>
    ),
    camera: (
      <>
        <Path {...p} d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <Circle {...p} cx={12} cy={13} r={3.5} />
      </>
    ),
    video: (
      <>
        <Rect {...p} x={3} y={6} width={13} height={12} rx={2} />
        <Path {...p} d="m16 10 5-3v10l-5-3" />
      </>
    ),
    close: <Path {...p} d="M6 6l12 12M18 6 6 18" />,
    refresh: <Path {...p} d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
    link: (
      <Path
        {...p}
        d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
      />
    ),
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name]}
    </Svg>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.sm,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
  dim: { opacity: 0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
    gap: space.sm,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 12, fontWeight: "600" },
  banner: { borderRadius: radius.md, padding: space.md },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface2, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.lime },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  rowValue: { flexShrink: 1, textAlign: "right", fontWeight: "500" },
});
