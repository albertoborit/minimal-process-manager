import path from "path"
import fs from "fs"
import { spawn } from "child_process"
import { createServer, Server } from "net";

export const startProcess = (script:string, maxRetries:number, unlimited:boolean=false, manager:any) => {
    const logStream = fs.createWriteStream('app.log', { flags: 'a' });
    const scriptPath = path.resolve(script);
    let retries = 0;

    function launch() {
        const proc = spawn('node', [scriptPath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        proc.stdout.on('data', (data) => {
            manager()
            logStream.write(data);
        });

        proc.stderr.on('data', (data) => {
            logStream.write(data);
        });

        proc.on('exit', (code) => {
            console.log(`\nProcess ${proc.pid} exited with code ${code}`);
            manager()
            launch()
            if(unlimited){
                retries++;
                console.log(`Restarting process... Attempt ${retries}`);
            }
            if (!unlimited) {
                retries++;
                console.log(`Restarting process... Attempt ${retries}`);
                if(retries >=  maxRetries){
                    throw Error
                }
            }
        });
        return proc;
    }
    launch();
}