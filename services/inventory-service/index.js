const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");
const metrics = require("../../shared/utils/metrics");
const sleep = require("../../shared/utils/sleep");
const { pool, checkDb } = require("../../shared/utils/db");
const { createKafka } = require("../../shared/utils/kafka");
const { startHealthServer } = require("../../shared/utils/health");

const kafka = createKafka("inventory-service");
const consumer = kafka.consumer({ groupId: "inventory-group" });

let kafkaReady = false;
let shuttingDown = false;

const parseMessage = (message) => {
  try {
    return JSON.parse(message.value.toString());
  } catch (err) {
    metrics.inc("events_invalid_total", { service: "inventory-service" });
    logger.warn("invalid kafka json skipped");
    return null;
  }
};

const appendOutboxEvent = (client, event) =>
  client.query("INSERT INTO outbox(event_type, payload) VALUES($1,$2)", [
    event.type,
    JSON.stringify(event),
  ]);

const reserveInventory = async (event) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT status FROM orders WHERE id = $1 FOR UPDATE",
      [event.orderId]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      metrics.inc("events_duplicate_total", { type: event.type });
      logger.info({ orderId: event.orderId }, "duplicate order event ignored");
      return;
    }

    const inventory = await client.query(
      "SELECT stock FROM inventory WHERE product_id = $1 FOR UPDATE",
      [event.productId]
    );

    if (inventory.rows.length === 0) {
      throw new Error("Product not found");
    }

    if (inventory.rows[0].stock < event.quantity) {
      throw new Error("Out of stock");
    }

    await client.query(
      "UPDATE inventory SET stock = stock - $1 WHERE product_id = $2",
      [event.quantity, event.productId]
    );

    await client.query(
      "INSERT INTO orders(id, product_id, quantity, status) VALUES($1,$2,$3,$4)",
      [event.orderId, event.productId, event.quantity, "RESERVED"]
    );

    await appendOutboxEvent(client, {
      type: "INVENTORY_RESERVED",
      orderId: event.orderId,
      productId: event.productId,
      quantity: event.quantity,
      requestId: event.requestId,
      createdAt: new Date().toISOString(),
    });

    await client.query("COMMIT");
    metrics.inc("inventory_reserved_total");
    logger.info({ orderId: event.orderId }, "inventory reserved");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});

    await client.query("BEGIN");
    await client.query(
      "INSERT INTO orders(id, product_id, quantity, status) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
      [event.orderId, event.productId, event.quantity, "FAILED"]
    );
    await appendOutboxEvent(client, {
      type: "ORDER_FAILED",
      orderId: event.orderId,
      productId: event.productId,
      quantity: event.quantity,
      requestId: event.requestId,
      reason: err.message,
      createdAt: new Date().toISOString(),
    });
    await client.query("COMMIT");

    metrics.inc("inventory_reservation_failed_total", { reason: err.message });
    logger.warn(
      { orderId: event.orderId, reason: err.message },
      "inventory reservation failed"
    );
  } finally {
    client.release();
  }
};

const confirmOrder = async (event) => {
  const result = await pool.query(
    "UPDATE orders SET status='CONFIRMED', updated_at=NOW() WHERE id=$1 AND status='RESERVED'",
    [event.orderId]
  );

  if (result.rowCount === 0) {
    metrics.inc("payment_result_ignored_total", { type: event.type });
    logger.info({ orderId: event.orderId }, "payment success ignored");
    return;
  }

  metrics.inc("orders_confirmed_total");
  logger.info({ orderId: event.orderId }, "order confirmed");
};

const failOrderAndRestoreStock = async (event) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "UPDATE orders SET status='FAILED', updated_at=NOW() WHERE id=$1 AND status='RESERVED'",
      [event.orderId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      metrics.inc("payment_result_ignored_total", { type: event.type });
      logger.info({ orderId: event.orderId }, "payment failure ignored");
      return;
    }

    await client.query(
      "UPDATE inventory SET stock = stock + $1 WHERE product_id = $2",
      [event.quantity, event.productId]
    );

    await client.query("COMMIT");
    metrics.inc("orders_failed_total", { reason: "payment_failed" });
    logger.info({ orderId: event.orderId }, "order failed and stock restored");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

const handleEvent = async (event) => {
  switch (event.type) {
    case "ORDER_CREATED":
      await reserveInventory(event);
      break;
    case "PAYMENT_SUCCESS":
      await confirmOrder(event);
      break;
    case "PAYMENT_FAILED":
      await failOrderAndRestoreStock(event);
      break;
    default:
      logger.debug({ eventType: event.type }, "event ignored");
  }
};

const startConsumer = async () => {
  while (!shuttingDown) {
    try {
      logger.info("connecting inventory consumer");
      await consumer.connect();
      await consumer.subscribe({ topic: config.kafka.orderTopic, fromBeginning: true });
      kafkaReady = true;
      logger.info("inventory consumer ready");

      await consumer.run({
        eachMessage: async ({ message }) => {
          const event = parseMessage(message);
          if (!event) return;

          metrics.inc("events_consumed_total", { type: event.type });
          await handleEvent(event);
        },
      });

      while (!shuttingDown) {
        await sleep(60000);
      }
    } catch (err) {
      kafkaReady = false;
      logger.error(err, "inventory consumer crashed; reconnecting");
      await consumer.disconnect().catch(() => {});
      await sleep(5000);
    }
  }
};

startHealthServer({
  checks: {
    db: checkDb,
    kafka: async () => {
      if (!kafkaReady) throw new Error("consumer not ready");
    },
  },
});

const shutdown = async () => {
  shuttingDown = true;
  logger.info("shutting down inventory service");
  await consumer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startConsumer();
