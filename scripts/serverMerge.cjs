const Database = require("better-sqlite3");
const fs = require("node:fs");

const liveDbPath = "./data/bot.db";
const oldDbPath = "./backups/old-downloads-bot.db";

if (!fs.existsSync(liveDbPath)) {
  console.error("Live DB not found:", liveDbPath);
  process.exit(1);
}
if (!fs.existsSync(oldDbPath)) {
  console.error("Old DB not found:", oldDbPath);
  process.exit(1);
}

const db = new Database(liveDbPath);
db.pragma("busy_timeout = 10000");

const preUsers = db.prepare("SELECT count(*) as c FROM users").get().c;
const preDownloads = db.prepare("SELECT count(*) as c FROM downloads").get().c;
console.log("Pre-merge users:", preUsers);
console.log("Pre-merge downloads:", preDownloads);

db.prepare("ATTACH DATABASE './backups/old-downloads-bot.db' AS old_db").run();

const runMerge = db.transaction(() => {
  // 1. Insert users only in old
  const insertOldUsersSql = `
    INSERT INTO users (telegram_id, username, first_seen, is_banned, is_blocked, language, lang_set, last_active)
    SELECT
      o.telegram_id,
      o.username,
      o.first_seen,
      o.is_banned,
      COALESCE(o.is_blocked, 0),
      COALESCE(o.language, 'fa'),
      COALESCE(o.lang_set, 1),
      o.last_active
    FROM old_db.users o
    WHERE NOT EXISTS (
      SELECT 1 FROM main.users m WHERE m.telegram_id = o.telegram_id
    )
  `;
  const resUsers = db.prepare(insertOldUsersSql).run();
  console.log("-> Inserted users from old:", resUsers.changes);

  // 2. Update overlapping users
  const updateOverlapSql = `
    UPDATE users
    SET
      first_seen = MIN(users.first_seen, (SELECT o.first_seen FROM old_db.users o WHERE o.telegram_id = users.telegram_id)),
      last_active = MAX(users.last_active, (SELECT o.last_active FROM old_db.users o WHERE o.telegram_id = users.telegram_id)),
      is_banned = CASE
        WHEN users.is_banned = 1 THEN 1
        WHEN (SELECT o.is_banned FROM old_db.users o WHERE o.telegram_id = users.telegram_id) = 1 THEN 1
        ELSE 0
      END,
      language = CASE
        WHEN users.language IS NOT NULL AND users.language != '' THEN users.language
        WHEN (SELECT o.language FROM old_db.users o WHERE o.telegram_id = users.telegram_id) IS NOT NULL THEN (SELECT o.language FROM old_db.users o WHERE o.telegram_id = users.telegram_id)
        ELSE 'fa'
      END,
      lang_set = CASE
        WHEN users.lang_set = 1 THEN 1
        WHEN (SELECT o.lang_set FROM old_db.users o WHERE o.telegram_id = users.telegram_id) = 1 THEN 1
        ELSE users.lang_set
      END
    WHERE EXISTS (
      SELECT 1 FROM old_db.users o WHERE o.telegram_id = users.telegram_id
    )
  `;
  const resUpdate = db.prepare(updateOverlapSql).run();
  console.log("-> Updated overlapping users:", resUpdate.changes);

  // 3. Insert downloads
  const insertDownloadsSql = `
    INSERT INTO downloads (user_id, url, status, file_size_bytes, created_at, platform)
    SELECT
      u.id AS user_id,
      od.url,
      od.status,
      od.file_size_bytes,
      od.created_at,
      od.platform
    FROM old_db.downloads od
    JOIN old_db.users ou ON ou.id = od.user_id
    JOIN main.users u ON u.telegram_id = ou.telegram_id
    WHERE NOT EXISTS (
      SELECT 1 FROM main.downloads md
      WHERE md.user_id = u.id
        AND md.url = od.url
        AND md.created_at = od.created_at
    )
  `;
  const resDownloads = db.prepare(insertDownloadsSql).run();
  console.log("-> Inserted downloads from old:", resDownloads.changes);
});

try {
  runMerge();
} finally {
  db.prepare("DETACH DATABASE old_db").run();
}

const finalUsers = db.prepare("SELECT count(*) as c FROM users").get().c;
const finalDownloads = db.prepare("SELECT count(*) as c FROM downloads").get().c;
console.log("Post-merge users:", finalUsers);
console.log("Post-merge downloads:", finalDownloads);
db.close();
