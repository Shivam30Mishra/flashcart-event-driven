const express = require("express");
const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");
const metrics = require("../../shared/utils/metrics");
const sleep = require("../../shared/utils/sleep");
const { pool, checkDb } = require("../../shared/utils/db");
const { createKafka } = require("../../shared/utils/kafka");

const app = express();
const kafka = createKafka("payment-service");
const consumer = kafka.consumer({ groupId: "payment-group" });

let kafkaReady = false;
let shuttingDown = false;

app.get("/health", async (req, res) => {
  try {
    await checkDb();
    res.status(kafkaReady ? 200 : 503).json({
      status: kafkaReady ? "ok" : "degraded",
      service: "payment-service",
      kafka: kafkaReady ? "ok" : "connecting",
      db: "ok",
    });
  } catch (err) {
    res.status(503).json({ status: "degraded", db: err.message });
  }
});

app.get("/metrics", (req, res) => {
  res.type("text/plain").send(metrics.render());
});

const parseMessage = (message) => {
  try {
    return JSON.parse(message.value.toString());
  } catch (err) {
    metrics.inc("events_invalid_total", { service: "payment-service" });
    logger.warn("invalid kafka json skipped");
    return null;
  }
};

const simulatePayment = () => Math.random() > 0.3;

const processPayment = async (event) => {
  if (event.type !== "INVENTORY_RESERVED") return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    try {
      await client.query(
        "INSERT INTO payments(order_id, status) VALUES($1,$2)",
        [event.orderId, "PROCESSING"]
      );
    } catch (err) {
      if (err.code === "23505") {
        await client.query("ROLLBACK");
        metrics.inc("events_duplicate_total", { type: event.type });
        logger.info({ orderId: event.orderId }, "duplicate payment ignored");
        return;
      }

      throw err;
    }

    const success = simulatePayment();
    const finalStatus = success ? "SUCCESS" : "FAILED";
    const resultEvent = {
      type: success ? "PAYMENT_SUCCESS" : "PAYMENT_FAILED",
      orderId: event.orderId,
      productId: event.productId,
      quantity: event.quantity,
      requestId: event.requestId,
      createdAt: new Date().toISOString(),
    };

    await client.query("UPDATE payments SET status=$1 WHERE order_id=$2", [
      finalStatus,
      event.orderId,
    ]);

    await client.query("INSERT INTO outbox(event_type, payload) VALUES($1,$2)", [
      resultEvent.type,
      JSON.stringify(resultEvent),
    ]);

    await client.query("COMMIT");

    metrics.inc("payments_processed_total", { status: finalStatus });
    logger.info(
      { orderId: event.orderId, status: finalStatus },
      "payment processed"
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const startService = async () => {
  while (!shuttingDown) {
    try {
      logger.info("connecting payment consumer");
      await consumer.connect();
      await consumer.subscribe({
        topic: config.kafka.paymentTopic,
        fromBeginning: true,
      });

      kafkaReady = true;
      logger.info("payment consumer ready");

      await consumer.run({
        eachMessage: async ({ message }) => {
          const event = parseMessage(message);
          if (!event) return;

          metrics.inc("events_consumed_total", { type: event.type });
          await processPayment(event);
        },
      });

      while (!shuttingDown) {
        await sleep(60000);
      }
    } catch (err) {
      kafkaReady = false;
      logger.error(err, "payment consumer crashed; reconnecting");
      await consumer.disconnect().catch(() => {});
      await sleep(5000);
    }
  }
};

const server = app.listen(config.healthPort, () => {
  logger.info({ port: config.healthPort }, "payment health server listening");
});

const shutdown = async () => {
  shuttingDown = true;
  logger.info("shutting down payment service");
  server.close();
  await consumer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startService();
