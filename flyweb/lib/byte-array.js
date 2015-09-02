"use strict";

var utils = require("./utils");

class ByteArray {
  constructor(...args) {
    if (args.length == 0)
      this.init(new ArrayBuffer(256), 0);
    else if (typeof(args[0]) === 'number')
      this.init(new ArrayBuffer(args[0]), 0);
    else if (typeof(args[0]) === 'object')
      this.init(args[0], args[0].length);
    else
      utils.raiseError(new Error("Unrecognized arguments: " + args.toString()));
  }

  init(buf, cursor) {
    this._buffer = buf;
    this._data = new Uint8Array(buf);
    this._cursor = cursor;
  }

  get byteLength() {
    return this._cursor;
  }

  get buffer() {
    return this._buffer.slice(0, this._cursor);
  }
  get data() {
    return this._data.slice(0, this._cursor);
  }

  push(value, byteLength) {
    byteLength = byteLength || 1;
    this.append(valueToUint8Array(value, byteLength));
  }

  append(bytes) {
    for (var i = 0, byteLength = bytes.length; i < byteLength; i++) {
      this._data[this._cursor] = bytes[i];
      this._cursor++;
    }
  }

  getReader(startByte) {
    var cursor = startByte || 0;
  
    var getBytes = (byteLength) => {
      if (byteLength === null) {
        return new Uint8Array();
      }
  
      byteLength = byteLength || 1;
  
      var endPointer = cursor + byteLength;
      if (endPointer > this.byteLength) {
        return new Uint8Array();
      }
  
      var uint8Array = new Uint8Array(this._buffer.slice(cursor, endPointer));
      cursor += byteLength;
  
      return uint8Array;
    };
  
    var getValue = (byteLength) => {
      var bytes = getBytes(byteLength);
      if (bytes.length === 0) {
        return null;
      }
  
      return uint8ArrayToValue(bytes);
    };
  
    var isEOF = () => {
      return cursor >= this.byteLength;
    };
  
    return {
      getBytes:  getBytes,
      getValue:  getValue,
      isEOF:     isEOF,
  
      get offset() { return cursor; },
  
      byteArray: this
    };
  }
}


/**
 *  Bit   1-Byte    2-Bytes     3-Bytes     4-Bytes
 *  -----------------------------------------------
 *    0        1        256       65536    16777216
 *    1        2        512      131072    33554432
 *    2        4       1024      262144    67108864
 *    3        8       2048      524288   134217728
 *    4       16       4096     1048576   268435456
 *    5       32       8192     2097152   536870912
 *    6       64      16384     4194304  1073741824
 *    7      128      32768     8388608  2147483648
 *  -----------------------------------------------
 *  Offset     0        255       65535    16777215
 *  Total    255      65535    16777215  4294967295
 */
function valueToUint8Array(value, byteLength) {
  var arrayBuffer = new ArrayBuffer(byteLength);
  var uint8Array = new Uint8Array(arrayBuffer);
  for (var i = byteLength - 1; i >= 0; i--) {
    uint8Array[i] = value & 0xff;
    value = value >> 8;
  }

  return uint8Array;
}

function uint8ArrayToValue(uint8Array) {
  var byteLength = uint8Array.length;
  if (byteLength === 0) {
    return null;
  }

  var value = 0;
  for (var i = 0; i < byteLength; i++) {
    value = value << 8;
    value += uint8Array[i];
  }

  return value;
}

exports.ByteArray = ByteArray;
