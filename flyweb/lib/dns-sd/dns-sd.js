var { emit, on, once, off } = require("sdk/event/core");
var {Cc, Ci, Cu} = require("chrome");

var utils = require("../utils");
var BinaryUtils = require('./binary-utils');
var ByteArray = require('./byte-array');
var DNSCodes = require('./dns-codes');
var DNSUtils = require('./dns-utils');
var {DNSRecord,
     DNSQuestionRecord,
     DNSResourceRecord} = require('./dns-records');

/* The following was modified from https://github.com/justindarc/dns-sd.js */

/**
 * DNSPacket
 */

const DNS_PACKET_RECORD_SECTION_TYPES = [
  'QD', // Question
  'AN', // Answer
  'NS', // Authority
  'AR'  // Additional
];

/**
 * DNS Packet Structure
 * *************************************************
 *
 * Header
 * ======
 *
 * 00                   2-Bytes                   15
 * -------------------------------------------------
 * |00|01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|
 * -------------------------------------------------
 * |<==================== ID =====================>|
 * |QR|<== OP ===>|AA|TC|RD|RA|UN|AD|CD|<== RC ===>|
 * |<================== QDCOUNT ==================>|
 * |<================== ANCOUNT ==================>|
 * |<================== NSCOUNT ==================>|
 * |<================== ARCOUNT ==================>|
 * -------------------------------------------------
 *
 * ID:        2-Bytes
 * FLAGS:     2-Bytes
 *  - QR:     1-Bit
 *  - OP:     4-Bits
 *  - AA:     1-Bit
 *  - TC:     1-Bit
 *  - RD:     1-Bit
 *  - RA:     1-Bit
 *  - UN:     1-Bit
 *  - AD:     1-Bit
 *  - CD:     1-Bit
 *  - RC:     4-Bits
 * QDCOUNT:   2-Bytes
 * ANCOUNT:   2-Bytes
 * NSCOUNT:   2-Bytes
 * ARCOUNT:   2-Bytes
 *
 *
 * Data
 * ====
 *
 * 00                   2-Bytes                   15
 * -------------------------------------------------
 * |00|01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|
 * -------------------------------------------------
 * |<???=============== QD[...] ===============???>|
 * |<???=============== AN[...] ===============???>|
 * |<???=============== NS[...] ===============???>|
 * |<???=============== AR[...] ===============???>|
 * -------------------------------------------------
 *
 * QD:        ??-Bytes
 * AN:        ??-Bytes
 * NS:        ??-Bytes
 * AR:        ??-Bytes
 *
 *
 * Question Record
 * ===============
 *
 * 00                   2-Bytes                   15
 * -------------------------------------------------
 * |00|01|02|03|04|05|06|07|08|09|10|11|12|13|14|15|
 * -------------------------------------------------
 * |<???================ NAME =================???>|
 * |<=================== TYPE ====================>|
 * |<=================== CLASS ===================>|
 * -------------------------------------------------
 *
 * NAME:      ??-Bytes
 * TYPE:      2-Bytes
 * CLASS:     2-Bytes
 *
 *
 * Resource Record
 * ===============
 *
 * 00                   4-Bytes                   31
 * -------------------------------------------------
 * |00|02|04|06|08|10|12|14|16|18|20|22|24|26|28|30|
 * -------------------------------------------------
 * |<???================ NAME =================???>|
 * |<======= TYPE ========>|<======= CLASS =======>|
 * |<==================== TTL ====================>|
 * |<====== DATALEN ======>|<???==== DATA =====???>|
 * -------------------------------------------------
 *
 * NAME:      ??-Bytes
 * TYPE:      2-Bytes
 * CLASS:     2-Bytes
 * DATALEN:   2-Bytes
 * DATA:      ??-Bytes (Specified By DATALEN)
 */
