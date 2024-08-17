import cluster from "cluster"
import os from "os"
import { Command } from "commander"
import { memoryUsageManager } from "./core/memoryUsageManager";
import { startProcess } from "./core/process";

const program = new Command();

program
  .option('--cluster', 'Run in cluster mode')
  .option('--unlimited', 'Unlimited retries')
  .command('start <script>')
  .description('Start a new process')
  .action((script) => {
    if (program.opts().cluster) { // TODO
      if (cluster.isMaster) {
        const numCPUs = os.cpus().length;
        console.log(`Master ${process.pid} is running`);

        for (let i = 0; i < numCPUs; i++) {
          cluster.fork();
        }

        cluster.on('exit', (worker, code, signal) => {
          console.log(`\nWorker ${worker.process.pid} died`);
          console.log('Starting a new worker');
          cluster.fork();
        });
      } else {
        startProcess(script, 5, false, memoryUsageManager);
        console.log(`Worker ${process.pid} started`);
      }
    } else if (program.opts().unlimited) {
      startProcess(script, 0, true, memoryUsageManager);
      console.log(`Unlimited single process started: ${process.pid}`);
    } else {
      startProcess(script, 5, false, memoryUsageManager);
      console.log(`Single process started: ${process.pid}`);
    }
  });

program.parse(process.argv);
