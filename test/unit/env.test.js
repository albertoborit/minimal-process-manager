const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { parseEnvFile, parseEnvPairs, buildEnv } = require("../../src/core/env");

describe("env", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mpm-env-"));

  it("parseEnvFile ignores blanks and comments", () => {
    const dir = tmp();
    const file = path.join(dir, "a.env");
    fs.writeFileSync(file, "# c\n\nFOO=1\nBAR=\"two\"\nBAZ='three'\n");
    assert.deepEqual(parseEnvFile(file), {
      FOO: "1",
      BAR: "two",
      BAZ: "three",
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parseEnvFile rejects invalid lines", () => {
    const dir = tmp();
    const file = path.join(dir, "bad.env");
    fs.writeFileSync(file, "NOEQUALS\n");
    assert.throws(() => parseEnvFile(file), /invalid env line/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parseEnvPairs parses KEY=VALUE", () => {
    assert.deepEqual(parseEnvPairs(["A=1", "B=x=y"]), { A: "1", B: "x=y" });
  });

  it("parseEnvPairs rejects bad pairs", () => {
    assert.throws(() => parseEnvPairs(["=no"]), /invalid --env/);
    assert.throws(() => parseEnvPairs(["nope"]), /invalid --env/);
  });

  it("buildEnv merges env-file then --env (later wins)", () => {
    const dir = tmp();
    const file = path.join(dir, "m.env");
    fs.writeFileSync(file, "X=1\nY=2\n");
    const env = buildEnv({ envFile: file, envPairs: ["Y=9", "Z=3"] });
    assert.equal(env.X, "1");
    assert.equal(env.Y, "9");
    assert.equal(env.Z, "3");
    assert.ok(env.PATH);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
