const renderDemoPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flashcart Distributed Backend Demo</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7f9;
      --panel: #ffffff;
      --ink: #1c2430;
      --muted: #667085;
      --line: #d9e0e7;
      --accent: #0f766e;
      --accent-dark: #0b5f59;
      --warn: #b45309;
      --bad: #b42318;
      --good: #047857;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }

    header {
      padding: 28px 24px 16px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }

    .wrap {
      max-width: 1180px;
      margin: 0 auto;
    }

    h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.15;
      letter-spacing: 0;
    }

    h2 {
      margin: 0 0 14px;
      font-size: 18px;
      letter-spacing: 0;
    }

    p {
      color: var(--muted);
      line-height: 1.55;
    }

    .sub {
      max-width: 850px;
      margin: 10px 0 0;
    }

    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 22px 24px 36px;
    }

    .grid {
      display: grid;
      grid-template-columns: 360px 1fr;
      gap: 18px;
      align-items: start;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }

    .stat {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-height: 88px;
    }

    .label {
      display: block;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .06em;
      margin-bottom: 8px;
    }

    .value {
      font-size: 28px;
      font-weight: 700;
    }

    label {
      display: block;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 6px;
    }

    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      font-size: 15px;
      color: var(--ink);
      background: #fff;
      margin-bottom: 14px;
    }

    button {
      width: 100%;
      border: 0;
      border-radius: 6px;
      padding: 11px 14px;
      background: var(--accent);
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }

    button:hover { background: var(--accent-dark); }
    button:disabled { opacity: .55; cursor: progress; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .05em;
    }

    .status {
      display: inline-block;
      min-width: 92px;
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 12px;
      font-weight: 700;
      text-align: center;
      background: #eef4ff;
      color: #3538cd;
    }

    .CONFIRMED, .ok { background: #ecfdf3; color: var(--good); }
    .FAILED, .degraded { background: #fef3f2; color: var(--bad); }
    .RESERVED { background: #fffaeb; color: var(--warn); }

    .flow {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .step {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfd;
      min-height: 94px;
    }

    .step strong {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
    }

    .step span {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
      display: block;
    }

    .health {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .service {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfd;
    }

    .mono {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }

    .notice {
      margin-top: 14px;
      padding: 12px;
      border-radius: 8px;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 14px;
    }

    @media (max-width: 920px) {
      .grid, .stats, .flow, .health {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>Flashcart Distributed Checkout Backend</h1>
      <p class="sub">A recruiter-friendly live demo for a Node.js, Kafka, and PostgreSQL event-driven backend using Saga orchestration, transactional outbox, idempotent consumers, retry, DLQ replay, compensation, health checks, metrics, and Dockerized deployment.</p>
    </div>
  </header>

  <main>
    <section class="stats">
      <div class="stat"><span class="label">Orders</span><span id="ordersCount" class="value">-</span></div>
      <div class="stat"><span class="label">Confirmed</span><span id="confirmedCount" class="value">-</span></div>
      <div class="stat"><span class="label">Failed</span><span id="failedCount" class="value">-</span></div>
      <div class="stat"><span class="label">Outbox Pending</span><span id="outboxCount" class="value">-</span></div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Create Order</h2>
        <form id="orderForm">
          <label for="productId">Product</label>
          <select id="productId" name="productId">
            <option value="p1">p1</option>
            <option value="p2">p2</option>
            <option value="p3">p3</option>
          </select>
          <label for="quantity">Quantity</label>
          <input id="quantity" name="quantity" type="number" min="1" value="1" />
          <button id="submitBtn" type="submit">Create Order</button>
        </form>
        <div id="createdOrder" class="notice" hidden></div>
      </div>

      <div class="panel">
        <h2>Recent Orders</h2>
        <table>
          <thead>
            <tr><th>Order ID</th><th>Product</th><th>Qty</th><th>Status</th></tr>
          </thead>
          <tbody id="ordersBody"></tbody>
        </table>
      </div>
    </section>

    <section class="panel" style="margin-top:18px">
      <h2>Event Flow</h2>
      <div class="flow">
        <div class="step"><strong>Order Service</strong><span>Accepts HTTP requests and emits ORDER_CREATED to Kafka.</span></div>
        <div class="step"><strong>Inventory Service</strong><span>Consumes ORDER_CREATED, locks stock, reserves inventory, writes outbox event.</span></div>
        <div class="step"><strong>Outbox Worker</strong><span>Publishes durable outbox rows to Kafka with retry and DLQ fallback.</span></div>
        <div class="step"><strong>Payment Service</strong><span>Consumes INVENTORY_RESERVED, stores payment once, writes payment result to outbox.</span></div>
        <div class="step"><strong>Compensation</strong><span>Payment failures mark orders FAILED and restore stock in a DB transaction.</span></div>
        <div class="step"><strong>DLQ Replay</strong><span>Retries failed events with retryCount and routes them back to the correct topic.</span></div>
      </div>
    </section>

    <section class="panel" style="margin-top:18px">
      <h2>Service Health</h2>
      <div id="healthGrid" class="health"></div>
    </section>
  </main>

  <script>
    const fmt = (value) => value == null ? "-" : String(value);

    async function loadStats() {
      const res = await fetch("/api/stats");
      const data = await res.json();
      ordersCount.textContent = fmt(data.counts.orders);
      confirmedCount.textContent = fmt(data.counts.confirmed);
      failedCount.textContent = fmt(data.counts.failed);
      outboxCount.textContent = fmt(data.counts.outboxPending);

      ordersBody.innerHTML = data.recentOrders.map(order => (
        "<tr>" +
        "<td class='mono'>" + order.id + "</td>" +
        "<td>" + order.product_id + "</td>" +
        "<td>" + order.quantity + "</td>" +
        "<td><span class='status " + order.status + "'>" + order.status + "</span></td>" +
        "</tr>"
      )).join("");
    }

    async function loadHealth() {
      const res = await fetch("/api/health/services");
      const data = await res.json();
      const results = data.services;

      healthGrid.innerHTML = results.map(item => (
        "<div class='service'>" +
        "<span class='label'>" + item.name + "</span>" +
        "<span class='status " + item.status + "'>" + item.status + "</span>" +
        "</div>"
      )).join("");
    }

    orderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitBtn.disabled = true;
      try {
        const res = await fetch("/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: productId.value,
            quantity: Number(quantity.value)
          })
        });
        const body = await res.json();
        createdOrder.hidden = false;
        createdOrder.textContent = body.orderId ? "Created order " + body.orderId : body.message;
        setTimeout(loadStats, 6500);
      } finally {
        submitBtn.disabled = false;
      }
    });

    loadStats();
    loadHealth();
    setInterval(loadStats, 5000);
    setInterval(loadHealth, 7000);
  </script>
</body>
</html>`;

module.exports = { renderDemoPage };
