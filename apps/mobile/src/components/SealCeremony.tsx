// SealCeremony — full-screen animation played after a letter is sealed.
// Narrative: letter settles → envelope rises → letter slides in → flap folds
// closed (3-D rotateX) → wax seal drops with spring press → squish ring + jolt
// (HAPTIC here) → sacred pause → lift-and-fade departure → onDone().
//
// Uses react-native-reanimated v4 (useSharedValue / withTiming / withSpring).
// Reduce-motion (A13): skip straight to onDone after a 0 ms settle.
// Public API: { onDone: () => void } — unchanged.

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet, View } from 'react-native';
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

// ── Geometry (proportional to the HTML prototype: letter 190×250, env 250×160) ──
const { width: SW } = Dimensions.get('window');

const PAPER_W = SW * 0.72;
const PAPER_H = PAPER_W * 1.38;

const ENV_W = PAPER_W * (250 / 190);
const ENV_H = ENV_W * (160 / 250);   // ENV_W * 0.64
const FLAP_H = ENV_H * (88 / 160);   // ENV_H * 0.55

// Envelope top within the pack: (255-68)/250 = 0.748 × PAPER_H
const ENV_TOP = PAPER_H * (187 / 250);

// Pack: the entire letter+envelope composition, centered on screen.
const PACK_W = ENV_W;
const PACK_H = ENV_TOP + ENV_H + 20;

// Letter is centered horizontally in the pack.
const LETTER_X = (ENV_W - PAPER_W) / 2;

// Letter insert: slides down by 56% of its height.
const INSERT_Y = PAPER_H * (140 / 250);

// Seal stamp (2:3 portrait, proportional to HTML 64px on 250px envelope).
const STAMP_W = ENV_W * (64 / 250);
const STAMP_H = STAMP_W * 1.5;
const STAMP_X = (PACK_W - STAMP_W) / 2;
// Seal center sits at the flap tip.
const STAMP_Y = ENV_TOP + FLAP_H - STAMP_H / 2;

// Wax squish ring (oval, proportional to HTML 96×58px).
const SQUISH_W = ENV_W * (96 / 250);
const SQUISH_H = SQUISH_W * (58 / 96);
const SQUISH_X = (PACK_W - SQUISH_W) / 2;
const SQUISH_Y = ENV_TOP + FLAP_H - SQUISH_H / 2;

// Ruled lines on the letter paper (1px lines every 22px, matching HTML).
const LINE_SPACING = 22;
const N_LINES = Math.max(0, Math.floor(PAPER_H / LINE_SPACING) - 1);

// Z-index layering (matches HTML prototype comment).
const Z_ENV_BACK = 0;
const Z_LETTER = 2;
const Z_ENV_FRONT = 4;
const Z_FLAP_OPEN = 1;
const Z_FLAP_CLOSE = 5;
const Z_SQUISH = 6;
const Z_SEAL = 7;

// ── Timeline (ms from animation start) ────────────────────────────────────
const T_ENV_IN = 750;
const T_INSERT = 1150;
const T_FLAP_CLOSE = 1850;
const T_STAMP = 2450;
const T_SETTLE = 2830;   // haptic + squish + jolt fire here
const T_DEPART = T_SETTLE + 750;   // 3580
const DUR_DEPART = 1300;
const T_DONE = T_DEPART + DUR_DEPART; // 4880

