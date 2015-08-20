"use strict";

var DNSCodes = require('./dns-codes');
var DNSUtils = require('./dns-utils');

/**
 * DNSRecord
 */

function DNSRecord(name, recordType, classCode) {
  this.name = name;
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
  let reader = packetData.getReader(offset);
  if (this.recordType === DNSCodes.RECORD_TYPES.PTR) {
    let name = DNSUtils.byteArrayToName(reader);
    this.parsedData = {name: name};
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
