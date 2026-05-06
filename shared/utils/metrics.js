const startedAt = Date.now();
const counters = new Map();

const inc = (name, labels = {}) => {
  const key = `${name}:${JSON.stringify(labels)}`;
  const current = counters.get(key) || { name, labels, value: 0 };
  current.value += 1;
  counters.set(key, current);
};

const labelString = (labels) => {
  const keys = Object.keys(labels);
  if (keys.length === 0) return "";

  return `{${keys
    .map((key) => `${key}="${String(labels[key]).replace(/"/g, '\\"')}"`)
    .join(",")}}`;
};

const render = () => {
  const lines = [
    "# HELP process_uptime_seconds Process uptime in seconds.",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
  ];

  for (const counter of counters.values()) {
    lines.push(`# TYPE ${counter.name} counter`);
    lines.push(`${counter.name}${labelString(counter.labels)} ${counter.value}`);
  }

  return `${lines.join("\n")}\n`;
};

module.exports = { inc, render };
