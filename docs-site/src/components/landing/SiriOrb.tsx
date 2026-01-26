export type SiriOrbProps = {
  size?: string;
  className?: string;
  colors?: {
    bg?: string;
    c1?: string;
    c2?: string;
    c3?: string;
  };
  animationDuration?: number;
  style?: React.CSSProperties;
};

const SIZE_THRESHOLD_SMALL = 50;
const SIZE_THRESHOLD_TINY = 30;
const SIZE_THRESHOLD_MEDIUM = 100;
const BLUR_MULTIPLIER_SMALL = 0.015;
const BLUR_MIN_SMALL = 3;
const BLUR_MULTIPLIER_LARGE = 0.03;
const BLUR_MIN_LARGE = 7;
const CONTRAST_MULTIPLIER_SMALL = 0.004;
const CONTRAST_MIN_SMALL = 1.2;
const CONTRAST_MULTIPLIER_LARGE = 0.008;
const CONTRAST_MIN_LARGE = 1.5;
const DOT_SIZE_MULTIPLIER_SMALL = 0.004;
const DOT_SIZE_MIN_SMALL = 0.05;
const DOT_SIZE_MULTIPLIER_LARGE = 0.008;
const DOT_SIZE_MIN_LARGE = 0.1;
const SHADOW_MULTIPLIER_SMALL = 0.004;
const SHADOW_MIN_SMALL = 0.5;
const SHADOW_MULTIPLIER_LARGE = 0.008;
const SHADOW_MIN_LARGE = 2;
const MASK_RADIUS_TINY = "0%";
const MASK_RADIUS_SMALL = "5%";
const MASK_RADIUS_MEDIUM = "15%";
const MASK_RADIUS_LARGE = "25%";
const CONTRAST_TINY = 1.1;
const CONTRAST_MULTIPLIER_FINAL = 1.2;
const CONTRAST_MIN_FINAL = 1.3;

const SiriOrb: React.FC<SiriOrbProps> = ({
  size = "192px",
  className,
  colors,
  animationDuration = 20,
  style,
}) => {
  // Colors matched to stella-landingpage design
  // Main purple: #a855f7
  const defaultColors = {
    bg: "oklch(55% 0.25 295)", // Main purple (#a855f7)
    c1: "oklch(65% 0.28 295)", // Brighter Violet
    c2: "oklch(72% 0.22 230)", // Brighter Blue
    c3: "oklch(78% 0.18 200)", // Brighter Cyan
  };

  const finalColors = { ...defaultColors, ...colors };

  // Extract numeric value from size for calculations
  const sizeValue = Number.parseInt(size.replace("px", ""), 10);

  // Responsive calculations based on size
  const blurAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * BLUR_MULTIPLIER_SMALL, BLUR_MIN_SMALL)
      : Math.max(sizeValue * BLUR_MULTIPLIER_LARGE, BLUR_MIN_LARGE);

  const contrastAmount =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * CONTRAST_MULTIPLIER_SMALL, CONTRAST_MIN_SMALL)
      : Math.max(sizeValue * CONTRAST_MULTIPLIER_LARGE, CONTRAST_MIN_LARGE);

  const dotSize =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * DOT_SIZE_MULTIPLIER_SMALL, DOT_SIZE_MIN_SMALL)
      : Math.max(sizeValue * DOT_SIZE_MULTIPLIER_LARGE, DOT_SIZE_MIN_LARGE);

  const shadowSpread =
    sizeValue < SIZE_THRESHOLD_SMALL
      ? Math.max(sizeValue * SHADOW_MULTIPLIER_SMALL, SHADOW_MIN_SMALL)
      : Math.max(sizeValue * SHADOW_MULTIPLIER_LARGE, SHADOW_MIN_LARGE);

  const getMaskRadius = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) {
      return MASK_RADIUS_TINY;
    }
    if (value < SIZE_THRESHOLD_SMALL) {
      return MASK_RADIUS_SMALL;
    }
    if (value < SIZE_THRESHOLD_MEDIUM) {
      return MASK_RADIUS_MEDIUM;
    }
    return MASK_RADIUS_LARGE;
  };

  const maskRadius = getMaskRadius(sizeValue);

  const getFinalContrast = (value: number) => {
    if (value < SIZE_THRESHOLD_TINY) {
      return CONTRAST_TINY;
    }
    if (value < SIZE_THRESHOLD_SMALL) {
      return Math.max(
        contrastAmount * CONTRAST_MULTIPLIER_FINAL,
        CONTRAST_MIN_FINAL
      );
    }
    return contrastAmount;
  };

  const finalContrast = getFinalContrast(sizeValue);

  return (
    <div
      className={className}
      style={
        {
          width: size,
          height: size,
          "--bg": finalColors.bg,
          "--c1": finalColors.c1,
          "--c2": finalColors.c2,
          "--c3": finalColors.c3,
          "--animation-duration": `${animationDuration}s`,
          "--blur-amount": `${blurAmount}px`,
          "--contrast-amount": finalContrast,
          "--dot-size": `${dotSize}px`,
          "--shadow-spread": `${shadowSpread}px`,
          "--mask-radius": maskRadius,
          display: "grid",
          gridTemplateAreas: '"stack"',
          overflow: "hidden",
          borderRadius: "50%",
          position: "relative",
        } as React.CSSProperties
      }
    >
      <style>{`
        @property --angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }

        @keyframes siri-orb-rotate {
          to {
            --angle: 360deg;
          }
        }
      `}</style>
      {/* Animated gradient layer */}
      <div
        style={{
          content: '""',
          display: "block",
          gridArea: "stack",
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background: `
            conic-gradient(
              from calc(var(--angle) * 2) at 25% 70%,
              var(--c3),
              var(--c1) 20% 80%,
              var(--c3)
            ),
            conic-gradient(
              from calc(var(--angle) * 2) at 45% 75%,
              var(--c2),
              var(--c3) 30% 60%,
              var(--c2)
            ),
            conic-gradient(
              from calc(var(--angle) * -3) at 80% 20%,
              var(--c1),
              var(--c2) 40% 60%,
              var(--c1)
            ),
            conic-gradient(
              from calc(var(--angle) * 2) at 15% 5%,
              var(--c2),
              var(--c1) 10% 90%,
              var(--c2)
            ),
            conic-gradient(
              from calc(var(--angle) * 1) at 20% 80%,
              var(--c1),
              var(--c3) 10% 90%,
              var(--c1)
            ),
            conic-gradient(
              from calc(var(--angle) * -2) at 85% 10%,
              var(--c3),
              var(--c2) 20% 80%,
              var(--c3)
            ),
            radial-gradient(circle at 50% 50%, var(--c1), var(--c2), var(--c3))
          `,
          boxShadow: `inset var(--bg) 0 0 var(--shadow-spread) calc(var(--shadow-spread) * 0.2)`,
          filter: `blur(var(--blur-amount)) contrast(var(--contrast-amount))`,
          animation: `siri-orb-rotate var(--animation-duration) linear infinite`,
          // GPU acceleration
          transform: 'translateZ(0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      />
    </div>
  );
};

export default SiriOrb;
