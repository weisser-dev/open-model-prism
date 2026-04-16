/**
 * Open Model Prism logo — JSX equivalent of public/model-prism-logo.svg.
 *
 * Upright prism triangle, white input beam, gradient stroke,
 * three dispersed rays (cyan / violet / magenta), highlight node.
 *
 * ViewBox 48×48 (square).
 */
export default function ModelPrismLogo({ height = 28 }) {
  return (
    <svg
      width={height}
      height={height}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      aria-label="Model Prism"
    >
      <defs>
        <linearGradient id="mpGradMain" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#38bdf8" />
          <stop offset="50%"  stopColor="#818cf8" />
          <stop offset="100%" stopColor="#e879f9" />
        </linearGradient>
        <linearGradient id="mpBeam1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="mpBeam2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#818cf8" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="mpBeam3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="#e879f9" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#e879f9" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Incoming white beam */}
      <line x1="4" y1="24" x2="16" y2="24"
        stroke="white" strokeWidth="1.5" opacity="0.6" />

      {/* Ghost prism (depth effect) */}
      <polygon
        points="16,8 32,40 0,40"
        transform="translate(8, 4) scale(0.75)"
        fill="none"
        stroke="url(#mpGradMain)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Main prism */}
      <polygon
        points="24,10 36,38 12,38"
        fill="rgba(56,189,248,0.05)"
        stroke="url(#mpGradMain)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Dispersed beams: cyan / violet / magenta */}
      <line x1="36" y1="22" x2="46" y2="16"
        stroke="#38bdf8" strokeWidth="1.5" opacity="0.85" />
      <line x1="36" y1="26" x2="46" y2="26"
        stroke="#818cf8" strokeWidth="1.5" opacity="0.85" />
      <line x1="36" y1="30" x2="46" y2="36"
        stroke="#e879f9" strokeWidth="1.5" opacity="0.85" />

      {/* Center highlight node */}
      <circle cx="24" cy="24" r="1.5" fill="white" opacity="0.7" />
    </svg>
  );
}
