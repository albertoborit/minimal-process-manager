const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EXIT } = require("../../src/core/exitCodes");

describe("exitCodes", () => {
  it("exports stable CLI exit codes", () => {
    assert.equal(EXIT.OK, 0);
    assert.equal(EXIT.ERROR, 1);
    assert.equal(EXIT.USAGE, 2);
    assert.equal(EXIT.NOT_FOUND, 3);
    assert.equal(EXIT.ALREADY_RUNNING, 4);
    assert.equal(EXIT.RUNTIME, 5);
  });
});
