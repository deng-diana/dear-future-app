// SealCeremony — two-beat seal ceremony, total ≈ 2.83 s.
//
// Beat 1 (~0–1.3 s): envelope fades in centered on ivory screen with flap OPEN
//   (rotateX ≈ 178°, triangle standing upward) → flap folds DOWN (rotateX → 0°,
//   hinged at the body's top edge via double-height wrapper trick, inOut-cubic 600 ms).
//
// Beat 2 (~1.75–2.83 s): wax seal drops from above and spring-presses onto the
//   flap tip (scale 1.5→1, damping 13 stiffness 260) → stamp lands → haptic (Medium)
//   + bordeaux squish ring + 2 px jolt → composition scales/translates to match the
//   sealed-screen envelope (120 px wide, slightly above screen center) during the
//   750 ms still pause → envelope lifts away and fades (departure) → onDone().
//
// (Departure replaces the earlier shrink-to-position hand-off — founder decision:
// sealing = leaving. Note kept for history: the sealed screen envelope is 120 × 79, horizontally
//   centered, translated −80 px from screen center, matching sealed-envelope.png's
//   position on the sealed screen that fades in immediately after.
//
// Uses react-native-reanimated v4. Reduce-motion: skip to onDone instantly.
// Public API: { onDone: () => void } — unchanged.

import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors } from '@/theme';

// ── Geometry ──────────────────────────────────────────────────────────────────

// Envelope: aspect ratio mirrors sealed-envelope.png (120 × 79 ≈ 1.52 : 1).
const ENV_W = 200;
const ENV_H = Math.round((ENV_W * 79) / 120); // = 132

// Flap: V-tip at ~42 % from top matches the sealed PNG's fold crease position.
const FLAP_H = Math.round(ENV_H * 0.42); // = 55

// Pack = the envelope composition (no letter paper in this design).
const PACK_W = ENV_W;
const PACK_H = ENV_H;

// Seal stamp. The asset is portrait (≈ 2 : 3); resizeMode="contain" fills the box.
const STAMP_W = 50;
const STAMP_H = Math.round(STAMP_W * 1.5); // = 75
const STAMP_X = (PACK_W - STAMP_W) / 2;   // = 75 — centered
const STAMP_Y = Math.round(FLAP_H - STAMP_H / 2); // stamp center at flap-tip Y=55

// Wax squish ring (oval, slightly wider than tall).
const SQUISH_W = 76;
const SQUISH_H = 46;
const SQUISH_X = (PACK_W - SQUISH_W) / 2;          // = 62
const SQUISH_Y = Math.round(FLAP_H - SQUISH_H / 2); // = 32

// Z-index layers.
const Z_ENV_BACK  = 0;
const Z_ENV_FRONT = 4;
const Z_FLAP      = 5; // always above envFront; in open state they don't overlap spatially
const Z_SQUISH    = 6;
const Z_SEAL      = 7;

// Departure(创始人定稿:封存即离开 —— 产品哲学):盖印静止后,信封向上飞走消失;
// 随后的已封存屏自带「从上而下浮现」入场,像信封的归来预告。
const DEPART_TRANSLATE_Y = -340;  // 向上飞出屏幕方向
const DEPART_SCALE       = 0.92;  // 远去时轻微缩小

// ── Timeline (ms) ─────────────────────────────────────────────────────────────
//
// T=0050 ─ envelope appear start
// T=0350 ─ envelope settled (DUR_ENV = 300 ms)
// T=0700 ─ flap fold start   (350 ms pause after envelope)
// T=1300 ─ flap closed       (DUR_FLAP = 600 ms)
// T=1750 ─ stamp drop start  (450 ms pause after flap)
// T=2130 ─ stamp lands       (DUR_DROP = 380 ms) → haptic + squish + jolt
// T=2880 ─ departure starts  (DUR_PAUSE = 750 ms sacred stillness)
// T=4080 ─ onDone            (DUR_DEPART = 1200 ms lift & fade)
//
// Total: ≈ 4080 ms

