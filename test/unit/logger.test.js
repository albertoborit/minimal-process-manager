const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLogStream } = require("../../src/utils/logger");

describe("logger.createLogStream", () => {
  it("appends and rotates when max size exceeded", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpm-log-"));
    const file = path.join(dir, "app.log");
    const stream = createLogStream(file, { maxLogSizeBytes: 20 });

    stream.write("AAAAAAAAAA"); // 10
    stream.write("BBBBBBBBBB"); // 10 → size 20
    stream.write("CCCCCCCCCC"); // would exceed → rotate then write

    stream.end();

    assert.ok(fs.existsSync(file));
    assert.ok(fs.existsSync(`${file}.1`));
    const rotated = fs.readFileSync(`${file}.1`, "utf8");
    const current = fs.readFileSync(file, "utf8");
    assert.ok(rotated.includes("A") || rotated.includes("B"));
    assert.ok(current.includes("C"));

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null without logFile", () => {
    assert.equal(createLogStream(null), null);
  });
});
