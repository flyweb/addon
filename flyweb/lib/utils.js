var {Cc, Ci, Cu} = require("chrome");

const systemPrincipal = Cc["@mozilla.org/systemprincipal;1"].createInstance(Ci.nsIPrincipal);

function newUDPSocket(config) {
    let loopback = config.loopback || false;
    let port = config.localPort || 0;
    let principal = config.principal || systemPrincipal;
    let sock = Cc["@mozilla.org/network/udp-socket;1"].createInstance(Ci.nsIUDPSocket);
    sock.init(port, loopback, principal);
    return sock;
}

function raiseError(err) {
    dump("!!! Exception raised: " + err.toString() + "\n");
    dump(err.stack + "\n");
    throw err;
}

function tryWrap(fn) {
    try {
        fn();
    } catch(err) {
        dump("tryWrap ERROR: " + err.toString() + "\n");
        dump(err.stack + "\n");
        throw err;
    }
}

function getIp() {
  return new Promise((resolve, reject) => {
    let receiver = newUDPSocket({localPort: 0, loopback: false});
    let sender = newUDPSocket({localPort: 0, loopback: false});
    const MULTICAST_GROUP = '224.0.2.222';
    const PORT = receiver.port;

    receiver.asyncListen({
      onPacketReceived: function(aSocket, aMessage) {
        let packet = aMessage.rawData;
        let addr = aMessage.fromAddr.address;
        receiver.close();
        sender.close();
        resolve(addr);
      },

      onStopListening: function(aSocket, aStatus) {
      },
    });
    receiver.joinMulticast(MULTICAST_GROUP);

    let msg = "FLYWEB_IP_HACK";
    let msgarray = [];
    for (let i = 0; i < msg.length; i++)
        msgarray.push(msg.charCodeAt(i));
    sender.asyncListen({
      onPacketReceived: function(aSocket, aMessage) {},
      onStopListening: function(aSocket, aStatus) {},
    });
    sender.send(MULTICAST_GROUP, PORT, msgarray, msgarray.length);
  });
}

exports.systemPrincipal = systemPrincipal;
exports.newUDPSocket = newUDPSocket;
exports.raiseError = raiseError;
exports.tryWrap = tryWrap;
exports.getIp = getIp;
