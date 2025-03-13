const path = require("path");
const { spawn } = require("child_process");

const startProcess = (script, maxRetries, unlimited = false, manager) => {
    const scriptPath = path.resolve(script);
    let retries = 0;

    const launch = () => {
        const proc = spawn('node', [scriptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
        manager();

        proc.on('error', (err) => {
            console.error(`Error in process: ${err.message}`);
        });

        proc.on('exit', (code) => {
            console.log(`\nProcess ${proc.pid} exited with code ${code}`);

            if (unlimited || retries < maxRetries) {
                retries++;
                console.log(`Restarting process... Attempt ${retries}`);
                launch();
            } else {
                console.error("Max retries reached. Exiting.");
            }
        });

        return proc;
    };

    launch();
};

module.exports = { startProcess };
