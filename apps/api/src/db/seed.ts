/**
 * seed.ts — Database seed script for FlowMind development.
 *
 * Seeds a demo organization, user, workspace, and a sample workflow
 * with nodes, edges, and a published version.
 *
 * Usage: npx tsx src/db/seed.ts
 *   (requires DATABASE_URL env var pointing to a running Postgres)
 */

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import * as schema from "./schema/index.js";
import { loadConfig } from "../config.js";

const config = loadConfig();

async function seed() {
  console.log("🌱 Seeding FlowMind database...");

  const client = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    // ── Check if already seeded ──────────────────────────────────────────
    const existingUsers = await db.select().from(schema.users).where(
      eq(schema.users.email, "demo@flowmind.io")
    );
    if (existingUsers.length > 0) {
      console.log("⚠️  Demo data already exists. Skipping seed.");
      return;
    }

    // ── 1. Create demo organization ──────────────────────────────────────
    console.log("  Creating demo organization...");
    const [org] = await db
      .insert(schema.organizations)
      .values({
        name: "Demo Org",
        slug: "demo-org",
      })
      .returning();
    console.log(`    ✓ Organization: ${org.id} (${org.name})`);

    // ── 2. Create demo user ──────────────────────────────────────────────
    console.log("  Creating demo user...");
    const [user] = await db
      .insert(schema.users)
      .values({
        email: "demo@flowmind.io",
        name: "Demo User",
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$not-a-real-hash$placeholder",
        emailVerifiedAt: new Date(),
      })
      .returning();
    console.log(`    ✓ User: ${user.id} (${user.email})`);

    // ── 3. Create organization membership ────────────────────────────────
    console.log("  Creating organization membership...");
    const [orgMember] = await db
      .insert(schema.organizationMembers)
      .values({
        orgId: org.id,
        userId: user.id,
        role: "owner",
      })
      .returning();
    console.log(`    ✓ Org Member: ${orgMember.id} (role: ${orgMember.role})`);

    // ── 4. Create demo workspace ─────────────────────────────────────────
    console.log("  Creating demo workspace...");
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        orgId: org.id,
        name: "Demo Workspace",
        slug: "demo-workspace",
        createdBy: user.id,
      })
      .returning();
    console.log(`    ✓ Workspace: ${workspace.id} (${workspace.name})`);

    // ── 5. Create workspace membership ───────────────────────────────────
    console.log("  Creating workspace membership...");
    const [wsMember] = await db
      .insert(schema.workspaceMembers)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      })
      .returning();
    console.log(`    ✓ Workspace Member: ${wsMember.id} (role: ${wsMember.role})`);

    // ── 6. Create sample workflow ────────────────────────────────────────
    console.log("  Creating sample workflow...");
    const [workflow] = await db
      .insert(schema.workflows)
      .values({
        workspaceId: workspace.id,
        name: "Welcome Workflow",
        description: "A sample workflow demonstrating FlowMind's capabilities. Triggered by a webhook, it processes data and sends a Slack notification.",
        status: "active",
        triggerType: "webhook",
        triggerConfig: { url: "/hooks/demo-workspace/welcome" },
        createdBy: user.id,
      })
      .returning();
    console.log(`    ✓ Workflow: ${workflow.id} (${workflow.name})`);

    // ── 7. Create workflow nodes ─────────────────────────────────────────
    console.log("  Creating workflow nodes...");

    const [triggerNode] = await db
      .insert(schema.workflowNodes)
      .values({
        workflowId: workflow.id,
        type: "trigger",
        label: "Webhook Trigger",
        config: { method: "POST", path: "/hooks/demo-workspace/welcome" },
        positionX: 250,
        positionY: 100,
      })
      .returning();

    const [aiNode] = await db
      .insert(schema.workflowNodes)
      .values({
        workflowId: workflow.id,
        type: "ai_agent",
        label: "AI Analysis",
        config: {
          model: "gpt-4o-mini",
          systemPrompt: "Analyze the incoming data and categorize it.",
          maxTokens: 500,
        },
        positionX: 250,
        positionY: 300,
      })
      .returning();

    const [conditionNode] = await db
      .insert(schema.workflowNodes)
      .values({
        workflowId: workflow.id,
        type: "condition",
        label: "Check Priority",
        config: {
          expression: "{{ai_analysis.priority}} === 'high'",
        },
        positionX: 250,
        positionY: 500,
      })
      .returning();

    const [slackNode] = await db
      .insert(schema.workflowNodes)
      .values({
        workflowId: workflow.id,
        type: "action",
        label: "Send Slack Alert",
        config: {
          channel: "#alerts",
          message: "High priority item detected: {{trigger.data}}",
        },
        positionX: 450,
        positionY: 700,
      })
      .returning();

    const [approvalNode] = await db
      .insert(schema.workflowNodes)
      .values({
        workflowId: workflow.id,
        type: "approval",
        label: "Manager Approval",
        config: {
          approvers: ["demo@flowmind.io"],
          timeout: "24h",
          message: "Please review and approve this item.",
        },
        positionX: 250,
        positionY: 700,
      })
      .returning();

    console.log(`    ✓ Created ${5} nodes`);

    // ── 8. Create workflow edges ─────────────────────────────────────────
    console.log("  Creating workflow edges...");

    await db.insert(schema.workflowEdges).values([
      {
        workflowId: workflow.id,
        sourceNodeId: triggerNode.id,
        targetNodeId: aiNode.id,
      },
      {
        workflowId: workflow.id,
        sourceNodeId: aiNode.id,
        targetNodeId: conditionNode.id,
      },
      {
        workflowId: workflow.id,
        sourceNodeId: conditionNode.id,
        targetNodeId: slackNode.id,
        condition: { branch: "high" },
      },
      {
        workflowId: workflow.id,
        sourceNodeId: conditionNode.id,
        targetNodeId: approvalNode.id,
        condition: { branch: "default" },
      },
    ]);

    console.log("    ✓ Created 4 edges");

    // ── 9. Create workflow version snapshot ──────────────────────────────
    console.log("  Creating workflow version...");

    const snapshot = {
      workflowName: workflow.name,
      nodes: [
        { id: triggerNode.id, type: triggerNode.type, label: triggerNode.label, config: triggerNode.config, position: { x: triggerNode.positionX, y: triggerNode.positionY } },
        { id: aiNode.id, type: aiNode.type, label: aiNode.label, config: aiNode.config, position: { x: aiNode.positionX, y: aiNode.positionY } },
        { id: conditionNode.id, type: conditionNode.type, label: conditionNode.label, config: conditionNode.config, position: { x: conditionNode.positionX, y: conditionNode.positionY } },
        { id: slackNode.id, type: slackNode.type, label: slackNode.label, config: slackNode.config, position: { x: slackNode.positionX, y: slackNode.positionY } },
        { id: approvalNode.id, type: approvalNode.type, label: approvalNode.label, config: approvalNode.config, position: { x: approvalNode.positionX, y: approvalNode.positionY } },
      ],
      edges: [
        { source: triggerNode.id, target: aiNode.id },
        { source: aiNode.id, target: conditionNode.id },
        { source: conditionNode.id, target: slackNode.id, condition: { branch: "high" } },
        { source: conditionNode.id, target: approvalNode.id, condition: { branch: "default" } },
      ],
    };

    const [version] = await db
      .insert(schema.workflowVersions)
      .values({
        workflowId: workflow.id,
        versionNumber: 1,
        snapshot,
        changelog: "Initial version — demo workflow with webhook trigger, AI analysis, condition branching, and approval.",
        createdBy: user.id,
      })
      .returning();
    console.log(`    ✓ Version: ${version.id} (v${version.versionNumber})`);

    // ── 10. Create sample integration ────────────────────────────────────
    console.log("  Creating sample integration...");

    const [integration] = await db
      .insert(schema.integrations)
      .values({
        workspaceId: workspace.id,
        provider: "slack",
        name: "Demo Slack",
        isBuiltin: true,
      })
      .returning();

    await db.insert(schema.integrationCredentials).values({
      integrationId: integration.id,
      credentialType: "api_key",
      encryptedCredentials: "encrypted-placeholder-not-real",
    });

    console.log(`    ✓ Integration: ${integration.id} (${integration.provider})`);

    // ── 11. Create audit log entry ───────────────────────────────────────
    console.log("  Creating audit log...");

    await db.insert(schema.auditLogs).values({
      orgId: org.id,
      workspaceId: workspace.id,
      userId: user.id,
      action: "seed.created",
      resourceType: "system",
      resourceId: org.id,
      details: { message: "Demo data seeded successfully" },
      ipAddress: "127.0.0.1",
      userAgent: "seed-script/1.0",
    });

    console.log("    ✓ Audit log created");

    // ── Summary ──────────────────────────────────────────────────────────
    console.log("\n✅ Seed complete! Demo data summary:");
    console.log(`   Organization:  ${org.name} (${org.slug})`);
    console.log(`   User:          ${user.email}`);
    console.log(`   Workspace:     ${workspace.name} (${workspace.slug})`);
    console.log(`   Workflow:      ${workflow.name} (${workflow.status})`);
    console.log(`   Nodes:         5  |  Edges: 4  |  Version: 1`);
    console.log(`   Integration:   ${integration.provider}`);
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
