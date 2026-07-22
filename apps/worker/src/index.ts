import { Worker } from "bullmq";
import { loadConfig } from "./config.js";
import {
  workflowExecutionQueue,
  webhookQueue,
  aiExecutionQueue,
  connection,
} from "./queues/index.js";

const config = loadConfig();

function createWorker(name: string, processor: (job: unknown) => Promise<void>) {
  const worker = new Worker(name, processor, {
    connection,
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 1000,
    },
  });

  worker.on("completed", (job) => {
    console.log(`[${name}] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[${name}] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error(`[${name}] Worker error:`, err.message);
  });

  return worker;
}

// Workflow execution worker
const workflowWorker = createWorker(
  workflowExecutionQueue.name,
  async (job: any) => {
    console.log(`[workflow-execution] Processing job ${job.id}`);
    // Workflow execution logic will be implemented in a future task.
    // This processes the DAG, executes nodes, and manages retries.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
);

// Webhook processing worker
const webhookWorker = createWorker(
  webhookQueue.name,
  async (job: any) => {
    console.log(`[webhook-processing] Processing job ${job.id}`);
    // Webhook validation and processing will be implemented in a future task.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
);

// AI execution worker
const aiWorker = createWorker(
  aiExecutionQueue.name,
  async (job: any) => {
    console.log(`[ai-execution] Processing job ${job.id}`);
    // AI orchestration will be implemented in a future task.
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
);

console.log(`🚀 FlowMind Worker started (env: ${config.NODE_ENV})`);

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    workflowWorker.close(),
    webhookWorker.close(),
    aiWorker.close(),
    workflowExecutionQueue.close(),
    webhookQueue.close(),
    aiExecutionQueue.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
