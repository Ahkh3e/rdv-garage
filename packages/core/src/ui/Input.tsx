import { forwardRef, useState } from "react";
import { StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { colors, fonts, radii } from "../theme";
import { Text } from "./Text";

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Input = forwardRef<TextInput, Props>(function Input({ label, error, hint, style, onFocus, onBlur, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? <Text variant="label" color={colors.subtle}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.subtle}
        selectionColor={colors.accent}
        keyboardAppearance="dark"
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[styles.input, focused && { borderColor: colors.focus }, error ? { borderColor: "rgba(255,69,58,0.6)" } : null, style]}
        {...rest}
      />
      {error ? <Text variant="caption" color={colors.danger}>{error}</Text> : hint ? <Text variant="caption" color={colors.subtle}>{hint}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.fill,
    paddingHorizontal: 16,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
});
