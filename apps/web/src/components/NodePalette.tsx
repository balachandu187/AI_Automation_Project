// ============================================================================
// FlowMind Web — Node Palette Sidebar
// ============================================================================
import { useCallback, useMemo } from "react";
import { useUIStore } from "../stores/uiStore";

// ---------------------------------------------------------------------------
// Node type definitions for the palette
// ---------------------------------------------------------------------------
interface PaletteItem {
  type: string;
  label: string;
  icon: string;
  description: string;
  category: string;
  defaultConfig: Record<string, unknown>;
}

const PALETTE_ITEMS: PaletteItem[] = [
  {
    type: "trigger",
    label: "Webhook",
    icon: "⚡",
    description: "Start workflow via HTTP webhook",
    category: "Triggers",
    defaultConfig: { triggerType: "webhook", method: "POST" },
  },
  {
    type: "trigger",
    label: "Schedule",
    icon: "🕐",
    description: "Run on a cron schedule",
    category: "Triggers",
    defaultConfig: { triggerType: "schedule", cron: "0 */6 * * *" },
  },
  {
    type: "trigger",
    label: "Manual",
    icon: "🖐️",
    description: "Trigger manually from dashboard",
    category: "Triggers",
    defaultConfig: { triggerType: "manual" },
  },
  {
    type: "action",
    label: "HTTP Request",
    icon: "🌐",
    description: "Make an HTTP API call",
    category: "Actions",
    defaultConfig: { method: "GET", url: "", headers: {}, body: "" },
  },
  {
    type: "action",
    label: "Send Email",
    icon: "✉️",
    description: "Send an email via SMTP",
    category: "Actions",
    defaultConfig: { to: "", subject: "", body: "" },
  },
  {
    type: "action",
    label: "Slack Message",
    icon: "💬",
    description: "Post a message to Slack",
    category: "Actions",
    defaultConfig: { channel: "", text: "" },
  },
  {
    type: "action",
    label: "Delay",
    icon: "⏱️",
    description: "Pause for a duration",
    category: "Actions",
    defaultConfig: { duration: 60, unit: "seconds" },
  },
  {
    type: "ai_agent",
    label: "LLM Call",
    icon: "🧠",
    description: "Call an LLM with a prompt",
    category: "AI",
    defaultConfig: {
      model: "gpt-4o",
      systemPrompt: "",
      temperature: 0.7,
      maxTokens: 1024,
    },
  },
  {
    type: "ai_agent",
    label: "AI Extract",
    icon: "🔍",
    description: "Extract structured data via AI",
    category: "AI",
    defaultConfig: {
      model: "gpt-4o",
      schema: {},
      inputField: "",
    },
  },
  {
    type: "ai_agent",
    label: "AI Router",
    icon: "🧭",
    description: "Route based on AI classification",
    category: "AI",
    defaultConfig: {
      model: "gpt-4o-mini",
      categories: [],
      inputField: "",
    },
  },
  {
    type: "condition",
    label: "Condition",
    icon: "🔀",
    description: "Branch based on a condition",
    category: "Logic",
    defaultConfig: { field: "", operator: "equals", value: "" },
  },
  {
    type: "condition",
    label: "AND Group",
    icon: "∧",
    description: "All conditions must match",
    category: "Logic",
    defaultConfig: { conditions: [], operator: "and" },
  },
  {
    type: "condition",
    label: "OR Group",
    icon: "∨",
    description: "Any condition must match",
    category: "Logic",
    defaultConfig: { conditions: [], operator: "or" },
  },
  {
    type: "approval",
    label: "Approval",
    icon: "👤",
    description: "Wait for human approval",
    category: "Human-in-the-Loop",
    defaultConfig: {
      approvers: [],
      messageTemplate: "Please review: {{trigger.payload}}",
    },
  },
];

const CATEGORIES = [
  "Triggers",
  "Actions",
  "AI",
  "Logic",
  "Human-in-the-Loop",
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function NodePalette() {
  const paletteSearch = useUIStore((s) => s.paletteSearch);
  const paletteCategory = useUIStore((s) => s.paletteCategory);
  const setPaletteSearch = useUIStore((s) => s.setPaletteSearch);
  const setPaletteCategory = useUIStore((s) => s.setPaletteCategory);

  const filteredItems = useMemo(() => {
    let items = PALETTE_ITEMS;
    if (paletteCategory) {
      items = items.filter((i) => i.category === paletteCategory);
    }
    if (paletteSearch) {
      const q = paletteSearch.toLowerCase();
      items = items.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.category.toLowerCase().includes(q),
      );
    }
    return items;
  }, [paletteSearch, paletteCategory]);

  const onDragStart = useCallback(
    (event: React.DragEvent, item: PaletteItem) => {
      event.dataTransfer.setData(
        "application/reactflow-node",
        JSON.stringify(item),
      );
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  return (
    <aside className="w-60 bg-surface-900 border-r border-surface-700 flex flex-col flex-shrink-0 h-full">
      {/* Header */}
      <div className="p-3 border-b border-surface-700">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Node Palette
        </h2>
        {/* Search */}
        <input
          type="text"
          value={paletteSearch}
          onChange={(e) => setPaletteSearch(e.target.value)}
          placeholder="Search nodes..."
          className="w-full px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-flowmind-500"
        />
        {/* Category filter */}
        <div className="flex gap-1 mt-2 flex-wrap">
          <button
            onClick={() => setPaletteCategory(null)}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              !paletteCategory
                ? "bg-flowmind-600 text-white"
                : "bg-surface-800 text-gray-400 hover:text-white"
            }`}
          >
            All
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() =>
                setPaletteCategory(
                  paletteCategory === cat ? null : cat,
                )
              }
              className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
                paletteCategory === cat
                  ? "bg-flowmind-600 text-white"
                  : "bg-surface-800 text-gray-400 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {filteredItems.map((item) => {
          const borderColor =
            item.type === "trigger"
              ? "border-emerald-600"
              : item.type === "action"
                ? "border-blue-600"
                : item.type === "ai_agent"
                  ? "border-purple-500"
                  : item.type === "condition"
                    ? "border-amber-600"
                    : "border-rose-600";

          const bgHover =
            item.type === "trigger"
              ? "hover:bg-emerald-950/40"
              : item.type === "action"
                ? "hover:bg-blue-950/40"
                : item.type === "ai_agent"
                  ? "hover:bg-purple-950/40"
                  : item.type === "condition"
                    ? "hover:bg-amber-950/40"
                    : "hover:bg-rose-950/40";

          return (
            <div
              key={`${item.type}-${item.label}`}
              draggable
              onDragStart={(e) => onDragStart(e, item)}
              className={`px-3 py-2.5 bg-surface-800 border ${borderColor} rounded-lg cursor-grab active:cursor-grabbing transition-colors ${bgHover} group`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{item.icon}</span>
                <span className="text-sm text-gray-200 font-medium">
                  {item.label}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-tight">
                {item.description}
              </p>
            </div>
          );
        })}
        {filteredItems.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-6">
            No nodes found
          </p>
        )}
      </div>
    </aside>
  );
}
