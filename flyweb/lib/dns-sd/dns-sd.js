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
const DNSSD_MULTICAST_GROUP = '224.0.0.251';
const DNSSD_PORT            = 5353;

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

DNSSD.registerService = function(serviceName, port, options) {
  services[serviceName] = {
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

  for (var serviceName in services) {
    addServiceToPacket(serviceName, packet);
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

function addServiceToPacket(serviceName, packet) {
  var service = services[serviceName];
  if (!service) {
    return;
  }

  var alias = serviceName;

  // SRV Record
  // var srv = new DNSResourceRecord(alias, DNSCodes.RECORD_TYPES.SRV);
  // var srvData = new ByteArray();
  // srvData.push(0x0000, 2);        // Priority
  // srvData.push(0x0000, 2);        // Weight
  // srvData.push(service.port, 2);  // Port
  // srvData.append(DNSUtils.nameToByteArray(serviceName));
  // srv.data = srvData;
  // packet.addRecord('AR', srv);

  // TXT Record
  // var txt = new DNSResourceRecord(alias, DNSCodes.RECORD_TYPES.TXT);
  // var txtData = new ByteArray();

  // for (var key in service.options) {
  //   txtData.append(DNSUtils.nameToByteArray(key + '=' + service.options[key]));
  // }

  // txt.data = txtData;
  // packet.addRecord('AR', txt);

  // PTR Wildcard Record
  var ptrWildcard = new DNSResourceRecord(DNSSD_SERVICE_NAME, DNSCodes.RECORD_TYPES.PTR);
  ptrWildcard.data = DNSUtils.nameToByteArray(serviceName);
  packet.addRecord('AN', ptrWildcard);

  // PTR Service Record
  var ptrService = new DNSResourceRecord(serviceName, DNSCodes.RECORD_TYPES.PTR);
  ptrService.data = DNSUtils.nameToByteArray(alias);
  packet.addRecord('AN', ptrService);
}

/**
 * exports
 */

exports.startDiscovery = DNSSD.startDiscovery;
exports.stopDiscovery = DNSSD.stopDiscovery;
exports.registerService = DNSSD.registerService;

exports.PACKETS = PACKETS;
