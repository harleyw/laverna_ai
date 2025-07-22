'use strict';

var finalhandler = require('finalhandler'),
    http         = require('http'),
    serveStatic  = require('serve-static'),
    serve,
    server;

const path = require('path');

serve  = serveStatic(path.join(__dirname, 'app'), {index: ['index.html']});

server = http.createServer(function(req, res) {
    var done = finalhandler(req, res);
    serve(req, res, done);
});

module.exports = function(port) {
    console.log('Server is running on port: ' + port);
    return server.listen(port);
};
