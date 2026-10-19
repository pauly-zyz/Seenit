import type { SceneKind } from "@/content/answers";

/** Original illustrations standing in for captured footage. Decorative. */
export function Scene({ kind }: { kind: SceneKind }) {
  return (
    <svg
      viewBox="0 0 400 300"
      className="size-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id="seenit-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {kind === "shelf" ? <Shelf /> : kind === "storefront" ? <Storefront /> : <Billboard />}
    </svg>
  );
}

function Shelf() {
  const cartonColors = ["#e9e4d4", "#d9e7c6", "#f3d9b4", "#c9dceb"];
  return (
    <g>
      <rect width="400" height="300" fill="#2b2f36" />
      <rect x="20" y="10" width="360" height="290" rx="6" fill="#3a3f48" />
      {[0, 1, 2].map((row) => (
        <g key={row} transform={`translate(0 ${row * 92})`}>
          {Array.from({ length: 8 }).map((_, i) => (
            <g key={i} transform={`translate(${38 + i * 42} 22)`}>
              <rect width="34" height="58" rx="4" fill={cartonColors[(i + row) % 4]} />
              <rect y="0" width="34" height="12" rx="3" fill="#ffffff" opacity="0.55" />
              <rect x="7" y="26" width="20" height="10" rx="2" fill="#0e1116" opacity="0.18" />
            </g>
          ))}
          <rect x="28" y="80" width="344" height="8" fill="#555c68" />
          <rect x={row === 1 ? 120 : 70} y="80" width="34" height="14" rx="2" fill="#c8f051" />
          <rect x={row === 1 ? 260 : 230} y="80" width="34" height="14" rx="2" fill="#f7f7f2" />
        </g>
      ))}
    </g>
  );
}

function Storefront() {
  return (
    <g>
      <rect width="400" height="300" fill="#cfd8dc" />
      <rect x="30" y="40" width="340" height="260" fill="#efe7da" />
      {Array.from({ length: 10 }).map((_, i) => (
        <rect
          key={i}
          x={30 + i * 34}
          y="40"
          width="34"
          height="38"
          fill={i % 2 ? "#f7f7f2" : "#2f6f5e"}
        />
      ))}
      <path d="M30 78 h340 l-10 12 H40z" fill="#245a4c" opacity="0.5" />
      <rect x="55" y="110" width="110" height="120" rx="4" fill="#9fb4bd" />
      <rect x="235" y="110" width="110" height="120" rx="4" fill="#9fb4bd" />
      <rect x="170" y="110" width="60" height="190" fill="#5c4632" />
      <rect x="178" y="138" width="44" height="34" rx="2" fill="#ffffff" />
      <rect x="184" y="146" width="32" height="5" rx="1" fill="#d93a3f" />
      <rect x="184" y="156" width="26" height="3" rx="1" fill="#0e1116" opacity="0.5" />
      <rect x="184" y="162" width="30" height="3" rx="1" fill="#0e1116" opacity="0.5" />
      <rect x="0" y="282" width="400" height="18" fill="#a9b0b5" />
      {/* passer-by, blurred */}
      <g filter="url(#seenit-blur)">
        <circle cx="300" cy="170" r="17" fill="#8a6a55" />
        <rect x="280" y="190" width="40" height="80" rx="16" fill="#3d5a80" />
      </g>
    </g>
  );
}

function Billboard() {
  return (
    <g>
      <rect width="400" height="300" fill="#1c2233" />
      <rect y="210" width="400" height="90" fill="#2a2f3a" />
      <rect x="60" y="30" width="280" height="150" rx="8" fill="#0e1116" />
      <rect x="70" y="40" width="260" height="130" rx="4" fill="#c8f051" />
      <circle cx="140" cy="105" r="38" fill="#0e1116" />
      <circle cx="140" cy="105" r="18" fill="#c8f051" />
      <rect x="200" y="78" width="110" height="14" rx="3" fill="#0e1116" />
      <rect x="200" y="100" width="80" height="10" rx="3" fill="#0e1116" opacity="0.6" />
      <rect x="200" y="122" width="60" height="18" rx="9" fill="#0e1116" />
      <rect x="192" y="180" width="16" height="40" fill="#4b5263" />
      {/* car with blurred plate */}
      <rect x="40" y="236" width="130" height="38" rx="12" fill="#6b7a8f" />
      <rect x="60" y="222" width="80" height="24" rx="8" fill="#8796ab" />
      <rect
        x="88"
        y="252"
        width="34"
        height="11"
        rx="2"
        fill="#f7f7f2"
        filter="url(#seenit-blur)"
      />
      <circle cx="70" cy="276" r="10" fill="#0e1116" />
      <circle cx="142" cy="276" r="10" fill="#0e1116" />
    </g>
  );
}
