const { Pool } = require("./requireServiceDependency")("pg");
const config = require("./config");

const pool = new Pool(config.db);

const checkDb = async () => {
  await pool.query("SELECT 1");
};

module.exports = { pool, checkDb };
