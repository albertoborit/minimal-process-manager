const { formatBytes, formatPercentage } = require("../utils/formatters");

const memoryUsageManager = () => {
  const updateMemoryUsage = () => {
    const memoryUsage = process.memoryUsage();
    const totalHeap = memoryUsage.heapTotal;
    const usedHeap = memoryUsage.heapUsed;
    const heapUsagePercentage = ((usedHeap / totalHeap) * 100).toFixed(2);
    if (heapUsagePercentage > 80 && typeof global.gc === "function") {
      process.stderr.write("High heap usage detected. Forcing GC... (run with --expose-gc to enable)\n");
      global.gc();
    }
    return `[memory] RSS: ${formatBytes(memoryUsage.rss)} | Heap: ${formatPercentage(heapUsagePercentage)} | External: ${formatBytes(memoryUsage.external)}`;
  };

  const intervalId = setInterval(() => {
    const line = updateMemoryUsage();
    process.stderr.write("\r" + line + " ".repeat(Math.max(0, 80 - line.length)) + "\r");
  }, 1000);

  return () => {
    clearInterval(intervalId);
    process.stderr.write("\n"); // newline so shell prompt stays on its own line
  };
};

module.exports = { memoryUsageManager };
