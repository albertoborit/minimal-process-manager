#!/usr/bin/env node

const cluster = require("cluster");
const os = require("os");
const { Command } = require("commander");
const { memoryUsageManager } = require("./core/memoryUsageManager");
const { startProcess } = require("./core/process");

const program = new Command();
program.name("minimal-process-manager");

const setupGracefulShutdown = (controller) => {
  const shutdown = () => {
    if (controller && typeof controller.stop === "function") {
      controller.stop();
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

program
  .option("--cluster", "Run in cluster mode")
  .option("--unlimited", "Unlimited retries")
  .command("start <script>")
  .description("Start a new process")
  .action((script) => {
    const opts = program.opts();
    if (opts.cluster) {
      if (cluster.isPrimary) {
        const numCPUs = os.cpus().length;
        console.log(`Master ${process.pid} is running`);

        for (let i = 0; i < numCPUs; i++) {
          cluster.fork();
        }

        cluster.on("exit", (worker) => {
          console.log(`\nWorker ${worker.process.pid} died`);
          console.log("Starting a new worker");
          cluster.fork();
        });

        const shutdown = () => {
          for (const id in cluster.workers) {
            cluster.workers[id].kill();
          }
          process.exit(0);
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);
      } else {
        const controller = startProcess(script, 5, false, memoryUsageManager);
        setupGracefulShutdown(controller);
      }
    } else {
      const retries = opts.unlimited ? 0 : 5;
      const unlimited = Boolean(opts.unlimited);
      const controller = startProcess(script, retries, unlimited, memoryUsageManager);
      setupGracefulShutdown(controller);
      console.log(`Process started (PID: ${process.pid}) with retries: ${retries}, unlimited: ${unlimited}`);
    }
  });

program.parse(process.argv);
