const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatBytes,
  formatPercentage,
  formatUptime,
  formatLogDate,
} = require("../../src/utils/formatters");

describe("formatters", () => {
  it("formatBytes handles null and zero", () => {
    assert.equal(formatBytes(null), "-");
    assert.equal(formatBytes(0), "0 B");
    assert.match(formatBytes(1024), /1(\.0+)?\s*KB/i);
  });

  it("formatPercentage appends unit", () => {
    assert.equal(formatPercentage("12.5"), "12.5 %");
  });

  it("formatUptime renders relative times", () => {
    assert.equal(formatUptime(null), "-");
    assert.equal(formatUptime("not-a-date"), "-");
    const now = Date.now();
    assert.match(formatUptime(now - 5_000), /\d+s/);
    assert.match(formatUptime(now - 90_000), /\d+m/);
  });

  it("formatLogDate substitutes tokens", () => {
    const d = new Date(2026, 6, 17, 19, 5, 9, 42);
    assert.equal(
      formatLogDate("YYYY-MM-DD HH:mm:ss", d),
      "2026-07-17 19:05:09"
    );
    assert.equal(formatLogDate("SSS", d), "042");
    assert.equal(formatLogDate(null), "");
  });
});
