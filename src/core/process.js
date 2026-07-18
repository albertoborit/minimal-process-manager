const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { log, error, pipeChildOutput, createLogStream } = require("../utils/logger");
const { resolveRuntime } = require("./runtime");
const { memoryUsageManager } = require("./memoryUsageManager");
const { EXIT } = require("./exitCodes");

const SHUTDOWN_TIMEOUT_MS = 5000;
/** Restarts within this window count as unstable (PM2-like). */
const MIN_UPTIME_MS = 15_000;

/**
 * @param {string} script
 * @param {object} options
 */
const startProcess = (script, options = {}) => {
  const {
    maxRetries = 5,
    unlimited = false,
    enableMemoryMeter = false,
    scope = "manager",
    retryDelayMs = 0,
    scriptArgs = [],
    logFile = null,
    cwd = null,
    env = null,
    interpreter = null,
    maxMemoryMb = null,
    logDateFormat = null,
    maxLogSizeBytes = 0,
    onSpawn = null,
    onRestart = null,
    onExitStatus = null,
  } = options;

  const scriptPath = path.resolve(script);

  if (!fs.existsSync(scriptPath)) {
    error(scope, `script not found: ${scriptPath}`);
    process.exit(EXIT.NOT_FOUND);
  }

  let runtime;
  try {
    runtime = resolveRuntime(scriptPath, { interpreter });
  } catch (err) {
    error(scope, err.message);
    process.exit(EXIT.RUNTIME);
  }

  let retries = 0;
  let unstableRestarts = 0;
  let currentProcess = null;
  let stopMemoryManager = null;
  let stopped = false;
  let retryTimer = null;
  let spawnedAt = 0;
  let restartingFor = null; // 'crash' | 'memory' | 'watch' | 'cron' | null
  const logStream = createLogStream(logFile, { maxLogSizeBytes });

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const closeLogStream = () => {
    if (logStream) {
      logStream.end();
    }
  };

  const notifyStatus = (status, extra = {}) => {
    if (typeof onExitStatus === "function") {
      onExitStatus({
        status,
        restarts: retries,
        unstable_restarts: unstableRestarts,
        ...extra,
      });
    }
  };

  const scheduleLaunch = () => {
    if (retryDelayMs > 0) {
      log(scope, `waiting ${retryDelayMs}ms before next attempt`);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!stopped) {
          launch();
        }
      }, retryDelayMs);
      return;
    }
    launch();
  };

  const bumpRestart = (reason) => {
    retries++;
    const uptime = spawnedAt ? Date.now() - spawnedAt : 0;
    if (uptime > 0 && uptime < MIN_UPTIME_MS) {
      unstableRestarts++;
    } else if (uptime >= MIN_UPTIME_MS) {
      unstableRestarts = 0;
    }

    if (typeof onRestart === "function") {
      onRestart({
        reason,
        restarts: retries,
        unstable_restarts: unstableRestarts,
        uptimeMs: uptime,
      });
    }

    return unlimited ? `${retries}` : `${retries}/${maxRetries}`;
  };

  const killChild = (signal = "SIGTERM") => {
    if (!currentProcess) {
      return;
    }
    try {
      currentProcess.kill(signal);
    } catch {
      // already gone
    }
  };

  /**
   * Externally request a restart (watch / cron). Counts as a restart.
   */
  const requestRestart = (reason = "watch") => {
    if (stopped || !currentProcess) {
      return;
    }
    restartingFor = reason;
    const attempt = bumpRestart(reason);
    log(scope, `${reason} — restart ${attempt}`);
    killChild("SIGTERM");
  };

  const launch = () => {
    restartingFor = null;
    const spawnOpts = {
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (cwd) {
      spawnOpts.cwd = path.resolve(cwd);
    }
    if (env) {
      spawnOpts.env = env;
    }

    currentProcess = spawn(
      runtime.command,
      [...runtime.args, ...scriptArgs],
      spawnOpts
    );
    spawnedAt = Date.now();

    const childScope = `${scope}:child:${currentProcess.pid}`;
    pipeChildOutput(currentProcess, childScope, logStream, { logDateFormat });
    log(
      scope,
      `spawned ${runtime.command} pid=${currentProcess.pid} via=${runtime.via}` +
        (cwd ? ` cwd=${path.resolve(cwd)}` : "")
    );

    if (typeof onSpawn === "function") {
      onSpawn({
        childPid: currentProcess.pid,
        restarts: retries,
        unstable_restarts: unstableRestarts,
      });
    }

    if (enableMemoryMeter || maxMemoryMb != null) {
      stopMemoryManager = memoryUsageManager(
        () => (currentProcess ? currentProcess.pid : null),
        {
          maxMemoryMb: maxMemoryMb || undefined,
          silent: !enableMemoryMeter,
          onMaxMemory: () => {
            if (stopped || !currentProcess) {
              return;
            }
            log(
              scope,
              `max-memory exceeded (rss>${maxMemoryMb}MB) — killing pid=${currentProcess.pid} for restart`
            );
            restartingFor = "memory";
            bumpRestart("memory");
            try {
              currentProcess.kill("SIGKILL");
            } catch {
              // gone
            }
          },
        }
      );
    }

    currentProcess.on("error", (err) => {
      error(scope, `spawn error: ${err.message}`);
    });

    currentProcess.on("exit", (code, signal) => {
      if (stopMemoryManager) {
        stopMemoryManager();
        stopMemoryManager = null;
      }

      const reason = signal ? `signal=${signal}` : `code=${code}`;
      log(scope, `child pid=${currentProcess.pid} exited (${reason})`);
      currentProcess = null;

      if (stopped) {
        closeLogStream();
        return;
      }

      // Planned restart from watch/cron/memory: already counted; just relaunch.
      if (restartingFor === "watch" || restartingFor === "cron") {
        restartingFor = null;
        scheduleLaunch();
        return;
      }

      if (restartingFor === "memory") {
        restartingFor = null;
        if (!unlimited && retries > maxRetries) {
          error(scope, "max retries reached after max-memory — exiting");
          notifyStatus("errored");
          closeLogStream();
          process.exit(EXIT.ERROR);
          return;
        }
        const attempt = unlimited ? `${retries}` : `${retries}/${maxRetries}`;
        log(scope, `memory — relaunch ${attempt}`);
        scheduleLaunch();
        return;
      }

      const crashed = signal != null || code !== 0;
      if (!crashed) {
        log(scope, "clean exit — not restarting");
        notifyStatus("stopped");
        closeLogStream();
        process.exit(EXIT.OK);
        return;
      }

      if (unlimited || retries < maxRetries) {
        const attempt = bumpRestart("crash");
        log(scope, `crash — restart ${attempt}`);
        scheduleLaunch();
      } else {
        if (retries > 0) {
          error(scope, "max retries reached — exiting");
        }
        notifyStatus("errored");
        closeLogStream();
        process.exit(code !== 0 && code != null ? code : EXIT.ERROR);
      }
    });

    return currentProcess;
  };

  launch();

  return {
    requestRestart,
    getChildPid: () => (currentProcess ? currentProcess.pid : null),
    /**
     * SIGTERM the child, wait up to timeoutMs, then SIGKILL if still alive.
     */
    stop(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
      stopped = true;
      clearRetryTimer();

      if (stopMemoryManager) {
        stopMemoryManager();
        stopMemoryManager = null;
      }

      if (!currentProcess) {
        closeLogStream();
        notifyStatus("stopped");
        return Promise.resolve({ forced: false });
      }

      const child = currentProcess;
      const pid = child.pid;

      return new Promise((resolve) => {
        let settled = false;
        let forced = false;

        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(killTimer);
          closeLogStream();
          notifyStatus("stopped");
          resolve({ forced, pid });
        };

        child.once("exit", finish);

        try {
          child.kill("SIGTERM");
          log(scope, `sent SIGTERM to child pid=${pid}`);
        } catch {
          finish();
          return;
        }

        const killTimer = setTimeout(() => {
          if (!currentProcess || currentProcess.pid !== pid) {
            return;
          }
          forced = true;
          log(
            scope,
            `child pid=${pid} still alive after ${timeoutMs}ms — sending SIGKILL`
          );
          try {
            child.kill("SIGKILL");
          } catch {
            finish();
          }
        }, timeoutMs);
      });
    },
  };
};

module.exports = { startProcess, SHUTDOWN_TIMEOUT_MS, MIN_UPTIME_MS };
