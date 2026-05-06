const express = require("express");
const { v4: uuidv4 } = require("uuid");
const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");
const metrics = require("../../shared/utils/metrics");
const sleep = require("../../shared/utils/sleep");
const { pool, checkDb } = require("../../shared/utils/db");
const { createKafka } = require("../../shared/utils/kafka");
const { renderDemoPage } = require("./demoPage");

const app = express();
app.use(express.json());

const kafka = createKafka("order-service");
const producer = kafka.producer();
let kafkaReady = false;

const internalHost = config.db.host === "postgres";
const serviceHealthTargets = [
  ["Order Service", `http://localhost:${config.port}/health`],
  ["Inventory Service", internalHost ? "http://inventory-service:4000/health" : "http://localhost:4000/health"],
  ["Payment Service", internalHost ? "http://payment-service:4001/health" : "http://localhost:4001/health"],
  ["Outbox Worker", internalHost ? "http://outbox-worker:4002/health" : "http://localhost:4002/health"],
  ["DLQ Replay Worker", internalHost ? "http://dlq-replay-worker:4003/health" : "http://localhost:4003/health"],
  ["Timeout Worker", internalHost ? "http://order-timeout-worker:4004/health" : "http://localhost:4004/health"],
];

const initKafka = async () => {
  while (!kafkaReady) {
    try {
      logger.info("connecting kafka producer");
      await producer.connect();
      kafkaReady = true;
      logger.info("kafka producer ready");
    } catch (err) {
      logger.error(err, "kafka connection failed; retrying");
      await sleep(3000);
    }
  }
};

const sendWithRetry = async (payload) => {
  for (let attempt = 1; attempt <= config.retry.maxRetries; attempt += 1) {
    try {
      await producer.send({
        topic: config.kafka.orderTopic,
        messages: [
          {
            key: payload.orderId,
            value: JSON.stringify(payload),
          },
        ],
      });
      return true;
    } catch (err) {
      logger.warn(
        { err: { message: err.message }, attempt, orderId: payload.orderId },
        "kafka send failed"
      );
      await sleep(config.retry.baseDelayMs);
    }
  }

  return false;
};

app.get("/", (req, res) => {
  res.type("html").send(renderDemoPage());
});

app.get("/health", async (req, res) => {
  try {
    await checkDb();
    res.json({
      status: kafkaReady ? "ok" : "degraded",
      service: "order-service",
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

app.get("/api/stats", async (req, res) => {
  try {
    const [counts, recentOrders, inventory, payments] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS orders,
          COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
          COUNT(*) FILTER (WHERE status = 'RESERVED')::int AS reserved,
          (SELECT COUNT(*)::int FROM outbox WHERE processed = FALSE) AS outbox_pending
        FROM orders
      `),
      pool.query(`
        SELECT id, product_id, quantity, status, created_at, updated_at
        FROM orders
        ORDER BY created_at DESC
        LIMIT 10
      `),
      pool.query("SELECT product_id, stock FROM inventory ORDER BY product_id"),
      pool.query(`
        SELECT status, COUNT(*)::int AS count
        FROM payments
        GROUP BY status
        ORDER BY status
      `),
    ]);

    const row = counts.rows[0] || {};
    res.json({
      counts: {
        orders: row.orders || 0,
        confirmed: row.confirmed || 0,
        failed: row.failed || 0,
        reserved: row.reserved || 0,
        outboxPending: row.outbox_pending || 0,
      },
      recentOrders: recentOrders.rows,
      inventory: inventory.rows,
      payments: payments.rows,
    });
  } catch (err) {
    logger.error(err, "stats lookup failed");
    res.status(500).json({ message: "Stats unavailable" });
  }
});

app.get("/api/health/services", async (req, res) => {
  const results = await Promise.all(
    serviceHealthTargets.map(async ([name, url]) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        const body = await response.json();
        return {
          name,
          status: response.ok ? body.status : "degraded",
          details: body.details || body,
        };
      } catch (err) {
        return { name, status: "degraded", details: { error: err.message } };
      }
    })
  );

  res.json({ services: results });
});

app.post("/order", async (req, res) => {
  const { productId, quantity } = req.body;
  const requestId = req.get("x-request-id") || uuidv4();

  if (!productId || typeof quantity !== "number" || quantity <= 0) {
    return res.status(400).json({ message: "Invalid input" });
  }

  if (!kafkaReady) {
    return res.status(503).json({ message: "Service not ready" });
  }

  const orderId = uuidv4();

  const event = {
    type: "ORDER_CREATED",
    orderId,
    productId,
    quantity,
    requestId,
    createdAt: new Date().toISOString(),
  };

  const success = await sendWithRetry(event);

  if (!success) {
    metrics.inc("orders_rejected_total", { reason: "kafka_unavailable" });
    return res.status(500).json({
      message: "Kafka unavailable, try again",
    });
  }

  metrics.inc("orders_created_total");
  logger.info({ orderId, productId, quantity, requestId }, "order event accepted");

  res.json({
    message: "Order received",
    orderId,
    requestId,
  });
});

app.get("/order/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders WHERE id = $1",
      [req.params.id]
    );

    res.json(result.rows[0] || { message: "Not found" });

  } catch (err) {
    logger.error(err, "order lookup failed");
    res.status(500).json({ message: "DB error" });
  }
});

const server = app.listen(config.port, async () => {
  logger.info({ port: config.port }, "order service listening");
  await initKafka();
});

const shutdown = async () => {
  logger.info("shutting down order service");
  server.close();
  await producer.disconnect().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
