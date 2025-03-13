const { formatBytes, formatPercentage } = require("../utils/formaters");

const memoryUsageManager = () => {
    const updateMemoryUsage = () => {
        const memoryUsage = process.memoryUsage();
        const totalHeap = memoryUsage.heapTotal;
        const usedHeap = memoryUsage.heapUsed;
        const heapUsagePercentage = ((usedHeap / totalHeap) * 100).toFixed(2);
        if (heapUsagePercentage > 80 && global.gc) {
            console.log("High heap usage detected. Forcing GC...");
            global.gc();
        }
        return [
            '\x1b[0;0H',
            '+----------------+----------------+',
            '| Metric         | Value          |',
            '+----------------+----------------+',
            `| RSS            | ${formatBytes(memoryUsage.rss).padEnd(14)} |`,
            `| Heap Usage     | ${formatPercentage(heapUsagePercentage).padEnd(14)} |`,
            `| Heap Used      | ${formatBytes(memoryUsage.heapUsed).padEnd(14)} |`,
            `| External       | ${formatBytes(memoryUsage.external).padEnd(14)} |`,
            '+----------------+----------------+'
        ].join('\n');
    };

    setInterval(() => {
        process.stdout.write(updateMemoryUsage() + '\n');
    }, 1000);
};

module.exports = { memoryUsageManager };
