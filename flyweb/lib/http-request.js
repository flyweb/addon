'use strict';

var {setTimeout, clearTimeout} = require("sdk/timers");
var {Ci, Cr} = require("chrome");
var utils = require('./utils');
var {EventTarget} = require('./event-target');
var {BinaryUtils} = require('./binary-utils');

var HTTPServer;

var CRLF = '\r\n';
var CRLFx2 = CRLF + CRLF;

function HTTPRequest(transport) {
  var parts = [];
  var receivedLength = 0;

  if (!HTTPServer)
    HTTPServer = require('./http-server').HTTPServer;
 
  var inputStream = transport.openInputStream(
                Ci.nsITransport.OPEN_UNBUFFERED, 0, 0);
  var binaryInputStream = utils.newBinaryInputStream(inputStream);

  this.transport = transport;
  this.inputStream = inputStream;
  this.binaryInputStream = binaryInputStream;

  let TIMEOUT = 1000;

  /** Check for input every 25ms. */
  var checkInput = () => {
    // Check for available data.
    var avail = inputStream.available();
    if (avail > 0) {
      // We may be at end of data, try to read more to raise error if so.
      var data = binaryInputStream.readByteArray(avail);
      for (var byte of data)
        parts.push(byte);
    }

    // Check for header.
    if (tryParseHeader()) {
        return;
    }

    // If still alive, schedule another check.
    setTimeout(checkInput, TIMEOUT);
  };
  setTimeout(checkInput, TIMEOUT);

  var tryParseHeader = () => {
    let arr = new Uint8Array(parts);
    let resp = parseHeader(this, arr.buffer);
    if (this.invalid) {
      transport.close(Cr.NS_OK);
      this.dispatchEvent('error', this);
      return true;
    }

    if (!resp) {
        return false;
    }

    // Check content-length for body.
    var contentLength = parseInt(this.headers['Content-Length'], 10);
    if (isNaN(contentLength)) {
      this.complete = true;
      this.dispatchEvent('complete', this);
      return true;
    }

    this.contentLength = contentLength;
    setTimeout(readBody, TIMEOUT);
    return true;
  };

  /** Check for input every 25ms. */
  var readBody = () => {
    // Check for available data.
    var avail = inputStream.available();
    if (avail > 0) {
      // We may be at end of data, try to read more to raise error if so.
      var data = binaryInputStream.readByteArray(avail);
      for (var byte of data)
        this.content.push(byte);
    }

    if (this.content.length >= this.contentLength) {
        // Trim content down to specified length (if necessary)
        while (this.content.length > this.contentLength)
            this.content.pop();

        // emit complete event.
        this.complete = true;
        this.dispatchEvent('complete', this);
        return;
    }

    // If still alive, schedule another check.
    setTimeout(readBody, TIMEOUT);
  };
}

HTTPRequest.prototype = new EventTarget();

HTTPRequest.prototype.constructor = HTTPRequest;

function parseHeader(request, data) {
  if (!data) {
    request.invalid = true;
    return false;
  }

  data = BinaryUtils.arrayBufferToString(data);
  // Check for presence of CRLF-CRLF
  var index = data.indexOf(CRLFx2);
  if (index == -1) {
    return false;
  }

  var header = data.substr(0, index);
  var body   = data.substr(index + CRLFx2.length)

  var headerLines = header.split(CRLF);
  var requestLine = headerLines.shift().split(' ');
  
  var method  = requestLine[0];
  var uri     = requestLine[1];
  var version = requestLine[2];

  if (version !== HTTPServer.HTTP_VERSION) {
    request.invalid = true;
    return false;
  }

  var uriParts = uri.split('?');
  
  var path   = uriParts.shift();
  var params = parseURLEncodedString(uriParts.join('?'));

  var headers = {};
  headerLines.forEach((headerLine) => {
    var parts = headerLine.split(': ');
    if (parts.length !== 2) {
      return;
    }

    var name  = parts[0];
    var value = parts[1];

    headers[name] = value;
  });

  request.method  = method;
  request.path    = path;
  request.params  = params;
  request.headers = headers;

  if (headers['Content-Length']) {
    request.content = [];
    for (var i = 0; i < body.length; i++)
      request.content.push(body[i]);
    return true;
  }

  return true;
}

function setOrAppendValue(object, name, value) {
  var existingValue = object[name];
  if (existingValue === undefined) {
    object[name] = value;
  } else {
    if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      object[name] = [existingValue, value];
    }
  }
}

function parseURLEncodedString(string) {
  var values = {};

  string.split('&').forEach((pair) => {
    if (!pair) {
      return;
    }

    var parts = decodeURIComponent(pair).split('=');

    var name  = parts.shift();
    var value = parts.join('=');

    setOrAppendValue(values, name, value);
  });

  return values;
}

function parseMultipartFormDataString(string, boundary) {
  var values = {};

  string.split('--' + boundary).forEach((data) => {
    data = data.replace(/^\r\n/, '').replace(/\r\n$/, '');

    if (!data || data === '--') {
      return;
    }

    var parts = data.split(CRLF + CRLF);
    
    var header = parts.shift();
    var value  = {
      headers: {},
      metadata: {},
      value: parts.join(CRLF + CRLF)
    };

    var name;

    var headers = header.split(CRLF);
    headers.forEach((header) => {
      var headerParams = header.split(';');
      var headerParts = headerParams.shift().split(': ');

      var headerName  = headerParts[0];
      var headerValue = headerParts[1];

      if (headerName  !== 'Content-Disposition' ||
          headerValue !== 'form-data') {
        value.headers[headerName] = headerValue;
        return;
      }

      headerParams.forEach((param) => {
        var paramParts = param.trim().split('=');

        var paramName  = paramParts[0];
        var paramValue = paramParts[1];

        paramValue = paramValue.replace(/\"(.*?)\"/, '$1') || paramValue;

        if (paramName === 'name') {
          name = paramValue;
        }

        else {
          value.metadata[paramName] = paramValue;
        }
      });
    });

    if (name) {
      setOrAppendValue(values, name, value);
    }
  });

  return values;
}

function parseBody(contentType, data) {
  contentType = contentType || 'text/plain';

  var contentTypeParams = contentType.replace(/\s/g, '').split(';');
  var mimeType = contentTypeParams.shift();

  var body = BinaryUtils.arrayBufferToString(data);

  var result;

  try {
    switch (mimeType) {
      case 'application/x-www-form-urlencoded':
        result = parseURLEncodedString(body);
        break;
      case 'multipart/form-data':
        contentTypeParams.forEach((contentTypeParam) => {
          var parts = contentTypeParam.split('=');

          var name  = parts[0];
          var value = parts[1];

          if (name === 'boundary') {
            result = parseMultipartFormDataString(body, value);
          }
        });
        break;
      case 'application/json':
        result = JSON.parse(body);
        break;
      case 'application/xml':
        result = new DOMParser().parseFromString(body, 'text/xml');
        break;
      default:
        break;
    }
  } catch (exception) {
    console.log('Unable to parse HTTP request body with Content-Type: ' + contentType);
  }

  return result || body;
}

exports.HTTPRequest = HTTPRequest;
