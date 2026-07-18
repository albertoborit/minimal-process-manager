const fs = require("fs");
const path = require("path");

/**
 * Watch a file or directory (non-recursive for dirs) and call onChange (debounced).
 * Returns stop().
 */
const startWatch = (target, onChange, { debounceMs = 300 } = {}) => {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--watch path not found: ${resolved}`);
  }

  let timer = null;
  const fire = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };

  let watcher;
  try {
    watcher = fs.watch(resolved, { persistent: true }, fire);
  } catch (err) {
    throw new Error(`cannot watch ${resolved}: ${err.message}`);
  }

  watcher.on("error", () => {
    // ignore transient watch errors (e.g. file replaced)
  });

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      watcher.close();
    } catch {
      // already closed
    }
  };
};

module.exports = { startWatch };