const T_ENV      = 50;
const DUR_ENV    = 300;
const T_FLAP     = 700;
const DUR_FLAP   = 600;
const T_STAMP    = 1750;
const DUR_DROP   = 380;
const T_SETTLE   = T_STAMP + DUR_DROP; // = 2130
const DUR_PAUSE  = 750;                    // 神圣停顿:什么都不动
const T_DEPART   = T_SETTLE + DUR_PAUSE;   // = 2880
const DUR_DEPART = 1200;                   // 向上远去 + 淡出
const T_DONE     = T_DEPART + DUR_DEPART;  // = 4080

// ──────────────────────────────────────────────────────────────────────────────

type Props = { onDone: () => void };

export default function SealCeremony({ onDone }: Props) {
  // ── Reduce-motion ─────────────────────────────────────────────────────────
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotionRef.current = v;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotionRef.current = v;
    });
    return () => sub.remove();
  }, []);

  // ── Shared values ─────────────────────────────────────────────────────────

  // Beat 1 — envelope appear (fade + gentle settle).
  const packOpacity    = useSharedValue(0);
  const packEnterY     = useSharedValue(8);
  const packEnterScale = useSharedValue(0.97);

  // Beat 1 — flap fold: 178° = open (standing upward), 0° = closed (V-flap flat).
  const flapRotX = useSharedValue(178);

  // Beat 2 — seal drop + spring press.
  const sealOpacity = useSharedValue(0);
  const sealDropY   = useSharedValue(-40); // starts 40 px above final position
  const sealScale   = useSharedValue(1.5);

  // Beat 2 — squish ring.
  const squishScale   = useSharedValue(0.5);
  const squishOpacity = useSharedValue(0);

  // Beat 2 — 2 px envelope jolt.
  const packJoltY = useSharedValue(0);

  // Beat 3 — departure:向上飞走(translateY)+ 远去缩小(scale)+ 淡出(复用 packOpacity)。
  const packFinalScale      = useSharedValue(1);
  const packFinalTranslateY = useSharedValue(0);

  // ── onDone guard (called exactly once) ───────────────────────────────────
  const doneCalled = useRef(false);

  // ── Animated styles ───────────────────────────────────────────────────────

  // Pack (the whole composition): combines appear, jolt, and final hand-off.
  const packStyle = useAnimatedStyle(() => ({
    opacity: packOpacity.value,
    transform: [
      { translateY: packEnterY.value + packFinalTranslateY.value + packJoltY.value },
      { scale: packEnterScale.value * packFinalScale.value },
    ],
  }));

  // Flap: perspective MUST be first in the transform array (RN / Reanimated rule).
  const flapWrapStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 700 },
      { rotateX: `${flapRotX.value}deg` as `${number}deg` },
    ],
  }));

  // Seal stamp: drop + spring scale.
  const sealStyle = useAnimatedStyle(() => ({
    opacity: sealOpacity.value,
    transform: [
      { translateY: sealDropY.value },
      { scale: sealScale.value },
    ],
  }));

  // Squish ring: expand + fade.
  const squishStyle = useAnimatedStyle(() => ({
    opacity: squishOpacity.value,
    transform: [{ scale: squishScale.value }],
  }));

  // ── Main animation ────────────────────────────────────────────────────────
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const boot = setTimeout(() => {
      if (reduceMotionRef.current) {
        if (!doneCalled.current) {
          doneCalled.current = true;
          onDone();
        }
        return;
      }

      // Beat 1a — envelope fades in and settles (T_ENV, DUR_ENV).
      packOpacity.value    = withDelay(T_ENV, withTiming(1,    { duration: DUR_ENV, easing: Easing.out(Easing.cubic) }));
      packEnterY.value     = withDelay(T_ENV, withTiming(0,    { duration: DUR_ENV, easing: Easing.out(Easing.cubic) }));
      packEnterScale.value = withDelay(T_ENV, withTiming(1,    { duration: DUR_ENV, easing: Easing.out(Easing.cubic) }));

      // Beat 1b — flap folds closed: rotateX 178° → 0° (inOut-cubic).
      // flapWrap z=5 throughout; in open state the flap is spatially above the
      // envelope body (Y < 0 in pack coords) so no z-index conflict with envFront.
      flapRotX.value = withDelay(
        T_FLAP,
        withTiming(0, { duration: DUR_FLAP, easing: Easing.inOut(Easing.cubic) }),
      );

      // Beat 2a — stamp drops from above and spring-presses onto flap tip (T_STAMP).
      sealOpacity.value = withDelay(T_STAMP, withTiming(1, { duration: 200 }));
      sealDropY.value   = withDelay(
        T_STAMP,
        withTiming(0, { duration: DUR_DROP, easing: Easing.in(Easing.quad) }),
      );
      // Spring undershoot IS the press feel — overshootClamping:false is intentional.
      sealScale.value   = withDelay(
        T_STAMP,
        withSpring(1, { damping: 13, stiffness: 260, overshootClamping: false }),
      );

      // Beat 2b — stamp settles (T_SETTLE): haptic + squish ring + jolt.
      timers.push(
        setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }, T_SETTLE),
      );

      // Squish ring: snap to 0.5 opacity (~1 frame), expand to scale 1.2, fade out.
      squishOpacity.value = withDelay(
        T_SETTLE,
        withSequence(
          withTiming(0.5, { duration: 16 }),
          withTiming(0,   { duration: 420 }),
        ),
      );
      squishScale.value = withDelay(T_SETTLE, withTiming(1.2, { duration: 420 }));

      // 2 px jolt: pack bumps down then springs back.
      packJoltY.value = withDelay(
        T_SETTLE,
        withSequence(
          withTiming(2, { duration: 80  }),
          withTiming(0, { duration: 160 }),
        ),
      );

      // Departure:750ms 神圣停顿后,信封踏上时间旅程 —— 向上远去、轻微缩小、淡出。
      // 封存即离开(产品哲学);随后的已封存屏自上而下浮现,与之呼应。
      const departEase = Easing.bezier(0.6, 0.04, 0.3, 1);
      packFinalTranslateY.value = withDelay(T_DEPART, withTiming(DEPART_TRANSLATE_Y, { duration: DUR_DEPART, easing: departEase }));
      packFinalScale.value      = withDelay(T_DEPART, withTiming(DEPART_SCALE,       { duration: DUR_DEPART, easing: departEase }));
      packOpacity.value         = withDelay(T_DEPART, withTiming(0,                  { duration: DUR_DEPART, easing: departEase }));

      // onDone after the full pause.
      timers.push(
        setTimeout(() => {
          if (!doneCalled.current) {
            doneCalled.current = true;
            onDone();
          }
        }, T_DONE),
      );
    }, 0);

    timers.push(boot);

    return () => {
      timers.forEach(clearTimeout);
      cancelAnimation(packOpacity);
      cancelAnimation(packEnterY);
      cancelAnimation(packEnterScale);
      cancelAnimation(flapRotX);
      cancelAnimation(sealOpacity);
      cancelAnimation(sealDropY);
      cancelAnimation(sealScale);
      cancelAnimation(squishScale);
      cancelAnimation(squishOpacity);
      cancelAnimation(packJoltY);
      cancelAnimation(packFinalScale);
      cancelAnimation(packFinalTranslateY);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.pack, packStyle]}>

        {/* Envelope back: pocket interior color, behind all other layers (z=0). */}
        <View style={styles.envBack} />

        {/* Flap wrapper: double-height container for transformOrigin emulation.
            Height = FLAP_H × 2; top = −FLAP_H → wrapper center = fold line = Y=0
            in pack (= envelope's top edge). perspective FIRST in the transform array.
            flapSpacer (top half) is transparent; flapClip (bottom half) holds the
            downward-V triangle.
            At rotX ≈ 178° (open): flapClip appears ABOVE the envelope body (Y < 0
            in pack coords), triangle appears mirrored → upward pointing. ✓
            At rotX = 0° (closed): flapClip covers the top FLAP_H px of the envelope,
            triangle pointing down = classic sealed-envelope V-flap. ✓
            z=5 always: in open state there is no spatial overlap with envFront (z=4),
            so no z-index artefact. */}
        <Animated.View style={[styles.flapWrap, flapWrapStyle]}>
          <View style={styles.flapSpacer} />
          <View style={styles.flapClip}>
            {/* Downward-V via CSS border trick.
                Element at top:FLAP_H (bottom of flapClip); borderTopWidth:FLAP_H
                draws upward → base at Y=0, tip at Y=FLAP_H within flapClip. */}
            <View style={styles.flapTriangle} />
          </View>
        </Animated.View>

        {/* Envelope front: main visible face (z=4). Contains an ultra-faint upward-V
            crease shadow representing the bottom flap fold line, matching the
            sealed-envelope.png's crease pattern. */}
        <View style={styles.envFront}>
          <View style={styles.vFoldTriangle} />
        </View>

        {/* Wax squish ring: bordeaux oval, expands and fades at stamp settle. */}
        <Animated.View
          accessible={false}
          style={[
            styles.squish,
            { left: SQUISH_X, top: SQUISH_Y, zIndex: Z_SQUISH },
            squishStyle,
          ]}
        />

        {/* Wax seal stamp: drops from above and spring-presses onto the flap tip. */}
        <Animated.Image
          source={require('@/assets/images/seal-stamp.png')}
          resizeMode="contain"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.seal,
            { left: STAMP_X, top: STAMP_Y, zIndex: Z_SEAL },
            sealStyle,
          ]}
        />

      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-screen ivory overlay; composition is centered.
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },

  // Fixed 200 × 132 px envelope composition, centered in overlay.
  pack: {
    width:  PACK_W,
    height: PACK_H,
  },

  // ── Envelope back (pocket interior) ──────────────────────────────────────
  envBack: {
    position: 'absolute',
    left: 0, top: 0,
    width: ENV_W, height: ENV_H,
    backgroundColor: colors.envelopeDeep,
    borderRadius: 5,
    zIndex: Z_ENV_BACK,
  },

  // ── Flap wrapper (3-D fold trick) ─────────────────────────────────────────
  flapWrap: {
    position: 'absolute',
    left: 0,
    top:  -FLAP_H,       // center of wrapper = Y=0 in pack = envelope's top edge
    width:  ENV_W,
    height: FLAP_H * 2,
    zIndex: Z_FLAP,
  },

  // Transparent top half — shifts the visual hinge to the wrapper's center.
  flapSpacer: { height: FLAP_H },

  // Clips the triangle to FLAP_H so it never overflows upward.
  flapClip: {
    width:    ENV_W,
    height:   FLAP_H,
    overflow: 'hidden',
  },

  flapTriangle: {
    position: 'absolute',
    width: 0, height: 0,
    top:  FLAP_H,        // bottom of flapClip; borderTopWidth draws upward
    left: ENV_W / 2,
    borderLeftWidth:  ENV_W / 2,
    borderRightWidth: ENV_W / 2,
    borderTopWidth:   FLAP_H,
    borderTopColor:   colors.envelope,
    borderLeftColor:  'transparent',
    borderRightColor: 'transparent',
  },

  // ── Envelope front ────────────────────────────────────────────────────────
  envFront: {
    position: 'absolute',
    left: 0, top: 0,
    width: ENV_W, height: ENV_H,
    backgroundColor: colors.envelope,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    zIndex: Z_ENV_FRONT,
    // Warm brown shadow only — no black, no elevation.
    shadowColor:   colors.brandWarm,
    shadowOpacity: 0.18,
    shadowRadius:  14,
    shadowOffset:  { width: 0, height: 8 },
  },

  // Faint upward-V crease: represents the bottom-flap fold line on the sealed face.
  // Tip at Y=FLAP_H (the seal center / V-junction); base at Y=ENV_H (envelope bottom).
  // Combined with the closed flapTriangle above, this forms the classic envelope diamond.
  vFoldTriangle: {
    position: 'absolute',
    width: 0, height: 0,
    top:  FLAP_H,
    left: ENV_W / 2,
    borderLeftWidth:   ENV_W / 2,
    borderRightWidth:  ENV_W / 2,
    borderBottomWidth: ENV_H - FLAP_H,
    borderBottomColor: colors.envelopeDeep,
    borderLeftColor:   'transparent',
    borderRightColor:  'transparent',
    opacity: 0.22,
  },

  // ── Wax squish ring ───────────────────────────────────────────────────────
  squish: {
    position: 'absolute',
    width:        SQUISH_W,
    height:       SQUISH_H,
    borderRadius: SQUISH_H / 2,
    backgroundColor: colors.dangerDeep, // bordeauxRed #7A1E1E
    opacity: 0,
  },

  // ── Wax seal stamp ────────────────────────────────────────────────────────
  seal: {
    position: 'absolute',
    width:  STAMP_W,
    height: STAMP_H,
  },
});
