const http = require('http');

function checkHealth() {
    http.get('http://localhost:3000/health', (res) => {
        res.setEncoding('utf8');
        res.on('data', console.log);
    }).on('error', (e) => console.error(`Request error: ${e.message}`));
}
setInterval(checkHealth, 5000);
