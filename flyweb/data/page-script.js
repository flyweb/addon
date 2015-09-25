//var { Cc, Ci, Cu, Cm } = require('chrome');

delete window.Promise;

var MESSAGE_ID = 0;
function NextMessageId() {
    return ++MESSAGE_ID;
}

// Map of responses to watch for.
var Handlers = {};
function AddHandler(name, messageId, handler) {
    if (!(name in Handlers))
        Handlers[name] = {}

    let subHandlers = Handlers[name];
    if (messageId in subHandlers) {
        dump("HANDLER CONFLICT FOR ID: " + messageId + "!\n");
        dump(new Error().stack + "\n");
    }
    let descriptor = {handler};
    subHandlers[messageId] = descriptor;
}
function SendRequest(name, obj, handler) {
    let messageId = NextMessageId();
    obj.messageId = messageId;
    obj.messageName = name;
    AddHandler(name, messageId, handler);
    self.port.emit("request", JSON.stringify(obj));
}
function HandleMessage(kind, message) {
    dump("Content script got " + kind + ": " + message + "\n");
    let obj = JSON.parse(message);
    let {messageName, messageId} = obj;
    if (!obj.messageName) {
        dump("  No name for " + kind + "!?\n");
        return;
    }
    if (!obj.messageId) {
        dump("  No id for " + kind + "!? (" + obj.messageName + ")\n");
        return;
    }
    delete obj.messageName;
    delete obj.messageId;
    if (!(messageName in Handlers)) {
        dump("  No handler for " + kind + "!? (" + messageName + ")\n");
        return;
    }
    let subHandlers = Handlers[messageName];
    if (!(messageId in subHandlers)) {
        dump("  No handler for " + kind + " id!? (" + messageName + "." +
                obj.messageId + ")\n");
        return;
    }
    let {handler} = subHandlers[messageId];
    if (kind == "response")
        delete subHandlers[messageId];
    handler(obj);
}
self.port.on("response", message => { HandleMessage("response", message); });
self.port.on("message", message => { HandleMessage("message", message); });

var NEXT_SVC_ID = 0;
function nextServiceId() {
    return "flyweb_service_" + (++NEXT_SVC_ID);
}
var NEXT_SESS_ID = 0;
function nextSessionId() {
    return "flyweb_session_" + (++NEXT_SESS_ID);
}

var GLOBAL_SERVICES = [];
var GLOBAL_CONNECTIONS = [];
function addGlobalService(service) {
    let serviceId = nextServiceId();
    let {location, target, ip, port, txt} = service;
    let [name] = location.split('.');
    let publicService = CI({
        id: serviceId,
        name: name,
        http: true
    });
    let descriptor = {serviceId, service, publicService};
    GLOBAL_SERVICES.push(descriptor);
    return descriptor;
}
function addGlobalConnection(svc) {
    let {serviceId} = svc;
    let sessionId = nextSessionId();
    let url = "http://" + svc.service.ip + ":" + svc.service.port + "/";
    let config = CI(svc.service.txt);
    let publicConnection = CI({
        serviceId, sessionId, url,
        close: function () {
            for (let i = 0; i < GLOBAL_CONNECTIONS.length; i++) {
                let conn = GLOBAL_CONNECTIONS[i];
                if (conn.sessionId == sessionId) {
                    GLOBAL_CONNECTIONS.splice(i, 1);
                    return;
                }
            }
        }
    });
    let descriptor = {serviceId, sessionId, publicConnection};
    GLOBAL_CONNECTIONS.push(descriptor);
    return descriptor;
}

