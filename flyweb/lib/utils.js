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

function newTCPServerSocket(config) {
    let loopback = config.loopback || false;
    let port = config.port || 0;
    let backlog = config.backlog || -1;
    let sock = Cc["@mozilla.org/network/server-socket;1"].createInstance(Ci.nsIServerSocket);
    sock.init(port, loopback, backlog);
    return sock;
}

function newBinaryInputStream(inputStream) {
    let bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
    bis.setInputStream(inputStream);
    return bis;
}

function newBinaryOutputStream(outputStream) {
    let bos = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    bos.setOutputStream(outputStream);
    return bos;
}

function newThreadManager() {
    return Cc["@mozilla.org/thread-manager;1"].createInstance(Ci.nsIThreadManager);
}

var ThreadManager;
function currentThread() {
    if (!ThreadManager)
        ThreadManager = newThreadManager();
    return ThreadManager.currentThread;
}

function dumpError(err) {
    dump("!!! Exception raised: " + err.toString() + "\n");
    dump(err.stack + "\n");
}

function raiseError(err) {
    dumpError(err);
    throw err;
}

function tryWrap(fn) {
    try {
        return fn();
    } catch(err) {
        dump("tryWrap ERROR: " + err.toString() + "\n");
        dump(err.stack + "\n");
        throw err;
    }
}

function tryWrapF(fn) {
    return function (...args) {
        return tryWrap(() => { fn.apply(null, args); });
    };
}

function suppressError(fn) {
    try {
        return fn();
    } catch(err) {
        dump("suppressError ERROR: " + err.toString() + "\n");
        dump(err.stack + "\n");
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
exports.newTCPServerSocket = newTCPServerSocket;
exports.newBinaryInputStream = newBinaryInputStream;
exports.newBinaryOutputStream = newBinaryOutputStream;
exports.newThreadManager = newThreadManager;
exports.currentThread = currentThread;
exports.dumpError = dumpError;
exports.raiseError = raiseError;
exports.tryWrap = tryWrap;
exports.tryWrapF = tryWrapF;
exports.suppressError = suppressError;
exports.getIp = getIp;
