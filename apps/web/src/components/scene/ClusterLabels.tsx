import { Html } from "@react-three/drei";
import { useMemo } from "react";

import { RADIUS_MAX, RADIUS_MIN, sectorCenterAngle } from "../../lib/layout";
import { useGalaxy } from "../../stores/galaxy";

const LABEL_RADIUS = (RADIUS_MIN + RADIUS_MAX) / 2;

/**
 * Floating cluster names with link counts, centered on each orbital
 * sector — the constellations' titles, always facing the camera.
 */
export function ClusterLabels() {
  const clusters = useGalaxy((s) => s.clusters);
  const memories = useGalaxy((s) => s.memories);
  const focusCluster = useGalaxy((s) => s.focusCluster);

  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of memories) counts.set(m.cluster, (counts.get(m.cluster) ?? 0) + 1);
    return clusters.map((cluster) => {
      const angle = sectorCenterAngle(clusters, cluster);
      return {
        cluster,
        count: counts.get(cluster) ?? 0,
        position: [Math.cos(angle) * LABEL_RADIUS, 1.35, Math.sin(angle) * LABEL_RADIUS] as [
          number,
          number,
          number,
        ],
      };
    });
  }, [clusters, memories]);

  return (
    <group>
      {labels.map(({ cluster, count, position }) => (
        <Html
          key={cluster}
          position={position}
          center
          distanceFactor={11}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "auto" }}
        >
          <button
            type="button"
            className="gm-cluster-label cursor-pointer"
            title={`Fly to ${cluster}`}
            onClick={() => focusCluster(cluster)}
          >
            <span className="gm-cluster-label-name">{cluster}</span>
            <span className="gm-cluster-label-count">
              {count} {count === 1 ? "link" : "links"}
            </span>
          </button>
        </Html>
      ))}
    </group>
  );
}
