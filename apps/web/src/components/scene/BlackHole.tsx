import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  ShaderMaterial,
  SRGBColorSpace,
} from "three";

const DISK_INNER = 1.5;
const DISK_OUTER = 5.0;

const DISK_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Swirling plasma: differential rotation (inner faster), sine-streak bands,
// HDR output (>1.0) so the Bloom pass picks the disk up. Doppler beaming:
// the side orbiting toward the viewer burns brighter and hotter — the
// signature Interstellar asymmetry.
const DISK_FRAG = /* glsl */ `
varying vec2 vPos;
uniform float uTime;
uniform float uInner;
uniform float uOuter;
uniform float uBeamAngle;

void main() {
  float r = length(vPos);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float angle = atan(vPos.y, vPos.x);
  float speed = mix(1.9, 0.32, t);
  float a = angle - uTime * speed;

  float plasma = sin(a * 9.0 + r * 5.0) * 0.5 + 0.5;
  plasma *= sin(a * 17.0 - r * 9.0 + 1.3) * 0.35 + 0.65;
  plasma += sin(a * 3.0 + uTime * 0.3) * 0.15;

  vec3 inner = vec3(1.0, 0.96, 0.84);
  vec3 mid = vec3(1.0, 0.60, 0.20);
  vec3 outer = vec3(0.30, 0.09, 0.03);
  vec3 col = mix(inner, mid, smoothstep(0.0, 0.42, t));
  col = mix(col, outer, smoothstep(0.42, 1.0, t));

  // relativistic beaming — fixed in space, independent of the plasma swirl
  float beam = 0.5 + 0.5 * cos(angle - uBeamAngle);
  col = mix(col, vec3(1.0, 0.99, 0.94), beam * 0.3);

  float brightness = (2.8 * (1.0 - t * 0.82)) * (0.5 + plasma * 0.95);
  brightness *= 0.5 + 0.95 * beam;
  float alpha = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.72, 1.0, t));
  alpha *= 0.4 + plasma * 0.6;
  alpha *= 0.62 + 0.6 * beam;

  gl_FragColor = vec4(col * brightness, alpha);
}
`;

function makeGlowTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, "rgba(255, 212, 148, 0.5)");
    g.addColorStop(0.35, "rgba(255, 156, 76, 0.16)");
    g.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const ARC_COLOR = new Color(2.6, 1.9, 1.1); // HDR — feeds bloom
const ARC_COLOR_DIM = new Color(1.6, 1.1, 0.6);

const DISK_UNIFORMS = {
  uTime: { value: 0 },
  uInner: { value: DISK_INNER },
  uOuter: { value: DISK_OUTER },
  uBeamAngle: { value: -1.15 },
};

export function BlackHole() {
  const glow = useMemo(() => makeGlowTexture(), []);
  const diskMaterial = useRef<ShaderMaterial>(null);

  useFrame(({ clock }) => {
    const mat = diskMaterial.current;
    if (mat?.uniforms.uTime) {
      mat.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  return (
    <group rotation={[-0.3, 0, 0.1]}>
      {/* soft halo behind everything */}
      <sprite scale={[11, 11, 1]} raycast={() => null}>
        <spriteMaterial
          map={glow}
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </sprite>

      {/* event horizon — pure black, occludes the far side of the disk.
          toneMapped: no tone-mapping lift — the sphere must stay #000000. */}
      <mesh raycast={() => null}>
        <sphereGeometry args={[1.06, 64, 64]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>

      {/* photon ring hugging the horizon, in the disk plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <torusGeometry args={[1.18, 0.014, 10, 160]} />
        <meshBasicMaterial
          color={ARC_COLOR}
          transparent
          opacity={0.78}
          toneMapped={false}
          blending={AdditiveBlending}
        />
      </mesh>

      {/* lensed disk image — vertical arcs over/under the sphere */}
      <mesh raycast={() => null}>
        <torusGeometry args={[1.32, 0.032, 10, 160, Math.PI]} />
        <meshBasicMaterial
          color={ARC_COLOR}
          transparent
          opacity={0.68}
          toneMapped={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <mesh rotation={[0, 0, Math.PI]} raycast={() => null}>
        <torusGeometry args={[1.32, 0.026, 10, 160, Math.PI]} />
        <meshBasicMaterial
          color={ARC_COLOR_DIM}
          transparent
          opacity={0.48}
          toneMapped={false}
          blending={AdditiveBlending}
        />
      </mesh>

      {/* accretion disk */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[DISK_INNER, DISK_OUTER, 200, 1]} />
        <shaderMaterial
          ref={diskMaterial}
          uniforms={DISK_UNIFORMS}
          vertexShader={DISK_VERT}
          fragmentShader={DISK_FRAG}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
