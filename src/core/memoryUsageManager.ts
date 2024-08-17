import {
    formatBytes,
    formatPercentage
  } from "../utils/formaters"

export const memoryUsageManager = () => {
    const updateMemoryUsage = () => {
        const memoryUsage = process.memoryUsage();
        const totalHeap = memoryUsage.heapTotal;
        const usedHeap = memoryUsage.heapUsed;
        const heapUsagePercentage = ((usedHeap / totalHeap) * 100).toFixed(2);
        const table = [
        '+----------------+----------------+',
        '| Metric         | Value          |',
        '+----------------+----------------+',
        `| RSS            | ${formatBytes(memoryUsage.rss).padEnd(14)} |`,
        `| Heap Usage     | ${formatPercentage(heapUsagePercentage).padEnd(14)} |`,
        `| Heap Used      | ${formatBytes(memoryUsage.heapUsed).padEnd(14)} |`,
        `| External       | ${formatBytes(memoryUsage.external).padEnd(14)} |`,
        '+----------------+----------------+'
        ].join('\n');
        
        return table;
    };
    setInterval(() => {
        process.stdout.write('\x1b[2J\x1b[0;0H');
        process.stdout.write(updateMemoryUsage() + '\n');
    }, 1000);
}

