const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME =
  process.env.MPM_HOME ||
  path.join(os.homedir(), ".minimal-process-manager");
const PROCESSES_DIR = path.join(HOME, "processes");
const LOGS_DIR = path.join(HOME, "logs");

const STATUS = {
  ONLINE: "online",
  STOPPED: "stopped",
  ERRORED: "errored",
};

const sleepMs = (ms) => {
  try {
    execFileSync("sleep", [String(ms / 1000)], { stdio: "ignore" });
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // busy-wait fallback
    }
  }
};

const ensureDirs = () => {
  fs.mkdirSync(PROCESSES_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
};

const processPath = (name) => path.join(PROCESSES_DIR, `${name}.json`);
const logPath = (name) => path.join(LOGS_DIR, `${name}.log`);

const isAlive = (pid) => {
  if (!pid || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readRecord = (name) => {
  const file = processPath(name);
  if (!fs.existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const writeRecord = (record) => {
  ensureDirs();
  fs.writeFileSync(processPath(record.name), JSON.stringify(record, null, 2));
};

const removeRecord = (name) => {
  const file = processPath(name);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
};

const defaultName = (script) => {
  const base = path.basename(script, path.extname(script));
  return base || "app";
};

/**
 * Patch fields on an existing registry record (best-effort; no-op if missing).
 */
const updateRecord = (name, patch) => {
  const record = readRecord(name);
  if (!record) {
    return null;
  }
  const next = {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeRecord(next);
  return next;
};

/**
 * Sync a record whose manager pid is dead: mark errored if it was online.
 * Returns the record to show, or null if it should be dropped.
 */
const reconcileRecord = (record) => {
  if (!record) {
    return null;
  }

  const alive = isAlive(record.pid);
  if (alive) {
    return record;
  }

  // Dead manager: keep stopped/errored entries for list; promote stale online → errored.
  if (record.status === STATUS.STOPPED || record.status === STATUS.ERRORED) {
    return { ...record, childPid: null };
  }

  if (record.status === STATUS.ONLINE || !record.status) {
    const next = {
      ...record,
      status: STATUS.ERRORED,
      childPid: null,
      updatedAt: new Date().toISOString(),
    };
    writeRecord(next);
    return next;
  }

  removeRecord(record.name);
  return null;
};

const listRecords = ({ includeStopped = true } = {}) => {
  if (!fs.existsSync(PROCESSES_DIR)) {
    return [];
  }

  const names = fs
    .readdirSync(PROCESSES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5));

  const records = [];
  for (const name of names) {
    const raw = readRecord(name);
    if (!raw) {
      removeRecord(name);
      continue;
    }
    const record = reconcileRecord(raw);
    if (!record) {
      continue;
    }
    if (
      !includeStopped &&
      (record.status === STATUS.STOPPED || record.status === STATUS.ERRORED) &&
      !isAlive(record.pid)
    ) {
      continue;
    }
    records.push(record);
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
};

const register = ({
  name,
  pid,
  script,
  args = [],
  cluster = false,
  cpus = null,
  mode = null,
  cwd = null,
  interpreter = null,
  maxMemoryMb = null,
  watch = null,
  cron = null,
}) => {
  ensureDirs();
  const existing = readRecord(name);
  if (
    existing &&
    isAlive(existing.pid) &&
    existing.pid !== pid &&
    existing.status === STATUS.ONLINE
  ) {
    const err = new Error(
      `process "${name}" is already running (pid=${existing.pid}). Use stop ${name} first, or --name <other>`
    );
    err.code = "EALREADY";
    throw err;
  }

  const inferredMode = mode || (cluster ? "cluster" : "fork");
  const record = {
    name,
    pid,
    childPid: null,
    script: path.resolve(script),
    args,
    cluster: Boolean(cluster),
    cpus,
    mode: inferredMode,
    cwd,
    interpreter,
    maxMemoryMb,
    watch,
    cron,
    status: STATUS.ONLINE,
    restarts: 0,
    unstable_restarts: 0,
    logFile: logPath(name),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeRecord(record);
  return record;
};

const unregister = (name) => {
  removeRecord(name);
};

const getRecord = (name) => {
  const record = readRecord(name);
  if (!record) {
    return null;
  }
  return reconcileRecord(record);
};

const stopProcess = (name, { timeoutMs = 5000, remove = false } = {}) => {
  const record = getRecord(name);
  if (!record) {
    return { ok: false, reason: "not_found" };
  }

  if (!isAlive(record.pid)) {
    const next = updateRecord(name, {
      status: STATUS.STOPPED,
      childPid: null,
    });
    if (remove) {
      removeRecord(name);
    }
    return { ok: true, pid: record.pid, record: next || record, alreadyDead: true };
  }

  try {
    process.kill(record.pid, "SIGTERM");
  } catch (err) {
    updateRecord(name, { status: STATUS.STOPPED, childPid: null });
    if (remove) {
      removeRecord(name);
    }
    return { ok: false, reason: "gone", error: err.message };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) {
      const next = updateRecord(name, {
        status: STATUS.STOPPED,
        childPid: null,
      });
      if (remove) {
        removeRecord(name);
      }
      return { ok: true, pid: record.pid, record: next || record };
    }
    sleepMs(50);
  }

  try {
    process.kill(record.pid, "SIGKILL");
  } catch {
    // already gone
  }

  const next = updateRecord(name, {
    status: STATUS.STOPPED,
    childPid: null,
  });
  if (remove) {
    removeRecord(name);
  }
  return { ok: true, pid: record.pid, record: next || record, forced: true };
};

const deleteProcess = (name) => {
  const record = readRecord(name);
  if (!record) {
    return { ok: false, reason: "not_found" };
  }
  if (isAlive(record.pid) && record.status === STATUS.ONLINE) {
    return { ok: false, reason: "still_running" };
  }
  removeRecord(name);
  return { ok: true, record };
};

module.exports = {
  STATUS,
  defaultName,
  getRecord,
  isAlive,
  listRecords,
  logPath,
  register,
  updateRecord,
  stopProcess,
  unregister,
  deleteProcess,
  readRecord,
};
