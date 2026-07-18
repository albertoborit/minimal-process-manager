const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveRuntime,
  resolveInterpreter,
  EXT_TO_COMMAND,
} = require("../../src/core/runtime");

describe("runtime", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mpm-rt-"));

  it("resolveInterpreter maps aliases", () => {
    assert.equal(resolveInterpreter("python"), "python3");
    assert.equal(resolveInterpreter("node"), "node");
    assert.equal(resolveInterpreter("custom"), "custom");
  });

  it("extension map covers common types", () => {
    assert.equal(EXT_TO_COMMAND[".js"], "node");
    assert.equal(EXT_TO_COMMAND[".py"], "python3");
    assert.equal(EXT_TO_COMMAND[".sh"], "bash");
  });

  it("--interpreter overrides shebang and extension", () => {
    const dir = tmp();
    const file = path.join(dir, "x.js");
    fs.writeFileSync(file, "#!/usr/bin/env python3\nconsole.log(1)\n");
    const rt = resolveRuntime(file, { interpreter: "bun" });
    assert.equal(rt.command, "bun");
    assert.deepEqual(rt.args, [file]);
    assert.equal(rt.via, "interpreter");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("uses shebang when present", () => {
    const dir = tmp();
    const file = path.join(dir, "s.py");
    fs.writeFileSync(file, "#!/usr/bin/env python3\nprint(1)\n");
    const rt = resolveRuntime(file);
    assert.equal(rt.command, "python3");
    assert.equal(rt.via, "shebang");
    assert.ok(rt.args.includes(file));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to extension", () => {
    const dir = tmp();
    const file = path.join(dir, "a.js");
    fs.writeFileSync(file, "console.log(1)\n");
    const rt = resolveRuntime(file);
    assert.equal(rt.command, "node");
    assert.equal(rt.via, "extension");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs executable with unknown extension", () => {
    const dir = tmp();
    const file = path.join(dir, "bin");
    // no shebang → falls through to executable bit
    fs.writeFileSync(file, "echo hi\n");
    fs.chmodSync(file, 0o755);
    const rt = resolveRuntime(file);
    assert.equal(rt.command, file);
    assert.equal(rt.via, "executable");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("throws ERUNTIME when unresolved", () => {
    const dir = tmp();
    const file = path.join(dir, "x.unknown");
    fs.writeFileSync(file, "data\n");
    assert.throws(() => resolveRuntime(file), (err) => {
      assert.equal(err.code, "ERUNTIME");
      return true;
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
