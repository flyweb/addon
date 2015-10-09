var {Cc, Ci, Cu} = require("chrome");

var utils = require("./utils");
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
var {AdvertisedService,
     AdvertiseRegistry} = require('./advertise-registry');
var {DiscoverListenerList,
     DiscoverListener} = require('./discover-listener');

/* The following was modified from https://github.com/justindarc/dns-sd.js */

/**
 * DNSSD
 */

const DNSSD_SERVICE_NAME    = '_services._dns-sd._udp.local';

// Actual mDNS port and group
//const DNSSD_MULTICAST_GROUP = '224.0.0.251';
//const DNSSD_PORT            = 5353;

// Fake prototype mDNS port and group
const DNSSD_MULTICAST_GROUP = '224.0.1.253';
const DNSSD_PORT            = 6363;

var DNSSD = new EventTarget();

var discovering = false;
var discoverRegistry = new DiscoverRegistry();
var advertiseRegistry = new AdvertiseRegistry();

var discoverListeners = new DiscoverListenerList();

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
  let svc = new AdvertisedService({
    serviceName: serviceName,
    name: name,
    port: port || 0,
    options: options || {}
  });
  advertiseRegistry.addService(svc);

  // Broadcast advertisement of registered services.
  advertise();

  return svc;
};

DNSSD.unregisterService = function(fullname) {
  advertiseRegistry.delService(fullname);

  // Broadcast advertisement of registered services.
  advertise();
};

function handleQueryPacket(packet, message) {
  packet.getRecords('QD').forEach((record) => {
    // Don't respond if the query's class code is not IN or ANY.
    if (record.classCode !== DNSCodes.CLASS_CODES.IN &&
        record.classCode !== DNSCodes.CLASS_CODES.ANY) {
      return;
    }

    if (record.recordType === DNSCodes.RECORD_TYPES.PTR) {
      respondToPtrQuery(record, message);
      return;
    }

    if (record.recordType === DNSCodes.RECORD_TYPES.SRV) {
      respondToSrvQuery(record, message);
      return;
    }

    if (record.recordType === DNSCodes.RECORD_TYPES.A) {
      respondToAddrQuery(record, message);
      return;
    }

    if (record.recordType === DNSCodes.RECORD_TYPES.TXT) {
      respondToTxtQuery(record, message);
      return;
    }

    if (record.recordType === DNSCodes.RECORD_TYPES.ANY) {
      respondToAnyQuery(record, message);
      return;
    }
  });
}

function respondToPtrQuery(query, message) {
  dump("KVKV: Respond to PTR Query: " + JSON.stringify(query) + "\n");
  advertiseRegistry.names().forEach(fullname => {
    let svc = advertiseRegistry.getService(fullname);
    if (svc.serviceName == query.name) {
      // Respond to query.
      utils.getIp().then((ip) => {
        DNSSD.getAdvertisingSocket().then((socket) => {
          let packet = new DNSPacket();
          packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.RESPONSE;
          packet.flags.AA = DNSCodes.AUTHORITATIVE_ANSWER_CODES.YES;
          let target = message.fromAddr;
          dump("KVKV: Sending service: " + JSON.stringify(svc) + "\n");
          packet.addRecord('QD', query);
          addPtrRecord(svc, packet, 'AN');
          addSrvRecord(svc, packet, 'AR');
          addAddrRecord(svc, ip, packet, 'AR');
          addTxtRecord(svc, packet, 'AR');
          sendPacket(packet, socket, target.address, target.port);
        }).catch((err) => {
          dump("Caught error: " + err.toString() + "\n");
          dump(err.stack + "\n");
        });
      }).catch((err) => {
        dump("Caught error: " + err.toString() + "\n");
        dump(err.stack + "\n");
      });
    }
  });
}

function respondToSrvQuery(query, message) {
  dump("KVKV: Respond to SRV Query: " + JSON.stringify(query) + "\n");
  for (let fullname of advertiseRegistry.names()) {
    let svc = advertiseRegistry.getService(fullname);
    if (svc.location == query.name) {
      // Respond to query.
      var packet = new DNSPacket();
      packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.RESPONSE;
      packet.flags.AA = DNSCodes.AUTHORITATIVE_ANSWER_CODES.YES;
      utils.getIp().then((ip) => {
        DNSSD.getAdvertisingSocket().then((socket) => {
          let target = message.fromAddr;
          packet.addRecord('QD', query);
          addSrvRecord(svc, packet, 'AN');
          addAddrRecord(svc, ip, packet, 'AR');
          addTxtRecord(svc, packet, 'AR');
          sendPacket(packet, socket, target.address, target.port);
        }).catch((err) => {
          dump("Caught error: " + err.toString() + "\n");
          dump(err.stack + "\n");
        });
      }).catch((err) => {
        dump("Caught error: " + err.toString() + "\n");
        dump(err.stack + "\n");
      });
    }
  }
}

function respondToAddrQuery(query, message) {
  dump("KVKV: TODO: Respond to A Query: " + JSON.stringify(query) + "\n");
  for (let fullname of advertiseRegistry.names()) {
    let svc = advertiseRegistry.getService(fullname);
    if (svc.target == query.name) {
      // Respond to query.
      var packet = new DNSPacket();
      packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.RESPONSE;
      packet.flags.AA = DNSCodes.AUTHORITATIVE_ANSWER_CODES.YES;
      utils.getIp().then((ip) => {
        DNSSD.getAdvertisingSocket().then((socket) => {
          let target = message.fromAddr;
          packet.addRecord('QD', query);
          addAddrRecord(svc, ip, packet, 'AN');
          sendPacket(packet, socket, target.address, target.port);
        }).catch((err) => {
          dump("Caught error: " + err.toString() + "\n");
          dump(err.stack + "\n");
        });
      }).catch((err) => {
        dump("Caught error: " + err.toString() + "\n");
        dump(err.stack + "\n");
      });
    }
  }
}

