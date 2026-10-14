import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tikWmCircuit } from "../src/services/tiktok.js";
import { validateSafeUrl } from "../src/utils/ssrf.js";

describe("TikTok and TikWM Security", () => {
  it("rejects non-https or private IP video URLs returned from external API", async () => {
    const safeUrl = await validateSafeUrl("https://tikwm.com/video/media.mp4");
    assert.equal(safeUrl.valid, true);

    const privateUrl = await validateSafeUrl("http://192.168.1.1/video.mp4");
    assert.equal(privateUrl.valid, false);

    const localhostUrl = await validateSafeUrl("http://localhost:8080/exploit.mp4");
    assert.equal(localhostUrl.valid, false);
  });

  it("handles circuit breaker state tracking", () => {
    assert.equal(tikWmCircuit.isOpen(), false);
    tikWmCircuit.recordSuccess();
    assert.ok(tikWmCircuit.getUsageCount() >= 1);
  });
});
