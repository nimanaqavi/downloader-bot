import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  formatBytes,
  formatDuration,
  renderProgressBar,
  truncateText
} from "../src/utils/formatting.js";

describe("UI Formatting Helpers", () => {
  it("escapes dangerous HTML characters", () => {
    assert.equal(escapeHtml("<script>alert('xss')</script>"), "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
    assert.equal(escapeHtml("Tom & Jerry > Spike < Tyke"), "Tom &amp; Jerry &gt; Spike &lt; Tyke");
  });

  it("formats duration accurately in mm:ss and hh:mm:ss", () => {
    assert.equal(formatDuration(0), "--:--");
    assert.equal(formatDuration(45), "00:45");
    assert.equal(formatDuration(125), "02:05");
    assert.equal(formatDuration(3665), "01:01:05");
  });

  it("formats file sizes cleanly", () => {
    assert.equal(formatBytes(500 * 1024), "500 KB");
    assert.equal(formatBytes(15 * 1024 * 1024), "15 MB");
    assert.equal(formatBytes(1500 * 1024 * 1024), "1.5 GB");
  });

  it("renders 10-block progress bar with numbers in brackets", () => {
    assert.equal(renderProgressBar(0), "[▱▱▱▱▱▱▱▱▱▱] 0%");
    assert.equal(renderProgressBar(50), "[▰▰▰▰▰▱▱▱▱▱] 50%");
    assert.equal(renderProgressBar(100), "[▰▰▰▰▰▰▰▰▰▰] 100%");
  });

  it("truncates long titles safely", () => {
    assert.equal(truncateText("Short title", 20), "Short title");
    assert.equal(truncateText("This is a very long title that exceeds the maximum length", 20), "This is a very long…");
  });
});
