const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..", "..");
const envPath = path.join(rootDir, ".env");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const list = (name, fallback) =>
  (process.env[name] || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const serviceName = process.env.SERVICE_NAME || path.basename(process.cwd());

const defaultHealthPorts = {
  "inventory-service": 4000,
  "payment-service": 4001,
  "outbox-worker": 4002,
  "dlq-replay-worker": 4003,
  "order-timeout-worker": 4004,
};

module.exports = {
  serviceName,
  env: process.env.NODE_ENV || "development",
  port: number("PORT", 3000),
  healthPort: number("HEALTH_PORT", defaultHealthPorts[serviceName] || 4000),
  logLevel: process.env.LOG_LEVEL || "info",
  kafka: {
    clientId: process.env.KAFKA_CLIENT_ID || serviceName,
    brokers: list("KAFKA_BROKERS", "localhost:9092"),
    orderTopic: process.env.ORDER_EVENTS_TOPIC || "order-events",
    paymentTopic: process.env.PAYMENT_EVENTS_TOPIC || "payment-events",
    dlqTopic: process.env.DLQ_EVENTS_TOPIC || "dlq-events",
  },
  db: {
    user: process.env.POSTGRES_USER || "postgres",
    host: process.env.POSTGRES_HOST || "localhost",
    database: process.env.POSTGRES_DB || "flashcart",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    port: number("POSTGRES_PORT", 5433),
    max: number("POSTGRES_POOL_MAX", 10),
  },
  retry: {
    maxRetries: number("MAX_RETRIES", 3),
    baseDelayMs: number("BASE_DELAY_MS", 1000),
  },
  workers: {
    outboxBatchSize: number("OUTBOX_BATCH_SIZE", 10),
    outboxPollMs: number("OUTBOX_POLL_MS", 2000),
    timeoutSeconds: number("ORDER_TIMEOUT_SECONDS", 30),
    timeoutPollMs: number("ORDER_TIMEOUT_POLL_MS", 5000),
  },
};
