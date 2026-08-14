import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { BoxKey } from '@/lib/economy/boxes';

// The six box vectors, transcribed from mocks 56/58 so the shop, the box-detail hero, and the
// open animation all draw the SAME silhouette at different sizes. Each box is a distinct object
// (logs, crate, furnace, vessel, chest, vault) because the crack in §8.5 is per-box — you can't
// chop a vault in half or spin a bundle of logs.

type Props = { boxKey: BoxKey; size?: number };

/** The radial backdrop tint behind each box in the shop grid (mock 56's `.bx` backgrounds). */
export const BOX_TINT: Record<BoxKey, string> = {
  kindling: '#332c44',
  ignition: '#1f5a34',
  furnace: '#1d5a72',
  hestia: '#4a2a6e',
  hephaestus: '#8a5a12',
  promethean: '#8a2020',
};

export function BoxArt({ boxKey, size = 48 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      {shapeFor(boxKey)}
    </Svg>
  );
}

function shapeFor(boxKey: BoxKey) {
  switch (boxKey) {
    // Kindling — a bundle of logs, banded. Cracks by a flat chop down the middle.
    case 'kindling':
      return (
        <>
          <Rect x="10" y="18" width="9" height="22" rx="4" fill="#7a5636" />
          <Ellipse cx="14.5" cy="18" rx="4.5" ry="2" fill="#c9a06a" />
          <Rect x="19" y="15" width="10" height="25" rx="5" fill="#85633f" />
          <Ellipse cx="24" cy="15" rx="5" ry="2.2" fill="#d1a86e" />
          <Rect x="29" y="18" width="9" height="22" rx="4" fill="#7a5636" />
          <Ellipse cx="33.5" cy="18" rx="4.5" ry="2" fill="#c9a06a" />
          <Rect x="8" y="24" width="32" height="3.6" rx="1.8" fill="#8a5230" />
          <Rect x="8" y="32" width="32" height="3.6" rx="1.8" fill="#8a5230" />
        </>
      );

    // Ignition — a crate with a lit fuse. The fuse burns down, then it blows.
    case 'ignition':
      return (
        <>
          <Path d="M22 12 C20 8 27 7 27 4" fill="none" stroke="#6a4a2a" strokeWidth={1.6} />
          <Circle cx="27" cy="3.6" r="2.6" fill="#FFD27A" />
          <Path d="M12 16 L24 13 L36 16 L24 19 Z" fill="#33313f" />
          <Path d="M12 16 L24 19 L24 38 L12 35 Z" fill="#22202b" />
          <Path d="M36 16 L24 19 L24 38 L36 35 Z" fill="#2A2834" />
          <Rect x="16" y="30" width="16" height="3" rx="1.5" fill="#3DA85C" />
        </>
      );

    // Furnace — a dark block with two glowing grates that blow out.
    case 'furnace':
      return (
        <>
          <Path d="M24 8 L38 16 L24 24 L10 16 Z" fill="#22202b" />
          <Path d="M10 16 L24 24 L24 40 L10 32 Z" fill="#14121A" />
          <Path d="M38 16 L24 24 L24 40 L38 32 Z" fill="#1a1720" />
          <Path d="M13 22 L21 26 L21 35 L13 31 Z" fill="#FFB800" />
          <Path d="M35 22 L27 26 L27 35 L35 31 Z" fill="#FFB800" />
        </>
      );

    // Vessel of Hestia — a two-handled urn with a purple flame at its mouth.
    case 'hestia':
      return (
        <>
          <Path
            d="M18 14 L30 14 L27 20 C37 25 38 35 30 42 L18 42 C10 35 11 25 21 20 Z"
            fill="#0F0D14"
            stroke="#3a3550"
            strokeWidth={1.2}
          />
          <Path d="M24 22 C33 26 34 34 28 40 L24 41 Z" fill="#080610" opacity={0.6} />
          <Ellipse cx="24" cy="14" rx="6" ry="2" fill="#1a1626" stroke="#3a3550" strokeWidth={1} />
          <Path d="M18 18 C10 20 10 30 16 33" fill="none" stroke="#0F0D14" strokeWidth={4} />
          <Path d="M30 18 C38 20 38 30 32 33" fill="none" stroke="#0F0D14" strokeWidth={4} />
          <Circle cx="23" cy="30" r="2" fill="#A200FF" />
        </>
      );

    // Hephaestus' Chest — a pale chest with a gold lock that turns before the lid lifts.
    case 'hephaestus':
      return (
        <>
          <Path d="M12 20 L17 16 L36 16 L31 20 Z" fill="#eef8ff" />
          <Path d="M31 20 L36 16 L36 34 L31 38 Z" fill="#c2dcea" />
          <Rect x="12" y="20" width="19" height="18" fill="#E0F4FF" />
          <Rect x="12" y="26" width="19" height="2.4" fill="#fff" />
          <Rect x="12" y="20" width="19" height="1.5" fill="#FFD700" />
          <Path d="M31 20 L36 16" stroke="#FFD700" strokeWidth={1.5} />
          <Circle cx="21.5" cy="30" r="3.4" fill="#FFD700" stroke="#b8860b" strokeWidth={1} />
        </>
      );

    // Promethean Vault — an octahedron with a red core. Spins ~3600° before flying open.
    case 'promethean':
      return (
        <>
          <Ellipse cx="24" cy="26" rx="20" ry="7" fill="none" stroke="#5a1414" strokeWidth={2.5} />
          <Path d="M24 8 L24 26 L12 26 Z" fill="#1a0c0e" />
          <Path d="M24 8 L36 26 L24 26 Z" fill="#251012" />
          <Path d="M12 26 L24 26 L24 42 Z" fill="#120a0c" />
          <Path d="M36 26 L24 26 L24 42 Z" fill="#1c0e10" />
          <G>
            <Path d="M24 8 L36 26 L24 42 L12 26 Z" fill="none" stroke="#5a1414" strokeWidth={1} />
          </G>
          <Circle cx="24" cy="26" r="5" fill="#FF2A2A" />
          <Circle cx="24" cy="26" r="2.4" fill="#ffc2c2" />
        </>
      );
  }
}