function DNSPacket(arrayBuffer) {
  this.flags = DNSUtils.valueToFlags(0x0000);
  this.records = {};

  DNSPacket.RECORD_SECTION_TYPES.forEach((recordSectionType) => {
    this.records[recordSectionType] = [];
  });

  if (!arrayBuffer) {
    return this;
  }

  exports.PACKETS.push({buffer:arrayBuffer, packet:this});

  var byteArray = new ByteArray(arrayBuffer);
  var reader = byteArray.getReader();

  if (reader.getValue(2) !== 0x0000) {
    throw new Error('Packet must start with 0x0000');
  }

  this.flags = DNSUtils.valueToFlags(reader.getValue(2));

  var recordCounts = {};

  // Parse the record counts.
  DNSPacket.RECORD_SECTION_TYPES.forEach((recordSectionType) => {
    recordCounts[recordSectionType] = reader.getValue(2);
  });

  // Parse the actual records.
  DNSPacket.RECORD_SECTION_TYPES.forEach((recordSectionType) => {
    var count = recordCounts[recordSectionType];
    var name;

    for (var i = 0; i < count; i++) {
      offset = reader.offset;
      name = DNSUtils.byteArrayToName(reader);// || name;

      if (recordSectionType === 'QD') {
        let rec = new DNSQuestionRecord(
          name,               // Name
          reader.getValue(2), // Type
          reader.getValue(2)  // Class
        );
        rec.offset = offset;
        this.addRecord(recordSectionType, rec);
      }

      else {
        let type = reader.getValue(2);
        let cls = reader.getValue(2);
        let ttl = reader.getValue(4);
        let dataLen = reader.getValue(2);
        let dataOffset = reader.offset;
        let data = reader.getBytes(dataLen);
        let rec = new DNSResourceRecord(name, type, cls, ttl, data);
        rec.parseData(byteArray, dataOffset);
        rec.offset = offset;
        this.addRecord(recordSectionType, rec);
      }
    }
  });

  if (!reader.isEOF()) {
    console.warn('Did not complete parsing packet data');
  }
}

DNSPacket.RECORD_SECTION_TYPES = DNS_PACKET_RECORD_SECTION_TYPES;

DNSPacket.prototype.constructor = DNSPacket;

DNSPacket.prototype.addRecord = function(recordSectionType, record) {
  this.records[recordSectionType].push(record);
};

DNSPacket.prototype.getRecords = function(recordSectionType) {
  return this.records[recordSectionType];
};

DNSPacket.prototype.serialize = function() {
  var byteArray = new ByteArray();

  byteArray.push(0x0000, 2);
  byteArray.push(DNSUtils.flagsToValue(this.flags), 2);

  DNSPacket.RECORD_SECTION_TYPES.forEach((recordSectionType) => {
    byteArray.push(this.records[recordSectionType].length, 2);
  });

  DNSPacket.RECORD_SECTION_TYPES.forEach((recordSectionType) => {
    this.records[recordSectionType].forEach((record) => {
      byteArray.append(DNSUtils.nameToByteArray(record.name));
      byteArray.push(record.recordType, 2);
      byteArray.push(record.classCode, 2);

      // No more data to serialize if this is a question record.
      if (recordSectionType === 'QD') {
        return;
      }

      byteArray.push(record.ttl, 4);

      var data = record.data;
      if (data instanceof ByteArray) {
        data = new Uint8Array(data.buffer);
      }

      if (data instanceof ArrayBuffer) {
        data = new Uint8Array(data);
      }

      byteArray.push(data.length, 2);
      byteArray.append(data);
    });
  });

  return byteArray.buffer;
};

/**
 * DNSSD
 */

const DNSSD_SERVICE_NAME    = '_services._dns-sd._udp.local';
const DNSSD_MULTICAST_GROUP = '224.0.0.251';
const DNSSD_PORT            = 5353;

var DNSSD = new EventTarget();

