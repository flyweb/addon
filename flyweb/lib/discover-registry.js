"use strict";

var {DNSCodes} = require('./dns-codes');
var {EventTarget} = require('./event-target');

function DiscoverRegistry() {
  // ptrRecords holds a list of all fly web PTR records, keyed by location.
  this._ptrRecords = {};

  // srvRecords map specific locations to an SRV record
  // identifying the target and port.
  this._srvRecords = {};

  // txtRecords map specific locations to a TXT record.
  this._txtRecords = {};

  // addrRecords map target names to IP addresses.
  this._addrRecords = {};
}

DiscoverRegistry.prototype = Object.create(EventTarget.prototype);
DiscoverRegistry.prototype.constructor = DiscoverRegistry;

DiscoverRegistry.prototype._clearLocation = function(loc) {
    // Clear any PTR records for the location.
    delete this._ptrRecords[loc];

    // Clear any SRV records for the location.
    let srvRecord = this._srvRecords[loc];
    delete this._srvRecords[loc];

    // Clear any TXT records for the location.
    delete this._txtRecords[loc];

    // Clear any A records associated with the target of the SRV record.
    if (srvRecord)
        delete this._addrRecords[srvRecord.parsedData.target];
};

DiscoverRegistry.prototype.addRecord = function(record, serviceSet) {
  if (record.recordType == DNSCodes.RECORD_TYPES.PTR) {
    let loc = record.parsedData.location;
    this._clearLocation(loc);
    this._ptrRecords[loc] = record;
    serviceSet.add(loc);

  } else if (record.recordType == DNSCodes.RECORD_TYPES.SRV) {
    this._srvRecords[record.name] = record;

  } else if (record.recordType == DNSCodes.RECORD_TYPES.TXT) {
    this._txtRecords[record.name] = record;

  } else if (record.recordType == DNSCodes.RECORD_TYPES.A) {
    this._addrRecords[record.name] = record;
  }
};

DiscoverRegistry.prototype.serviceInfo = function(location) {
  // Get the PTR record for this location.
  let ptrRecord = this._ptrRecords[location];
  if (!ptrRecord)
    return null;

  // Get the SRV record for this location.
  let srvRecord = this._srvRecords[location];
  if (!srvRecord)
    return null;

  // Get the TXT record for this location.
  let txt = {};
  let txtRecord = this._txtRecords[location];
  if (txtRecord) {
    for (let part of txtRecord.parsedData.parts) {
      let idx = part.indexOf('=');
      if (idx == -1)
        continue;
      txt[part.slice(0, idx)] = part.slice(idx+1);
    }
  }

  // Get the A record for the SRV target.
  let port = srvRecord.parsedData.port;
  let target = srvRecord.parsedData.target;
  let addrRecord = this._addrRecords[target];
  if (!addrRecord)
    return null;

  let ip = addrRecord.parsedData.ip;

  // Compose the info into a ServiceInfo and return it.
  return new ServiceInfo({location, target, ip, port, txt});
};


function ServiceInfo({location, target, ip, port, txt}) {
  this.location = location;
  this.target = target;
  this.ip = ip;
  this.port = port;
  this.txt = txt;
}

ServiceInfo.prototype.equals = function (other) {
  return (this.location == other.location) &&
         (this.target == other.target) &&
         (this.ip == other.ip) &&
         (this.port == other.port);
}

exports.DiscoverRegistry = DiscoverRegistry;
exports.ServiceInfo = ServiceInfo;
