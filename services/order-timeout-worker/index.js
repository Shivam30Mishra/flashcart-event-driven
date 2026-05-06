const config = require("../../shared/utils/config");
const logger = require("../../shared/utils/logger");
const metrics = require("../../shared/utils/metrics");
const { pool, checkDb } = require("../../shared/utils/db");
const { startHealthServer } = require("../../shared/utils/health");

let interval;

const timeoutOrders = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, product_id, quantity
      FROM orders
      WHERE status = 'RESERVED'
      AND NOW() - created_at > ($1::text || ' seconds')::interval
      FOR UPDATE SKIP LOCKED
      `,
      [config.workers.timeoutSeconds]
    );

    for (const order of result.rows) {
      await client.query(
        "UPDATE orders SET status='FAILED', updated_at=NOW() WHERE id=$1",
        [order.id]
      );

      await client.query(
        "UPDATE inventory SET stock = stock + $1 WHERE product_id=$2",
        [order.quantity, order.product_id]
      );

      metrics.inc("orders_failed_total", { reason: "timeout" });
      logger.info({ orderId: order.id }, "reserved order timed out and stock restored");
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error(err, "timeout worker transaction failed");
  } finally {
    client.release();
  }
};

startHealthServer({ checks: { db: checkDb } });

logger.info(
  {
    timeoutSeconds: config.workers.timeoutSeconds,
    pollMs: config.workers.timeoutPollMs,
  },
  "order timeout worker started"
);

interval = setInterval(timeoutOrders, config.workers.timeoutPollMs);
timeoutOrders();

const shutdown = async () => {
  logger.info("shutting down order timeout worker");
  clearInterval(interval);
  await pool.end().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
