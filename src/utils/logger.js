const fs = require("fs");
const path = require("path");
const { formatLogDate } = require("./formatters");

const log = (scope, message) => {
  console.log(`[${scope}] ${message}`);
};

const error = (scope, message) => {
  console.error(`[${scope}] ${message}`);
};

/**
 * Rotating append log stream.
 * When size would exceed maxLogSizeBytes, rename to .1 and open a fresh file.
 */
const createLogStream = (logFile, { maxLogSizeBytes = 0 } = {}) => {
  if (!logFile) {
    return null;
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  let fd = fs.openSync(logFile, "a");
  let size = fs.fstatSync(fd).size;
  let closed = false;

  const rotate = () => {
    fs.closeSync(fd);
    const rotated = `${logFile}.1`;
    try {
      if (fs.existsSync(rotated)) {
        fs.unlinkSync(rotated);
      }
      fs.renameSync(logFile, rotated);
    } catch {
      // best-effort; continue with a fresh file either way
    }
    fd = fs.openSync(logFile, "a");
    size = fs.fstatSync(fd).size;
  };

  return {
    write(chunk) {
      if (closed) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (maxLogSizeBytes > 0 && size + buf.length > maxLogSizeBytes && size > 0) {
        rotate();
      }
      fs.writeSync(fd, buf, 0, buf.length);
      size += buf.length;
    },
    end() {
      if (closed) {
        return;
      }
      closed = true;
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    },
  };
};

const writePrefixedLines = (
  stream,
  scope,
  chunk,
  logStream = null,
  { logDateFormat } = {}
) => {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const stamp = logDateFormat
      ? `${formatLogDate(logDateFormat)} `
      : "";
    const prefixed = `${stamp}[${scope}] ${line}\n`;
    stream.write(prefixed);
    if (logStream) {
      logStream.write(prefixed);
    }
  }
};

const pipeChildOutput = (child, scope, logStream = null, options = {}) => {
  if (child.stdout) {
    child.stdout.on("data", (chunk) =>
      writePrefixedLines(process.stdout, scope, chunk, logStream, options)
    );
  }
  if (child.stderr) {
    child.stderr.on("data", (chunk) =>
      writePrefixedLines(process.stderr, scope, chunk, logStream, options)
    );
  }
};

/** Forward a silent cluster worker's pipes; lines already prefixed by the worker stay as-is. */
const pipeWorkerOutput = (worker, scope) => {
  const proc = worker.process;
  if (proc.stdout) {
    proc.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
  }
  if (proc.stderr) {
    proc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }
  worker.__logScope = scope;
};

module.exports = {
  log,
  error,
  pipeChildOutput,
  pipeWorkerOutput,
  createLogStream,
};
