import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Mesh, MeshStandardMaterial } from "three";

import type { Memory } from "@galaxy-memory/shared";

import { nodeColor, type Vec3 } from "../../lib/layout";
import { useGalaxy } from "../../stores/galaxy";

type NodeState = "idle" | "lit" | "dim" | "match";

const TARGET_INTENSITY: Record<NodeState, number> = {
  idle: 1.3,
  lit: 3.6,
  dim: 0.14,
  match: 3.8,
};

function MemoryNode({
  memory,
  position,
  color,
  radius,
  state,
  isActive,
  showLabel,
}: {
  memory: Memory;
  position: Vec3;
  color: string;
  /** Base radius — well-connected stars burn bigger. */
  radius: number;
  state: NodeState;
  /** This node is the hovered/selected one — not just a neighbor. */
  isActive: boolean;
  showLabel: boolean;
}) {
  const meshRef = useRef<Mesh>(null);
  const setHovered = useGalaxy((s) => s.setHovered);
  const openMemory = useGalaxy((s) => s.openMemory);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const pulse = state === "match" ? Math.sin(clock.elapsedTime * 5 + position[0]) * 0.6 : 0;
    const target = TARGET_INTENSITY[state] + pulse + (isActive ? 0.9 : 0);
    const mat = mesh.material;
    if (mat instanceof MeshStandardMaterial) {
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * 0.15;
    }
    const scale = isActive ? 1.55 : state === "lit" ? 1.3 : 1;
    mesh.scale.setScalar(mesh.scale.x + (scale - mesh.scale.x) * 0.18);
  });

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        scale={0.001}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(memory.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          openMemory(memory.id);
        }}
      >
        <sphereGeometry args={[radius, 20, 20]} />
        <meshStandardMaterial
          color="#0b0b12"
          emissive={color}
          emissiveIntensity={TARGET_INTENSITY.idle}
          roughness={1}
          metalness={0}
        />
      </mesh>
      {(showLabel || isActive || state === "match") && (
        <Html center distanceFactor={9} zIndexRange={[15, 0]} style={{ pointerEvents: "none" }}>
          <div className="gm-node-label">
            <span className="gm-node-label-dot" style={{ background: color }} />
            {memory.title}
          </div>
        </Html>
      )}
    </group>
  );
}

export function GraphNodes() {
  const memories = useGalaxy((s) => s.memories);
  const positions = useGalaxy((s) => s.positions);
  const edges = useGalaxy((s) => s.edges);
  const hoveredId = useGalaxy((s) => s.hoveredId);
  const selectedId = useGalaxy((s) => s.selectedId);
  const highlightIds = useGalaxy((s) => s.highlightIds);
  const showLabels = useGalaxy((s) => s.settings.showLabels);

  const activeId = hoveredId ?? selectedId;
  const neighbors = useMemo(() => {
    if (!activeId) return new Set<string>();
    const set = new Set<string>([activeId]);
    for (const e of edges) {
      if (e.source_id === activeId) set.add(e.target_id);
      if (e.target_id === activeId) set.add(e.source_id);
    }
    return set;
  }, [edges, activeId]);

  // degree centrality — the most connected stars burn a little bigger
  const degrees = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of edges) {
      map.set(e.source_id, (map.get(e.source_id) ?? 0) + 1);
      map.set(e.target_id, (map.get(e.target_id) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  return (
    <group>
      {memories.map((m) => {
        const position = positions[m.id];
        if (!position) return null;
        let state: NodeState = "idle";
        if (highlightIds) {
          state = highlightIds.has(m.id) ? "match" : "dim";
        }
        if (activeId) {
          state = neighbors.has(m.id) ? "lit" : "dim";
        }
        const degree = degrees.get(m.id) ?? 0;
        const radius = 0.062 * (1 + (0.45 * Math.min(degree, 8)) / 8);
        return (
          <MemoryNode
            key={m.id}
            memory={m}
            position={position}
            color={nodeColor(m.cluster)}
            radius={radius}
            state={state}
            isActive={activeId === m.id}
            showLabel={showLabels}
          />
        );
      })}
    </group>
  );
}