function respondToTxtQuery(query, message) {
  dump("KVKV: TODO: Respond to TXT Query: " + JSON.stringify(query) + "\n");
  for (let fullname of advertiseRegistry.names()) {
    let svc = advertiseRegistry.getService(fullname);
    if (svc.location == query.name) {
      // Respond to query.
      var packet = new DNSPacket();
      packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.RESPONSE;
      packet.flags.AA = DNSCodes.AUTHORITATIVE_ANSWER_CODES.YES;
      utils.getIp().then((ip) => {
        DNSSD.getAdvertisingSocket().then((socket) => {
          let target = message.fromAddr;
          packet.addRecord('QD', query);
          addTxtRecord(svc, packet, 'An');
          sendPacket(packet, socket, target.address, target.port);
        }).catch((err) => {
          dump("Caught error: " + err.toString() + "\n");
          dump(err.stack + "\n");
        });
      }).catch((err) => {
        dump("Caught error: " + err.toString() + "\n");
        dump(err.stack + "\n");
      });
    }
  }
}

function respondToAnyQuery(query, message) {
  dump("KVKV: Respond to ANY Query: " + JSON.stringify(query) + "\n");
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
    discoverListeners.found(svcInfo);
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
  if (advertiseRegistry.hasServices()) {
    return;
  }

  utils.getIp().then((ip) => {
    DNSSD.getAdvertisingSocket().then((socket) => {
      for (var fullname of advertiseRegistry.names()) {
        advertiseService(fullname, socket, ip);
      }
    }).catch((err) => {
      dump("Caught error: " + err.toString() + "\n");
      dump(err.stack + "\n");
    });
  }).catch((err) => {
    dump("Caught error: " + err.toString() + "\n");
    dump(err.stack + "\n");
  });
}

function advertiseService(fullname, socket, ip) {
  let svc = advertiseRegistry.getService(fullname);
  if (!svc)
    return;
  dump("KVKV: advertiseService " + JSON.stringify(svc) + "\n");

  var packet = new DNSPacket();

  packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.RESPONSE;
  packet.flags.AA = DNSCodes.AUTHORITATIVE_ANSWER_CODES.YES;

  addPtrRecord(svc, packet, 'AN');
  addSrvRecord(svc, packet, 'AR');
  addAddrRecord(svc, ip, packet, 'AR');
  addTxtRecord(svc, packet, 'AR');
  sendPacket(packet, socket, DNSSD_MULTICAST_GROUP, DNSSD_PORT);
}

function sendPacket(packet, socket, targetip, port) {
  var data = packet.serialize();
  // socket.send(data, DNSSD_MULTICAST_GROUP, DNSSD_PORT);

  let raw = new DataView(data);
  let length =  raw.byteLength;
  let buf = [];
  for (let x = 0; x < length; x++) {
    let charcode = raw.getUint8(x);
    buf[x] = charcode;
  }
  socket.send(targetip, port, buf, buf.length);

  // Parse raw data from packet.
  let parsed_packet = new DNSPacket(data);
  dump("KVKV: Sent packet: " + JSON.stringify(parsed_packet) + "\n");
}

function addServiceToPacket(svc, packet, ip) {
  addPtrRecord(svc, packet, 'AN');
  addSrvRecord(svc, packet, 'AR');
  addAddrRecord(svc, ip, packet, 'AR');
  addTxtRecord(svc, packet, 'AR');
}

function addPtrRecord(svc, packet, section) {
  let location = svc.location;
  let rec = new DNSResourceRecord(svc.serviceName, DNSCodes.RECORD_TYPES.PTR);
  rec.setParsedData({location});
  packet.addRecord(section, rec);
}

function addSrvRecord(svc, packet, section) {
  let priority = 0;
  let weight = 0;
  let port = svc.port;
  let target = svc.target;
  let rec = new DNSResourceRecord(svc.location, DNSCodes.RECORD_TYPES.SRV);
  rec.setParsedData({priority,weight,port,target});
  packet.addRecord(section, rec);
}

function addAddrRecord(svc, ip, packet, section) {
  let rec = new DNSResourceRecord(svc.target, DNSCodes.RECORD_TYPES.A);
  rec.setParsedData({ip});
  packet.addRecord(section, rec);
}

function addTxtRecord(svc, packet, section) {
  let parts = [];
  for (let name in svc.options) {
    parts.push(name + "=" + svc.options[name]);
  }
  var rec = new DNSResourceRecord(svc.location, DNSCodes.RECORD_TYPES.TXT);
  rec.setParsedData({parts});
  packet.addRecord(section, rec);
}

/**
 * exports
 */

exports.startDiscovery = DNSSD.startDiscovery;
exports.stopDiscovery = DNSSD.stopDiscovery;
exports.registerService = DNSSD.registerService;
exports.unregisterService = DNSSD.unregisterService;
exports.discoverRegistry = discoverRegistry;
exports.discoverListeners = discoverListeners;
exports.getIp = utils.getIp;
exports.utils = utils;

exports.PACKETS = PACKETS;
