const formatBytes = (bytes, decimals = 2) => {
  if (bytes == null || Number.isNaN(bytes)) {
    return "-";
  }
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + sizes[i];
};

const formatPercentage = (value) => {
  return value.toString() + " %";
};

/** Human uptime from an ISO date or ms timestamp. */
const formatUptime = (startedAt) => {
  if (!startedAt) {
    return "-";
  }
  const start = typeof startedAt === "number" ? startedAt : Date.parse(startedAt);
  if (Number.isNaN(start)) {
    return "-";
  }
  let sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const days = Math.floor(sec / 86400);
  sec %= 86400;
  const hours = Math.floor(sec / 3600);
  sec %= 3600;
  const mins = Math.floor(sec / 60);
  sec %= 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${sec}s`;
  }
  return `${sec}s`;
};

/**
 * PM2-like log date format. Tokens: YYYY MM DD HH mm ss SSS
 * Example: "YYYY-MM-DD HH:mm:ss"
 */
const formatLogDate = (format, date = new Date()) => {
  if (!format) {
    return "";
  }
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const map = {
    YYYY: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    SSS: pad(date.getMilliseconds(), 3),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss|SSS/g, (t) => map[t]);
};

/** Render a simple aligned table (header + rows of objects keyed by columns). */
const printTable = (columns, rows) => {
  const widths = columns.map((col) => {
    let w = col.label.length;
    for (const row of rows) {
      const cell = String(row[col.key] ?? "");
      if (cell.length > w) {
        w = cell.length;
      }
    }
    return Math.min(w, col.maxWidth || 40);
  });

  const fmt = (cells) =>
    cells
      .map((cell, i) => {
        const s = String(cell ?? "");
        const truncated =
          s.length > widths[i] ? s.slice(0, Math.max(1, widths[i] - 1)) + "…" : s;
        return truncated.padEnd(widths[i]);
      })
      .join(" │ ");

  console.log(fmt(columns.map((c) => c.label)));
  console.log(widths.map((w) => "─".repeat(w)).join("─┼─"));
  for (const row of rows) {
    console.log(fmt(columns.map((c) => row[c.key])));
  }
};

module.exports = {
  formatBytes,
  formatPercentage,
  formatUptime,
  formatLogDate,
  printTable,
};
