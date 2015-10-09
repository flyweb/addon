
function StreamReader(req) {
    this.req = req;
    this.buffer = [];
    this.checkOnInput = null;

    this.req.ondata(data => {
        for (var c of data)
            this.buffer.push(c);
        if (this.checkOnInput)
            this.checkOnInput();
    });
}

StreamReader.prototype.readRest = function(callback) {
    this.checkOnInput = function () {
        if (this.buffer.length > 0)
            callback(this.buffer.splice(0));
    };
    if (this.buffer.length > 0)
        callback(this.buffer.splice(0));
}

StreamReader.prototype.readLine = function() {
    return new Promise((resolve, reject) => {
        var s = this.tryGetLine();
        if (typeof(s) == 'string') {
            resolve(s);
            return;
        }

        // Check for line.
        function checkOnInput() {
            var s = this.tryGetLine();
            if (typeof(s) == 'string') {
                this.checkOnInput = null;
                resolve(s);
                return;
            }
        }
        this.checkOnInput = checkOnInput;
    });
}

StreamReader.prototype.read = function(bytes) {
    return new Promise((resolve, reject) => {
        var data = this.tryRead(bytes);
        if (data) {
            resolve(data);
            return;
        }

        // Check for line.
        function checkOnInput() {
            var data = this.tryRead(bytes);
            if (data) {
                this.checkOnInput = null;
                resolve(data);
                return;
            }
        }
        this.checkOnInput = checkOnInput;
    });
};


StreamReader.prototype.readHeader = function() {
    // Get header line.
    return new Promise((resolve, reject) => {
        var headerString = this.tryGetHeader();
        if (typeof(headerString) == 'string') {
            this.parseHeader(headerString, resolve, reject);
            return;
        }

        function checkOnInput() {
            var headerString = this.tryGetHeader();
            if (typeof(headerString) == 'string') {
                this.checkOnInput = null;
                parseHeader(headerString, resolve, reject);
                return;
            }
        }
        this.checkOnInput = checkOnInput;
    });
};

StreamReader.prototype.tryGetHeader = function() {
    var a = [];
    for (var b of this.buffer)
        a.push(String.fromCharCode(b));
    var s = a.join('');
    var idx = s.indexOf('\r\n\r\n');
    if (idx >= 0) {
        var header = s.substr(0, idx);
        this.buffer.splice(0, idx+4);
        return header;
    }
};

StreamReader.prototype.tryGetLine = function() {
    var a = [];
    for (var b of this.buffer)
        a.push(String.fromCharCode(b));
    var s = a.join('');
    var idx = s.indexOf('\r\n');
    if (idx >= 0) {
        var line = s.substr(0, idx+2);
        this.buffer.splice(0, idx+2);
        return line;
    }
};

StreamReader.prototype.tryRead = function(bytes) {
    if (this.buffer.length >= bytes)
        return this.buffer.splice(0, bytes);
};

function parseHeader(header, resolve, reject) {
  var headerLines = header.split('\r\n');
  var requestLine = headerLines.shift().split(' ');

  var method  = requestLine[0];
  var uri     = requestLine[1];
  var version = requestLine[2];

  if (version !== "HTTP/1.1") {
    reject("Invalid http version: " + version);
    return;
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

  resolve({method, path, params, headers});
  return;
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
