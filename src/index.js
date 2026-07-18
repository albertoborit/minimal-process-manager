#!/usr/bin/env node

const cluster = require("cluster");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Command } = require("commander");
const { startProcess, SHUTDOWN_TIMEOUT_MS } = require("./core/process");
const { buildEnv } = require("./core/env");
const { startCron } = require("./core/cron");
const { startWatch } = require("./core/watch");
const { EXIT } = require("./core/exitCodes");
const { readRssBytes } = require("./core/memoryUsageManager");
const {
  STATUS,
  defaultName,
  getRecord,
  listRecords,
  logPath,
  register,
  updateRecord,
  stopProcess,
  deleteProcess,
  isAlive,
} = require("./core/registry");
const { log, error, pipeWorkerOutput } = require("./utils/logger");
const {
  formatBytes,
  formatUptime,
  printTable,
} = require("./utils/formatters");

const program = new Command();
program.name("minimal-process-manager").description("A minimalist process manager");
program.configureOutput({
  writeErr: (str) => process.stderr.write(str),
});
program.exitOverride();

const DEFAULT_MAX_RETRIES = 5;

const exitWith = (code) => {
  process.exit(code);
};

const setupGracefulShutdown = (controller, onShutdown) => {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    try {
      if (controller && typeof controller.stop === "function") {
        await controller.stop(SHUTDOWN_TIMEOUT_MS);
      }
      if (typeof onShutdown === "function") {
        onShutdown();
      }
    } finally {
      exitWith(EXIT.OK);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

const parseDelayMs = (value) => {
  const ms = parseInt(value, 10);
  if (Number.isNaN(ms) || ms < 0) {
    throw new Error(`--unlimited requires a delay in ms >= 0 (got: ${value})`);
  }
  return ms;
};

const parseCpus = (value) => {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new Error(`--cpus must be an integer (got: ${value})`);
  }
  return n;
};

const parsePositiveInt = (label) => (value) => {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) {
    throw new Error(`${label} must be an integer >= 1 (got: ${value})`);
  }
  return n;
};

const modeLabel = (record) => {
  if (record.cron) return `cron`;
  if (record.watch) return `watch`;
  if (record.cluster) return `cluster/${record.cpus ?? "?"}`;
  return record.mode || "fork";
};

