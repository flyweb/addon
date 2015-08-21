var {Cc, Ci, Cu} = require("chrome");

var utils = require("../utils");
var {BinaryUtils} = require('./binary-utils');
var {ByteArray} = require('./byte-array');
var {DNSCodes} = require('./dns-codes');
var {DNSUtils} = require('./dns-utils');
var {DNSRecord,
     DNSQuestionRecord,
     DNSResourceRecord} = require('./dns-records');
var {DNSPacket, PACKETS} = require('./dns-packet');

var {EventTarget} = require('./event-target');
var {DiscoverRegistry} = require('./discover-registry');

/* The following was modified from https://github.com/justindarc/dns-sd.js */

/**
 * DNSSD
 */

const DNSSD_SERVICE_NAME    = '_services._dns-sd._udp.local';
//const DNSSD_MULTICAST_GROUP = '224.0.0.251';
//const DNSSD_PORT            = 5353;
const DNSSD_MULTICAST_GROUP = '224.0.1.253';
const DNSSD_PORT            = 6363;

var DNSSD = new EventTarget();

var discovering = false;
var discoverRegistry = new DiscoverRegistry();
var services = {};

DNSSD.getAdvertisingSocket = function() {
  return new Promise((resolve) => {
    if (!this.advertisingSocket) {
      this.advertisingSocket = utils.newUDPSocket({localPort: DNSSD_PORT,
                                                   loopback: false});
      this.advertisingSocket.asyncListen({
        onPacketReceived: function(aSocket, aMessage) {
          let packet = new DNSPacket(aMessage.rawData);
          switch (packet.flags.QR) {
            case DNSCodes.QUERY_RESPONSE_CODES.QUERY:
              handleQueryPacket.call(this, packet, aMessage);
              break;
            default:
              break;
          }
        },

        onStopListening: function(aSocket, aStatus) {
        },
      });
      this.advertisingSocket.joinMulticast(DNSSD_MULTICAST_GROUP);
    }

    resolve(this.advertisingSocket);
  });
};

DNSSD.getDiscoverySocket = function() {
  return new Promise((resolve) => {
    if (!this.discoverySocket) {
      this.discoverySocket = utils.newUDPSocket({localPort: 0,
                                                 loopback: false});
      this.discoverySocket.asyncListen({
        onPacketReceived(aSocket, aMessage) {
          let packet = new DNSPacket(aMessage.rawData);
          switch (packet.flags.QR) {
            case DNSCodes.QUERY_RESPONSE_CODES.RESPONSE:
              handleResponsePacket(packet);
              break;
            default:
              break;
          }
        },
        onStopListening(aSocket, aStatus) {
          if (handler.onStopListening)
            handler.onStopListening(aStatus);
        },
      });
    }
    resolve(this.discoverySocket);
  });
};

DNSSD.startDiscovery = function(target) {
  discovering = true;

  // Broadcast query for advertised services.
  discover.call(this, target);
};

DNSSD.stopDiscovery = function() {
  discovering = false;
};

DNSSD.registerService = function(serviceName, name, port, options) {
  let fullname = name + '.' + serviceName;
  services[fullname] = {
    serviceName: serviceName,
    name: name,
    port: port || 0,
    options: options || {}
  };

  // Broadcast advertisement of registered services.
  advertise.call(this);
};

DNSSD.unregisterService = function(serviceName) {
  delete services[serviceName];

  // Broadcast advertisement of registered services.
  advertise.call(this);
};

function handleQueryPacket(packet, message) {
  packet.getRecords('QD').forEach((record) => {
    // Don't respond if the query's class code is not IN or ANY.
    if (record.classCode !== DNSCodes.CLASS_CODES.IN &&
        record.classCode !== DNSCodes.CLASS_CODES.ANY) {
      return;
    }

    // Don't respond if the query's record type is not PTR, SRV or ANY.
    if (record.recordType !== DNSCodes.RECORD_TYPES.PTR &&
        record.recordType !== DNSCodes.RECORD_TYPES.SRV &&
        record.recordType !== DNSCodes.RECORD_TYPES.ANY) {
      return;
    }

    // Broadcast advertisement of registered services.
    advertise.call(this);
  });
}

