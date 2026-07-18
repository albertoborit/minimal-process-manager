const fs = require("fs");
const { formatBytes, formatPercentage } = require("../utils/formatters");

const readProcStatus = (pid) => {
  const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
  const getKb = (key) => {
    const match = status.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
    return match ? parseInt(match[1], 10) * 1024 : null;
  };
  return {
    rss: getKb("VmRSS"),
    size: getKb("VmSize"),
    peak: getKb("VmHWM"),
  };
};

/** Best-effort RSS in bytes for a pid (Linux /proc). Returns null if unavailable. */
const readRssBytes = (pid) => {
  if (!pid) {
    return null;
  }
  try {
    return readProcStatus(pid).rss;
  } catch {
    return null;
  }
};

/**
 * Poll child memory every 1s.
 * @param {() => number|null} getPid
 * @param {{ maxMemoryMb?: number, onMaxMemory?: (rss:number) => void, silent?: boolean }} [options]
 */
const memoryUsageManager = (getPid, options = {}) => {
  const maxBytes =
    options.maxMemoryMb != null && options.maxMemoryMb > 0
      ? options.maxMemoryMb * 1024 * 1024
      : null;
  let exceeded = false;

  const updateMemoryUsage = () => {
    const pid = typeof getPid === "function" ? getPid() : getPid;
    if (!pid) {
      return "[memory] waiting for child...";
    }

    try {
      const mem = readProcStatus(pid);
      if (mem.rss == null) {
        return `[memory] child=${pid} unavailable`;
      }

      if (maxBytes != null && mem.rss >= maxBytes && !exceeded) {
        exceeded = true;
        if (typeof options.onMaxMemory === "function") {
          options.onMaxMemory(mem.rss);
        }
      }

      const total = mem.size || mem.rss;
      const usagePercentage =
        total > 0 ? ((mem.rss / total) * 100).toFixed(2) : "0.00";
      const peak = mem.peak != null ? ` peak=${formatBytes(mem.peak)}` : "";
      const cap =
        maxBytes != null ? ` cap=${formatBytes(maxBytes)}` : "";
      return `[memory] child=${pid} rss=${formatBytes(mem.rss)} vsz=${formatBytes(total)} (${formatPercentage(usagePercentage)})${peak}${cap}`;
    } catch {
      return `[memory] child=${pid} gone`;
    }
  };

  const intervalId = setInterval(() => {
    const line = updateMemoryUsage();
    if (!options.silent) {
      process.stderr.write(
        "\r" + line + " ".repeat(Math.max(0, 80 - line.length)) + "\r"
      );
    }
  }, 1000);

  return () => {
    clearInterval(intervalId);
    if (!options.silent) {
      process.stderr.write("\n");
    }
  };
};

module.exports = { memoryUsageManager, readRssBytes, readProcStatus };
