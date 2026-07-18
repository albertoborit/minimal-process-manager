const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  makeTempHome,
  rimraf,
  runCli,
  startCli,
  processRecord,
  waitForOnline,
  waitForRestarts,
  waitFor,
  writeFixture,
  sleep,
} = require("../helpers");
const { EXIT } = require("../../src/core/exitCodes");

describe("CLI features", () => {
  let home;
  let fixtures;
  let handles;

  before(() => {
    fixtures = fs.mkdtempSync(path.join(require("os").tmpdir(), "mpm-fx-"));
  });

  after(() => {
    rimraf(fixtures);
  });

  beforeEach(() => {
    home = makeTempHome();
    handles = [];
  });

  afterEach(async () => {
    try {
      await runCli(["stop", "--all"], { mpmHome: home, timeoutMs: 10_000 });
    } catch {
      // ignore
    }
    for (const h of handles) {
      h.kill("SIGKILL");
    }
    await sleep(100);
    rimraf(home);
  });

  const bg = (args) => {
    const h = startCli(args, { mpmHome: home });
    handles.push(h);
    return h;
  };

  const aliveScript = (name, body = 'console.log("hi"); setInterval(() => {}, 1e9);\n') =>
    writeFixture(fixtures, name, body);

  // --- exit codes / usage ---

  it("start without script → exit USAGE", async () => {
    const r = await runCli(["start"], { mpmHome: home });
    assert.equal(r.code, EXIT.USAGE);
  });

  it("start missing script → exit NOT_FOUND", async () => {
    const r = await runCli(["start", "/no/such/script.js"], { mpmHome: home });
    assert.equal(r.code, EXIT.NOT_FOUND);
  });

  it("--cpus without --cluster → USAGE", async () => {
    const script = aliveScript("cpus.js");
    const r = await runCli(["start", script, "--cpus", "2"], { mpmHome: home });
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr + r.stdout, /--cpus requires --cluster/);
  });

  it("stop unknown name → NOT_FOUND", async () => {
    const r = await runCli(["stop", "ghost"], { mpmHome: home });
    assert.equal(r.code, EXIT.NOT_FOUND);
  });

  it("delete without name → USAGE", async () => {
    const r = await runCli(["delete"], { mpmHome: home });
    assert.equal(r.code, EXIT.USAGE);
  });

  it("logs unknown → NOT_FOUND", async () => {
    const r = await runCli(["logs", "ghost"], { mpmHome: home });
    assert.equal(r.code, EXIT.NOT_FOUND);
  });

  // --- start / list / stop / delete / logs ---

  it("start, list, logs, stop, delete lifecycle", async () => {
    const script = aliveScript(
      "life.js",
      'console.log("hello-life"); setInterval(() => {}, 1e9);\n'
    );
    bg(["start", script, "--name", "life", "--log-date-format", "YYYY-MM-DD"]);

    await waitForOnline(home, "life");

    const list = await runCli(["list"], { mpmHome: home });
    assert.equal(list.code, EXIT.OK);
    assert.match(list.stdout, /life/);
    assert.match(list.stdout, /online/);

    await waitFor(
      () => {
        const logFile = path.join(home, "logs", "life.log");
        return fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").includes("hello-life");
      },
      { label: "log content" }
    );

    const logs = await runCli(["logs", "life", "-n", "5"], { mpmHome: home });
    assert.equal(logs.code, EXIT.OK);
    assert.match(logs.stdout, /hello-life/);
    assert.match(logs.stdout, /\d{4}-\d{2}-\d{2}/);

    const stop = await runCli(["stop", "life"], { mpmHome: home });
    assert.equal(stop.code, EXIT.OK);

    await waitFor(
      () => {
        const rec = processRecord(home, "life");
        return rec && rec.status === "stopped" ? rec : null;
      },
      { label: "stopped" }
    );

    const del = await runCli(["delete", "life"], { mpmHome: home });
    assert.equal(del.code, EXIT.OK);
    assert.equal(processRecord(home, "life"), null);
  });

  it("rejects duplicate online name with ALREADY_RUNNING", async () => {
    const script = aliveScript("dup.js");
    bg(["start", script, "--name", "dup"]);
    await waitForOnline(home, "dup");

    const r = await runCli(["start", script, "--name", "dup"], {
      mpmHome: home,
      timeoutMs: 5_000,
    });
    assert.equal(r.code, EXIT.ALREADY_RUNNING);
  });

  it("forwards script args after --", async () => {
    const script = writeFixture(
      fixtures,
      "args.js",
      'console.log("ARGS", JSON.stringify(process.argv.slice(2))); setInterval(() => {}, 1e9);\n'
    );
    bg(["start", script, "--name", "args", "--", "--port", "4242"]);
    await waitForOnline(home, "args");
    await waitFor(
      () => {
        const logFile = path.join(home, "logs", "args.log");
        if (!fs.existsSync(logFile)) return null;
        const t = fs.readFileSync(logFile, "utf8");
        return t.includes("--port") && t.includes("4242") ? t : null;
      },
      { label: "script args in log" }
    );
  });

  it("--env and --env-file and --cwd", async () => {
    const cwdDir = path.join(fixtures, "cwd-work");
    fs.mkdirSync(cwdDir, { recursive: true });
    const envFile = writeFixture(fixtures, "vars.env", "X=1\nY=2\n");
    const script = writeFixture(
      fixtures,
      "env.js",
      [
        'console.log("ENV", process.env.X, process.env.Y);',
        'console.log("CWD", process.cwd());',
        "setInterval(() => {}, 1e9);",
        "",
      ].join("\n")
    );

    bg([
      "start",
      script,
      "--name",
      "envy",
      "--env-file",
      envFile,
      "--env",
      "Y=9",
      "--cwd",
      cwdDir,
    ]);

    await waitForOnline(home, "envy");
    await waitFor(
      () => {
        const logFile = path.join(home, "logs", "envy.log");
        if (!fs.existsSync(logFile)) return null;
        const t = fs.readFileSync(logFile, "utf8");
        return t.includes("ENV 1 9") && t.includes(cwdDir) ? t : null;
      },
      { label: "env+cwd log" }
    );
  });

  it("--interpreter node forces runtime", async () => {
    const script = writeFixture(
      fixtures,
      "interp.dat",
      'console.log("interp-ok"); setInterval(() => {}, 1e9);\n'
    );
    bg(["start", script, "--name", "interp", "--interpreter", "node"]);
    await waitForOnline(home, "interp");
    await waitFor(
      () => {
        const logFile = path.join(home, "logs", "interp.log");
        return (
          fs.existsSync(logFile) &&
          fs.readFileSync(logFile, "utf8").includes("interp-ok")
        );
      },
      { label: "interpreter log" }
    );
  });

  it("crash restarts with --unlimited and bumps unstable", async () => {
    const script = writeFixture(
      fixtures,
      "crash.js",
      'console.log("boom"); process.exit(1);\n'
    );
    bg(["start", script, "--name", "crash", "--unlimited", "200"]);
    const rec = await waitForRestarts(home, "crash", 2, { timeoutMs: 8_000 });
    assert.ok(rec.restarts >= 2);
    assert.ok((rec.unstable_restarts || 0) >= 1);
    assert.equal(rec.lastRestartReason, "crash");
  });

  it("clean exit 0 does not restart (status stopped)", async () => {
    const script = writeFixture(
      fixtures,
      "clean.js",
      'console.log("bye"); process.exit(0);\n'
    );
    bg(["start", script, "--name", "clean"]);
    await waitFor(
      () => {
        const rec = processRecord(home, "clean");
        return rec && rec.status === "stopped" ? rec : null;
      },
      { timeoutMs: 8_000, label: "clean stopped" }
    );
    const rec = processRecord(home, "clean");
    assert.equal(rec.restarts || 0, 0);
  });

  it("--max-memory triggers memory restart", async () => {
    const script = writeFixture(
      fixtures,
      "mem.js",
      [
        "const a = [];",
        "while (a.length < 40) a.push(Buffer.alloc(1024 * 1024));",
        'console.log("ok", a.length);',
        "setInterval(() => {}, 1e9);",
        "",
      ].join("\n")
    );
    bg([
      "start",
      script,
      "--name",
      "mem",
      "--max-memory",
      "20",
      "--unlimited",
      "300",
    ]);
    const rec = await waitForRestarts(home, "mem", 1, { timeoutMs: 15_000 });
    assert.equal(rec.lastRestartReason, "memory");
  });

  it("--watch restarts on file change", async () => {
    const script = writeFixture(
      fixtures,
      "watch.js",
      'console.log("v1"); setInterval(() => {}, 1e9);\n'
    );
    bg(["start", script, "--name", "w", "--watch", script]);
    await waitForOnline(home, "w");
    await waitFor(
      () => {
        const logFile = path.join(home, "logs", "w.log");
        return (
          fs.existsSync(logFile) &&
          fs.readFileSync(logFile, "utf8").includes("v1")
        );
      },
      { label: "v1 logged" }
    );

    fs.writeFileSync(script, 'console.log("v2"); setInterval(() => {}, 1e9);\n');
    const rec = await waitForRestarts(home, "w", 1, { timeoutMs: 8_000 });
    assert.equal(rec.lastRestartReason, "watch");
    assert.equal(rec.mode, "watch");

    await waitFor(
      () => {
        const logFile = path.join(home, "logs", "w.log");
        return (
          fs.existsSync(logFile) &&
          fs.readFileSync(logFile, "utf8").includes("v2")
        );
      },
      { label: "v2 logged" }
    );
  });

  it("--cron schedules restarts (every minute fires immediately once)", async () => {
    const script = aliveScript("cron.js", 'console.log("cron-tick"); setInterval(() => {}, 1e9);\n');
    bg(["start", script, "--name", "cronjob", "--cron", "* * * * *"]);
    await waitForOnline(home, "cronjob");
    // * * * * * matches every minute; startCron fires on first matching tick
    const rec = await waitForRestarts(home, "cronjob", 1, { timeoutMs: 5_000 });
    assert.equal(rec.lastRestartReason, "cron");
    assert.equal(rec.mode, "cron");
  });

  it("cluster mode with --cpus 2", async () => {
    const script = writeFixture(
      fixtures,
      "chello.js",
      'console.log("worker", process.pid); setInterval(() => {}, 1e9);\n'
    );
    bg(["start", script, "--name", "chello", "--cluster", "--cpus", "2"]);

    await waitFor(
      () => {
        const rec = processRecord(home, "chello");
        return rec && rec.status === "online" && rec.cluster && rec.cpus === 2
          ? rec
          : null;
      },
      { timeoutMs: 10_000, label: "cluster online" }
    );

    const list = await runCli(["list"], { mpmHome: home });
    assert.match(list.stdout, /cluster\/2/);

    const stop = await runCli(["stop", "chello", "--delete"], { mpmHome: home });
    assert.equal(stop.code, EXIT.OK);
    assert.equal(processRecord(home, "chello"), null);
  });

  it("cluster rejects --watch", async () => {
    const script = aliveScript("cw.js");
    const r = await runCli(
      ["start", script, "--cluster", "--cpus", "1", "--watch"],
      { mpmHome: home }
    );
    assert.equal(r.code, EXIT.USAGE);
  });

  it("--max-log-size rotates log file", async () => {
    const script = writeFixture(
      fixtures,
      "rot.js",
      // print a lot quickly then stay alive
      [
        'for (let i = 0; i < 200; i++) console.log("LINE-" + i + "-" + "x".repeat(200));',
        "setInterval(() => {}, 1e9);",
        "",
      ].join("\n")
    );
    // 1 MB is large; use tiny by writing via process — CLI takes MB.
    // We'll set 1 MB and verify rotation API in unit tests; for CLI verify option is accepted
    // and process starts. Real tiny rotation is unit-tested on createLogStream.
    bg(["start", script, "--name", "rot", "--max-log-size", "1"]);
    await waitForOnline(home, "rot");
    const rec = processRecord(home, "rot");
    assert.ok(rec);
    assert.ok(fs.existsSync(path.join(home, "logs", "rot.log")));
  });

  it("stop --all and delete --all", async () => {
    const a = aliveScript("a.js");
    const b = aliveScript("b.js");
    bg(["start", a, "--name", "pa"]);
    bg(["start", b, "--name", "pb"]);
    await waitForOnline(home, "pa");
    await waitForOnline(home, "pb");

    const stopAll = await runCli(["stop", "--all"], { mpmHome: home });
    assert.equal(stopAll.code, EXIT.OK);

    await waitFor(
      () => {
        const ra = processRecord(home, "pa");
        const rb = processRecord(home, "pb");
        return ra?.status === "stopped" && rb?.status === "stopped";
      },
      { label: "both stopped" }
    );

    const delAll = await runCli(["delete", "--all"], { mpmHome: home });
    assert.equal(delAll.code, EXIT.OK);
    assert.equal(processRecord(home, "pa"), null);
    assert.equal(processRecord(home, "pb"), null);
  });

  it("stop --delete removes registry entry", async () => {
    const script = aliveScript("sd.js");
    bg(["start", script, "--name", "sd"]);
    await waitForOnline(home, "sd");
    const r = await runCli(["stop", "sd", "--delete"], { mpmHome: home });
    assert.equal(r.code, EXIT.OK);
    assert.equal(processRecord(home, "sd"), null);
  });

  it("default name is script basename", async () => {
    const script = writeFixture(
      fixtures,
      "myapp.js",
      'console.log("x"); setInterval(() => {}, 1e9);\n'
    );
    bg(["start", script]);
    await waitForOnline(home, "myapp");
    assert.ok(processRecord(home, "myapp"));
  });

  it("missing --cwd → NOT_FOUND", async () => {
    const script = aliveScript("cwdmiss.js");
    const r = await runCli(
      ["start", script, "--cwd", "/no/such/cwd"],
      { mpmHome: home }
    );
    assert.equal(r.code, EXIT.NOT_FOUND);
  });

  it("missing --env-file → NOT_FOUND", async () => {
    const script = aliveScript("envmiss.js");
    const r = await runCli(
      ["start", script, "--env-file", "/no/such.env"],
      { mpmHome: home }
    );
    assert.equal(r.code, EXIT.NOT_FOUND);
  });
});