var discovering = false;
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
        onPacketReceived: function(aSocket, aMessage) {
          dump("KVKV: Packet received on discovery socket! " + aMessage.rawData + "\n");
          let packet = new DNSPacket(aMessage.rawData);
          switch (packet.flags.QR) {
            case DNSCodes.QUERY_RESPONSE_CODES.RESPONSE:
              dump("KVKV: Reponse packet:\n" + JSON.stringify(packet, null, 2) + "\n");
              handleResponsePacket.call(this, packet, aMessage);
              break;
            default:
              break;
          }
        },

        onStopListening: function(aSocket, aStatus) {
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

function handleResponsePacket(packet, message) {
  if (!discovering) {
    return;
  }

  var services = [];
  var domainNames =[];
  packet.getRecords('AN').forEach((record) => {
    dump("KVKV: -- AN record!\n");
    if (record.recordType === DNSCodes.RECORD_TYPES.PTR) {
      let name = record.getName();
      dump("KVKV: -- -- is PTR record! name=" + name + "\n");
      let domain = record.getData().name;
      if (name && domain && name[0] == '_' && name.indexOf('.local') != -1) {
        services.push(record.getName());
        domainNames.push(record.getData());
        dump("PTR = name: " + name + " data: " + domain + "\n");
      }
    }

    if (record.recordType === DNSCodes.RECORD_TYPES.SRV) {
      dump("KVKV: -- -- is SRV record!\n");
      // SRV data does not work yet
      // console.log("SRV = name: " + record.getName() + " data: " + record.getData());
    }
  });

  emit(exports, 'discovered', {
    address: message.fromAddr.address,
    services: services,
    domainNames: domainNames
  });

  DNSSD.dispatchEvent('discovered', {
    message: message,
    packet: packet,
    //address: message.remoteAddress,
    address: message.fromAddr.address,
    services: services
  });
}

function discover(target) {
  var packet = new DNSPacket();

  packet.flags.QR = DNSCodes.QUERY_RESPONSE_CODES.QUERY;

  var question = new DNSQuestionRecord(target ? target : DNSSD_SERVICE_NAME, DNSCodes.RECORD_TYPES.PTR);
  packet.addRecord('QD', question);

  dump("KVKV: discover()\n");
  DNSSD.getDiscoverySocket().then((socket) => {
    dump("KVKV: discover() - got socket\n");
    var data = packet.serialize();
    // socket.send(data, DNSSD_MULTICAST_GROUP, DNSSD_PORT);

    let raw = new DataView(data);
    let length =  raw.byteLength;
    let buf = [];
    for (let x = 0; x < length; x++) {
      let charcode = raw.getUint8(x);
      buf[x] = charcode;
    }
    dump("KVKV: discover() - sending data: " + buf + "\n");
    socket.send( DNSSD_MULTICAST_GROUP, DNSSD_PORT, buf, buf.length);
  }).catch((err) => {
    dump("KVKV: Caught error: " + err.toString() + "\n");
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
    dump("KVKV: Caught error: " + err.toString() + "\n");
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
 * EventTarget
 */

function EventTarget(object) {
  if (typeof object !== 'object') {
    return;
  }

  for (var property in object) {
    this[property] = object[property];
  }
}

EventTarget.prototype.constructor = EventTarget;

EventTarget.prototype.dispatchEvent = function(name, data) {
  var events    = this._events || {};
  var listeners = events[name] || [];
  listeners.forEach((listener) => {
    listener.call(this, data);
  });
};

EventTarget.prototype.addEventListener = function(name, listener) {
  var events    = this._events = this._events || {};
  var listeners = events[name] = events[name] || [];
  if (listeners.find(fn => fn === listener)) {
    return;
  }

  listeners.push(listener);
};

EventTarget.prototype.removeEventListener = function(name, listener) {
  var events    = this._events || {};
  var listeners = events[name] || [];
  for (var i = listeners.length - 1; i >= 0; i--) {
    if (listeners[i] === listener) {
      listeners.splice(i, 1);
      return;
    }
  }
};

/**
 * IPUtils
 */

const CRLF = '\r\n';

var IPUtils = {
  getAddresses: function(callback) {
    if (typeof callback !== 'function') {
      console.warn('No callback provided');
      return;
    }

    var addresses = {
      '0.0.0.0': true
    };

    var rtc = new mozRTCPeerConnection({ iceServers: [] });
    rtc.createDataChannel('', { reliable: false });

    rtc.onicecandidate = function(evt) {
      if (evt.candidate) {
        parseSDP('a=' + evt.candidate.candidate);
      }
    };

    rtc.createOffer((description) => {
      parseSDP(description.sdp);
      rtc.setLocalDescription(description, noop, noop);
    }, (error) => {
      console.warn('Unable to create offer', error);
    });

    function addAddress(address) {
      if (addresses[address]) {
        return;
      }

      addresses[address] = true;
      callback(address);
    }

    function parseSDP(sdp) {
      sdp.split(CRLF).forEach((line) => {
        var parts = line.split(' ');

        if (line.indexOf('a=candidate') !== -1) {
          if (parts[7] === 'host') {
            addAddress(parts[4]);
          }
        }

        else if (line.indexOf('c=') !== -1) {
          addAddress(parts[2]);
        }
      });
    }
  }
};

function noop() {}

/**
 * exports
 */

exports.startDiscovery = DNSSD.startDiscovery;
exports.stopDiscovery = DNSSD.stopDiscovery;
exports.registerService = DNSSD.registerService;

exports.getDiscoverySocket = function () { return DNSSD.getDiscoverySocket() };

exports.PACKETS = [];

exports.on = on.bind(null, exports);
exports.once = once.bind(null, exports);
exports.removeListener = function removeListener(type, listener) {
  off(exports, type, listener);
};