function discoverNearbyServices(spec) {
    return new window.Promise(XF((resolve, reject) => {
        try {
            SendRequest("discoverNearbyServices", {spec}, resp => {
                dump("discoverNearbyServices got response: " +
                    JSON.stringify(resp));

                // Handle error.
                if (resp.error) {
                    reject(resp.error);
                    return;
                }

                let onservicefound = null;
                let onservicelost = null;

                // Handle response.
                let {serviceListId} = resp;
                let services = [];
                let result = CI({
                    length: function () { return services.length; },
                    get: function (id_or_idx) {
                        if (typeof(id_or_idx) == 'number') {
                            let svc = services[id_or_idx|0];
                            if (!svc)
                                return undefined;
                            return svc.publicService;
                        }

                        for (let svc of services) {
                            if (svc.serviceId == id_or_idx)
                                return svc.publicService;
                        }
                    },
                    stopDiscovery: function () {
                        SendRequest("stopDiscovery", {serviceListId},
                            resp => {
                                return new window.Promise(
                                    XF((resolve, reject) => {
                                        if (resp.error)
                                            reject(resp.error);
                                        else
                                            resolve();
                                    }));
                            }
                        );
                    },
                    onservicefound: function (callback) {
                        dump("CONTENT HANDLER setting onservicefound\n");
                        onservicefound = callback;
                    },
                    onservicelost: function (callback) {
                        onservicelost = callback;
                    },
                });

                AddHandler("serviceFound", serviceListId, message => {
                    dump("CONTENT HANDLER serviceFound: " +
                        JSON.stringify(message) + "\n");
                    let {service} = message;
                    let descriptor = addGlobalService(service);
                    let {serviceId} = descriptor;
                    services.push(descriptor);
                    dump("CONTENT HANDLER serviceFound: dispatching\n");
                    if (onservicefound) {
                        dump("CONTENT HANDLER serviceFound: have onservicefound\n");
                        try {
                            onservicefound(CI({serviceId}));
                        } catch(err) {
                            dump("Error calling page onservicefound: "
                                    + err.message + "\n" + err.stack + "\n");
                        }
                    }
                });
                AddHandler("serviceLost", serviceListId, message => {
                    let {service} = message;
                    dump("CONTENT HANDLER serviceLost: " +
                        JSON.stringify(message) + "\n");
                });

                dump("discoverNearbyServices added handlers.  Returning result\n");
                try { resolve(result); }
                catch(err) { reject(err.message + "\n" + err.stack); }
            });
        } catch (err) {
            reject(err.message + "\n" + err.stack);
        }
    }));
}

function connectToService(spec) {
    return new window.Promise(XF((resolve, reject) => {
        try {
            if (typeof(spec) == 'string')
                spec = {id:spec};

            if (!spec.id) {
                reject("Only service id specs accepted for now.");
                return;
            }

            // Look up the service.
            let svc;
            for (let checkSvc of GLOBAL_SERVICES) {
                if (checkSvc.serviceId == spec.id) {
                    svc = checkSvc;
                    break;
                }
            }
            if (!svc) {
                reject("Invalid service id: " + spec.id);
                return;
            }

            // Return a connection object.
            let connection = addGlobalConnection(svc);
            let {serviceId, sessionId} = connection;
            resolve(connection.publicConnection);
        } catch (err) {
            reject(err.message + "\n" + err.stack);
        }
    }));
}

function publishServer(name, options) {
    return new window.Promise(XF((resolve, reject) => {
        try {
            if (typeof(name) != 'string') {
                reject("Server name must be a string.");
                return;
            }
            if (!options)
                options = {};
            if (typeof(options) != 'object') {
                reject("Server options must be an object.");
                return;
            }

            let localOptions = {};
            for (let opt in options) {
                localOptions[opt] = options[opt];
            }
            options = localOptions;

            SendRequest("publishServer", {name, options}, resp => {
                dump("publishServer got response: " +
                     JSON.stringify(resp) + "\n");
                let {httpServerId} = resp;

                let onrequest = null;

                let result = CI({
                    name, options,
                    stop: function () {
                        SendRequest("stopServer", {httpServerId}, resp => {
                            dump("stopServer got response: " +
                                 JSON.stringify(resp) + "\n");
                        });
                    },
                    onrequest: function (callback) {
                        onrequest = callback;
                    }
                });

                AddHandler("httpRequest", httpServerId, message => {
                    dump("CONTENT HANDLER serviceFound: " +
                        JSON.stringify(message) + "\n");
                    let {httpRequestId, method, path,
                         params, headers, content} = message;

                    function sendResponse(status, headers, body) {
                        SendRequest("httpResponse", {httpRequestId, status,
                                                     headers, body},
                            resp => {
                                dump("httpResponse got response " +
                                     JSON.stringify(resp) + "\n");
                            }
                        );
                    }
                    if (onrequest) {
                        try {
                            onrequest(CI({
                                method, path, params, headers, content,
                                sendResponse
                            }));
                        } catch(err) {
                            dump("Error calling page onrequest: "
                                    + err.stack + "\n");
                        }
                    } else {
                        sendResponse(404, {"Content-type":"text/plain"},
                                     "Request handler not installed");
                    }
                });

                resolve(result);
            });
        } catch (err) {
            reject(err.message + "\n" + err.stack);
        }
    }));
}

exportFunction(discoverNearbyServices, window.navigator, {
    defineAs: 'discoverNearbyServices'
});
exportFunction(connectToService, window.navigator, {
    defineAs: 'connectToService'
});
exportFunction(publishServer, window.navigator, {
    defineAs: 'publishServer'
});

function XF(fn, obj, defName) {
    if (!obj)
        obj = window.navigator;
    if (defName)
        return exportFunction(fn, obj, {defineAs:defName});
    return exportFunction(fn, obj);
}
function CI(obj) {
    return cloneInto(obj, window.navigator, {cloneFunctions:true});
}

function DEF_EVENT_PROP(obj, name, get, set) {
    window.Object.defineProperty(obj, name, CI({get, set}));
}
