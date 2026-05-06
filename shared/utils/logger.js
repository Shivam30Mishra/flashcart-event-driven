const config = require("./config");

const levels = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const activeLevel = levels[config.logLevel] || levels.info;

const serializeError = (err) => ({
  message: err.message,
  name: err.name,
  stack: config.env === "production" ? undefined : err.stack,
  code: err.code,
});

const write = (level, payload, message) => {
  if (levels[level] < activeLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: config.serviceName,
  };

  if (payload instanceof Error) {
    entry.err = serializeError(payload);
  } else if (payload && typeof payload === "object") {
    Object.assign(entry, payload);
  } else if (typeof payload === "string") {
    message = payload;
  }

  if (message) entry.message = message;
  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

module.exports = {
  trace: (payload, message) => write("trace", payload, message),
  debug: (payload, message) => write("debug", payload, message),
  info: (payload, message) => write("info", payload, message),
  warn: (payload, message) => write("warn", payload, message),
  error: (payload, message) => write("error", payload, message),
  fatal: (payload, message) => write("fatal", payload, message),
};
