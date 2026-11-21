import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  QuadraticBezierCurve3,
  Vector3,
} from "three";

import type { EdgeType, MemoryEdge } from "@galaxy-memory/shared";

import type { Vec3 } from "../../lib/layout";
import { useGalaxy } from "../../stores/galaxy";

// additive blending: brightness does the dimming, not alpha
const EXPLICIT_RGB: Vec3 = [0.75, 0.78, 0.9];
const SEMANTIC_RGB: Vec3 = [0.5, 0.42, 0.85];
const LIT_BOOST = 2.2;
const DIM_FACTOR = 0.12;
const CURVE_SEGMENTS = 22;

const UP = new Vector3(0, 1, 0);

/**
 * Edge curve: a quadratic bezier whose control point is pushed radially
 * outward (and slightly up) so every edge sweeps in a graceful arc away
 * from the black hole — orbital paths rather than straight chords.
 */
function edgeCurve(a: Vec3, b: Vec3): QuadraticBezierCurve3 {
  const va = new Vector3(a[0], a[1], a[2]);
  const vb = new Vector3(b[0], b[1], b[2]);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const dist = va.distanceTo(vb);

  let radial = mid.clone();
  if (radial.lengthSq() < 0.25) {
    // endpoints near-opposite: pick any perpendicular direction instead
    radial = vb.clone().sub(va).cross(UP);
    if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
  }
  radial.normalize().multiplyScalar(mid.length() + dist * 0.38);

  const control = new Vector3(radial.x, mid.y + dist * 0.16, radial.z);
  return new QuadraticBezierCurve3(va, control, vb);
}

function buildGeometry(
  edges: MemoryEdge[],
  positions: Record<string, Vec3>,
  type: EdgeType,
  activeId: string | null,
): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const rgb = type === "explicit" ? EXPLICIT_RGB : SEMANTIC_RGB;

  for (const e of edges) {
    if (e.edge_type !== type) continue;
    const a = positions[e.source_id];
    const b = positions[e.target_id];
    if (!a || !b) continue;

    const lit = activeId === null || e.source_id === activeId || e.target_id === activeId;
    const k = activeId === null ? 1 : lit ? LIT_BOOST : DIM_FACTOR;
    const r = rgb[0] * k;
    const g = rgb[1] * k;
    const bl = rgb[2] * k;

    const curve = edgeCurve(a, b);
    let prev = curve.getPoint(0);
    for (let i = 1; i <= CURVE_SEGMENTS; i++) {
      const next = curve.getPoint(i / CURVE_SEGMENTS);
      pos.push(prev.x, prev.y, prev.z, next.x, next.y, next.z);
      col.push(r, g, bl, r, g, bl);
      prev = next;
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  return geo;
}

export function GraphEdges() {
  const edges = useGalaxy((s) => s.edges);
  const positions = useGalaxy((s) => s.positions);
  const hoveredId = useGalaxy((s) => s.hoveredId);
  const selectedId = useGalaxy((s) => s.selectedId);
  const showSemantic = useGalaxy((s) => s.settings.showSemanticEdges);

  const activeId = hoveredId ?? selectedId;

  const explicitGeo = useMemo(
    () => buildGeometry(edges, positions, "explicit", activeId),
    [edges, positions, activeId],
  );
  const semanticGeo = useMemo(
    () => buildGeometry(edges, positions, "semantic", activeId),
    [edges, positions, activeId],
  );

  // geometries are rebuilt on every change — release the previous buffers
  useEffect(
    () => () => {
      explicitGeo.dispose();
      semanticGeo.dispose();
    },
    [explicitGeo, semanticGeo],
  );

  return (
    <group>
      <lineSegments geometry={explicitGeo}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.42}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </lineSegments>
      <lineSegments geometry={semanticGeo} visible={showSemantic}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.2}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
