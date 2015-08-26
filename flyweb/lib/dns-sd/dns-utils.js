"use strict";

var {BinaryUtils} = require('./binary-utils');
var {ByteArray} = require('./byte-array');

function parseNameIntoArray(reader, outArray) {
  const byteArray = reader.byteArray;

  let partLength;
  while (partLength = reader.getValue()) {
    if ((partLength & 0xc0) == 0xc0) {
      // name pointer to elsewhere in the response.
      let offset = ((partLength & 0x3f) << 8) | reader.getValue();
      parseNameIntoArray(byteArray.getReader(offset), outArray);
      break;
    }

    var nameBytes = reader.getBytes(partLength);
    outArray.push(BinaryUtils.arrayBufferToString(nameBytes));
  }
}

function byteArrayToName(reader) {
  const parts = [];
  parseNameIntoArray(reader, parts)
  return parts.join('.');
}

function nameToByteArray(name) {
  const byteArray = new ByteArray();
  const parts = name.split('.');
  parts.forEach((part) => {
    var length = part.length;
    byteArray.push(length);

    for (let i = 0; i < length; i++) {
      byteArray.push(part.charCodeAt(i));
    }
  });

  byteArray.push(0x00);
  return byteArray.data;
}

function valueToFlags(value) {
  return {
    QR: (value & 0x8000) >> 15,
    OP: (value & 0x7800) >> 11,
    AA: (value & 0x0400) >> 10,
    TC: (value & 0x0200) >>  9,
    RD: (value & 0x0100) >>  8,
    RA: (value & 0x0080) >>  7,
    UN: (value & 0x0040) >>  6,
    AD: (value & 0x0020) >>  5,
    CD: (value & 0x0010) >>  4,
    RC: (value & 0x000f) >>  0
  };
}

function flagsToValue(flags) {
  var value = 0x0000;

  value = value << 1;
  value += flags.QR & 0x01;

  value = value << 4;
  value += flags.OP & 0x0f;

  value = value << 1;
  value += flags.AA & 0x01;

  value = value << 1;
  value += flags.TC & 0x01;

  value = value << 1;
  value += flags.RD & 0x01;

  value = value << 1;
  value += flags.RA & 0x01;

  value = value << 1;
  value += flags.UN & 0x01;

  value = value << 1;
  value += flags.AD & 0x01;

  value = value << 1;
  value += flags.CD & 0x01;

  value = value << 4;
  value += flags.RC & 0x0f;

  return value;
}

exports.DNSUtils = {
  parseNameIntoArray,
  byteArrayToName,
  nameToByteArray,
  valueToFlags,
  flagsToValue
};
