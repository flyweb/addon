'use strict';

var {Ci, Cr} = require("chrome");
var utils = require('./utils');
var {EventTarget} = require('./event-target');
var {BinaryUtils} = require('./binary-utils');

var HTTPServer;

var CRLF = '\r\n';
var CRLFx2 = CRLF + CRLF;

function HTTPRequest(transport, options) {
  options = options || {};
  if (!HTTPServer)
    HTTPServer = require('./http-server').HTTPServer;
 
  var inputStream = transport.openInputStream(
                Ci.nsITransport.OPEN_UNBUFFERED, 0, 0);
  var asyncInputStream = inputStream.QueryInterface(Ci.nsIAsyncInputStream);
  var binaryInputStream = utils.newBinaryInputStream(inputStream);

  this.transport = transport;
  this.inputStream = inputStream;
  this.asyncInputStream = asyncInputStream;
  this.binaryInputStream = binaryInputStream;
}
HTTPRequest.prototype = new EventTarget();
HTTPRequest.prototype.constructor = HTTPRequest;

HTTPRequest.prototype.waitForData = function (handler) {
    this.asyncInputStream.asyncWait({
        onInputStreamReady: utils.tryWrapF(handler)
    }, 0, 0, utils.currentThread());
};

HTTPRequest.prototype.receiveRaw = function () {
  var buffer = [];

  var handler = (stream) => {
    let avail;
    try { avail = this.asyncInputStream.available(); }
    catch (err) { /* closed stream. */ return; }

    // Check if stream is finished.
    if (avail == 0) {
        this.dispatchEvent('complete');
        return;
    }

    let data = this.binaryInputStream.readByteArray(avail);
    let array = [];
    for (let byte of data)
        array.push(byte);
    this.dispatchEvent('data', array);
    this.waitForData(handler);
  };

  this.waitForData(handler);
};

HTTPRequest.prototype.receiveParsed = function () {
  var parts = [];
  var readingHeader = true;
  var readingBody = false;

  var handler = (stream) => {
    let avail;
    try { avail = this.asyncInputStream.available(); }
    catch (err) {
        // Closed stream.
        return;
    }

    if (avail == 0) {
        // Stream is finished.
        return;
    }

    // If we're neither reading the header nor the body,
    // not sure what's going on.
    if (!readingHeader && !readingBody) {
        dump("[FlyWeb-HTTPRequest] Incoming when reading " +
             "neither header nor body.");
        return;
    }

    let data = this.binaryInputStream.readByteArray(avail);
    if (readingHeader) {
      if (data) {
        for (let byte of data)
          parts.push(byte);
      }

      if (tryParseHeader()) {
        if (readingBody)
          this.waitForData(handler);
        return;
      }
      this.waitForData(handler);
      return;
    }

    if (readingBody) {
      if (data) {
        let dataArray = [];
        for (let byte of data) {
          dataArray.push(byte);
          this.content.push(byte);
        }
        this.dispatchEvent('requestData', dataArray);
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
    }
  };

  this.waitForData(handler);

  var tryParseHeader = () => {
    let arr = new Uint8Array(parts);
    let resp = this.parseHeader(arr.buffer);
    if (this.invalid) {
      transport.close(Cr.NS_OK);
      this.dispatchEvent('error', this);
      readingHeader = false;
      return true;
    }

    if (!resp)
      return false;

    // Check content-length for body.
    var contentLength = parseInt(this.headers['Content-Length'], 10);
    if (isNaN(contentLength)) {
      this.complete = true;
      readingHeader = false;
      this.dispatchEvent('headerComplete', this);
      this.dispatchEvent('complete', this);
      return true;
    }

    this.contentLength = contentLength;
    readingHeader = false;
    readingBody = true;
    this.dispatchEvent('headerComplete', this);
    return true;
  };
};

HTTPRequest.prototype.parseHeader = function (data) {
  if (!data) {
    this.invalid = true;
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
    this.invalid = true;
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

  this.method  = method;
  this.path    = path;
  this.params  = params;
  this.headers = headers;

  if (headers['Content-Length']) {
    this.content = [];
    for (var i = 0; i < body.length; i++)
      this.content.push(body[i]);
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
