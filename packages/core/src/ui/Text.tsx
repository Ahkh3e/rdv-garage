import { Text as RNText, type TextProps, type TextStyle } from "react-native";
import { colors, fonts, type as typeScale } from "../theme";

export type TextVariant = "caption" | "body" | "default" | "title" | "large" | "mono" | "monoLarge" | "label";

const variants: Record<TextVariant, TextStyle> = {
  caption: { ...typeScale.caption, fontFamily: fonts.regular },
  body: { ...typeScale.body, fontFamily: fonts.regular },
  default: { ...typeScale.default, fontFamily: fonts.regular },
  title: { ...typeScale.title, fontFamily: fonts.semibold },
  large: { ...typeScale.large, fontFamily: fonts.semibold },
  label: { ...typeScale.caption, fontFamily: fonts.semibold, letterSpacing: 0.6, textTransform: "uppercase" },
  mono: { ...typeScale.default, fontFamily: fonts.mono },
  monoLarge: { fontSize: 28, lineHeight: 34, fontFamily: fonts.mono },
};

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
      style={[{ color: color ?? (muted ? colors.muted : colors.text) }, variants[variant], bold && { fontFamily: fonts.semibold }, style]}
    />
  );
}
