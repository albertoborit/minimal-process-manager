const http = require('http');

const PORT = 3000;
let callCount = 0;

const requestHandler = (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        callCount++;

        if (callCount < 2) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'healthy' }));
        } else {
            throw Error
        }
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint Not Found' }));
    }
};

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
