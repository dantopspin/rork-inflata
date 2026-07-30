import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { Colors, Fonts } from "@/constants/theme";
import { fmtUSD } from "@/lib/format";

/**
 * Animated price text that flashes green (price dropped) or red
 * (price increased) whenever the `price` prop changes — e.g. after
 * a new scan sync updates the tracked item's current price.
 *
 * The flash is a subtle color pulse + scale bump that settles back
 * to the base color, giving the user immediate visual feedback that
 * a tracked price was updated during the latest sync.
 */
export function FlashPrice({
  price,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
}: {
  price: number;
  style?: import("react-native").TextStyle;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
}) {
  const prevPrice = useRef<number>(price);
  const flash = useSharedValue<number>(0); // 0 = idle, 1 = up, -1 = down

  useEffect(() => {
    if (price === prevPrice.current) return;
    const direction = price > prevPrice.current ? 1 : -1;
    flash.value = 0;
    flash.value = withSequence(
      withTiming(direction, { duration: 200, easing: Easing.out(Easing.ease) }),
      withDelay(900, withTiming(0, { duration: 600, easing: Easing.inOut(Easing.ease) })),
    );

    // Light haptic on price change for tactile feedback
    runOnJS(Haptics.impactAsync)(
      direction > 0
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium,
    );

    prevPrice.current = price;
  }, [price, flash]);

  const animStyle = useAnimatedStyle(() => {
    "worklet";
    const v = flash.value;
    if (v > 0.01) {
      // Price went up — red pulse + slight scale bump
      return {
        color: Colors.accent,
        transform: [{ scale: 1 + v * 0.06 }],
      };
    }
    if (v < -0.01) {
      // Price went down — green pulse + slight scale bump
      return {
        color: Colors.success,
        transform: [{ scale: 1 + Math.abs(v) * 0.06 }],
      };
    }
    return {
      color: (style?.color as string) ?? Colors.foreground,
      transform: [{ scale: 1 }],
    };
  });

  return (
    <Animated.Text
      style={[styles.base, style, animStyle]}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={adjustsFontSizeToFit}
      minimumFontScale={minimumFontScale}
    >
      {fmtUSD(price)}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: Fonts.extrabold,
    fontSize: 17,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
});
