
var DNSSD = require('./dns-sd');
var {HTTPServer} = require('./http-server');
var {HTTPStatus} = require('./http-status');
var utils = require('./utils');
var uuid = require('sdk/util/uuid');

function dispatchRequest(worker, name, obj, responseCallback) {
    let func;
    if (name == "discoverNearbyServices") {
        func = discoverNearbyServices;
    } if (name == "stopDiscovery") {
        func = stopDiscovery;
    } else if (name == "publishServer") {
        func = publishServer;
    } else if (name == "stopServer") {
        func = stopServer;
    } else if (name == "httpResponse") {
        func = httpResponse;
    } else {
        dump("dispatchMessage: unhandled name " + name +
             " (" + JSON.stringify(obj) + ")\n");
    }

    try {
        func(worker, obj, responseCallback);
    } catch(err) {
        dump("KVKV dispatch " + name + "failed: " + err.stack + "\n");
        responseCallback({error:err.stack});
    }
}

var nextServiceListId = 0;
function newServiceListId() {
    return 'flyweb_service_list_' + (++nextServiceListId);
}

var nextServiceId = 0;
function newServiceId() {
    return 'flyweb_service_' + (++nextServiceId);
}

var nextSessionId = 0;
function newSessionId() {
    return 'flyweb_session_' + (++nextSessionId);
}

var ServiceLists = {};

function discoverNearbyServices(worker, obj, responseCallback) {
    let spec = obj.spec;
    let serviceListId = newServiceListId();
    let listenerId = DNSSD.discoverListeners.addListener(spec,
        (service, found) => {
            if (found) {
                dump("KVKV HERE1\n");
                try {
                worker.port.emit('message', JSON.stringify({
                    messageName: 'serviceFound',
                    messageId: serviceListId,
                    service: service
                }));
                } catch(err) {
                    dump("KVKV HERE1.5: " + err.message + "\n" + err.stack + "\n");
                }
                dump("KVKV HERE2\n");
            } else {
                worker.port.emit('message', JSON.stringify({
                    messageName: 'serviceLost',
                    messageId: serviceListId,
                    service: service
                }));
            }
        }
    );
    DNSSD.startDiscovery('_flyweb._tcp.local');
    ServiceLists[serviceListId] = {serviceListId, listenerId};
    responseCallback({serviceListId});
}

function stopDiscovery(worker, obj, responseCallback) {
    let {serviceListId} = obj;
    if (ServiceLists[serviceListId]) {
        let {listenerId} = ServiceLists[serviceListId];
        DNSSD.discoverListeners.removeListener(listenerId);
        delete ServiceLists[serviceListId];
    }
    responseCallback({});
}


var nextHTTPServerId = 0;
function newHTTPServerId() {
    return 'flyweb_httpserver_' + (++nextHTTPServerId);
}
var nextHTTPRequestId = 0;
function newHTTPRequestId() {
    return 'flyweb_httprequest_' + (++nextHTTPRequestId);
}
var HTTPServers = {};
var HTTPRequests = {};
function publishServer(worker, obj, responseCallback) {
    let httpServerId = newHTTPServerId();
    let {name,options} = obj;

    // Create and start a new HTTP server, get port.
    let httpServer = new HTTPServer();
    httpServer.start();
    let {port} = httpServer;

    // Request handler - register request and response,
    // send message to content script about request.
    httpServer.onrequest = function (request, response) {
        let httpRequestId = newHTTPRequestId();
        HTTPRequests[httpRequestId] = {httpRequestId, request, response};
        let {method, path, params, headers, content} = request;
        worker.port.emit("message", JSON.stringify({
            messageName: "httpRequest",
            messageId: httpServerId,
            httpRequestId, method, path, params, headers, content
        }));
    };

    let service = DNSSD.registerService("_flyweb._tcp.local", name, port,
                                        options);
    HTTPServers[httpServerId] = {httpServerId, httpServer, service};
    responseCallback({httpServerId});
}

function stopServer(worker, obj, responseCallback) {
    let {httpServerId} = obj;
    if (!(httpServerId in HTTPServers)) {
        responseCallback({error:"Invalid http server id: " + httpServerId});
        return;
    }
    let {service, httpServer} = HTTPServers[httpServerId];
    DNSSD.unregisterService(service.fullname);
    httpServer.stop();
    delete HTTPServers[httpServerId];
    responseCallback({});
}

function httpResponse(worker, obj, responseCallback) {
    let {httpRequestId, status, headers, body} = obj;
    if (!(httpRequestId in HTTPRequests)) {
        responseCallback({error:"Invalid http request id: " + httpRequestId});
        return;
    }
    let {response} = HTTPRequests[httpRequestId];
    response.send(status, headers, body).then(ok => {
        responseCallback({});
    }).catch(err => {
        responseCallback({error: err.message + "\n" + err.stack});
    });
    delete HTTPRequests[httpRequestId];
}

exports.dispatchRequest = dispatchRequest;
