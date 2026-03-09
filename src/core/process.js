const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const startProcess = (script, maxRetries, unlimited = false, manager) => {
  const scriptPath = path.resolve(script);

  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: Script not found: ${scriptPath}`);
    process.exit(1);
  }

  let retries = 0;
  let currentProcess = null;
  let stopMemoryManager = null;

  const launch = () => {
    currentProcess = spawn("node", [scriptPath], {
      stdio: "inherit",
    });
    if (manager) {
      stopMemoryManager = manager();
    }

    currentProcess.on("error", (err) => {
      console.error(`Error in process: ${err.message}`);
    });

    currentProcess.on("exit", (code) => {
      if (stopMemoryManager) stopMemoryManager();
      console.log(`\nProcess ${currentProcess.pid} exited with code ${code}`);
      currentProcess = null;

      if (unlimited || retries < maxRetries) {
        retries++;
        console.log(`Restarting process... Attempt ${retries}`);
        launch();
      } else {
        console.error("Max retries reached. Exiting.");
        process.exit(code !== 0 ? code : 1);
      }
    });

    return currentProcess;
  };

  launch();

  return {
    stop() {
      if (currentProcess && currentProcess.kill) {
        currentProcess.kill("SIGTERM");
      }
      if (stopMemoryManager) stopMemoryManager();
    },
  };
};

module.exports = { startProcess };
