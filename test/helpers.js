const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "src", "index.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const makeTempHome = (prefix = "mpm-test-") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
};

const rimraf = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
};

/**
 * Run CLI to completion. Returns { code, stdout, stderr }.
 */
/** `--` stops Node from eating flags like `--env-file` (Node 20+). */
const cliArgv = (args) => ["--", CLI, ...args];

const runCli = (args, { mpmHome, cwd, env = {}, timeoutMs = 15_000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgv(args), {
      cwd: cwd || ROOT,
      env: {
        ...process.env,
        ...(mpmHome ? { MPM_HOME: mpmHome } : {}),
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out: ${args.join(" ")}\n${stdout}\n${stderr}`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

/**
 * Start CLI in background (for `start`). Returns handle with stop/wait helpers.
 */
const startCli = (args, { mpmHome, cwd, env = {} } = {}) => {
  const child = spawn(process.execPath, cliArgv(args), {
    cwd: cwd || ROOT,
    env: {
      ...process.env,
      ...(mpmHome ? { MPM_HOME: mpmHome } : {}),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => {
    stdout += c.toString();
  });
  child.stderr.on("data", (c) => {
    stderr += c.toString();
  });

  const closed = new Promise((resolve) => {
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });

  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    closed,
    kill(signal = "SIGTERM") {
      try {
        child.kill(signal);
      } catch {
        // gone
      }
    },
  };
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const processRecord = (mpmHome, name) => {
  const file = path.join(mpmHome, "processes", `${name}.json`);
  if (!fs.existsSync(file)) {
    return null;
  }
  return readJson(file);
};

const waitFor = async (fn, { timeoutMs = 10_000, intervalMs = 100, label = "condition" } = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `timeout waiting for ${label}${lastErr ? `: ${lastErr.message}` : ""}`
  );
};

const waitForOnline = (mpmHome, name, opts) =>
  waitFor(
    () => {
      const rec = processRecord(mpmHome, name);
      return rec && rec.status === "online" && rec.childPid ? rec : null;
    },
    { label: `${name} online`, ...opts }
  );

const waitForRestarts = (mpmHome, name, min, opts) =>
  waitFor(
    () => {
      const rec = processRecord(mpmHome, name);
      return rec && (rec.restarts || 0) >= min ? rec : null;
    },
    { label: `${name} restarts>=${min}`, ...opts }
  );

const writeFixture = (dir, name, contents) => {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
};

module.exports = {
  ROOT,
  CLI,
  sleep,
  makeTempHome,
  rimraf,
  runCli,
  startCli,
  processRecord,
  waitFor,
  waitForOnline,
  waitForRestarts,
  writeFixture,
};
