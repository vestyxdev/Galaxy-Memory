import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute } from "three";

import type { EdgeType, MemoryEdge } from "@galaxy-memory/shared";

import type { Vec3 } from "../../lib/layout";
import { useGalaxy } from "../../stores/galaxy";

// additive blending: brightness does the dimming, not alpha
const EXPLICIT_RGB: Vec3 = [0.75, 0.78, 0.9];
const SEMANTIC_RGB: Vec3 = [0.5, 0.42, 0.85];
const LIT_BOOST = 2.2;
const DIM_FACTOR = 0.18;

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
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);

    const lit = activeId === null || e.source_id === activeId || e.target_id === activeId;
    const k = activeId === null ? 1 : lit ? LIT_BOOST : DIM_FACTOR;
    col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k, rgb[0] * k, rgb[1] * k, rgb[2] * k);
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
          opacity={0.4}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </lineSegments>
      <lineSegments geometry={semanticGeo} visible={showSemantic}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
