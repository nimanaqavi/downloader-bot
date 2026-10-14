import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseMediaUrl } from "../src/utils/mediaUrl.js";

describe("Spotify URL Detection and Resolution", () => {
  it("detects Spotify track URLs with platform 'spotify'", async () => {
    const res = await parseMediaUrl("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
    assert.ok(res);
    assert.equal(res?.platform, "spotify");
    assert.equal(res?.platformName, "اسپاتیفای");
  });

  it("detects Spotify short links", async () => {
    const res = await parseMediaUrl("https://spotify.link/abcd1234efg");
    assert.ok(res);
    assert.equal(res?.platform, "spotify");
  });
});
