/**
 * Lossless Database Merger for Mimo Telegram Bot
 * Works with both built-in node:sqlite (Node 22.5+) and better-sqlite3.
 * Usage:
 *   node scripts/mergeDatabases.cjs --dry-run <liveDbPath> <oldDbPath>
 *   node scripts/mergeDatabases.cjs --apply <liveDbPath> <oldDbPath>
 */

const fs = require("node:fs");
const path = require("node:path");

let createDb;
try {
  const { DatabaseSync } = require("node:sqlite");
  createDb = (file, opts = {}) => {
    const db = new DatabaseSync(file, { readOnly: opts.readonly || false });
    return {
      prepare: (sql) => {
        const stmt = db.prepare(sql);
        return {
          all: (...args) => stmt.all(...args),
          get: (...args) => stmt.get(...args),
          run: (...args) => stmt.run(...args)
        };
      },
      exec: (sql) => db.exec(sql),
      close: () => db.close()
    };
  };
} catch {
  const BetterSqlite = require("better-sqlite3");
  createDb = (file, opts = {}) => new BetterSqlite(file, opts);
}

function getSchemaVersion(db) {
  try {
    const row = db.prepare("SELECT MAX(version) AS ver FROM schema_migrations").get();
    return row?.ver || 1;
  } catch {
    return 1;
  }
}

