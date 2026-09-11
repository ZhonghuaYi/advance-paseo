// Custom slider row for numeric settings. The host UI kit ships no slider,
// so this is built from React Native core primitives only: a track View with
// a PanResponder for dragging / tap-to-jump, plus minus and plus steppers
// for precise, keyboard-reachable adjustment. Values snap to `step` and are
// clamped to [min, max] by construction.
//
// Layout notes (each choice fixes a real rendering quirk seen in RN Web):
// - The fill width and thumb position use PIXEL offsets computed from the
//   measured track width. Percentage `left` on absolutely positioned views
//   proved unreliable, letting the thumb drift to the track's end.
// - The steppers draw their glyphs with Views (bars) instead of text, whose
//   baseline never centers optically with the track.
// - The control row has a fixed height with every element centered on the
//   same line, matching the host SettingsRow rhythm: label + value first,
//   optional hint beneath, then the slider.

import { useEffect, useMemo, useRef, useState } from "react";
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

const CONTROL_HEIGHT = 32;
const STEPPER_SIZE = 32;
const STEPPER_STROKE = 2;
const STEPPER_LENGTH = 14;
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
  /** Track pageX, refreshed through measure() at gesture start. */
  const pageX = useRef(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
  }, [value]);

  // Callbacks live in a ref so the PanResponder instance stays stable.
  const callbacks = useRef({ onValueChange, onRelease, disabled });
  callbacks.current = { onValueChange, onRelease, disabled };

  const ratio = max > min ? (value - min) / (max - min) : 0;
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  const fillWidth = Math.round(trackWidth * clampedRatio);
  const thumbLeft = Math.min(
    Math.max(0, Math.round(trackWidth * clampedRatio - THUMB_SIZE / 2)),
    Math.max(0, trackWidth - THUMB_SIZE),
  );

  const snap = (raw: number): number => {
    const clamped = Math.min(max, Math.max(min, raw));
    return Math.round(clamped / step) * step;
  };

  const valueFromClientX = (clientX: number): number => {
    if (trackWidth <= 0) return latest.current;
    return snap(min + ((clientX - pageX.current) / trackWidth) * (max - min));
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
          trackRef.current?.measure((_x, _y, width, _h, measuredPageX) => {
            if (width > 0) pageX.current = measuredPageX;
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
    // min/max/step/trackWidth are captured through refs/state reads at event
    // time except trackWidth, which the deps refresh when layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step, trackWidth],
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
  const stepperGlyphColor = disabled ? theme.colors.foregroundMuted : theme.colors.accent;
  const stepperStyle = {
    width: STEPPER_SIZE,
    height: STEPPER_SIZE,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  };

  /** Minus/plus glyphs drawn as bars so they center on the track line. */
  const stepperMinus = (
    <View
      style={{
        width: STEPPER_LENGTH,
        height: STEPPER_STROKE,
        borderRadius: STEPPER_STROKE / 2,
        backgroundColor: stepperGlyphColor,
      }}
    />
  );
  const stepperPlus = (
    <View style={{ width: STEPPER_LENGTH, height: STEPPER_LENGTH, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: STEPPER_LENGTH,
          height: STEPPER_STROKE,
          borderRadius: STEPPER_STROKE / 2,
          backgroundColor: stepperGlyphColor,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: STEPPER_STROKE,
          height: STEPPER_LENGTH,
          borderRadius: STEPPER_STROKE / 2,
          backgroundColor: stepperGlyphColor,
        }}
      />
    </View>
  );

  return (
    <View style={{ paddingVertical: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={labelStyle}>{label}</Text>
        <Text style={valueStyle}>{formatValue(value)}</Text>
      </View>
      {hint !== undefined && hint.length > 0 ? (
        <Text style={[hintStyle, { marginTop: 2, marginBottom: 6 }]}>{hint}</Text>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: CONTROL_HEIGHT,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={decreaseLabel}
          disabled={disabled}
          hitSlop={4}
          onPress={() => stepBy(-1)}
          style={stepperStyle}
        >
          {stepperMinus}
        </Pressable>
        <View
          ref={trackRef}
          onLayout={(event) => {
            const width = event.nativeEvent.layout.width;
            if (width > 0) setTrackWidth(width);
          }}
          {...panResponder.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ min, max, now: value }}
          style={{
            flex: 1,
            height: CONTROL_HEIGHT,
            justifyContent: "center",
            marginHorizontal: 4,
          }}
        >
          {/* Track base */}
          <View
            style={{
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: theme.colors.border,
            }}
          />
          {/* Filled portion, pixel-positioned over the base */}
          <View
            style={{
              position: "absolute",
              left: 0,
              top: (CONTROL_HEIGHT - BAR_HEIGHT) / 2,
              width: fillWidth,
              height: BAR_HEIGHT,
              borderRadius: BAR_HEIGHT / 2,
              backgroundColor: theme.colors.accent,
            }}
          />
          {/* Thumb, pixel-positioned over the base */}
          <View
            style={{
              position: "absolute",
              left: thumbLeft,
              top: (CONTROL_HEIGHT - THUMB_SIZE) / 2,
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
          hitSlop={4}
          onPress={() => stepBy(1)}
          style={stepperStyle}
        >
          {stepperPlus}
        </Pressable>
      </View>
    </View>
  );
}