try {
  program
    .command("start <script> [scriptArgs...]")
    .description("Start a script under the process manager")
    .option("--cluster", "Run in cluster mode")
    .option(
      "--cpus <n>",
      "Number of workers in cluster mode (default: all CPUs)",
      parseCpus
    )
    .option(
      "--unlimited <ms>",
      "Unlimited retries; wait <ms> milliseconds before each retry",
      parseDelayMs
    )
    .option("--name <name>", "Process name for stop / list / logs")
    .option("--cwd <path>", "Working directory for the child process")
    .option(
      "--env <KEY=VALUE>",
      "Set environment variable (repeatable)",
      (v, acc) => {
        acc.push(v);
        return acc;
      },
      []
    )
    .option("--env-file <path>", "Load environment variables from a file")
    .option(
      "--interpreter <name>",
      "Force runtime (node, python, bun, …)"
    )
    .option(
      "--max-memory <mb>",
      "Restart when child RSS exceeds <mb> MB",
      parsePositiveInt("--max-memory")
    )
    .option(
      "--watch [path]",
      "Restart on file change (default: the script path)"
    )
    .option(
      "--cron <expr>",
      'Restart on cron schedule (5 fields: "min hour dom month dow")'
    )
    .option(
      "--log-date-format <format>",
      'Prefix log lines with a date (e.g. "YYYY-MM-DD HH:mm:ss")'
    )
    .option(
      "--max-log-size <mb>",
      "Rotate log file when it exceeds <mb> MB",
      parsePositiveInt("--max-log-size")
    )
    .action((script, scriptArgs, opts) => {
      const unlimited = opts.unlimited != null;
      const retryDelayMs = unlimited ? opts.unlimited : 0;
      const maxRetries = unlimited ? 0 : DEFAULT_MAX_RETRIES;
      const availableCPUs = os.cpus().length;
      const name = opts.name || defaultName(script);
      const processLogFile = logPath(name);
      const shouldRegister = !opts.cluster || cluster.isPrimary;
      const watchPath =
        opts.watch === true ? path.resolve(script) : opts.watch || null;
      const maxLogSizeBytes = opts.maxLogSize
        ? opts.maxLogSize * 1024 * 1024
        : 0;

      if (opts.cpus != null && !opts.cluster) {
        error("manager", "--cpus requires --cluster");
        exitWith(EXIT.USAGE);
      }

      if (opts.cluster && (opts.watch || opts.cron)) {
        error("manager", "--watch / --cron are not supported with --cluster");
        exitWith(EXIT.USAGE);
      }

      if (!fs.existsSync(path.resolve(script))) {
        error("manager", `script not found: ${path.resolve(script)}`);
        exitWith(EXIT.NOT_FOUND);
      }

      if (opts.cwd && !fs.existsSync(path.resolve(opts.cwd))) {
        error("manager", `--cwd not found: ${opts.cwd}`);
        exitWith(EXIT.NOT_FOUND);
      }

      if (opts.envFile && !fs.existsSync(opts.envFile)) {
        error("manager", `--env-file not found: ${opts.envFile}`);
        exitWith(EXIT.NOT_FOUND);
      }

      let childEnv;
      try {
        childEnv = buildEnv({
          envFile: opts.envFile,
          envPairs: opts.env,
        });
      } catch (err) {
        error("manager", err.message);
        exitWith(EXIT.USAGE);
      }

      const syncRegistry = (patch) => {
        try {
          updateRecord(name, patch);
        } catch {
          // best-effort
        }
      };

      if (shouldRegister) {
        try {
          register({
            name,
            pid: process.pid,
            script,
            args: scriptArgs,
            cluster: Boolean(opts.cluster),
            cpus: opts.cluster
              ? opts.cpus != null
                ? opts.cpus
                : availableCPUs
              : null,
            mode: opts.cron
              ? "cron"
              : opts.watch
                ? "watch"
                : opts.cluster
                  ? "cluster"
                  : "fork",
            cwd: opts.cwd ? path.resolve(opts.cwd) : null,
            interpreter: opts.interpreter || null,
            maxMemoryMb: opts.maxMemory || null,
            watch: watchPath,
            cron: opts.cron || null,
          });
        } catch (err) {
          error("manager", err.message);
          exitWith(
            err.code === "EALREADY" ? EXIT.ALREADY_RUNNING : EXIT.ERROR
          );
        }
      }

      const processOptions = {
        maxRetries,
        unlimited,
        enableMemoryMeter: !opts.cluster,
        scope: "manager",
        retryDelayMs,
        scriptArgs,
        logFile: processLogFile,
        cwd: opts.cwd || null,
        env: childEnv,
        interpreter: opts.interpreter || null,
        maxMemoryMb: opts.maxMemory || null,
        logDateFormat: opts.logDateFormat || null,
        maxLogSizeBytes,
        onSpawn: ({ childPid, restarts, unstable_restarts }) => {
          syncRegistry({
            status: STATUS.ONLINE,
            childPid,
            restarts,
            unstable_restarts,
          });
        },
        onRestart: ({ restarts, unstable_restarts, reason }) => {
          syncRegistry({
            restarts,
            unstable_restarts,
            lastRestartReason: reason,
          });
        },
        onExitStatus: ({ status, restarts, unstable_restarts }) => {
          syncRegistry({
            status,
            restarts,
            unstable_restarts,
            childPid: null,
          });
        },
      };

      if (opts.cluster) {
        if (cluster.isPrimary) {
          const numWorkers =
            opts.cpus != null && !Number.isNaN(opts.cpus)
              ? opts.cpus
              : availableCPUs;

          if (!Number.isInteger(numWorkers) || numWorkers < 1) {
            error("master", `--cpus must be an integer >= 1 (got: ${opts.cpus})`);
            syncRegistry({ status: STATUS.ERRORED });
            exitWith(EXIT.USAGE);
          }

          cluster.setupPrimary({ silent: true });

          let shuttingDown = false;
          let workerRestarts = 0;
          const restartTimers = new Set();

          const livingWorkers = () => Object.keys(cluster.workers || {}).length;
          const retryLabel = () =>
            unlimited
              ? `unlimited delay=${retryDelayMs}ms`
              : `${DEFAULT_MAX_RETRIES} max`;

          log(
            "master",
            `name=${name} pid=${process.pid} starting ${numWorkers} workers (cpus=${availableCPUs}, restarts=${retryLabel()})`
          );

          const attachWorker = (worker) => {
            const pid = worker.process.pid;
            const scope = `worker#${worker.id}:pid=${pid}`;
            pipeWorkerOutput(worker, scope);
            return scope;
          };

          for (let i = 0; i < numWorkers; i++) {
            attachWorker(cluster.fork());
          }

          cluster.on("online", (worker) => {
            const scope =
              worker.__logScope ||
              `worker#${worker.id}:pid=${worker.process.pid}`;
            log("master", `${scope} online`);
            syncRegistry({ status: STATUS.ONLINE });
          });

          const forkReplacement = (attemptLabel, workerMeta) => {
            log(
              "master",
              `worker#${workerMeta.id} pid=${workerMeta.pid} crash (${workerMeta.reason}) — restart ${attemptLabel} | alive=${livingWorkers()}`
            );
            attachWorker(cluster.fork());
          };

          cluster.on("exit", (worker, code, signal) => {
            if (shuttingDown) {
              return;
            }

            const reason = signal ? `signal=${signal}` : `code=${code}`;
            const crashed = signal != null || code !== 0;
            const workerMeta = {
              id: worker.id,
              pid: worker.process.pid,
              reason,
            };

            if (!crashed) {
              log(
                "master",
                `worker#${worker.id} pid=${worker.process.pid} clean exit (${reason}) — not replacing | alive=${livingWorkers()}`
              );
              if (livingWorkers() === 0 && restartTimers.size === 0) {
                log("master", "no workers left — exiting");
                syncRegistry({ status: STATUS.STOPPED, childPid: null });
                exitWith(EXIT.OK);
              }
              return;
            }

            if (unlimited || workerRestarts < maxRetries) {
              workerRestarts++;
              syncRegistry({ restarts: workerRestarts });
              const attempt = unlimited
                ? `${workerRestarts}`
                : `${workerRestarts}/${maxRetries}`;

              if (unlimited && retryDelayMs > 0) {
                log(
                  "master",
                  `worker#${worker.id} pid=${worker.process.pid} crash (${reason}) — waiting ${retryDelayMs}ms before restart ${attempt}`
                );
                const timer = setTimeout(() => {
                  restartTimers.delete(timer);
                  if (!shuttingDown) {
                    forkReplacement(attempt, workerMeta);
                  }
                }, retryDelayMs);
                restartTimers.add(timer);
              } else {
                forkReplacement(attempt, workerMeta);
              }
            } else {
              error(
                "master",
                `worker#${worker.id} pid=${worker.process.pid} crash (${reason}) — max restarts reached, not replacing | alive=${livingWorkers()}`
              );
              if (livingWorkers() === 0 && restartTimers.size === 0) {
                error("master", "no workers left — exiting");
                syncRegistry({ status: STATUS.ERRORED, childPid: null });
                exitWith(EXIT.ERROR);
              }
            }
          });

          let shutdownStarted = false;
          const shutdown = () => {
            if (shutdownStarted) {
              return;
            }
            shutdownStarted = true;
            shuttingDown = true;
            for (const timer of restartTimers) {
              clearTimeout(timer);
            }
            restartTimers.clear();
            log("master", "shutting down workers");

            const workers = Object.values(cluster.workers || {});
            for (const worker of workers) {
              try {
                worker.kill("SIGTERM");
              } catch {
                // already gone
              }
            }

            const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
            const finish = (forced) => {
              if (forced) {
                log("master", "workers still alive — SIGKILL");
                for (const id in cluster.workers) {
                  try {
                    cluster.workers[id].process.kill("SIGKILL");
                  } catch {
                    // already gone
                  }
                }
              }
              syncRegistry({ status: STATUS.STOPPED, childPid: null });
              exitWith(EXIT.OK);
            };

            const poll = () => {
              if (livingWorkers() === 0) {
                finish(false);
                return;
              }
              if (Date.now() >= deadline) {
                finish(true);
                return;
              }
              setTimeout(poll, 50);
            };
            poll();
          };
          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);
        } else {
          const scope = `worker#${cluster.worker.id}:pid=${process.pid}`;
          const controller = startProcess(script, {
            ...processOptions,
            maxRetries: 0,
            unlimited: false,
            enableMemoryMeter: false,
            scope,
            onSpawn: null,
            onRestart: null,
            onExitStatus: null,
          });
          setupGracefulShutdown(controller);
        }
      } else {
        log(
          "manager",
          `name=${name} pid=${process.pid} script=${script} retries=${maxRetries} unlimited=${unlimited}` +
            (unlimited ? ` delay=${retryDelayMs}ms` : "") +
            (opts.maxMemory ? ` max-memory=${opts.maxMemory}MB` : "") +
            (opts.interpreter ? ` interpreter=${opts.interpreter}` : "") +
            (watchPath ? ` watch=${watchPath}` : "") +
            (opts.cron ? ` cron="${opts.cron}"` : "") +
            (scriptArgs.length ? ` args=${JSON.stringify(scriptArgs)}` : "")
        );

        const controller = startProcess(script, processOptions);

        let stopWatch = null;
        let stopCron = null;

        if (watchPath) {
          try {
            stopWatch = startWatch(watchPath, () => {
              controller.requestRestart("watch");
            });
            log("manager", `watching ${watchPath}`);
          } catch (err) {
            error("manager", err.message);
            syncRegistry({ status: STATUS.ERRORED });
            exitWith(EXIT.ERROR);
          }
        }

        if (opts.cron) {
          try {
            stopCron = startCron(opts.cron, () => {
              controller.requestRestart("cron");
            });
            log("manager", `cron "${opts.cron}"`);
          } catch (err) {
            error("manager", err.message);
            syncRegistry({ status: STATUS.ERRORED });
            exitWith(EXIT.USAGE);
          }
        }

        setupGracefulShutdown(controller, () => {
          if (stopWatch) stopWatch();
          if (stopCron) stopCron();
          syncRegistry({ status: STATUS.STOPPED, childPid: null });
        });
      }
    });

  program
    .command("stop [name]")
    .description("Stop a managed process by name (or all)")
    .option("--all", "Stop every managed process")
    .option("--delete", "Remove registry entry after stop")
    .action((name, opts) => {
      if (opts.all || !name) {
        const records = listRecords().filter(
          (r) => r.status === STATUS.ONLINE && isAlive(r.pid)
        );
        if (!name && !opts.all) {
          if (records.length === 0) {
            error("manager", "no running processes");
            exitWith(EXIT.NOT_FOUND);
          }
          if (records.length > 1) {
            error(
              "manager",
              `multiple processes running; specify a name or use --all: ${records
                .map((r) => r.name)
                .join(", ")}`
            );
            exitWith(EXIT.USAGE);
          }
          name = records[0].name;
        }

        if (opts.all) {
          if (records.length === 0) {
            log("manager", "no running processes");
            return;
          }
          let failed = false;
          for (const record of records) {
            const result = stopProcess(record.name, { remove: opts.delete });
            if (result.ok) {
              log(
                "manager",
                `stopped ${record.name} (pid=${result.pid}${result.forced ? ", forced" : ""})`
              );
            } else {
              error("manager", `could not stop ${record.name}: ${result.reason}`);
              failed = true;
            }
          }
          if (failed) {
            exitWith(EXIT.ERROR);
          }
          return;
        }
      }

      const result = stopProcess(name, { remove: opts.delete });
      if (!result.ok) {
        error(
          "manager",
          result.reason === "not_found"
            ? `no process named "${name}"`
            : `could not stop "${name}": ${result.reason}`
        );
        exitWith(
          result.reason === "not_found" ? EXIT.NOT_FOUND : EXIT.ERROR
        );
      }
      log(
        "manager",
        `stopped ${name} (pid=${result.pid}${result.forced ? ", forced" : ""})`
      );
    });

  program
    .command("delete [name]")
    .description("Remove a stopped/errored process from the registry")
    .option("--all", "Delete every non-running registry entry")
    .action((name, opts) => {
      if (opts.all) {
        const records = listRecords();
        let n = 0;
        for (const record of records) {
          const result = deleteProcess(record.name);
          if (result.ok) {
            log("manager", `deleted ${record.name}`);
            n++;
          }
        }
        if (n === 0) {
          log("manager", "nothing to delete");
        }
        return;
      }
      if (!name) {
        error("manager", "usage: delete <name> (or --all)");
        exitWith(EXIT.USAGE);
      }
      const result = deleteProcess(name);
      if (!result.ok) {
        error(
          "manager",
          result.reason === "still_running"
            ? `"${name}" is still online — stop it first`
            : `no process named "${name}"`
        );
        exitWith(
          result.reason === "still_running" ? EXIT.ERROR : EXIT.NOT_FOUND
        );
      }
      log("manager", `deleted ${name}`);
    });

  program
    .command("list")
    .description("List managed processes")
    .action(() => {
      const records = listRecords();
      if (records.length === 0) {
        log("manager", "no processes");
        return;
      }

      const rows = records.map((record, index) => {
        const alive = isAlive(record.pid);
        const status =
          record.status || (alive ? STATUS.ONLINE : STATUS.ERRORED);
        const memPid = record.childPid || (alive ? record.pid : null);
        const rss = status === STATUS.ONLINE ? readRssBytes(memPid) : null;
        return {
          id: index,
          name: record.name,
          mode: modeLabel(record),
          pid: record.pid,
          status,
          restarts: record.restarts ?? 0,
          unstable: record.unstable_restarts ?? 0,
          uptime:
            status === STATUS.ONLINE && alive
              ? formatUptime(record.startedAt)
              : "0",
          mem: rss != null ? formatBytes(rss) : "0b",
        };
      });

      printTable(
        [
          { key: "id", label: "id" },
          { key: "name", label: "name" },
          { key: "mode", label: "mode" },
          { key: "pid", label: "pid" },
          { key: "status", label: "status" },
          { key: "restarts", label: "↺" },
          { key: "unstable", label: "unstable" },
          { key: "uptime", label: "uptime" },
          { key: "mem", label: "mem" },
        ],
        rows
      );
    });

  program
    .command("logs [name]")
    .description("Show logs for a managed process")
    .option("-f, --follow", "Follow log output")
    .option("-n, --lines <n>", "Show last n lines", (v) => parseInt(v, 10), 50)
    .action((name, opts) => {
      if (!name) {
        const records = listRecords().filter(
          (r) => r.status === STATUS.ONLINE && isAlive(r.pid)
        );
        if (records.length === 0) {
          error("manager", "no running processes; pass a name: logs <name>");
          exitWith(EXIT.NOT_FOUND);
        }
        if (records.length > 1) {
          error(
            "manager",
            `multiple processes; specify a name: ${records.map((r) => r.name).join(", ")}`
          );
          exitWith(EXIT.USAGE);
        }
        name = records[0].name;
      }

      const record = getRecord(name);
      const file = record ? record.logFile : logPath(name);

      if (!fs.existsSync(file)) {
        error("manager", `no log file for "${name}" (${file})`);
        exitWith(EXIT.NOT_FOUND);
      }

      const lines = Math.max(0, opts.lines || 50);
      const content = fs.readFileSync(file, "utf8");
      const allLines = content.split(/\r?\n/);
      if (allLines.length && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      const slice = lines > 0 ? allLines.slice(-lines) : allLines;
      for (const line of slice) {
        console.log(line);
      }

      if (!opts.follow) {
        return;
      }

      let offset = fs.statSync(file).size;
      const printNew = () => {
        if (!fs.existsSync(file)) {
          return;
        }
        const stat = fs.statSync(file);
        if (stat.size < offset) {
          offset = 0;
        }
        if (stat.size === offset) {
          return;
        }
        const fd = fs.openSync(file, "r");
        const length = stat.size - offset;
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, offset);
        fs.closeSync(fd);
        offset = stat.size;
        process.stdout.write(buffer.toString("utf8"));
      };

      fs.watchFile(file, { interval: 200 }, printNew);
      process.on("SIGINT", () => {
        fs.unwatchFile(file);
        exitWith(EXIT.OK);
      });
    });

  program.parse(process.argv);
} catch (err) {
  if (err.code === "commander.helpDisplayed" || err.code === "commander.versionDisplayed") {
    exitWith(EXIT.OK);
  }
  if (err.code === "commander.missingArgument" || err.code === "commander.unknownOption" || err.code === "commander.invalidArgument" || err.code === "commander.missingMandatoryOptionValue") {
    exitWith(EXIT.USAGE);
  }
  if (err.code && String(err.code).startsWith("commander.")) {
    exitWith(EXIT.USAGE);
  }
  error("manager", err.message || String(err));
  exitWith(EXIT.ERROR);
}
