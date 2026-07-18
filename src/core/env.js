const fs = require("fs");

/**
 * Parse a KEY=VALUE env file (ignores blank lines and # comments).
 * Values may be optionally quoted with " or '.
 */
const parseEnvFile = (filePath) => {
  const text = fs.readFileSync(filePath, "utf8");
  const env = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      throw new Error(`invalid env line in ${filePath}: ${rawLine}`);
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
};

/**
 * Parse CLI --env KEY=VALUE entries into an object.
 */
const parseEnvPairs = (pairs = []) => {
  const env = {};
  for (const pair of pairs) {
    const eq = String(pair).indexOf("=");
    if (eq <= 0) {
      throw new Error(`invalid --env value (expected KEY=VALUE): ${pair}`);
    }
    env[String(pair).slice(0, eq)] = String(pair).slice(eq + 1);
  }
  return env;
};

/**
 * Merge process.env ← env-file ← --env (later wins).
 */
const buildEnv = ({ envFile, envPairs } = {}) => {
  const env = { ...process.env };
  if (envFile) {
    Object.assign(env, parseEnvFile(envFile));
  }
  if (envPairs && envPairs.length) {
    Object.assign(env, parseEnvPairs(envPairs));
  }
  return env;
};

module.exports = { parseEnvFile, parseEnvPairs, buildEnv };
