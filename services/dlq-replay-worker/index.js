const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");
const metrics = require("../../shared/utils/metrics");
const sleep = require("../../shared/utils/sleep");
const { createKafka, eventTopic } = require("../../shared/utils/kafka");
const { startHealthServer } = require("../../shared/utils/health");

const kafka = createKafka("dlq-replay-worker");
const consumer = kafka.consumer({ groupId: "dlq-replay-group" });
const producer = kafka.producer();

let kafkaReady = false;
let shuttingDown = false;

const parseMessage = (message) => {
  try {
    return JSON.parse(message.value.toString());
  } catch (err) {
    metrics.inc("events_invalid_total", { service: "dlq-replay-worker" });
    logger.warn("invalid dlq message skipped");
    return null;
  }
};

const replayEvent = async (event) => {
  const retryCount = (event.retryCount || 0) + 1;

  if (retryCount > config.retry.maxRetries) {
    metrics.inc("dlq_permanent_failure_total", { type: event.type || "unknown" });
    logger.error(
      { orderId: event.orderId, eventType: event.type, retryCount },
      "event permanently failed in dlq"
    );
    return;
  }

  const topic = eventTopic(event.type);

  if (!topic) {
    metrics.inc("dlq_unknown_event_total");
    logger.warn({ eventType: event.type }, "unknown dlq event type skipped");
    return;
  }

  const delay = config.retry.baseDelayMs * Math.pow(2, retryCount);
  logger.info(
    { orderId: event.orderId, eventType: event.type, retryCount, delay, topic },
    "waiting before dlq replay"
  );
  await sleep(delay);

  try {
    await producer.send({
      topic,
      messages: [
        {
          key: event.orderId,
          value: JSON.stringify({ ...event, retryCount }),
        },
      ],
    });

    metrics.inc("dlq_replayed_total", { topic });
    logger.info({ orderId: event.orderId, topic }, "dlq event replayed");
  } catch (err) {
    await producer.send({
      topic: config.kafka.dlqTopic,
      messages: [
        {
          key: event.orderId,
          value: JSON.stringify({ ...event, retryCount, lastReplayError: err.message }),
        },
      ],
    });

    metrics.inc("dlq_requeued_total", { type: event.type || "unknown" });
    logger.warn({ orderId: event.orderId, error: err.message }, "dlq replay failed and was requeued");
  }
};

const startWorker = async () => {
  while (!shuttingDown) {
    try {
      logger.info("connecting dlq replay worker");
      await consumer.connect();
      await producer.connect();
      await consumer.subscribe({ topic: config.kafka.dlqTopic, fromBeginning: true });

      kafkaReady = true;
      logger.info("dlq replay worker ready");

      await consumer.run({
        eachMessage: async ({ message }) => {
          const event = parseMessage(message);
          if (!event) return;
          await replayEvent(event);
        },
      });

      while (!shuttingDown) {
        await sleep(60000);
      }
    } catch (err) {
      kafkaReady = false;
      logger.error(err, "dlq replay worker crashed; reconnecting");
      await consumer.disconnect().catch(() => {});
      await producer.disconnect().catch(() => {});
      await sleep(5000);
    }
  }
};

startHealthServer({
  checks: {
    kafka: async () => {
      if (!kafkaReady) throw new Error("consumer not ready");
    },
  },
});

const shutdown = async () => {
  shuttingDown = true;
  logger.info("shutting down dlq replay worker");
  await consumer.disconnect().catch(() => {});
  await producer.disconnect().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startWorker();
