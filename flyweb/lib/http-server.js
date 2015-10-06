'use strict';

var {Ci,Cr} = require('chrome');
var {EventTarget}  = require('./event-target');
var {HTTPRequest}  = require('./http-request');
var {HTTPResponse} = require('./http-response');
var utils = require('./utils');

var DEFAULT_PORT = 8080;
var DEFAULT_TIMEOUT = 20000;

var CRLF = '\r\n';

function HTTPServer(port, options) {
  this.port = port;
  options = options || {};

  if (options.rawRequest)
    this.rawRequest = true;
  else
    this.rawRequest = false;

  this.running = false;
}

HTTPServer.HTTP_VERSION = 'HTTP/1.1';

HTTPServer.prototype = new EventTarget();

HTTPServer.prototype.constructor = HTTPServer;

HTTPServer.prototype.timeout = DEFAULT_TIMEOUT;

HTTPServer.prototype.start = function() {
  if (this.running) {
    return;
  }

  console.log('Starting HTTP server on port ' + this.port);
  var socket = utils.newTCPServerSocket({port:this.port});
  this.port = socket.port;
  socket.asyncListen({
    onSocketAccepted: (sock, transport) => {
      // Don't accept requests until 'onrequest' is installed.
      if (!this.onrequest) {
        this.transport_.close(Cr.NS_OK);
        return;
      }
      var request = new HTTPRequest(transport);
      var response = new HTTPResponse(transport);
      this.onrequest(request, response);
    },

    onStopListening: (sock, status) => {
    }
  });

  this.socket = socket;
  this.running = true;
};

HTTPServer.prototype.stop = function() {
  if (!this.running) {
    return;
  }

  console.log('Shutting down HTTP server on port ' + this.port);

  this.socket.close();

  this.running = false;
};

exports.HTTPServer = HTTPServer;