function handleResponsePacket(packet) {
  if (!discovering) {
    return;
  }

  let seenServices = new Set();
  packet.getRecords('AN').forEach((record) => {
    handleResponseRecord(record, seenServices);
  });
  packet.getRecords('AR').forEach((record) => {
    handleResponseRecord(record, seenServices);
  });

  for (let svc of seenServices) {
    let svcInfo = discoverRegistry.serviceInfo(svc);
    dump("KVKV: Seen service " + svc + ": " + JSON.stringify(svcInfo) + "\n");
  }
}

function handleResponseRecord(record, seenServices) {
  discoverRegistry.addRecord(record, seenServices);
}

function discover(target) {
  var packet = new DNSPacket();
  packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.QUERY;
  var question = new DNSQuestionRecord(target ? target : DNSSD_SERVICE_NAME,
                                       DNSCodes.RECORD_TYPES.PTR);
  packet.addRecord('QD', question);

  DNSSD.getDiscoverySocket().then((socket) => {
    var data = packet.serialize();
    // socket.send(data, DNSSD_MULTICAST_GROUP, DNSSD_PORT);

    let raw = new DataView(data);
    let length =  raw.byteLength;
    let buf = [];
    for (let x = 0; x < length; x++) {
      let charcode = raw.getUint8(x);
      buf[x] = charcode;
    }
    socket.send( DNSSD_MULTICAST_GROUP, DNSSD_PORT, buf, buf.length);
  }).catch((err) => {
    dump("Caught error: " + err.toString() + "\n");
    dump(err.stack + "\n");
  });
}

function advertise() {
  if (Object.keys(services).length === 0) {
    return;
  }

  var packet = new DNSPacket();

  packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.RESPONSE;
  packet.flags.AA = DNSCodes.AUTHORITATIVE_ANSWER_CODES.YES;

  for (var fullname in services) {
    addServiceToPacket(fullname, packet);
  }

  DNSSD.getAdvertisingSocket().then((socket) => {
    var data = packet.serialize();
    // socket.send(data, DNSSD_MULTICAST_GROUP, DNSSD_PORT);

    let raw = new DataView(data);
    let length =  raw.byteLength;
    let buf = [];
    for (let x = 0; x < length; x++) {
      let charcode = raw.getUint8(x);
      buf[x] = charcode;
    }
    dump("KVKV: Sending data: " + JSON.stringify(buf) + "\n");
    socket.send(DNSSD_MULTICAST_GROUP, DNSSD_PORT, buf, buf.length);

    // Re-broadcast announcement after 1000ms (RFC6762, 8.3).
    // setTimeout(() => {
    //   socket.send(data, DNSSD_MULTICAST_GROUP, DNSSD_PORT);
    // }, 1000);
  }).catch((err) => {
    dump("Caught error: " + err.toString() + "\n");
    dump(err.stack + "\n");
  });
}

function addServiceToPacket(fullname, packet) {
  var service = services[fullname];
  if (!service) {
    return;
  }

  var location = service.name + '.' + service.serviceName;

  // PTR Record
  var ptrRecord = new DNSResourceRecord(service.serviceName,
                                         DNSCodes.RECORD_TYPES.PTR);
  ptrRecord.setParsedData({location});
  packet.addRecord('AN', ptrRecord);

  // SRV Record
  let priority = 0;
  let weight = 0;
  let port = service.port;
  let target = service.name + '.local';
  var srvRecord = new DNSResourceRecord(location,
                                        DNSCodes.RECORD_TYPES.SRV);
  srvRecord.setParsedData({priority,weight,port,target});
  packet.addRecord('AR', srvRecord);

  // TXT record
  let parts = [];
  for (let name in service.options) {
    parts.push(name + "=" + service.options[name]);
  }
  var txtRecord = new DNSResourceRecord(location,
                                        DNSCodes.RECORD_TYPES.TXT);
  txtRecord.setParsedData({parts});
  packet.addRecord('AR', txtRecord);
}

/**
 * exports
 */

exports.startDiscovery = DNSSD.startDiscovery;
exports.stopDiscovery = DNSSD.stopDiscovery;
exports.registerService = DNSSD.registerService;

exports.PACKETS = PACKETS;
