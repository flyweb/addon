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

exports.systemPrincipal = systemPrincipal;
exports.newUDPSocket = newUDPSocket;