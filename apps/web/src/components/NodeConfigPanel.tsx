// ============================================================================
// FlowMind Web — Node Configuration Panel
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkflowStore } from "../stores/workflowStore";
import { useUIStore } from "../stores/uiStore";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function NodeConfigPanel() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const getNodeVariables = useWorkflowStore((s) => s.getNodeVariables);
  const closePanel = useUIStore((s) => s.closePanel);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [showVars, setShowVars] = useState(false);

  useEffect(() => {
    if (selectedNode) {
      setLocalConfig(
        structuredClone(
          (selectedNode.data.config as Record<string, unknown>) || {},
        ),
      );
    }
  }, [selectedNode]);

  const variables = useMemo(
    () => (selectedNodeId ? getNodeVariables(selectedNodeId) : []),
    [selectedNodeId, getNodeVariables],
  );

  const handleConfigChange = useCallback(
    (key: string, value: unknown) => {
      setLocalConfig((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!selectedNodeId) return;
    updateNodeData(selectedNodeId, { config: localConfig });
  }, [selectedNodeId, localConfig, updateNodeData]);

  const nodeType = (selectedNode?.data.nodeType as string) || "action";
  const nodeLabel = (selectedNode?.data.label as string) || "";

  if (!selectedNode) {
    return (
      <aside className="w-72 bg-surface-900 border-l border-surface-700 flex-shrink-0 h-full flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-3xl mb-2 opacity-30">📋</div>
          <p className="text-sm text-gray-500">Select a node to configure</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 bg-surface-900 border-l border-surface-700 flex-shrink-0 h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-surface-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">{nodeLabel}</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 capitalize">
            {nodeType.replace("_", " ")}
          </p>
        </div>
        <button
          onClick={closePanel}
          className="text-gray-400 hover:text-white text-xl leading-none transition-colors"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label field (common) */}
        <FormField label="Node Label">
          <input
            type="text"
            value={nodeLabel}
            onChange={(e) => {
              if (selectedNodeId) {
                updateNodeData(selectedNodeId, { label: e.target.value });
              }
            }}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
          />
        </FormField>

        {/* Type-specific fields */}
        {nodeType === "trigger" && <TriggerConfig config={localConfig} onChange={handleConfigChange} />}
        {nodeType === "action" && <ActionConfig config={localConfig} onChange={handleConfigChange} />}
        {nodeType === "condition" && <ConditionConfig config={localConfig} onChange={handleConfigChange} />}
        {nodeType === "ai_agent" && <AIAgentConfig config={localConfig} onChange={handleConfigChange} />}
        {nodeType === "approval" && <ApprovalConfig config={localConfig} onChange={handleConfigChange} />}

        {/* Variable suggestions */}
        <div className="pt-2 border-t border-surface-700">
          <button
            onClick={() => setShowVars(!showVars)}
            className="text-xs text-flowmind-400 hover:text-flowmind-300 transition-colors flex items-center gap-1"
          >
            <span>{showVars ? "▾" : "▸"}</span>
            Available Variables ({variables.length})
          </button>
          {showVars && (
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {variables.map((v) => (
                <div
                  key={v.name}
                  className="flex items-center gap-2 px-2 py-1 bg-surface-800 rounded text-xs"
                >
                  <code className="text-flowmind-400 font-mono">
                    {`{{${v.name}}}`}
                  </code>
                  <span className="text-gray-500">{v.label}</span>
                </div>
              ))}
              {variables.length === 0 && (
                <p className="text-xs text-gray-500">
                  No upstream nodes connected
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-surface-700">
        <button
          onClick={handleSave}
          className="w-full py-2 bg-flowmind-600 hover:bg-flowmind-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Apply Changes
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Form Field wrapper
// ---------------------------------------------------------------------------
function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config sub-forms
// ---------------------------------------------------------------------------
function TriggerConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const triggerType = (config.triggerType as string) || "webhook";
  return (
    <>
      <FormField label="Trigger Type">
        <select
          value={triggerType}
          onChange={(e) => onChange("triggerType", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
        >
          <option value="webhook">Webhook</option>
          <option value="schedule">Schedule</option>
          <option value="manual">Manual</option>
        </select>
      </FormField>
      {triggerType === "webhook" && (
        <>
          <FormField label="HTTP Method">
            <select
              value={(config.method as string) || "POST"}
              onChange={(e) => onChange("method", e.target.value)}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
            >
              <option value="POST">POST</option>
              <option value="GET">GET</option>
              <option value="PUT">PUT</option>
            </select>
          </FormField>
          <FormField label="Webhook URL">
            <div className="p-2 bg-surface-800 border border-surface-700 rounded-md">
              <code className="text-xs text-flowmind-400 break-all">
                /api/v1/hooks/{"{workflowId}"}
              </code>
            </div>
          </FormField>
        </>
      )}
      {triggerType === "schedule" && (
        <FormField label="Cron Expression">
          <input
            type="text"
            value={(config.cron as string) || "0 */6 * * *"}
            onChange={(e) => onChange("cron", e.target.value)}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:border-flowmind-500"
            placeholder="0 */6 * * *"
          />
        </FormField>
      )}
    </>
  );
}

function ActionConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const method = (config.method as string) || "GET";
  return (
    <>
      <FormField label="HTTP Method">
        <select
          value={method}
          onChange={(e) => onChange("method", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
        >
          <option value="GET">GET</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
      </FormField>
      <FormField label="URL">
        <input
          type="text"
          value={(config.url as string) || ""}
          onChange={(e) => onChange("url", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:border-flowmind-500"
          placeholder="https://api.example.com/endpoint"
        />
      </FormField>
      <FormField label="Headers (JSON)">
        <textarea
          value={(config.headers as string) || "{}"}
          onChange={(e) => onChange("headers", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-200 font-mono focus:outline-none focus:border-flowmind-500 h-20 resize-y"
          placeholder='{"Content-Type": "application/json"}'
        />
      </FormField>
      {method !== "GET" && (
        <FormField label="Body">
          <textarea
            value={(config.body as string) || ""}
            onChange={(e) => onChange("body", e.target.value)}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-200 font-mono focus:outline-none focus:border-flowmind-500 h-24 resize-y"
            placeholder='{"key": "{{trigger.payload.value}}"}'
          />
        </FormField>
      )}
    </>
  );
}

function ConditionConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <FormField label="Field">
        <input
          type="text"
          value={(config.field as string) || ""}
          onChange={(e) => onChange("field", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:border-flowmind-500"
          placeholder="{{trigger.payload.value}}"
        />
      </FormField>
      <FormField label="Operator">
        <select
          value={(config.operator as string) || "equals"}
          onChange={(e) => onChange("operator", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
        >
          <option value="equals">equals</option>
          <option value="not_equals">not equals</option>
          <option value="contains">contains</option>
          <option value="greater_than">greater than</option>
          <option value="less_than">less than</option>
          <option value="is_empty">is empty</option>
          <option value="is_not_empty">is not empty</option>
          <option value="regex">matches regex</option>
        </select>
      </FormField>
      <FormField label="Value">
        <input
          type="text"
          value={(config.value as string) || ""}
          onChange={(e) => onChange("value", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 font-mono focus:outline-none focus:border-flowmind-500"
          placeholder="expected value"
        />
      </FormField>
    </>
  );
}

function AIAgentConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <>
      <FormField label="Model">
        <select
          value={(config.model as string) || "gpt-4o"}
          onChange={(e) => onChange("model", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
        >
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
          <option value="gpt-4-turbo">GPT-4 Turbo</option>
          <option value="claude-3-opus">Claude 3 Opus</option>
          <option value="claude-3-sonnet">Claude 3 Sonnet</option>
          <option value="claude-3-haiku">Claude 3 Haiku</option>
        </select>
      </FormField>
      <FormField label="System Prompt">
        <textarea
          value={(config.systemPrompt as string) || ""}
          onChange={(e) => onChange("systemPrompt", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-200 focus:outline-none focus:border-flowmind-500 h-24 resize-y"
          placeholder="You are a helpful assistant..."
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Temperature">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={(config.temperature as number) ?? 0.7}
            onChange={(e) => onChange("temperature", parseFloat(e.target.value))}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
          />
        </FormField>
        <FormField label="Max Tokens">
          <input
            type="number"
            min={1}
            max={128000}
            step={1}
            value={(config.maxTokens as number) ?? 1024}
            onChange={(e) => onChange("maxTokens", parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
          />
        </FormField>
      </div>
    </>
  );
}

function ApprovalConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const approvers = (config.approvers as string[]) || [];
  const [newApprover, setNewApprover] = useState("");

  return (
    <>
      <FormField label="Approvers">
        <div className="space-y-1.5 mb-2">
          {approvers.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200"
            >
              <span className="flex-1">{a}</span>
              <button
                onClick={() =>
                  onChange(
                    "approvers",
                    approvers.filter((_, idx) => idx !== i),
                  )
                }
                className="text-gray-500 hover:text-red-400 text-sm"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newApprover}
            onChange={(e) => setNewApprover(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newApprover.trim()) {
                onChange("approvers", [...approvers, newApprover.trim()]);
                setNewApprover("");
              }
            }}
            className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-sm text-gray-200 focus:outline-none focus:border-flowmind-500"
            placeholder="user@company.com"
          />
          <button
            onClick={() => {
              if (newApprover.trim()) {
                onChange("approvers", [...approvers, newApprover.trim()]);
                setNewApprover("");
              }
            }}
            className="px-3 py-2 bg-flowmind-600 hover:bg-flowmind-500 text-white text-sm rounded-md transition-colors"
          >
            Add
          </button>
        </div>
      </FormField>
      <FormField label="Message Template">
        <textarea
          value={(config.messageTemplate as string) || ""}
          onChange={(e) => onChange("messageTemplate", e.target.value)}
          className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-md text-xs text-gray-200 focus:outline-none focus:border-flowmind-500 h-20 resize-y"
          placeholder="Please review: {{trigger.payload}}"
        />
      </FormField>
    </>
  );
}
