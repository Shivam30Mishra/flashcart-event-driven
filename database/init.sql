CREATE TABLE IF NOT EXISTS inventory (
  product_id VARCHAR PRIMARY KEY,
  stock INT NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR PRIMARY KEY,
  product_id VARCHAR NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  status VARCHAR NOT NULL CHECK (status IN ('RESERVED', 'CONFIRMED', 'FAILED')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id VARCHAR NOT NULL UNIQUE,
  status VARCHAR NOT NULL CHECK (status IN ('PROCESSING', 'SUCCESS', 'FAILED')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS outbox (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR NOT NULL,
  payload JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON orders(status, created_at);

CREATE INDEX IF NOT EXISTS idx_outbox_processed_id
  ON outbox(processed, id);

INSERT INTO inventory(product_id, stock)
VALUES ('p1', 100), ('p2', 50), ('p3', 25)
ON CONFLICT (product_id) DO NOTHING;
