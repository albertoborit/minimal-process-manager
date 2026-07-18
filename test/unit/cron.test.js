const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseCron, matchesCron, startCron } = require("../../src/core/cron");

describe("cron", () => {
  it("parseCron requires 5 fields", () => {
    assert.throws(() => parseCron("* * *"), /5 fields/);
    assert.throws(() => parseCron("a b c d e"), /invalid cron/);
  });

  it("parseCron supports *, lists, ranges, steps", () => {
    const p = parseCron("*/15 9-17 1,15 * 1-5");
    assert.ok(p.minute.has(0));
    assert.ok(p.minute.has(15));
    assert.ok(p.minute.has(30));
    assert.ok(!p.minute.has(1));
    assert.ok(p.hour.has(9));
    assert.ok(p.hour.has(17));
    assert.ok(!p.hour.has(8));
    assert.ok(p.dayOfMonth.has(1));
    assert.ok(p.dayOfMonth.has(15));
    assert.ok(p.dayOfWeek.has(1));
    assert.ok(p.dayOfWeek.has(5));
  });

  it("matchesCron checks all fields and Sunday as 0 or 7", () => {
    const every = parseCron("* * * * *");
    assert.equal(matchesCron(every, new Date(2026, 0, 1, 12, 0, 0)), true);

    // 2026-01-04 is Sunday
    const sun = new Date(2026, 0, 4, 10, 5, 0);
    assert.equal(matchesCron(parseCron("5 10 * * 0"), sun), true);
    assert.equal(matchesCron(parseCron("5 10 * * 7"), sun), true);
    assert.equal(matchesCron(parseCron("5 10 * * 1"), sun), false);
    assert.equal(matchesCron(parseCron("6 10 * * 0"), sun), false);
  });

  it("startCron fires when expression matches and stop() clears interval", async () => {
    let fires = 0;
    const stop = startCron("* * * * *", () => {
      fires++;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(fires >= 1);
    stop();
    const after = fires;
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(fires, after);
  });
});
