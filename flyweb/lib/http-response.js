'use strict';

var {Ci,Cr} = require('chrome');
var {EventTarget} = require('./event-target');
var {BinaryUtils} = require('./binary-utils');
var {HTTPStatus} = require('./http-status');
var utils = require('./utils');

var CRLF = '\r\n';
var BUFFER_SIZE = 64 * 1024;

function HTTPResponse(transport) {
  this.transport  = transport;
  var outputStream = transport.openOutputStream(
    Ci.nsITransport.OPEN_UNBUFFERED, 0, 0);
  var asyncOutputStream = outputStream.QueryInterface(Ci.nsIAsyncOutputStream);
  this.outputStream  = asyncOutputStream;
}

HTTPResponse.prototype = new EventTarget();

HTTPResponse.prototype.constructor = HTTPResponse;

HTTPResponse.prototype.send = function(status, headers, body) {
  let response = createResponse(status, headers, body);
  let idx = 0;

  let sendData = (stream) => {
    dump("KVKV: outputStreamReady idx=" + idx + "/" + response.length + "!\n");

    if (idx < response.length) {
      let written;
      try {
        written = this.outputStream.write(response.substr(idx), response.length - idx);
      } catch(err) {
          utils.dumpError(error);
          return;
      }
      idx += written;
      this.outputStream.asyncWait({
        onOutputStreamReady: sendData
      }, 0, 128, utils.currentThread());

    } else {
      dump("KVKV: closing!\n");
      try {
        this.outputStream.close();
        this.transport.close(Cr.NS_OK);
      } catch(err) {
        utils.dumpError(err);
        return;
      }
    }
  };

  this.outputStream.asyncWait({
    onOutputStreamReady: sendData
  }, 0, 128, utils.currentThread());
};

function createResponseHeader(status, headers) {
  var header = HTTPStatus.getStatusLine(status);

  for (var name in headers) {
    header += name + ': ' + headers[name] + CRLF;
  }

  return header;
}

function createResponse(status, headers, body) {
  body    = body    || '';
  status  = status  || 200;
  headers = headers || {};

  headers['Content-Length'] = body.length;
  if (!headers['Content-Type'])
    headers['Content-Type'] = "text/html";

  let header_string = createResponseHeader(status, headers);
  let response_array = [header_string, CRLF];

  if (typeof(body) === 'string') {
    response_array.push(body);
  } else {
    for (let i = 0; i < body.length; i++)
      response_array.push(String.fromCharCode(body[i]));
  }

  return response_array.join('');
}

exports.HTTPResponse = HTTPResponse;
