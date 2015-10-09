
var WS_ACCEPT_SUFFIX = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

var WsOpcodes = {
    Continuation: 0,
    Text: 1,
    Binary: 2,
    Close: 8,
    Ping: 9,
    Pong: 10
};

function Cursor(array) {
    this.array_ = array;
    this.idx_ = 0;
}

Cursor.prototype.hasByte = function () {
    return this.idx_ < this.array_.length;
}
Cursor.prototype.hasBytes = function (bytes) {
    return (this.idx_ + bytes) <= this.array_.length;
}
Cursor.prototype.readByte = function () {
    if (this.idx_ >= this.array_.length)
        return undefined;
    var result = this.array_[this.idx_];
    this.idx_ += 1;
    return result;
}
Cursor.prototype.readBytes = function (bytes) {
    var result = [];
    var i;
    for (i = 0; i < bytes; i++) {
        if (!this.hasByte())
            break;
        result.push(this.readByte());
    }
    return result;
}
Cursor.prototype.splice = function () {
    this.array_.splice(0, this.idx_);
}

function ServerWebSocket({onerror, onmessage, instream, outstream, headers, stringMessage}) {
    this.onerror = onerror;
    this.onmessage = onmessage;

    this.stringMessage = stringMessage;

    this.instream = instream;
    this.outstream = outstream;

    this.inputBuffer = [];

    // Ensure Upgrade: websocket header exists.
    if (headers['Upgrade'] != 'websocket') {
        this.badHeader("Upgrade header not given.");
        return;
    }

    // Get the websocket key.
    var key = headers['Sec-WebSocket-Key'];
    if (!key) {
        this.badHeader("Sec-WebSocket-Key not given.");
        return;
    }

    // Ensure version is 13.
    var version = headers['Sec-WebSocket-Version'];
    if (version != "13") {
        this.badHeader("Unrecognized Sec-WebSocket-Version: " + version);
        return;
    }

    instream.readRest(data => {
        for (var i = 0; i < data.length; i++)
            this.inputBuffer.push(data[i]);
        this.checkInputBuffer();
    });

    // Hash it.
    var hashString = Sha1.hashToString(key + WS_ACCEPT_SUFFIX);
    var uuenc = btoa(hashString);

    console.log("Sending uuenc: " + uuenc);

    outstream.send("HTTP/1.1 101 Switching Protocols\r\n");
    outstream.send("Upgrade: websocket\r\n");
    outstream.send("Connection: Upgrade\r\n");
    outstream.send("Sec-WebSocket-Accept: " + uuenc + "\r\n");
    outstream.send("\r\n");
}

ServerWebSocket.prototype.badHeader = function (message) {
    console.log("Bad header: " + message);
    if (this.onerror) {
        this.onerror("Bad header: " + message);
        return;
    }
}

ServerWebSocket.prototype.emitError = function (message) {
    console.log("Web Socket Error: " + message);
    if (this.onerror) {
        this.onerror(message);
        return;
    }
}

/**
 * Format:
 *
 *  Byte 0 -   FRRROOOO
 *      F - Fin bit.
 *      R - Reserved (0)
 *      O - Opcode
 *
 *  Byte 1 -   MPPPPPPP
 *      M - Mask bit.
 *      P - Payload size.
 *
 *  If P = 126, then next 2 bytes are extended payload length.
 *  If P = 127, then next 4 bytes are extended payload length.
 *
 *  Next 4 bytes - Mask.
 */
ServerWebSocket.prototype.checkInputBuffer = function () {
    console.log("CheckInputBuffer", this.inputBuffer);
    var curs = new Cursor(this.inputBuffer);
    if (!curs.hasBytes(2))
        return;

    var b1 = curs.readByte();
    var finBit = (b1 >> 7) & 0x1;
    var opcode = (b1 & 0xf);

    var b2 = curs.readByte();
    var maskBit = (b2 >> 7) & 0x1;
    var payloadSize = b2 & 0x7f;

    if (!maskBit) {
        this.emitError("Expected mask bit!");
        return;
    }

    console.log("Got bytes", {finBit, opcode, maskBit, payloadSize});

    if (payloadSize == 126) {
        if (!curs.hasBytes(2))
            return;
        payloadSize = (curs.readByte() << 8) | curs.readByte();
    }

    if (payloadSize == 127) {
        // Error, payload too large.
        this.emitError("Client frame payload too large.");
        return;
    }

    // Read mask.
    if (!curs.hasBytes(4))
        return;
    var maskBytes = curs.readBytes(4);
    console.log("Got maskBytes", maskBytes);
    console.log("Cursor", curs);

    // Read payload.
    if (!curs.hasBytes(payloadSize))
        return;

    var payload = curs.readBytes(payloadSize);
    console.log("Got payload", payload);
    // Unmask the payload.
    for (var i = 0; i < payload.length; i++) {
        payload[i] ^= maskBytes[i % 4];
    }

    // Splice the frame out from the buffer.
    curs.splice();

    this.handleFrame({opcode, finBit, payload});
};

ServerWebSocket.prototype.send = function (data) {
    if (typeof(data) == 'string') {
        this.sendFrame({opcode: WsOpcodes.Text, payload: data});
    } else {
        this.sendFrame({opcode: WsOpcodes.Binary, payload: data});
    }
};

ServerWebSocket.prototype.handleFrame = function ({opcode, finBit, payload}) {
    if (!finBit) {
        // Cannot handle multi-part messages.
        this.emitError("Cannot handle multi-part frames.");
    }
    if (opcode == WsOpcodes.Continuation) {
        this.emitError("Cannot handle continuation frames.");
    }

    if (opcode == WsOpcodes.Text) {
        // Convert message to text.
        var message = payload.map(function (i) { return String.fromCharCode(i); }).join('');
        message = decodeURIComponent(escape(message));
        if (this.onmessage)
            this.onmessage(message);
        return;
    }

    if (opcode == WsOpcodes.Binary) {
        // Convert message to text.
        if (this.onmessage)
            this.onmessage(payload);
        return;
    }

    if (opcode == WsOpcodes.Ping) {
        this.sendFrame({opcode: WsOpcodes.Pont, payload:''});
        return;
    }

    if (opcode == WsOpcodes.Pong) {
        // Ignore.
    }

    // Otherwise, ignore.
    this.emitError("Unknown frame type received: " + opcode);
};

ServerWebSocket.prototype.sendFrame = function ({opcode, payload}) {
    var frame = [];
    // Write opcode.  We don't send fragmented frames at all.
    frame.push(0x80 | opcode);

    if (typeof(payload) == 'string') {
        var message = unescape(encodeURIComponent(payload));
        var bytes = [];
        for (var i = 0; i < message.length; i++) {
            bytes.push(message.charCodeAt(i));
        }
        payload = bytes;
    }

    // Write payload size.  No masking.
    var payloadSize = payload.length;
    if (payloadSize > 0xffff) {
        this.emitError("Payload too large for outgoing frame.");
        return;
    }

    if (payloadSize < 126) {
        frame.push(payloadSize);
    } else {
        frame.push(126);
        frame.push((payloadSize >> 8)|0xff);
        frame.push(payloadSize & 0xff);
    }

    for (var i = 0; i < payload.length; i++) {
        frame.push(payload[i]);
    }

    // Send frame.
    var frameStr = frame.map(function (i) { return String.fromCharCode(i); }).join('');
    this.outstream.send(frameStr);
};
