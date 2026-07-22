import { Queue } from "bullmq";
import { loadConfig } from "../config.js";

const config = loadConfig();

const connection = {
  url: config.REDIS_URL,
  maxRetriesPerRequest: null,
};

export const workflowExecutionQueue = new Queue("workflow-execution", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export const webhookQueue = new Queue("webhook-processing", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 24 * 3600 },
  },
});

export const aiExecutionQueue = new Queue("ai-execution", {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export { connection };
