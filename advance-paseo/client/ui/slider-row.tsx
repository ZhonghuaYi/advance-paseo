// Custom slider row for numeric settings. The host UI kit ships no slider,
// so this is built from React Native core primitives only: a track View with
// a PanResponder for dragging / tap-to-jump, plus minus and plus steppers
// for precise, keyboard-reachable adjustment. Values snap to `step` and are
// clamped to [min, max] by construction.

import { useEffect, useMemo, useRef } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

interface SliderRowProps {
  readonly theme: PluginTheme;
  readonly label: string;
  readonly hint?: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Rendered as the current value, e.g. "22 px". */
  readonly formatValue: (value: number) => string;
  readonly accessibilityLabel: string;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  readonly disabled?: boolean;
  /** Called continuously while dragging or stepping (local preview). */
  readonly onValueChange: (value: number) => void;
  /** Called once when the interaction settles (persist here). */
  readonly onRelease: (value: number) => void;
}

const TRACK_HEIGHT = 28;
const BAR_HEIGHT = 4;
const THUMB_SIZE = 16;

export function SliderRow(props: SliderRowProps) {
  const {
    theme,
    label,
    hint,
    value,
    min,
    max,
    step,
    formatValue,
    accessibilityLabel,
    decreaseLabel,
    increaseLabel,
    disabled = false,
    onValueChange,
    onRelease,
  } = props;

  const trackRef = useRef<View>(null);
  /** Track pageX/width, refreshed by onLayout (width) and measure (pageX). */
  const geometry = useRef({ pageX: 0, width: 0 });
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  // Callbacks live in a ref so the PanResponder instance stays stable.
  const callbacks = useRef({ onValueChange, onRelease, disabled });
  callbacks.current = { onValueChange, onRelease, disabled };

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const percent = `${Math.round(Math.min(100, Math.max(0, ratio * 100)))}%` as `${number}%`;

  const snap = (raw: number): number => {
    const clamped = Math.min(max, Math.max(min, raw));
    return Math.round(clamped / step) * step;
  };

  const valueFromClientX = (clientX: number): number => {
    const { pageX, width } = geometry.current;
    if (width <= 0) return latest.current;
    return snap(min + ((clientX - pageX) / width) * (max - min));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !callbacks.current.disabled,
        onMoveShouldSetPanResponder: () => !callbacks.current.disabled,
        onPanResponderGrant: (event) => {
          // Refresh geometry for this gesture; the callback may land after
          // this grant on native, but the steppers and prior gestures have
          // usually primed it already.
          trackRef.current?.measure((_x, _y, width, _h, pageX) => {
            if (width > 0) geometry.current = { pageX, width };
          });
          const next = valueFromClientX(event.nativeEvent.pageX);
          if (next !== latest.current) {
            latest.current = next;
            callbacks.current.onValueChange(next);
          }
        },
        onPanResponderMove: (event) => {
          const next = valueFromClientX(event.nativeEvent.pageX);
          if (next !== latest.current) {
            latest.current = next;
            callbacks.current.onValueChange(next);
          }
        },
        onPanResponderRelease: () => callbacks.current.onRelease(latest.current),
        onPanResponderTerminate: () => callbacks.current.onRelease(latest.current),
      }),
    // min/max/step are captured once; ranges are static per usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step],
  );

  const stepBy = (direction: 1 | -1): void => {
    if (callbacks.current.disabled) return;
    const next = snap(latest.current + direction * step);
    if (next === latest.current) return;
    latest.current = next;
    callbacks.current.onValueChange(next);
    callbacks.current.onRelease(next);
  };

  const labelStyle = { color: theme.colors.foreground, fontSize: 14 };
  const valueStyle = { color: theme.colors.foregroundMuted, fontSize: 13 };
  const hintStyle = { color: theme.colors.foregroundMuted, fontSize: 12 };
  const stepStyle = {
    color: disabled ? theme.colors.foregroundMuted : theme.colors.accent,
    fontSize: 20,
    lineHeight: 24,
  };

  return (
    <View style={{ paddingVertical: 8 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 2,
        }}
      >
        <Text style={labelStyle}>{label}</Text>
        <Text style={valueStyle}>{formatValue(value)}</Text>
      </View>
      {hint !== undefined && hint.length > 0 ? (
        <Text style={[hintStyle, { marginBottom: 6 }]}>{hint}</Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={decreaseLabel}
          disabled={disabled}
          hitSlop={8}
          onPress={() => stepBy(-1)}
        >
          <Text style={stepStyle} accessibilityElementsHidden>
            −
          </Text>
        </Pressable>
        <View
          ref={trackRef}
          onLayout={(event) => {
            geometry.current.width = event.nativeEvent.layout.width;
          }}
          {...panResponder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ min, max, now: value }}
          style={{ flex: 1, height: TRACK_HEIGHT, justifyContent: "center" }}
        >
          <View
            style={{
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: theme.colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: percent,
                backgroundColor: theme.colors.accent,
              }}
            />
          </View>
          <View
            style={{
              position: "absolute",
              left: percent,
              top: (TRACK_HEIGHT - THUMB_SIZE) / 2,
              marginLeft: -THUMB_SIZE / 2,
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: THUMB_SIZE / 2,
              backgroundColor: theme.colors.accent,
            }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={increaseLabel}
          disabled={disabled}
          hitSlop={8}
          onPress={() => stepBy(1)}
        >
          <Text style={stepStyle} accessibilityElementsHidden>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
