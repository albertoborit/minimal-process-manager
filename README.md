# Minimalist Resources Manager for Node

## Description

A simple and lightweight process manager for Node.js applications. Start, manage, and monitor Node.js processes with cluster mode for multiple CPU cores and optional memory usage logging.

## Installation

```bash
npm install -g minimal-process-manager
```

## Usage

Start a script (default: up to 5 restarts on crash):

```bash
minimal-process-manager start script.js
```

Run in cluster mode (one worker per CPU):

```bash
minimal-process-manager start example.js --cluster
```

Run with unlimited restarts on crash:

```bash
minimal-process-manager start example.js --unlimited
```

## Options

| Option       | Description                    |
| ------------ | ------------------------------ |
| `--cluster`  | Run one process per CPU core   |
| `--unlimited`| Restart on crash indefinitely  |

## Behavior

- **Graceful shutdown**: SIGINT (Ctrl+C) and SIGTERM stop the managed process and exit cleanly.
- **Memory logging**: The manager prints RSS, heap usage, and external memory every second. For high-heap GC hints, run Node with `--expose-gc` (e.g. `node --expose-gc node_modules/.bin/minimal-process-manager start app.js`).

