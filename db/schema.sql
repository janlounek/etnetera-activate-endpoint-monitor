CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  slack_webhook_url TEXT,
  username TEXT,
  password_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  parent_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  site_type TEXT DEFAULT 'public',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  checker_type TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS check_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'error')),
  details TEXT DEFAULT '{}',
  checked_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_check_results_site_id ON check_results(site_id);
CREATE INDEX IF NOT EXISTS idx_check_results_checked_at ON check_results(checked_at);
CREATE INDEX IF NOT EXISTS idx_site_checks_site_id ON site_checks(site_id);
