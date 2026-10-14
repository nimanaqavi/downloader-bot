import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../src/database/migrations.js";
import { SettingsRepository } from "../src/database/repositories/settings.js";
import { ForceJoinService } from "../src/services/forceJoin.js";

describe("Force Join Service", () => {
  it("exempts admins automatically", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const settings = new SettingsRepository(db);
    settings.setForceJoinEnabled(true);
    settings.setForceJoinChannel("@my_channel");

    const forceJoin = new ForceJoinService(settings);
    const adminIds = new Set(["123456"]);

    // @ts-ignore
    const mockBot = {};
    const res = await forceJoin.checkMembership(mockBot as any, 123456, adminIds, "https://youtu.be/test");
    assert.equal(res.isAllowed, true);

    db.close();
  });

  it("allows all users if force join is disabled", async () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const settings = new SettingsRepository(db);
    settings.setForceJoinEnabled(false);

    const forceJoin = new ForceJoinService(settings);
    const adminIds = new Set(["999999"]);

    // @ts-ignore
    const mockBot = {};
    const res = await forceJoin.checkMembership(mockBot as any, 111111, adminIds, "https://youtu.be/test");
    assert.equal(res.isAllowed, true);

    db.close();
  });
});
