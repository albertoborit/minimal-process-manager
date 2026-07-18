# Minimal Process Manager

A lightweight Node.js process manager: start a script, restart it on crash, optional cluster mode, pass args to the script, and control processes with `stop` / `list` / `logs`.

## Install

```bash
npm install -g minimal-process-manager
```

From this repo:

```bash
npm install
node src/index.js start <script>
```

## Quick start

```bash
# start (restarts on crash up to 5 times)
minimal-process-manager start script.js

# pass flags to the script (after --)
minimal-process-manager start app.js -- --port 3000

# name it, then manage from another terminal
minimal-process-manager start script.js --name api
minimal-process-manager list
minimal-process-manager logs api -f
minimal-process-manager stop api
```

## Commands

| Command | Description |
| ------- | ----------- |
| `start <script> [args...]` | Start and supervise a script |
| `stop [name]` | Stop by name, or the only running process if there is just one |
| `stop --all` | Stop every managed process |
| `stop --delete` | Also remove the registry entry after stop |
| `delete <name>` | Remove a stopped/errored registry entry |
| `delete --all` | Remove every non-running registry entry |
| `list` | PM2-style table: uptime, restarts, mem, mode, status |
| `logs [name]` | Show recent log lines (`-n <lines>`, default 50) |
| `logs [name] -f` | Follow log output |

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0` | Success |
| `1` | General error |
| `2` | Usage / invalid options |
| `3` | Not found (script, process, log, path) |
| `4` | Name already running |
| `5` | Cannot resolve runtime / interpreter |

## `start` options

Options belong to **`start`** (not the root program), so this works:

```bash
minimal-process-manager start script.js --cluster --cpus 2
```

| Option | Description |
| ------ | ----------- |
| `--cluster` | Run master + workers (default: one worker per CPU) |
| `--cpus <n>` | Number of workers (`>= 1`). Requires `--cluster` |
| `--unlimited <ms>` | Unlimited crash restarts; wait `<ms>` (`>= 0`) before each retry |
| `--name <name>` | Name for `stop` / `list` / `logs` (default: script basename) |
| `--cwd <path>` | Working directory for the child |
| `--env KEY=VALUE` | Set env var (repeatable; overrides `--env-file`) |
| `--env-file <path>` | Load `KEY=VALUE` lines from a file |
| `--interpreter <name>` | Force runtime: `node`, `python`, `bun`, … |
| `--max-memory <mb>` | Restart when child RSS exceeds `<mb>` MB (complements the memory meter) |
| `--watch [path]` | Restart on file change (default: the script path) |
| `--cron <expr>` | Restart on cron (`min hour dom month dow`, e.g. `0 * * * *`) |
| `--log-date-format <fmt>` | Prefix log lines (`YYYY-MM-DD HH:mm:ss`, tokens: `YYYY MM DD HH mm ss SSS`) |
| `--max-log-size <mb>` | Rotate the log to `.log.1` when it exceeds `<mb>` MB |

`--watch` / `--cron` are single-mode only (not with `--cluster`).

### Script arguments

Anything after `--` is forwarded to the script:

```bash
minimal-process-manager start app.js -- --port 3000 --env production
node src/index.js start examples/index.js -- --port 3001
```

### Single process

```bash
minimal-process-manager start script.js
minimal-process-manager start script.js --unlimited 1000
minimal-process-manager start script.js --unlimited 0   # retry immediately, still unlimited
minimal-process-manager start script.js --max-memory 200 --name api
minimal-process-manager start script.js --cwd ./app --env NODE_ENV=production
minimal-process-manager start script.py --interpreter python --name py
minimal-process-manager start script.js --watch --log-date-format "YYYY-MM-DD HH:mm:ss"
```

### Cluster mode

```bash
minimal-process-manager start script.js --cluster
minimal-process-manager start script.js --cluster --cpus 2
minimal-process-manager start script.js --cluster --cpus 2 --unlimited 2000
```

Workers are independent copies of your script. The manager does **not** share a listen port. Binding the same port in every worker (e.g. `:3000`) causes `EADDRINUSE`. Use different ports or an app built for Node cluster port sharing.

Worker stdout/stderr is collected by the master (silent workers) and printed with `[worker#N:pid=…]` prefixes so concurrent workers do not scramble an inherited TTY.

### Runtimes

Resolution order:

1. **`--interpreter`** — forced command (`node`, `python`/`python3`, `bun`, …)
2. **Shebang** — e.g. `#!/usr/bin/env python3`, `#!/bin/bash`
3. **Extension** — `.js` / `.cjs` / `.mjs` → `node`, `.py` → `python3`, `.sh` / `.bash` → `bash`, `.rb` → `ruby`, `.pl` → `perl`
4. **Executable** — run the file directly if the executable bit is set

Otherwise `start` exits with code `5`.

## Process registry

Each `start` registers a named process under `~/.minimal-process-manager/` (override with `MPM_HOME`):

| Path | Contents |
| ---- | -------- |
| `processes/<name>.json` | PID, script, args, mode, status, restarts, … |
| `logs/<name>.log` | Child stdout/stderr (prefixed; optional date + rotation) |

Registry fields used by `list`:

| Field | Description |
| ----- | ----------- |
| `status` | `online` / `stopped` / `errored` |
| `restarts` | Crash / memory / watch / cron restart count |
| `unstable_restarts` | Restarts where uptime was under 15s |
| `childPid` | Current child PID (for memory column) |
| `mode` | `fork` / `cluster` / `watch` / `cron` |

Stopped and errored entries stay in the registry until `delete` (or `stop --delete`). A new `start` with the same name replaces them.

```bash
minimal-process-manager start examples/index.js --name api
minimal-process-manager list
minimal-process-manager logs api
minimal-process-manager logs api -n 100
minimal-process-manager logs api -f
minimal-process-manager stop api
minimal-process-manager delete api
minimal-process-manager stop --all
```

## Behavior

| Topic | Detail |
| ----- | ------ |
| When it restarts | Crash (`code !== 0` or signal), `--max-memory`, `--watch`, or `--cron` |
| Clean `exit 0` | No restart; status → `stopped` |
| Single mode | Max **5** crash/memory restarts, or `--unlimited <ms>` with no cap |
| Unstable | Restart with uptime under 15s increments `unstable_restarts` |
| Cluster mode | Master replaces crashed workers up to **5** times total, or unlimited with `--unlimited <ms>` |
| Shutdown | `SIGINT` / `SIGTERM` or `stop`: SIGTERM → wait up to 5s → SIGKILL if still alive |
| Memory | Single mode: 1s RSS/VSZ meter from `/proc/<pid>/status` (Linux); `--max-memory` kills + restarts when over cap |
| Logs | Optional `--log-date-format`; optional `--max-log-size` rotation to `.log.1` |
| Log prefixes | `[manager]`, `[master]`, `[worker#N:pid=P]`, `[worker#N:pid=P:child:PID]` |

## How to test

Use a dedicated `MPM_HOME` so demos do not touch `~/.minimal-process-manager`. Run `start` in the background (`&`) or in a second terminal; use `list` / `logs` / `stop` from another shell with the same `MPM_HOME`.

```bash
cd /path/to/minimal-process-manager
export MPM_HOME=/tmp/mpm-demo
rm -rf "$MPM_HOME"
```

If a demo is left running: `node src/index.js stop --all`, or `pkill -f "src/index.js start"`.

### 1. Registry, `list`, and exit codes

```bash
# exit 2 = usage, 3 = not found
node src/index.js start; echo $?
node src/index.js start /no/such.js; echo $?

printf 'console.log("hi", process.env.FOO); setInterval(() => {}, 1e9)\n' > /tmp/mpm-hi.js
node src/index.js start /tmp/mpm-hi.js --name hi --env FOO=bar --cwd /tmp \
  --log-date-format "YYYY-MM-DD HH:mm:ss" &

sleep 1
node src/index.js list
node src/index.js logs hi -n 5
node src/index.js stop hi
node src/index.js list          # status=stopped
node src/index.js delete hi
```

Expect a PM2-style table (`id`, `name`, `mode`, `pid`, `status`, restarts, `unstable`, `uptime`, `mem`) and dated log lines.

### 2. `--max-memory` (restart when over the cap)

```bash
printf 'const a = []; while (a.length < 40) a.push(Buffer.alloc(1024 * 1024)); console.log("ok", a.length); setInterval(() => {}, 1e9)\n' > /tmp/mpm-mem.js
node src/index.js start /tmp/mpm-mem.js --name mem --max-memory 20 --unlimited 500 &

sleep 3
node src/index.js list          # restart count > 0
cat "$MPM_HOME/processes/mem.json"   # lastRestartReason: "memory"
node src/index.js stop mem --delete
```

### 3. `--watch` (restart on file change)

```bash
printf 'console.log("v1"); setInterval(() => {}, 1e9)\n' > /tmp/mpm-watch.js
node src/index.js start /tmp/mpm-watch.js --name w --watch /tmp/mpm-watch.js &

sleep 1
printf 'console.log("v2"); setInterval(() => {}, 1e9)\n' > /tmp/mpm-watch.js
sleep 1
node src/index.js logs w -n 10  # v1 then v2
node src/index.js list          # mode=watch, restarts >= 1
node src/index.js stop w --delete
```

### 4. `--env-file` and `--interpreter`

```bash
printf 'X=1\nY=2\n' > /tmp/mpm.env
printf 'console.log(process.env.X, process.env.Y); setInterval(() => {}, 1e9)\n' > /tmp/mpm-env.js
node src/index.js start /tmp/mpm-env.js --name env --env-file /tmp/mpm.env --env Y=9 --interpreter node &

sleep 1
node src/index.js logs env -n 3   # prints: 1 9
node src/index.js stop env --delete
```

### 5. Crash restarts and counters

```bash
node src/index.js start examples/crash.js --name crash --unlimited 300 &

sleep 2
node src/index.js list            # restarts and unstable climbing
cat "$MPM_HOME/processes/crash.json"
node src/index.js stop crash --delete
```

### 6. `--cron` (optional; waits for the next minute)

```bash
# restart every minute at second 0
node src/index.js start /tmp/mpm-hi.js --name cron --cron "* * * * *" &
# wait ~1 minute, then:
node src/index.js list
node src/index.js logs cron -n 20
node src/index.js stop cron --delete
```

### 7. Cluster mode

```bash
node src/index.js start examples/crash.js --cluster --cpus 2 --unlimited 1000 --name chello &

sleep 1
node src/index.js list            # mode=cluster/2
node src/index.js logs chello -n 20
node src/index.js stop chello --delete
```

### 8. HTTP demo (single mode only)

```bash
node src/index.js start examples/index.js --name api -- --port 3001 &
# other terminal (same MPM_HOME):
node examples/call.js
node src/index.js list
node src/index.js stop api --delete
```

Prefer `examples/crash.js` for cluster tests: `examples/index.js` binds one port and will conflict across workers.

## Examples (repo)

| File | Useful for | Notes |
| ---- | ---------- | ----- |
| `examples/crash.js` | Restarts, `--unlimited`, `--cluster`, `--cpus`, counters | Best file to validate manager behavior |
| `examples/index.js` | Single mode, memory meter, HTTP | Accepts `--port <n>` (default `3000`). **Avoid with `--cluster`** (port conflict) |
| `examples/call.js` | Optional traffic against the HTTP demo | Only useful while `examples/index.js` is running |

## npm scripts

| Script | Command |
| ------ | ------- |
| `npm run start:example` | single process, `examples/index.js` |
| `npm run start:cluster` | cluster + `examples/index.js` (expect port conflicts; prefer `crash.js` for cluster tests) |
| `npm run start:unlimited` | single process, `--unlimited 1000` |

## License

Apache-2.0
