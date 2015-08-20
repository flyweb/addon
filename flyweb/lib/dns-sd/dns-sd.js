var { emit, on, once, off } = require("sdk/event/core");
var {Cc, Ci, Cu} = require("chrome");

var utils = require("../utils");
var BinaryUtils = require('./binary-utils');

/* The following was modified from https://github.com/justindarc/dns-sd.js */


/**
 * ByteArray
 */

function ByteArray(maxBytesOrData) {
  if (maxBytesOrData instanceof Uint8Array ||
      maxBytesOrData instanceof ArrayBuffer) {
    this._data = new Uint8Array(maxBytesOrData);
    this._buffer = this._data.buffer;
    this._cursor = this._data.length;
    return this;
  }

  this._buffer = new ArrayBuffer(maxBytesOrData || 256);
  this._data = new Uint8Array(this._buffer);
  this._cursor = 0;
}

ByteArray.prototype.constructor = ByteArray;

Object.defineProperty(ByteArray.prototype, 'byteLength', {
  get: function() {
    return this._cursor;
  }
});

Object.defineProperty(ByteArray.prototype, 'buffer', {
  get: function() {
    return this._buffer.slice(0, this._cursor);
  }
});

ByteArray.prototype.push = function(value, byteLength) {
  byteLength = byteLength || 1;

  this.append(valueToUint8Array(value, byteLength));
};

ByteArray.prototype.append = function(bytes) {
  if (bytes instanceof ByteArray) {
    bytes = bytes.buffer;
  }

  if (bytes instanceof ArrayBuffer) {
    bytes = new Uint8Array(bytes);
  }

  for (var i = 0, byteLength = bytes.length; i < byteLength; i++) {
    this._data[this._cursor] = bytes[i];
    this._cursor++;
  }
};

ByteArray.prototype.getReader = function(startByte) {
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
};

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

/**
 * DNSCodes
 */

const QUERY_RESPONSE_CODES = defineType({
  QUERY       : 0,      // RFC 1035 - Query
  RESPONSE    : 1       // RFC 1035 - Reponse
});

const OPERATION_CODES = defineType({
  QUERY       : 0,      // RFC 1035 - Query
  IQUERY      : 1,      // RFC 1035 - Inverse Query
  STATUS      : 2,      // RFC 1035 - Status
  NOTIFY      : 4,      // RFC 1996 - Notify
  UPDATE      : 5       // RFC 2136 - Update
});

const AUTHORITATIVE_ANSWER_CODES = defineType({
  NO          : 0,      // RFC 1035 - Not Authoritative
  YES         : 1       // RFC 1035 - Is Authoritative
});

const TRUNCATED_RESPONSE_CODES = defineType({
  NO          : 0,      // RFC 1035 - Not Truncated
  YES         : 1       // RFC 1035 - Is Truncated
});

const RECURSION_DESIRED_CODES = defineType({
  NO          : 0,      // RFC 1035 - Recursion Not Desired
  YES         : 1       // RFC 1035 - Recursion Is Desired
});

const RECURSION_AVAILABLE_CODES = defineType({
  NO          : 0,      // RFC 1035 - Recursive Query Support Not Available
  YES         : 1       // RFC 1035 - Recursive Query Support Is Available
});

const AUTHENTIC_DATA_CODES = defineType({
  NO          : 0,      // RFC 4035 - Response Has Not Been Authenticated/Verified
  YES         : 1       // RFC 4035 - Response Has Been Authenticated/Verified
});

const CHECKING_DISABLED_CODES = defineType({
  NO          : 0,      // RFC 4035 - Authentication/Verification Checking Not Disabled
  YES         : 1       // RFC 4035 - Authentication/Verification Checking Is Disabled
});

