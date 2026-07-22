-- Custom migration: Table comments for all 16 MVP tables
-- Generated alongside drizzle-kit migration 0000

COMMENT ON TABLE users IS 'Core user accounts for authentication and identity. Soft-delete via deleted_at.';
COMMENT ON TABLE organizations IS 'Top-level tenant container. Each organization owns workspaces, billing, and audit logs.';
COMMENT ON TABLE organization_members IS 'Maps users to organizations with a role (owner, admin, member).';
COMMENT ON TABLE workspaces IS 'Sub-organization grouping for workflows, integrations, and team members.';
COMMENT ON TABLE workspace_members IS 'Maps users to workspaces with a role (owner, admin, editor, viewer).';
COMMENT ON TABLE workflows IS 'Automation workflow definitions. Versioned via workflow_versions. Status: draft/active/paused/archived.';
COMMENT ON TABLE workflow_versions IS 'Immutable snapshots of workflow definitions. Each version captures the full DAG as a JSONB snapshot.';
COMMENT ON TABLE workflow_nodes IS 'Individual nodes in the workflow DAG. Types: trigger/action/condition/ai_agent/approval.';
COMMENT ON TABLE workflow_edges IS 'Directed connections between workflow nodes. Optional condition JSONB for branching logic.';
COMMENT ON TABLE executions IS 'Records of workflow runs. Links to the workflow and specific version executed. Status: pending/running/completed/failed/cancelled.';
COMMENT ON TABLE execution_steps IS 'Individual node execution results within a workflow run. Tracks input/output, errors, retries, and timing.';
COMMENT ON TABLE integrations IS 'Third-party service connections configured per workspace (slack, gmail, google_drive, etc).';
COMMENT ON TABLE integration_credentials IS 'Encrypted authentication tokens for integrations. AES-256-GCM encrypted. Supports OAuth and API keys.';
COMMENT ON TABLE ai_conversations IS 'AI chat sessions tied to workflow executions. Records model used and conversation lifecycle.';
COMMENT ON TABLE ai_messages IS 'Individual messages within an AI conversation. Supports system/user/assistant/tool roles. Tracks tool calls and token counts.';
COMMENT ON TABLE audit_logs IS 'Immutable append-only audit trail. Logs every mutating action: workflow edits, executions, user invites, credential changes. No UPDATE or DELETE allowed.';