type Props = {
  onDone: () => void;
};

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

  // ── Flap z-index: starts behind letter (1), swaps above front (5) at T_FLAP_CLOSE
  const [flapZIndex, setFlapZIndex] = useState<number>(Z_FLAP_OPEN);

  // ── Shared animation values ───────────────────────────────────────────────

  // Phase 1 – letter enter
  const letterOpacity = useSharedValue(0);
  const letterEnterY = useSharedValue(8);
  const letterEnterScale = useSharedValue(0.96);

  // Phase 3 – letter insert (additive on top of enter values)
  const letterInsertY = useSharedValue(0);
  const letterInsertScale = useSharedValue(1);

  // Phase 2 – envelope in
  const envOpacity = useSharedValue(0);
  const envRiseY = useSharedValue(14);

  // Phase 4 – flap close (degrees, 178 = open, 0 = closed)
  const flapRotX = useSharedValue(178);

  // Phase 5 – seal stamp
  const sealOpacity = useSharedValue(0);
  const sealDropY = useSharedValue(-70);
  const sealScale = useSharedValue(1.6);

  // Phase 6 – wax squish ring
  const squishScale = useSharedValue(0.45);
  const squishOpacity = useSharedValue(0);

  // Phase 6 – pack jolt (3 px quick press)
  const packJoltY = useSharedValue(0);

  // Phase 8 – pack departure (lift-and-fade)
  const packDepartY = useSharedValue(0);
  const packDepartScale = useSharedValue(1);
  const packDepartOpacity = useSharedValue(1);

  // ── onDone guard (call exactly once) ─────────────────────────────────────
  const doneCalled = useRef(false);

  // ── Animated styles ───────────────────────────────────────────────────────

  // Letter: enter opacity/translate/scale, then insert translate/scale (additive).
  const letterStyle = useAnimatedStyle(() => ({
    opacity: letterOpacity.value,
    transform: [
      { translateY: letterEnterY.value + letterInsertY.value },
      { scale: letterEnterScale.value * letterInsertScale.value },
    ],
  }));

  // All envelope layers share the same rise-in animation.
  const envStyle = useAnimatedStyle(() => ({
    opacity: envOpacity.value,
    transform: [{ translateY: envRiseY.value }],
  }));

  // Flap wrapper: perspective FIRST (required), then rotateX.
  // backfaceVisibility:'hidden' (in StyleSheet) hides the flap at 178° (open).
  const flapWrapStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 700 },
      { rotateX: `${flapRotX.value}deg` as `${number}deg` },
    ],
  }));

  // Seal stamp: drop + spring press.
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

  // Pack: departure translateY+scale+opacity, plus the brief 3-px jolt (additive).
  const packStyle = useAnimatedStyle(() => ({
    opacity: packDepartOpacity.value,
    transform: [
      { translateY: packDepartY.value + packJoltY.value },
      { scale: packDepartScale.value },
    ],
  }));

  // ── Main animation effect ─────────────────────────────────────────────────
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const boot = setTimeout(() => {
      if (reduceMotionRef.current) {
        // A13: skip ceremony, go straight to done.
        if (!doneCalled.current) {
          doneCalled.current = true;
          onDone();
        }
        return;
      }

      // ── Phase 1 (T=0): letter settles onto screen ────────────────────────
      letterOpacity.value = withTiming(1, { duration: 550, easing: Easing.out(Easing.cubic) });
      letterEnterY.value = withTiming(0, { duration: 550, easing: Easing.out(Easing.cubic) });
      letterEnterScale.value = withTiming(1, { duration: 550, easing: Easing.out(Easing.cubic) });

      // ── Phase 2 (T=750): envelope rises in from below ───────────────────
      envOpacity.value = withDelay(T_ENV_IN, withTiming(1, { duration: 450 }));
      envRiseY.value = withDelay(
        T_ENV_IN,
        withTiming(0, { duration: 450, easing: Easing.out(Easing.cubic) }),
      );

      // ── Phase 3 (T=1150): letter slides down into envelope pocket ────────
      letterInsertY.value = withDelay(
        T_INSERT,
        withTiming(INSERT_Y, { duration: 650, easing: Easing.inOut(Easing.cubic) }),
      );
      letterInsertScale.value = withDelay(
        T_INSERT,
        withTiming(0.55, { duration: 650, easing: Easing.inOut(Easing.cubic) }),
      );

      // ── Phase 4 (T=1850): flap folds closed (3-D rotateX) ───────────────
      flapRotX.value = withDelay(
        T_FLAP_CLOSE,
        withTiming(0, { duration: 500, easing: Easing.inOut(Easing.cubic) }),
      );
      // Swap flap z-index so it folds ABOVE the envelope front.
      timers.push(setTimeout(() => setFlapZIndex(Z_FLAP_CLOSE), T_FLAP_CLOSE));

      // ── Phase 5 (T=2450): seal drops with spring press ───────────────────
      sealOpacity.value = withDelay(T_STAMP, withTiming(1, { duration: 240 }));
      sealDropY.value = withDelay(
        T_STAMP,
        withTiming(0, { duration: 380, easing: Easing.in(Easing.quad) }),
      );
      // Spring undershoot IS the stamp-press feel; overshootClamping: false is intentional.
      sealScale.value = withDelay(
        T_STAMP,
        withSpring(1, { damping: 13, stiffness: 260, overshootClamping: false }),
      );

      // ── Phase 6 (T=2830): stamp settles — HAPTIC + squish ring + jolt ────
      timers.push(
        setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }, T_SETTLE),
      );

      // Squish ring: jump to 0.55 opacity then fade, while scale expands.
      squishOpacity.value = withDelay(
        T_SETTLE,
        withSequence(
          withTiming(0.55, { duration: 16 }),  // ~1 frame instant appear
          withTiming(0, { duration: 404 }),
        ),
      );
      squishScale.value = withDelay(T_SETTLE, withTiming(1.25, { duration: 420 }));

      // Envelope jolt: 3 px down in 80 ms, back to 0 in 160 ms.
      packJoltY.value = withDelay(
        T_SETTLE,
        withSequence(
          withTiming(3, { duration: 80 }),
          withTiming(0, { duration: 160 }),
        ),
      );

      // ── Phase 7 (T=3580): sacred pause (750 ms) then departure ───────────
      // Departure variant: lift — translateY up, slight scale-down, fade.
      const departEasing = Easing.bezier(0.6, 0.04, 0.3, 1);
      packDepartY.value = withDelay(T_DEPART, withTiming(-340, { duration: DUR_DEPART, easing: departEasing }));
      packDepartScale.value = withDelay(T_DEPART, withTiming(0.92, { duration: DUR_DEPART, easing: departEasing }));
      packDepartOpacity.value = withDelay(T_DEPART, withTiming(0, { duration: DUR_DEPART, easing: departEasing }));

      // ── onDone after departure completes ─────────────────────────────────
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
      cancelAnimation(letterOpacity);
      cancelAnimation(letterEnterY);
      cancelAnimation(letterEnterScale);
      cancelAnimation(letterInsertY);
      cancelAnimation(letterInsertScale);
      cancelAnimation(envOpacity);
      cancelAnimation(envRiseY);
      cancelAnimation(flapRotX);
      cancelAnimation(sealOpacity);
      cancelAnimation(sealDropY);
      cancelAnimation(sealScale);
      cancelAnimation(squishScale);
      cancelAnimation(squishOpacity);
      cancelAnimation(packJoltY);
      cancelAnimation(packDepartY);
      cancelAnimation(packDepartScale);
      cancelAnimation(packDepartOpacity);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.overlay}>
      {/* Pack: the whole letter+envelope composition that flies away on departure. */}
      <Animated.View style={[styles.pack, packStyle]}>

        {/* Envelope back — z=0, behind letter, shows the pocket interior. */}
        <Animated.View style={[styles.envBack, envStyle]} />

        {/* Letter paper — z=2, slides into envelope pocket in phase 3. */}
        <Animated.View style={[styles.paper, letterStyle]}>
          {Array.from({ length: N_LINES }).map((_, i) => (
            <View
              key={i}
              style={[styles.ruledLine, { top: LINE_SPACING * (i + 1) }]}
            />
          ))}
        </Animated.View>

        {/* Flap wrapper — perspective + rotateX for the 3-D fold.
            Height = FLAP_H × 2; the visible flap lives in the BOTTOM half so
            the wrapper's center = the fold line (transformOrigin emulation).
            backfaceVisibility:'hidden' keeps it invisible during the "open" state
            (rotateX ≈ 178°). z-index starts at 1 (behind letter), swaps to 5
            (above env front) when the close begins. */}
        <Animated.View
          style={[
            styles.flapWrap,
            { zIndex: flapZIndex },
            flapWrapStyle,
          ]}
        >
          {/* Top half: transparent spacer — shifts visual hinge to wrapper center. */}
          <View style={styles.flapSpacer} />
          {/* Bottom half: the visible downward-pointing triangle flap. */}
          <View style={styles.flapClip}>
            <View style={styles.flapTriangle} />
          </View>
        </Animated.View>

        {/* Envelope front — z=4, covers the letter after it slides in.
            V-fold crease triangle gives a paper-fold depth hint. */}
        <Animated.View style={[styles.envFront, envStyle]}>
          <View style={styles.vFoldTriangle} />
        </Animated.View>

        {/* Wax squish ring — bordeaux oval glow, fires at stamp settle. */}
        <Animated.View
          accessible={false}
          style={[
            styles.squish,
            { left: SQUISH_X, top: SQUISH_Y, zIndex: Z_SQUISH },
            squishStyle,
          ]}
        />

        {/* Wax seal stamp — drops with spring press. Purely decorative (A7). */}
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
  // Full-screen warm-cream overlay, matches background so transition is seamless.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },

  // Pack: fixed size, centered; flies away on departure.
  pack: {
    width: PACK_W,
    height: PACK_H,
  },

  // ── Letter paper ───────────────────────────────────────────────────────────
  paper: {
    position: 'absolute',
    left: LETTER_X,
    top: 0,
    width: PAPER_W,
    height: PAPER_H,
    backgroundColor: colors.surfacePaper,
    borderRadius: 3,
    overflow: 'hidden',
    zIndex: Z_LETTER,
    // Warm shadow only — never black/grey.
    shadowColor: colors.brandWarm,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },

  // Faint horizontal ruled lines (match HTML: 1px every 22px, warm brown at 11%).
  ruledLine: {
    position: 'absolute',
    left: 14,
    right: 14,
    height: 1,
    backgroundColor: colors.brandWarm,
    opacity: 0.11,
  },

  // ── Envelope back (pocket interior, behind letter) ─────────────────────────
  envBack: {
    position: 'absolute',
    left: 0,
    top: ENV_TOP,
    width: ENV_W,
    height: ENV_H,
    backgroundColor: colors.envelopeDeep,  // slightly deeper pocket interior
    borderRadius: 6,
    zIndex: Z_ENV_BACK,
  },

  // ── Flap ───────────────────────────────────────────────────────────────────

  // Wrapper: FLAP_H × 2 tall. Top half = transparent spacer.
  // Center of wrapper = fold line (transformOrigin emulation for rotateX).
  flapWrap: {
    position: 'absolute',
    left: 0,
    top: ENV_TOP - FLAP_H,  // center = ENV_TOP = fold line
    width: ENV_W,
    height: FLAP_H * 2,
    backfaceVisibility: 'hidden',  // hide at 178° (open state)
  },

  // Spacer: fills the top half of the wrapper (invisible).
  flapSpacer: {
    height: FLAP_H,
  },

  // Clips the triangle to exactly FLAP_H so it never overflows upward.
  flapClip: {
    width: ENV_W,
    height: FLAP_H,
    overflow: 'hidden',
  },

  // Downward-pointing triangle via border trick.
  // Position: bottom of flapClip + left=ENV_W/2 (center).
  // border-top extends UPWARD from the element, creating a triangle with:
  //   base at top (y=0 of flapClip), tip at bottom (y=FLAP_H).
  flapTriangle: {
    position: 'absolute',
    width: 0,
    height: 0,
    top: FLAP_H,
    left: ENV_W / 2,
    borderLeftWidth: ENV_W / 2,
    borderRightWidth: ENV_W / 2,
    borderTopWidth: FLAP_H,
    borderTopColor: colors.envelopeDeep,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  // ── Envelope front (above letter, creates pocket illusion) ─────────────────
  envFront: {
    position: 'absolute',
    left: 0,
    top: ENV_TOP,
    width: ENV_W,
    height: ENV_H,
    backgroundColor: colors.envelope,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
    zIndex: Z_ENV_FRONT,
    // Warm shadow — no elevation (Android renders black elevation).
    shadowColor: colors.brandWarm,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },

  // V-fold crease on envelope front: upward triangle occupying the lower 68%.
  // border-bottom extends DOWNWARD from element at top=ENV_H*0.32,
  // creating an upward-pointing triangle: tip at (ENV_W/2, ENV_H*0.32),
  // base corners at (0, ENV_H) and (ENV_W, ENV_H).
  vFoldTriangle: {
    position: 'absolute',
    width: 0,
    height: 0,
    top: ENV_H * 0.32,
    left: ENV_W / 2,
    borderLeftWidth: ENV_W / 2,
    borderRightWidth: ENV_W / 2,
    borderBottomWidth: ENV_H * 0.68,
    borderBottomColor: colors.envelopeDeep,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  // ── Wax squish ring ────────────────────────────────────────────────────────
  // Bordeaux oval glow approximating the radial-gradient in the HTML prototype.
  // (RN has no radial gradient without Skia; a low-opacity solid oval is close.)
  squish: {
    position: 'absolute',
    width: SQUISH_W,
    height: SQUISH_H,
    borderRadius: SQUISH_H / 2,
    backgroundColor: colors.dangerDeep,  // bordeauxRed #7A1E1E
    opacity: 0,
  },

  // ── Wax seal stamp ─────────────────────────────────────────────────────────
  seal: {
    position: 'absolute',
    width: STAMP_W,
    height: STAMP_H,
  },
});