const RETURN_CODES = defineType({
  NOERROR     : 0,      // RFC 1035 - No Error
  FORMERR     : 1,      // RFC 1035 - Format Error
  SERVFAIL    : 2,      // RFC 1035 - Server Failure
  NXDOMAIN    : 3,      // RFC 1035 - Non-Existent Domain
  NOTIMP      : 4,      // RFC 1035 - Not Implemented
  REFUSED     : 5,      // RFC 1035 - Query Refused
  YXDOMAIN    : 6,      // RFC 2136 - Name Exists when it should not
  YXRRSET     : 7,      // RFC 2136 - RR Set Exists when it should not
  NXRRSET     : 8,      // RFC 2136 - RR Set that should exist does not
  NOTAUTH     : 9,      // RFC 2136 - Server Not Authoritative for zone
  NOTZONE     : 10      // RFC 2136 - NotZone Name not contained in zone
});

const CLASS_CODES = defineType({
  IN          : 1,      // RFC 1035 - Internet
  CS          : 2,      // RFC 1035 - CSNET
  CH          : 3,      // RFC 1035 - CHAOS
  HS          : 4,      // RFC 1035 - Hesiod
  NONE        : 254,    // RFC 2136 - None
  ANY         : 255     // RFC 1035 - Any
});

const OPTION_CODES = defineType({
  LLQ         : 1,      // RFC ???? - Long-Lived Queries
  UL          : 2,      // RFC ???? - Update Leases
  NSID        : 3,      // RFC ???? - Name Server Identifier
  OWNER       : 4,      // RFC ???? - Owner
  UNKNOWN     : 65535   // RFC ???? - Token
});

const RECORD_TYPES = defineType({
  SIGZERO     : 0,      // RFC 2931
  A           : 1,      // RFC 1035
  NS          : 2,      // RFC 1035
  MD          : 3,      // RFC 1035
  MF          : 4,      // RFC 1035
  CNAME       : 5,      // RFC 1035
  SOA         : 6,      // RFC 1035
  MB          : 7,      // RFC 1035
  MG          : 8,      // RFC 1035
  MR          : 9,      // RFC 1035
  NULL        : 10,     // RFC 1035
  WKS         : 11,     // RFC 1035
  PTR         : 12,     // RFC 1035
  HINFO       : 13,     // RFC 1035
  MINFO       : 14,     // RFC 1035
  MX          : 15,     // RFC 1035
  TXT         : 16,     // RFC 1035
  RP          : 17,     // RFC 1183
  AFSDB       : 18,     // RFC 1183
  X25         : 19,     // RFC 1183
  ISDN        : 20,     // RFC 1183
  RT          : 21,     // RFC 1183
  NSAP        : 22,     // RFC 1706
  NSAP_PTR    : 23,     // RFC 1348
  SIG         : 24,     // RFC 2535
  KEY         : 25,     // RFC 2535
  PX          : 26,     // RFC 2163
  GPOS        : 27,     // RFC 1712
  AAAA        : 28,     // RFC 1886
  LOC         : 29,     // RFC 1876
  NXT         : 30,     // RFC 2535
  EID         : 31,     // RFC ????
  NIMLOC      : 32,     // RFC ????
  SRV         : 33,     // RFC 2052
  ATMA        : 34,     // RFC ????
  NAPTR       : 35,     // RFC 2168
  KX          : 36,     // RFC 2230
  CERT        : 37,     // RFC 2538
  DNAME       : 39,     // RFC 2672
  OPT         : 41,     // RFC 2671
  APL         : 42,     // RFC 3123
  DS          : 43,     // RFC 4034
  SSHFP       : 44,     // RFC 4255
  IPSECKEY    : 45,     // RFC 4025
  RRSIG       : 46,     // RFC 4034
  NSEC        : 47,     // RFC 4034
  DNSKEY      : 48,     // RFC 4034
  DHCID       : 49,     // RFC 4701
  NSEC3       : 50,     // RFC ????
  NSEC3PARAM  : 51,     // RFC ????
  HIP         : 55,     // RFC 5205
  SPF         : 99,     // RFC 4408
  UINFO       : 100,    // RFC ????
  UID         : 101,    // RFC ????
  GID         : 102,    // RFC ????
  UNSPEC      : 103,    // RFC ????
  TKEY        : 249,    // RFC 2930
  TSIG        : 250,    // RFC 2931
  IXFR        : 251,    // RFC 1995
  AXFR        : 252,    // RFC 1035
  MAILB       : 253,    // RFC 1035
  MAILA       : 254,    // RFC 1035
  ANY         : 255,    // RFC 1035
  DLV         : 32769   // RFC 4431
});

