CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS academies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, academy_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS student_records (
  id TEXT PRIMARY KEY,
  academy_id TEXT NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT '',
  order_number TEXT NOT NULL DEFAULT '',
  advisor TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL,
  document_number TEXT NOT NULL DEFAULT '',
  procedure TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  payment_crc_status TEXT NOT NULL DEFAULT '',
  qpl_status TEXT NOT NULL DEFAULT '',
  sheet_cost REAL,
  qpl_cost REAL,
  amount_due REAL,
  medical_exam_cost REAL,
  observations TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS student_records_academy_date
  ON student_records(academy_id, date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS memberships_academy ON memberships(academy_id);
CREATE INDEX IF NOT EXISTS login_attempts_window ON login_attempts(window_start);
