import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  ShaderMaterial,
  SRGBColorSpace,
} from "three";

import { clusterColor, sectorCenterAngle, sectorWidth } from "../../lib/layout";
import { useGalaxy } from "../../stores/galaxy";

/** Deterministic PRNG so the dust field is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeDotTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

const DUST_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;

void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // twinkle: each grain breathes at its own phase and rate
  float tw = 0.72 + 0.28 * sin(uTime * (0.45 + aPhase * 0.85) + aPhase * 23.0);
  gl_PointSize = aSize * tw * (uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  gl_FragColor = vec4(vColor, tex.a);
}
`;

const CLUSTER_POINTS = 420; // dust grains per cluster sector
const HALO_POINTS = 650; // sparse outer field tying the galaxy to the starfield
const WHITE = new Color(0.92, 0.94, 1.0);

/**
 * A field of tiny ambient stars — the "fog of memory" that makes the galaxy
 * read as hundreds of points. Cluster dust is tinted toward its cluster color
 * and concentrated in the same orbital sectors as real memory nodes, with a
 * spiral shear that trails the clumps into faint arms.
 */
export function AmbientDust() {
  const clusters = useGalaxy((s) => s.clusters);
  const texture = useMemo(() => makeDotTexture(), []);
  const materialRef = useRef<ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uScale: { value: 600 },
      uMap: { value: texture },
    }),
    [texture],
  );

  const geometry = useMemo(() => {
    const rand = mulberry32(0x9e3779b9);
    const pos: number[] = [];
    const col: number[] = [];
    const siz: number[] = [];
    const pha: number[] = [];
    const width = sectorWidth(clusters);
    const tint = new Color();

    const push = (x: number, y: number, z: number, c: Color, size: number) => {
      pos.push(x, y, z);
      col.push(c.r, c.g, c.b);
      siz.push(size);
      pha.push(rand());
    };

    const tmp = new Color();
    for (const cluster of clusters) {
      const center = sectorCenterAngle(clusters, cluster);
      tint.set(clusterColor(cluster));
      for (let i = 0; i < CLUSTER_POINTS; i++) {
        // gaussian clump: tight angular core, wider radial tails, thin disk
        const radius = 8.4 + gauss(rand) * 2.5;
        if (radius < 4.4) continue; // keep clear of the accretion disk
        // spiral shear — outer grains lag behind, stretching clumps into arms
        const angle = center + gauss(rand) * width * 0.3 + (radius - 8.4) * 0.085;
        const y = gauss(rand) * 1.05;
        const k = 0.55 + rand() * 0.4;
        tmp.setRGB(
          WHITE.r * (1 - 0.28 * k) + tint.r * 0.28 * k,
          WHITE.g * (1 - 0.28 * k) + tint.g * 0.28 * k,
          WHITE.b * (1 - 0.28 * k) + tint.b * 0.28 * k,
        );
        // a few brighter "core stars", mostly fine grains
        const size = rand() < 0.12 ? 0.14 + rand() * 0.1 : 0.05 + rand() * 0.06;
        push(Math.cos(angle) * radius, y, Math.sin(angle) * radius, tmp, size);
      }
    }

    for (let i = 0; i < HALO_POINTS; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 12 + rand() * 14;
      const y = gauss(rand) * 3.4;
      const d = 0.16 + rand() * 0.3;
      tmp.setRGB(d, d, d * 1.05);
      push(Math.cos(angle) * radius, y, Math.sin(angle) * radius, tmp, 0.04 + rand() * 0.05);
    }

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new Float32BufferAttribute(col, 3));
    geo.setAttribute("aSize", new Float32BufferAttribute(siz, 1));
    geo.setAttribute("aPhase", new Float32BufferAttribute(pha, 1));
    return geo;
  }, [clusters]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const mat = materialRef.current;
    const uTime = mat?.uniforms.uTime;
    const uScale = mat?.uniforms.uScale;
    if (!uTime || !uScale) return;
    uTime.value = state.clock.elapsedTime;
    // gl_PointSize is in device pixels — scale by half the drawingbuffer height
    uScale.value = state.gl.domElement.height * 0.5;
  });

  return (
    <points geometry={geometry} raycast={() => null}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={DUST_VERT}
        fragmentShader={DUST_FRAG}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
}