function defineType(values) {
  function T(value) {
    for (var name in T) {
      if (T[name] === value) {
        return name;
      }
    }

    return null;
  }

  for (var name in values) {
    T[name] = values[name];
  }

  return T;
}

var DNSCodes = {
  QUERY_RESPONSE_CODES        : QUERY_RESPONSE_CODES,
  OPERATION_CODES             : OPERATION_CODES,
  AUTHORITATIVE_ANSWER_CODES  : AUTHORITATIVE_ANSWER_CODES,
  TRUNCATED_RESPONSE_CODES    : TRUNCATED_RESPONSE_CODES,
  RECURSION_DESIRED_CODES     : RECURSION_DESIRED_CODES,
  RECURSION_AVAILABLE_CODES   : RECURSION_AVAILABLE_CODES,
  AUTHENTIC_DATA_CODES        : AUTHENTIC_DATA_CODES,
  CHECKING_DISABLED_CODES     : CHECKING_DISABLED_CODES,
  RETURN_CODES                : RETURN_CODES,
  CLASS_CODES                 : CLASS_CODES,
  OPTION_CODES                : OPTION_CODES,
  RECORD_TYPES                : RECORD_TYPES
};

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
 * DNSQuestionRecord
 */

function DNSQuestionRecord(name, recordType, classCode) {
  this.name = name;
  this.recordType = recordType;
  this.recordTypeName = DNSCodes.RECORD_TYPES(recordType) || "!!UNKNOWN!!";
  this.classCode = classCode || DNSCodes.CLASS_CODES.IN;
}

DNSQuestionRecord.prototype = Object.create(DNSRecord.prototype);

DNSQuestionRecord.prototype.constructor = DNSQuestionRecord;

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
 * DNSResourceRecord
 */

const DNS_RESOURCE_RECORD_DEFAULT_TTL = 10; // 10 seconds
// const DNS_RESOURCE_RECORD_DEFAULT_TTL = 3600; // 1 hour

function DNSResourceRecord(name, recordType, classCode, ttl, data) {
  this.name = name;
  this.recordType = recordType;
  this.recordTypeName = DNSCodes.RECORD_TYPES(recordType) || "!!UNKNOWN!!";
  this.classCode = classCode || DNSCodes.CLASS_CODES.IN;
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
 * DNSUtils
 */

var DNSUtils = {
  parseNameIntoArray: function(byteArrayOrReader, outArray) {
    var byteArray;
    var reader;

    if (byteArrayOrReader instanceof ByteArray) {
      byteArray = byteArrayOrReader;
      reader = byteArray.getReader();
    } else {
      reader = byteArrayOrReader;
      byteArray = reader.byteArray;
    }

    var partLength;
    while (partLength = reader.getValue()) {
      if ((partLength & 0xc0) == 0xc0) {
        // name pointer to elsewhere in the response.
        var nextByte = reader.getValue();
        var offset = ((partLength & 0x3f) << 8) | nextByte;
        var subReader = byteArray.getReader(offset);
        DNSUtils.parseNameIntoArray(subReader, outArray);
        break;
      }

      var nameBytes = reader.getBytes(partLength);
      outArray.push(BinaryUtils.arrayBufferToString(nameBytes));
    }
  },

  byteArrayToName: function(byteArrayOrReader) {
    var parts = [];
    DNSUtils.parseNameIntoArray(byteArrayOrReader, parts)
    return parts.join('.');
  },

  nameToByteArray: function(name) {
    var byteArray = new ByteArray();
    var parts = name.split('.');
    parts.forEach((part) => {
      var length = part.length;
      byteArray.push(length);

      for (var i = 0; i < length; i++) {
        byteArray.push(part.charCodeAt(i));
      }
    });

    byteArray.push(0x00);

    return byteArray;
  },

  valueToFlags: function(value) {
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
  },

  flagsToValue: function(flags) {
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

};

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
