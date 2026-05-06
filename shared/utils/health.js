const http = require("http");
const config = require("./config");
const logger = require("./logger");
const metrics = require("./metrics");

const startHealthServer = ({ port = config.healthPort, checks = {} } = {}) => {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(metrics.render());
      return;
    }

    if (req.url !== "/health") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not found" }));
      return;
    }

    const details = {};
    let ok = true;

    for (const [name, check] of Object.entries(checks)) {
      try {
        await check();
        details[name] = "ok";
      } catch (err) {
        ok = false;
        details[name] = err.message;
      }
    }

    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: ok ? "ok" : "degraded",
        service: config.serviceName,
        details,
      })
    );
  });

  server.listen(port, () => {
    logger.info({ port }, "health server listening");
  });

  server.on("error", (err) => {
    logger.error(
      { port, code: err.code, error: err.message },
      "health server failed to bind"
    );
    process.exit(1);
  });

  return server;
};

module.exports = { startHealthServer };
