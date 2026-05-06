const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const totalOrders = Number(process.env.TOTAL_ORDERS || 50);
const concurrency = Number(process.env.CONCURRENCY || 10);
const products = (process.env.PRODUCTS || "p1,p2,p3").split(",");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createOrder = async (index) => {
  const productId = products[index % products.length];
  const response = await fetch(`${baseUrl}/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, quantity: 1 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Create order failed (${response.status}): ${body}`);
  }

  return response.json();
};

const waitForTerminalStatus = async (orderId) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/order/${orderId}`);
    const order = await response.json();

    if (order.status === "CONFIRMED" || order.status === "FAILED") {
      return order.status;
    }

    await sleep(1000);
  }

  return "TIMEOUT";
};

const runPool = async (items, worker) => {
  const results = [];
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
};

const main = async () => {
  const startedAt = Date.now();
  const indexes = Array.from({ length: totalOrders }, (_, index) => index);

  console.log(
    JSON.stringify({
      event: "load_test_started",
      baseUrl,
      totalOrders,
      concurrency,
    })
  );

  const created = await runPool(indexes, createOrder);
  const statuses = await runPool(
    created.map((order) => order.orderId),
    waitForTerminalStatus
  );

  const durationSeconds = (Date.now() - startedAt) / 1000;
  const summary = statuses.reduce(
    (acc, status) => {
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    },
    {
      CONFIRMED: 0,
      FAILED: 0,
      TIMEOUT: 0,
    }
  );

  console.log(
    JSON.stringify(
      {
        event: "load_test_finished",
        totalOrders,
        concurrency,
        durationSeconds: Number(durationSeconds.toFixed(2)),
        throughputOrdersPerSecond: Number((totalOrders / durationSeconds).toFixed(2)),
        summary,
      },
      null,
      2
    )
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
