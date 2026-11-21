import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, SRGBColorSpace, Sprite } from "three";

/** Blotchy smoke puff: several overlapping soft gradients on one canvas. */
function makeFogTexture(seed: number): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    let s = seed;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < 7; i++) {
      const x = size * (0.28 + rnd() * 0.44);
      const y = size * (0.28 + rnd() * 0.44);
      const r = size * (0.16 + rnd() * 0.26);
      const a = 0.1 + rnd() * 0.14;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(168,176,196,${a.toFixed(3)})`);
      g.addColorStop(1, "rgba(168,176,196,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

interface FogSprite {
  position: [number, number, number];
  scale: number;
  opacity: number;
  speed: number;
}

const SPRITES: FogSprite[] = [
  { position: [-9.5, 2.2, -3.5], scale: 16, opacity: 0.08, speed: 0.006 },
  { position: [10.5, -1.4, -6.0], scale: 19, opacity: 0.065, speed: -0.004 },
  { position: [6.0, 3.2, 7.5], scale: 13, opacity: 0.055, speed: 0.008 },
  { position: [-7.0, -2.6, 6.5], scale: 15, opacity: 0.07, speed: -0.005 },
  { position: [0.5, -3.4, -10.5], scale: 18, opacity: 0.05, speed: 0.003 },
];

/**
 * Wispy gray nebula smoke drifting around the galaxy — pure atmosphere,
 * sits far outside the node band so it never occludes the graph.
 */
export function NebulaFog() {
  const textures = useMemo(() => [makeFogTexture(11), makeFogTexture(29)], []);
  const spriteRefs = useRef<(Sprite | null)[]>([]);

  useFrame((_, delta) => {
    for (let i = 0; i < spriteRefs.current.length; i++) {
      const sprite = spriteRefs.current[i];
      const cfg = SPRITES[i];
      if (sprite && cfg) {
        sprite.material.rotation += cfg.speed * delta;
      }
    }
  });

  return (
    <group>
      {SPRITES.map((cfg, i) => (
        <sprite
          key={i}
          ref={(s) => {
            spriteRefs.current[i] = s;
          }}
          position={cfg.position}
          scale={[cfg.scale, cfg.scale, 1]}
          raycast={() => null}
        >
          <spriteMaterial
            map={textures[i % textures.length] ?? null}
            transparent
            opacity={cfg.opacity}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </sprite>
      ))}
    </group>
  );
}
