const fs = require("fs");
const path = require("path");

const EXT_TO_COMMAND = {
  ".js": "node",
  ".cjs": "node",
  ".mjs": "node",
  ".ts": "node",
  ".py": "python3",
  ".rb": "ruby",
  ".pl": "perl",
  ".sh": "bash",
  ".bash": "bash",
};

const INTERPRETERS = {
  node: "node",
  python: "python3",
  python3: "python3",
  bun: "bun",
  ruby: "ruby",
  perl: "perl",
  bash: "bash",
  sh: "sh",
};

const readShebangLine = (scriptPath) => {
  const fd = fs.openSync(scriptPath, "r");
  try {
    const buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, 512, 0);
    const text = buf.slice(0, n).toString("utf8");
    if (!text.startsWith("#!")) {
      return null;
    }
    const line = text.split(/\r?\n/, 1)[0].slice(2).trim();
    return line || null;
  } finally {
    fs.closeSync(fd);
  }
};

const parseShebang = (line) => {
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (path.basename(parts[0]) === "env") {
    if (parts.length < 2) {
      return null;
    }
    return { command: parts[1], prefixArgs: parts.slice(2) };
  }
  return { command: parts[0], prefixArgs: parts.slice(1) };
};

const isExecutable = (scriptPath) => {
  try {
    fs.accessSync(scriptPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const resolveInterpreter = (name) => {
  const key = String(name).toLowerCase();
  const command = INTERPRETERS[key] || key;
  return command;
};

/**
 * Decide how to spawn a script.
 * --interpreter overrides shebang/extension.
 * Returns { command, args, via }.
 */
const resolveRuntime = (scriptPath, { interpreter } = {}) => {
  if (interpreter) {
    const command = resolveInterpreter(interpreter);
    return {
      command,
      args: [scriptPath],
      via: "interpreter",
    };
  }

  const shebang = readShebangLine(scriptPath);
  if (shebang) {
    const parsed = parseShebang(shebang);
    if (parsed) {
      return {
        command: parsed.command,
        args: [...parsed.prefixArgs, scriptPath],
        via: "shebang",
      };
    }
  }

  const ext = path.extname(scriptPath).toLowerCase();
  const command = EXT_TO_COMMAND[ext];
  if (command) {
    return {
      command,
      args: [scriptPath],
      via: "extension",
    };
  }

  if (isExecutable(scriptPath)) {
    return {
      command: scriptPath,
      args: [],
      via: "executable",
    };
  }

  const err = new Error(
    `cannot determine how to run "${scriptPath}": no shebang, unknown extension "${
      ext || "(none)"
    }", and not executable (try --interpreter node|python|bun)`
  );
  err.code = "ERUNTIME";
  throw err;
};

module.exports = {
  resolveRuntime,
  EXT_TO_COMMAND,
  INTERPRETERS,
  resolveInterpreter,
};
