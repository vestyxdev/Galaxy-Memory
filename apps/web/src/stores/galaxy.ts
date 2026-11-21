import type {
  Embedder,
  Memory,
  MemoryBackend,
  MemoryEdge,
  MemoryInput,
} from "@galaxy-memory/shared";
import { create } from "zustand";

import { getBackend } from "../data/backend";
import { computePositions, sortClusters, type Vec3 } from "../lib/layout";

export interface GraphSettings {
  showSemanticEdges: boolean;
  showLabels: boolean;
  autoRotate: boolean;
}

interface GalaxyState {
  status: "loading" | "ready" | "error";
  error: string | null;
  mode: "demo" | "supabase";
  backendLabel: string;
  embedderName: string;

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
  settings: GraphSettings;

  /** Incremented to request a camera move — CameraRig watches the tick. */
  focusRequest: { id: string | null; tick: number };

  backend: MemoryBackend | null;
  embedder: Embedder | null;

  init(): Promise<void>;
  refresh(): Promise<void>;
  setHovered(id: string | null): void;
  /** Select a node, fly the camera to it, and open the editor drawer. */
  openMemory(id: string): void;
  openNewMemory(): void;
  closeDrawer(): void;
  setPagesOpen(open: boolean): void;
  setSearchOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setHighlight(ids: Set<string> | null): void;
  toggleSetting(key: keyof GraphSettings): void;
  resetCamera(): void;
  saveMemory(input: MemoryInput, id: string | null): Promise<Memory>;
  deleteMemory(id: string): Promise<void>;
}

export const useGalaxy = create<GalaxyState>()((set, get) => ({
  status: "loading",
  error: null,
  mode: "demo",
  backendLabel: "Demo",
  embedderName: "local",

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
  settings: { showSemanticEdges: true, showLabels: false, autoRotate: true },

  focusRequest: { id: null, tick: 0 },

  backend: null,
  embedder: null,

  async init() {
    try {
      const { backend, embedder, mode } = await getBackend();
      set({ backend, embedder, mode, backendLabel: backend.label, embedderName: embedder.name });
      await get().refresh();
      set({ status: "ready" });
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
      focusRequest: { id, tick: s.focusRequest.tick + 1 },
    }));
  },

  openNewMemory() {
    set({ editingId: null, drawerOpen: true, pagesOpen: false, searchOpen: false });
  },

  closeDrawer() {
    set({ drawerOpen: false, editingId: null });
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
    set((s) => ({ settings: { ...s.settings, [key]: !s.settings[key] } }));
  },

  resetCamera() {
    set((s) => ({
      focusRequest: { id: null, tick: s.focusRequest.tick + 1 },
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
      focusRequest: { id: memory.id, tick: s.focusRequest.tick + 1 },
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
