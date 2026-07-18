/**
 * Minimal 5-field cron matcher: minute hour day-of-month month day-of-week.
 * Supports *, lists (1,2), ranges (1-5), and steps (* /5, 1-10/2).
 * day-of-week: 0–7 (0 and 7 = Sunday).
 */

const parseField = (field, min, max) => {
  const values = new Set();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart != null ? parseInt(stepPart, 10) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`invalid cron step in "${field}"`);
    }

    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      start = parseInt(a, 10);
      end = parseInt(b, 10);
    } else {
      start = parseInt(rangePart, 10);
      end = start;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new Error(`invalid cron field "${field}" (expected ${min}-${max})`);
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return values;
};

const parseCron = (expression) => {
  const parts = String(expression).trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `--cron expects 5 fields "min hour dom month dow" (got: ${expression})`
    );
  }

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 7),
  };
};

const matchesCron = (parsed, date = new Date()) => {
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay(); // 0=Sun

  if (!parsed.minute.has(minute)) return false;
  if (!parsed.hour.has(hour)) return false;
  if (!parsed.month.has(month)) return false;
  if (!parsed.dayOfMonth.has(dayOfMonth)) return false;

  // 0 and 7 both mean Sunday
  const dowOk =
    parsed.dayOfWeek.has(dayOfWeek) ||
    (dayOfWeek === 0 && parsed.dayOfWeek.has(7));
  return dowOk;
};

/**
 * Call onFire when the cron expression matches a new minute.
 * Returns a stop() function.
 */
const startCron = (expression, onFire) => {
  const parsed = parseCron(expression);
  let lastKey = null;

  const tick = () => {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (key === lastKey) {
      return;
    }
    if (matchesCron(parsed, now)) {
      lastKey = key;
      onFire(now);
    }
  };

  const intervalId = setInterval(tick, 1000);
  tick();

  return () => clearInterval(intervalId);
};

module.exports = { parseCron, matchesCron, startCron };
