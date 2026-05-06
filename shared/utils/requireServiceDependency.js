const path = require("path");
const { createRequire } = require("module");

module.exports = (name) => {
  try {
    return require(name);
  } catch (err) {
    if (err.code !== "MODULE_NOT_FOUND") throw err;
  }

  const serviceRequire = createRequire(path.join(process.cwd(), "package.json"));
  return serviceRequire(name);
};
