const cluster = require("cluster");
const os = require("os");
const { Command } = require("commander");
const { memoryUsageManager } = require("./core/memoryUsageManager");
const { startProcess } = require("./core/process");

const program = new Command();

program
  .option('--cluster', 'Run in cluster mode')
  .option('--unlimited', 'Unlimited retries')
  .command('start <script>')
  .description('Start a new process')
  .action((script, options) => {
    const opts = program.opts();
    if (opts.cluster) {
      if (cluster.isPrimary) {
        const numCPUs = os.cpus().length;
        console.log(`Master ${process.pid} is running`);

        for (let i = 0; i < numCPUs; i++) {
          cluster.fork();
        }

        cluster.on('exit', (worker) => {
          console.log(`\nWorker ${worker.process.pid} died`);
          console.log('Starting a new worker');
          cluster.fork();
        });
      } else {
        startProcess(script, 5, false, memoryUsageManager);
      }
    } else {
      const retries = opts.unlimited ? 0 : 5;
      const unlimited = !!opts.unlimited;
      startProcess(script, retries, unlimited, memoryUsageManager);
      console.log(`Process started (PID: ${process.pid}) with retries: ${retries}, unlimited: ${unlimited}`);
    }
  });

program.parse(process.argv);
