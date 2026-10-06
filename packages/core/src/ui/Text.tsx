import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { colors, fonts, type as typeScale } from "../theme";

export type TextVariant = "caption" | "body" | "default" | "title" | "large" | "hero" | "mono" | "monoLarge" | "label" | "headline" | "numeral" | "numeralXL";

const variants: Record<TextVariant, TextStyle> = {
  caption: { ...typeScale.caption, fontFamily: fonts.medium, letterSpacing: 0.1 },
  body: { ...typeScale.body, fontFamily: fonts.regular },
  default: { ...typeScale.default, fontFamily: fonts.regular },
  headline: { ...typeScale.default, fontFamily: fonts.semibold, letterSpacing: -0.1 },
  title: { ...typeScale.title, fontFamily: fonts.display, letterSpacing: -0.4 },
  large: { ...typeScale.large, fontFamily: fonts.display, letterSpacing: -0.8 },
  hero: { ...typeScale.hero, fontFamily: fonts.displayBold, letterSpacing: -1.2 },
  label: { fontSize: 11, lineHeight: 14, fontFamily: fonts.semibold, letterSpacing: 1.2, textTransform: "uppercase" },
  numeral: { fontSize: 20, lineHeight: 24, fontFamily: fonts.display, letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  numeralXL: { fontSize: 56, lineHeight: 56, fontFamily: fonts.displayBold, letterSpacing: -2, fontVariant: ["tabular-nums"] },
  mono: { ...typeScale.default, fontFamily: fonts.mono },
  monoLarge: { fontSize: 28, lineHeight: 34, fontFamily: fonts.mono },
};

const display: TextVariant[] = ["title", "large", "hero", "numeral", "numeralXL"];

interface Props extends TextProps {
  variant?: TextVariant;
  muted?: boolean;
  color?: string;
  bold?: boolean;
}

export function Text({ variant = "default", muted, color, bold, style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      style={[{ color: color ?? (muted ? colors.muted : colors.text) }, variants[variant], bold && !display.includes(variant) && { fontFamily: fonts.semibold }, style]}
    />
  );
}
