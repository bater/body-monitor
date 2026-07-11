-- Public waiting list: strangers submit their email from the /welcome landing
-- page (Access-bypassed). Admins review and send invites from #/admin.

CREATE TABLE waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'pending', -- pending | invited
  invited_at TEXT,
  invite_id INTEGER REFERENCES invites(id)
);
