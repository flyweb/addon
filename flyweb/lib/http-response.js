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
  return new Promise((resolve, reject) => {
    let response = createResponse(status, headers, body);
    let idx = 0;
  
    let sendData = (stream) => {
      if (idx < response.length) {
        let written;
        try {
          written = this.outputStream.write(response.substr(idx), response.length - idx);
        } catch(err) {
            utils.dumpError(err);
            reject(err);
            return;
        }
        idx += written;
        this.outputStream.asyncWait({
          onOutputStreamReady: sendData
        }, 0, 128, utils.currentThread());
  
      } else {
        try {
          this.outputStream.close();
          this.transport.close(Cr.NS_OK);
          resolve();
        } catch(err) {
          utils.dumpError(err);
          reject(err);
          return;
        }
      }
    };
  
    this.outputStream.asyncWait({
      onOutputStreamReady: sendData
    }, 0, 128, utils.currentThread());
  });
};

function HTTPResponseStream(response, outputStream, transport) {
  this.response_ = response;
  this.outputStream_ = outputStream;
  this.transport_ = transport;
  this.buffer_ = [];
  this.done_ = false;
  this.error_ = false;
  this.transmitting_ = false;
}
HTTPResponseStream.prototype = Object.create(EventTarget.prototype);
HTTPResponseStream.prototype.constructor = HTTPResponseStream;

HTTPResponseStream.prototype.addData = function (data) {
  if (this.done_ || this.error_)
    return;
  if (data.length == 0)
    return;
  this.buffer_.push(data);
  this.ensureTransmitting();
};
HTTPResponseStream.prototype.endData = function () {
  if (this.done_ || this.error_)
    return;
  this.done_ = true;
  if (this.transmitting_)
    return;
  // If already idling, close the connection.
  this.close();
};
HTTPResponseStream.prototype.ensureTransmitting = function () {
  if (this.transmitting_)
    return;
  this.outputStream_.asyncWait({
    onOutputStreamReady: stream => { this.transmit(); }
  }, 0, 0, utils.currentThread());
  this.transmitting_ = true;
};
HTTPResponseStream.prototype.transmit = function () {
  this.transmitting_ = false;

  if (this.buffer_.length > 0) {
    let data = this.buffer_.join('');
    this.buffer_.splice(0);

    let written;
    try {
      written = this.outputStream_.write(data, data.length);
    } catch(err) {
        utils.dumpError(err);
        this.error_ = true;
        this.done_ = true;
        this.dispatchEvent('error', err);
        return;
    }

    if (written < data.length) {
        this.buffer_.push(data.substr(written));
    }
    this.ensureTransmitting();
    return;
  }

  if (this.done_) {
    this.close();
  }
};
HTTPResponseStream.prototype.close = function () {
  this.outputStream_.close();
  this.transport_.close(Cr.NS_OK);
  this.dispatchEvent('complete');
}
HTTPResponse.prototype.stream = function() {
   return new HTTPResponseStream(this, this.outputStream, this.transport);
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
