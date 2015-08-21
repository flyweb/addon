"use strict";

var {BinaryUtils} = require('./binary-utils');
var {ByteArray} = require('./byte-array');
var {DNSCodes} = require('./dns-codes');
var {DNSUtils} = require('./dns-utils');

/**
 * DNSRecord
 */

function DNSRecord(name, recordType, classCode) {
  this.name = name;
  this.timestamp = Date.now();
  this.recordType = recordType;
  this.recordTypeName = DNSCodes.RECORD_TYPES(recordType) || "!!UNKNOWN!!";
  this.classCode = classCode || DNSCodes.CLASS_CODES.IN;
}

DNSRecord.prototype.constructor = DNSRecord;

/**
 * DNSQuestionRecord
 */

function DNSQuestionRecord(name, recordType, classCode) {
  DNSRecord.call(this, name, recordType, classCode);
}

DNSQuestionRecord.prototype = Object.create(DNSRecord.prototype);
DNSQuestionRecord.prototype.constructor = DNSQuestionRecord;

/**
 * DNSResourceRecord
 */

const DNS_RESOURCE_RECORD_DEFAULT_TTL = 10; // 10 seconds
// const DNS_RESOURCE_RECORD_DEFAULT_TTL = 3600; // 1 hour

function DNSResourceRecord(name, recordType, classCode, ttl, data) {
  DNSRecord.call(this, name, recordType, classCode);
  this.ttl = ttl || DNS_RESOURCE_RECORD_DEFAULT_TTL;
  this.data = data;
}

DNSResourceRecord.prototype = Object.create(DNSRecord.prototype);
DNSResourceRecord.prototype.constructor = DNSResourceRecord;

DNSResourceRecord.prototype.parseData = function (packetData, offset) {
  if (this.recordType === DNSCodes.RECORD_TYPES.PTR) {
    let reader = packetData.getReader(offset);
    let location = DNSUtils.byteArrayToName(reader);
    this.parsedData = {location};
  } else if (this.recordType == DNSCodes.RECORD_TYPES.SRV) {
    let reader = packetData.getReader(offset);
    let priority = reader.getValue(2);
    let weight = reader.getValue(2);
    let port = reader.getValue(2);
    let target = DNSUtils.byteArrayToName(reader);
    this.parsedData = {priority,weight,port,target};
  } else if (this.recordType == DNSCodes.RECORD_TYPES.TXT) {
    let byteArray = new ByteArray(this.data.buffer);
    let reader = byteArray.getReader(0);
    let parts = [];
    let partLength;
    while (partLength = reader.getValue()) {
      let bytes = reader.getBytes(partLength);
      let str = BinaryUtils.arrayBufferToString(bytes);
      parts.push(str);
    }
    this.parsedData = {parts};
  } else if (this.recordType == DNSCodes.RECORD_TYPES.A) {
    let byteArray = new ByteArray(this.data.buffer);
    let reader = byteArray.getReader(0);
    let parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push('' + reader.getValue());
    }
    let ip = parts.join('.');
    this.parsedData = {ip};
  }
};

DNSResourceRecord.prototype.getData = function() {
  return this.parsedData;
};

DNSResourceRecord.prototype.getName = function() {
  return this.name;
};

exports.DNSRecord = DNSRecord;
exports.DNSQuestionRecord = DNSQuestionRecord;
exports.DNSResourceRecord = DNSResourceRecord;