function dryRun(liveDbPath, oldDbPath) {
  console.log("==================================================");
  console.log(" DRY-RUN DATABASE MERGE ANALYSIS");
  console.log("==================================================");
  console.log(`Live DB: ${liveDbPath} (Size: ${(fs.statSync(liveDbPath).size / 1024).toFixed(1)} KB)`);
  console.log(`Old  DB: ${oldDbPath} (Size: ${(fs.statSync(oldDbPath).size / 1024).toFixed(1)} KB)`);

  const liveDb = createDb(liveDbPath, { readonly: true });
  const oldDb = createDb(oldDbPath, { readonly: true });

  const liveVer = getSchemaVersion(liveDb);
  const oldVer = getSchemaVersion(oldDb);
  console.log(`Schema Versions -> Live: v${liveVer}, Old: v${oldVer}`);

  const liveUsers = liveDb.prepare("SELECT * FROM users").all();
  const oldUsers = oldDb.prepare("SELECT * FROM users").all();

  const liveUsersMap = new Map(liveUsers.map((u) => [String(u.telegram_id), u]));
  const oldUsersMap = new Map(oldUsers.map((u) => [String(u.telegram_id), u]));

  let onlyInLive = 0;
  let onlyInOld = 0;
  let inBoth = 0;
  const conflicts = [];
  let mergedBannedCount = 0;

  const allTelegramIds = new Set([...liveUsersMap.keys(), ...oldUsersMap.keys()]);

  for (const tid of allTelegramIds) {
    const liveU = liveUsersMap.get(tid);
    const oldU = oldUsersMap.get(tid);

    if (liveU && !oldU) {
      onlyInLive++;
      if (liveU.is_banned) mergedBannedCount++;
    } else if (!liveU && oldU) {
      onlyInOld++;
      if (oldU.is_banned) mergedBannedCount++;
    } else {
      inBoth++;
      const isBanned = liveU.is_banned || oldU.is_banned ? 1 : 0;
      if (isBanned) mergedBannedCount++;

      const conflictReasons = [];
      if (liveU.username !== oldU.username) {
        conflictReasons.push(`username ('${liveU.username}' vs '${oldU.username}')`);
      }
      if (liveU.is_banned !== oldU.is_banned) {
        conflictReasons.push(`is_banned (${liveU.is_banned} vs ${oldU.is_banned})`);
      }
      if (liveU.language && oldU.language && liveU.language !== oldU.language) {
        conflictReasons.push(`language ('${liveU.language}' vs '${oldU.language}')`);
      }
      if (conflictReasons.length > 0) {
        conflicts.push({ telegram_id: tid, reasons: conflictReasons });
      }
    }
  }

  // Analyze Downloads
  const liveDownloads = liveDb.prepare("SELECT * FROM downloads").all();
  const oldDownloads = oldDb.prepare("SELECT * FROM downloads").all();

  const oldDownloadsWithTid = oldDownloads.map((d) => {
    const u = oldDb.prepare("SELECT telegram_id FROM users WHERE id = ?").get(d.user_id);
    return { ...d, telegram_id: u ? String(u.telegram_id) : null };
  });

  const liveDownloadsSignatures = new Set(
    liveDownloads.map((d) => {
      const u = liveUsersMap.get(
        String(liveDb.prepare("SELECT telegram_id FROM users WHERE id = ?").get(d.user_id)?.telegram_id)
      );
      const tid = u ? String(u.telegram_id) : "";
      return `${tid}|${d.url}|${d.created_at}`;
    })
  );

  let oldDownloadsToInsert = 0;
  let oldDownloadsDuplicates = 0;

  for (const d of oldDownloadsWithTid) {
    if (!d.telegram_id) continue;
    const sig = `${d.telegram_id}|${d.url}|${d.created_at}`;
    if (liveDownloadsSignatures.has(sig)) {
      oldDownloadsDuplicates++;
    } else {
      oldDownloadsToInsert++;
    }
  }

  const expectedTotalUsers = allTelegramIds.size;
  const expectedTotalDownloads = liveDownloads.length + oldDownloadsToInsert;

  console.log("\n--- USER METRICS ---");
  console.log(`Users in Live DB:     ${liveUsers.length}`);
  console.log(`Users in Old DB:      ${oldUsers.length}`);
  console.log(`Intersection (Both):  ${inBoth}`);
  console.log(`Only in Live:         ${onlyInLive}`);
  console.log(`Only in Old:          ${onlyInOld}`);
  console.log(`Union (Expected Total): ${expectedTotalUsers}`);
  console.log(`Merged Banned Users:  ${mergedBannedCount}`);
  console.log(`Conflicts Detected:   ${conflicts.length}`);
  if (conflicts.length > 0) {
    console.log("Sample Conflicts (First 5):", conflicts.slice(0, 5));
  }

  console.log("\n--- DOWNLOADS METRICS ---");
  console.log(`Downloads in Live DB:         ${liveDownloads.length}`);
  console.log(`Downloads in Old DB:          ${oldDownloads.length}`);
  console.log(`Exact Duplicates to Skip:     ${oldDownloadsDuplicates}`);
  console.log(`New Downloads to Insert:      ${oldDownloadsToInsert}`);
  console.log(`Expected Total Downloads:     ${expectedTotalDownloads}`);

  console.log("\n--- CACHE & SETTINGS ---");
  let oldCacheCount = 0;
  let liveCacheCount = 0;
  try {
    oldCacheCount = oldDb.prepare("SELECT count(*) as c FROM download_cache").get().c;
  } catch {}
  try {
    liveCacheCount = liveDb.prepare("SELECT count(*) as c FROM download_cache").get().c;
  } catch {}
  console.log(`Cache records (ignored per spec): Live=${liveCacheCount}, Old=${oldCacheCount}`);

  liveDb.close();
  oldDb.close();

  return {
    expectedTotalUsers,
    expectedTotalDownloads,
    onlyInOld,
    inBoth,
    onlyInLive,
    mergedBannedCount,
    conflictsCount: conflicts.length
  };
}

const mode = process.argv[2];
const livePath = process.argv[3];
const oldPath = process.argv[4];

if (!mode || !livePath || !oldPath) {
  console.error("Usage: node mergeDatabases.cjs <--dry-run> <liveDbPath> <oldDbPath>");
  process.exit(1);
}

if (mode === "--dry-run") {
  dryRun(livePath, oldPath);
} else {
  console.error(`Unsupported mode in node:sqlite runner: ${mode}`);
  process.exit(1);
}
