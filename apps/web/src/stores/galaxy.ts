import type {
  Embedder,
  Memory,
  MemoryBackend,
  MemoryEdge,
  MemoryInput,
} from "@galaxy-memory/shared";
import { create } from "zustand";

import { getBackend } from "../data/backend";
import {
  RADIUS_MAX,
  RADIUS_MIN,
  computePositions,
  sectorCenterAngle,
  sortClusters,
  type Vec3,
} from "../lib/layout";

export interface GraphSettings {
  showSemanticEdges: boolean;
  showLabels: boolean;
  autoRotate: boolean;
}

const SETTINGS_KEY = "gm:settings";
const DEFAULT_SETTINGS: GraphSettings = {
  showSemanticEdges: true,
  showLabels: false,
  autoRotate: true,
};

function loadSettings(): GraphSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GraphSettings>) };
    }
  } catch {
    // fall through to defaults
  }
  const reduced =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { ...DEFAULT_SETTINGS, autoRotate: !reduced };
}

/** Outside the store: the active backend subscription, so re-init tears it down. */
let backendUnsubscribe: (() => void) | undefined;

interface GalaxyState {
  status: "loading" | "ready" | "error";
  error: string | null;
  mode: "demo" | "supabase";
  backendLabel: string;
  embedderName: string;
  /** Where data physically lives, for the status popover. */
  storage: string;
  /** Timestamp of the last completed graph refresh (live-sync heartbeat). */
  lastSyncAt: number | null;

  memories: Memory[];
  edges: MemoryEdge[];
  positions: Record<string, Vec3>;
  clusters: string[];

  hoveredId: string | null;
  selectedId: string | null;
  /** Search-driven highlights — matching node ids, or null when inactive. */
  highlightIds: Set<string> | null;

  pagesOpen: boolean;
  searchOpen: boolean;
  settingsOpen: boolean;
  drawerOpen: boolean;
  /** Memory being edited; null = creating a new one. */
  editingId: string | null;
  /** Prefilled title for a new memory (e.g. from an unresolved [[wikilink]]). */
  draftTitle: string | null;
  settings: GraphSettings;

  /** Incremented to request a camera move — CameraRig watches the tick. */
  focusRequest: { id: string | null; point: Vec3 | null; tick: number };

  backend: MemoryBackend | null;
  embedder: Embedder | null;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setHovered(id: string | null): void;
  /** Select a node, fly the camera to it, and open the editor drawer. */
  openMemory(id: string): void;
  openNewMemory(titleSeed?: string): void;
  closeDrawer(): void;
  /** Deselect the active node (Esc / pointer-miss). */
  clearSelection(): void;
  setPagesOpen(open: boolean): void;
  setSearchOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setHighlight(ids: Set<string> | null): void;
  toggleSetting(key: keyof GraphSettings): void;
  resetCamera(): void;
  /** Fly the camera to a cluster's orbital sector. */
  focusCluster(cluster: string): void;
  saveMemory(input: MemoryInput, id: string | null): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;
}

export const useGalaxy = create<GalaxyState>()((set, get) => ({
  status: "loading",
  error: null,
  mode: "demo",
  backendLabel: "Demo",
  embedderName: "local",
  storage: "",
  lastSyncAt: null,

  memories: [],
  edges: [],
  positions: {},
  clusters: [],

  hoveredId: null,
  selectedId: null,
  highlightIds: null,

  pagesOpen: false,
  searchOpen: false,
  settingsOpen: false,
  drawerOpen: false,
  editingId: null,
  draftTitle: null,
  settings: loadSettings(),

  focusRequest: { id: null, point: null, tick: 0 },

  backend: null,
  embedder: null,

  async init() {
    try {
      const { backend, embedder, mode, storage } = await getBackend();
      set({
        backend,
        embedder,
        mode,
        storage,
        backendLabel: backend.label,
        embedderName: embedder.name,
      });
      await get().refresh();
      set({ status: "ready" });

      // Live sync: agent/other-tab writes re-flow the galaxy. Debounced —
      // a single save_memory produces several row changes (memory + edges).
      // Tear down any previous subscription first (StrictMode re-invokes init).
      backendUnsubscribe?.();
      let timer: ReturnType<typeof setTimeout> | undefined;
      backendUnsubscribe = backend.subscribe?.(() => {
        clearTimeout(timer);
        // transient poll/realtime failures shouldn't take down a working UI
        timer = setTimeout(
          () =>
            void get()
              .refresh()
              .catch(() => {}),
          300,
        );
      });
    } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : String(error) });
    }
  },

  async refresh() {
    const { backend } = get();
    if (!backend) return;
    const [memories, edges] = await Promise.all([backend.listMemories(), backend.listEdges()]);
    const clusters = sortClusters(memories);
    set({
      memories,
      edges,
      clusters,
      positions: computePositions(memories, clusters),
      lastSyncAt: Date.now(),
    });
  },

  setHovered(id) {
    set({ hoveredId: id });
  },

  openMemory(id) {
    set((s) => ({
      selectedId: id,
      editingId: id,
      drawerOpen: true,
      pagesOpen: false,
      focusRequest: { id, point: null, tick: s.focusRequest.tick + 1 },
    }));
  },

  openNewMemory(titleSeed) {
    set({
      editingId: null,
      draftTitle: titleSeed ?? null,
      drawerOpen: true,
      pagesOpen: false,
      searchOpen: false,
    });
  },

  closeDrawer() {
    set({ drawerOpen: false, editingId: null, draftTitle: null });
  },

  clearSelection() {
    set({ selectedId: null });
  },

  setPagesOpen(open) {
    set({ pagesOpen: open });
  },

  setSearchOpen(open) {
    set({ searchOpen: open });
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },

  setHighlight(ids) {
    set({ highlightIds: ids });
  },

  toggleSetting(key) {
    set((s) => {
      const settings = { ...s.settings, [key]: !s.settings[key] };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // storage unavailable — setting lives in memory only
      }
      return { settings };
    });
  },

  resetCamera() {
    set((s) => ({
      focusRequest: { id: null, point: null, tick: s.focusRequest.tick + 1 },
      selectedId: null,
    }));
  },

  focusCluster(cluster) {
    const { clusters } = get();
    const angle = sectorCenterAngle(clusters, cluster);
    const r = (RADIUS_MIN + RADIUS_MAX) / 2;
    set((s) => ({
      focusRequest: {
        id: null,
        point: [Math.cos(angle) * r, 1.35, Math.sin(angle) * r],
        tick: s.focusRequest.tick + 1,
      },
      selectedId: null,
    }));
  },

  async saveMemory(input, id) {
    const { backend } = get();
    if (!backend) throw new Error("backend not ready");
    const memory = id ? await backend.updateMemory(id, input) : await backend.saveMemory(input);
    await get().refresh();
    set((s) => ({
      editingId: memory.id,
      selectedId: memory.id,
      focusRequest: { id: memory.id, point: null, tick: s.focusRequest.tick + 1 },
    }));
    return memory;
  },

  async deleteMemory(id) {
    const { backend } = get();
    if (!backend) return;
    await backend.deleteMemory(id);
    set({ selectedId: null, editingId: null, drawerOpen: false });
    await get().refresh();
  },
}));
