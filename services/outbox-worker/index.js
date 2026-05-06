const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");
const metrics = require("../../shared/utils/metrics");
const sleep = require("../../shared/utils/sleep");
const { pool, checkDb } = require("../../shared/utils/db");
const { createKafka, eventTopic } = require("../../shared/utils/kafka");
const { startHealthServer } = require("../../shared/utils/health");

const kafka = createKafka("outbox-worker");
const producer = kafka.producer();

let kafkaReady = false;
let shuttingDown = false;

const sendWithRetry = async (event, topic) => {
  for (let attempt = 1; attempt <= config.retry.maxRetries; attempt += 1) {
    try {
      await producer.send({
        topic,
        messages: [
          {
            key: event.orderId,
            value: JSON.stringify(event),
          },
        ],
      });
      return true;
    } catch (err) {
      logger.warn(
        {
          orderId: event.orderId,
          eventType: event.type,
          topic,
          attempt,
          error: err.message,
        },
        "kafka publish failed"
      );
      await sleep(config.retry.baseDelayMs * attempt);
    }
  }

  return false;
};

const publishDlq = async (event, reason) => {
  const dlqEvent = {
    ...event,
    failureReason: reason,
    failedAt: new Date().toISOString(),
    retryCount: event.retryCount || 0,
  };

  await producer.send({
    topic: config.kafka.dlqTopic,
    messages: [
      {
        key: event.orderId,
        value: JSON.stringify(dlqEvent),
      },
    ],
  });
};

const pollOutbox = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, event_type, payload, retry_count
      FROM outbox
      WHERE processed = FALSE
      ORDER BY id
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [config.workers.outboxBatchSize]
    );

    for (const row of result.rows) {
      const event =
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      const topic = eventTopic(row.event_type || event.type);

      if (!topic) {
        await client.query(
          "UPDATE outbox SET processed = TRUE, last_error = $2, updated_at = NOW() WHERE id = $1",
          [row.id, `Unknown event type: ${row.event_type || event.type}`]
        );
        metrics.inc("outbox_unknown_event_total");
        logger.warn({ eventType: row.event_type || event.type }, "unknown outbox event");
        continue;
      }

      logger.info(
        { outboxId: row.id, orderId: event.orderId, eventType: event.type, topic },
        "publishing outbox event"
      );

      const success = await sendWithRetry(event, topic);

      if (success) {
        await client.query(
          "UPDATE outbox SET processed = TRUE, updated_at = NOW() WHERE id = $1",
          [row.id]
        );
        metrics.inc("outbox_published_total", { topic });
        continue;
      }

      try {
        await publishDlq(
          event,
          `Failed to publish ${event.type} to ${topic} after ${config.retry.maxRetries} attempts`
        );
        await client.query(
          "UPDATE outbox SET processed = TRUE, retry_count = retry_count + 1, last_error = $2, updated_at = NOW() WHERE id = $1",
          [row.id, "sent to dlq"]
        );
        metrics.inc("outbox_dlq_total", { event_type: event.type });
        logger.error({ outboxId: row.id, orderId: event.orderId }, "outbox event sent to dlq");
      } catch (err) {
        await client.query(
          "UPDATE outbox SET retry_count = retry_count + 1, last_error = $2, updated_at = NOW() WHERE id = $1",
          [row.id, err.message]
        );
        metrics.inc("outbox_retry_scheduled_total");
        logger.error(err, "failed to publish outbox event and dlq write failed");
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const startWorker = async () => {
  while (!shuttingDown) {
    try {
      logger.info("connecting outbox producer");
      await producer.connect();
      kafkaReady = true;
      logger.info("outbox producer ready");

      while (!shuttingDown) {
        await pollOutbox();
        await sleep(config.workers.outboxPollMs);
      }
    } catch (err) {
      kafkaReady = false;
      logger.error(err, "outbox worker crashed; reconnecting");
      await producer.disconnect().catch(() => {});
      await sleep(5000);
    }
  }
};

startHealthServer({
  checks: {
    db: checkDb,
    kafka: async () => {
      if (!kafkaReady) throw new Error("producer not ready");
    },
  },
});

const shutdown = async () => {
  shuttingDown = true;
  logger.info("shutting down outbox worker");
  await producer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startWorker();
