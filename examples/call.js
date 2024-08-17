const http = require('http');

function checkHealth() {
    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/health',
        method: 'GET',
    };

    const req = http.request(options, (res) => {
        let data = '';

        // Acumular los datos recibidos
        res.on('data', (chunk) => {
            data += chunk;
        });

        // Manejar el final de la respuesta
        res.on('end', () => {
            console.log('Response:', data);
        });
    });

    // Manejar errores en la solicitud
    req.on('error', (e) => {
        console.error(`Problem with request: ${e.message}`);
    });

    // Finalizar la solicitud
    req.end();
}

// Llamar a la función
checkHealth();
