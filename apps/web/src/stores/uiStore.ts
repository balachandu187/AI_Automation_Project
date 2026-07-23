// ============================================================================
// FlowMind Web — UI State Store (Zustand)
// ============================================================================
import { create } from "zustand";

export type PanelView =
  | "none"
  | "config"
  | "execution"
  | "versions"
  | "settings";

interface UIState {
  // Panel states
  activePanel: PanelView;
  configExpanded: boolean;

  // Node palette
  paletteSearch: string;
  paletteCategory: string | null;

  // Execution
  executionId: string | null;
  executionStatus: "idle" | "running" | "completed" | "failed";

  // Toasts
  toast: { message: string; type: "success" | "error" | "info" } | null;

  // Actions
  openConfig: () => void;
  openExecution: (id: string) => void;
  closePanel: () => void;
  setExecutionStatus: (status: UIState["executionStatus"]) => void;
  setPaletteSearch: (search: string) => void;
  setPaletteCategory: (category: string | null) => void;
  showToast: (
    message: string,
    type: "success" | "error" | "info",
  ) => void;
  clearToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activePanel: "none",
  configExpanded: false,
  paletteSearch: "",
  paletteCategory: null,
  executionId: null,
  executionStatus: "idle",
  toast: null,

  openConfig: () => set({ activePanel: "config" }),
  openExecution: (id) =>
    set({ activePanel: "execution", executionId: id, executionStatus: "running" }),
  closePanel: () =>
    set({ activePanel: "none", executionStatus: "idle" }),
  setExecutionStatus: (status) => set({ executionStatus: status }),
  setPaletteSearch: (search) => set({ paletteSearch: search }),
  setPaletteCategory: (category) => set({ paletteCategory: category }),

  showToast: (message, type) => set({ toast: { message, type } }),
  clearToast: () => set({ toast: null }),
}));
