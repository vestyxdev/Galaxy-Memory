import type { Memory } from "@galaxy-memory/shared";

export type Vec3 = [number, number, number];

/** Preferred sector order; unknown clusters sort after these, alphabetically. */
export const CLUSTER_ORDER = [
  "Projects",
  "Code & Architecture",
  "Reference Notes",
  "Ideas",
  "Daily Logs",
  "General",
];

const CLUSTER_COLORS: Record<string, string> = {
  Projects: "#ffd27a",
  "Code & Architecture": "#7ac8ff",
  "Reference Notes": "#9ff0c0",
  Ideas: "#e3a1ff",
  "Daily Logs": "#ff9c9c",
  General: "#d7dae6",
};

const FALLBACK_COLORS = ["#8ff0e0", "#f6c58f", "#b6a4ff", "#9ab8ff", "#f49ac1"];

export function clusterColor(cluster: string): string {
  const known = CLUSTER_COLORS[cluster];
  if (known) return known;
  return FALLBACK_COLORS[stableHash(cluster) % FALLBACK_COLORS.length]!;
}

/** Sorted, deduped cluster list: preferred order first, extras alphabetical. */
export function sortClusters(memories: Memory[]): string[] {
  const set = new Set(memories.map((m) => m.cluster));
  const known = CLUSTER_ORDER.filter((c) => set.has(c));
  const extras = [...set].filter((c) => !CLUSTER_ORDER.includes(c)).sort();
  return [...known, ...extras];
}

/** fnv-1a — deterministic placement across reloads. */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SECTOR_SPREAD = 0.68; // fraction of the sector width nodes may occupy
const RADIUS_MIN = 5.4;
const RADIUS_MAX = 11.5;
const HEIGHT_JITTER = 1.5;

/**
 * Orbital layout: every cluster owns an angular sector; a memory keeps a
 * stable radius/angle inside it derived from its id hash.
 */
export function computePositions(memories: Memory[], clusters: string[]): Record<string, Vec3> {
  const positions: Record<string, Vec3> = {};
  const n = Math.max(clusters.length, 1);
  const sectorWidth = (Math.PI * 2) / n;

  for (const m of memories) {
    const ci = Math.max(clusters.indexOf(m.cluster), 0);
    const h = stableHash(m.id);
    const h2 = stableHash(`${m.id}:r`);
    const h3 = stableHash(`${m.id}:y`);

    const sectorCenter = ci * sectorWidth;
    const angle = sectorCenter + (h / 0xffffffff - 0.5) * sectorWidth * SECTOR_SPREAD * 2;
    const radius = RADIUS_MIN + (h2 / 0xffffffff) * (RADIUS_MAX - RADIUS_MIN);
    const y = (h3 / 0xffffffff - 0.5) * HEIGHT_JITTER;

    positions[m.id] = [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  }
  return positions;
}
