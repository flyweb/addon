
var DNSSD = require('./dns-sd');
var {HTTPServer} = require('./http-server');
var {HTTPStatus} = require('./http-status');
var utils = require('./utils');
var uuid = require('sdk/util/uuid');

function discoverNearbyServices(spec) {
  return new Promise((resolve, reject) => {
    let service_wrapper;
    let listener_id = DNSSD.discoverListeners.addListener(spec, (service, found) => {
        if (found) {
          service_wrapper.impl.servicefound(service);
        } else {
          service_wrapper.impl.servicelost(service);
        }
    });
    service_wrapper = makeFlyWebServices(listener_id);
    DNSSD.startDiscovery('_flyweb._tcp.local');
    resolve(service_wrapper.iface);
  });
}
    
var nextServiceId = 0;
function newServiceId() {
  return 'flyweb_service_' + (++nextServiceId);
}

var nextSessionId = 0;
function newSessionId() {
  return 'flyweb_session_' + (++nextSessionId);
}

function makeFlyWebServices(listenerId) {
  let services = [];
  let servicesById = {};

  let services_iface = Object.create(null);
  services_iface.onservicefound = null;
  services_iface.onservicelost = null;

  Object.defineProperty(services_iface, 'length', {
    get: function () { return services.length; },
  });

  Object.defineProperty(services_iface, 'getService', {
    value: function (idx) {
      if (typeof(idx) == 'number') {
        let svc = services[idx|0];
        if (svc)
          return svc.iface;
      }
    }
  });

  Object.defineProperty(services_iface, 'getServiceById', {
    value: function (id) {
      let svc = servicesById[id];
      if (svc)
        return svc.iface;
    }
  });

  Object.defineProperty(services_iface, 'stopDiscovery', {
    value: function () {
      DNSSD.discoverListeners.removeListener(listenerId);
    }
  });

  var services_impl = {
    servicefound(svc) {
      let idx = lookupService(svc);
      if (idx !== undefined) {
        services[idx].impl.update(svc);
        return;
      }

      let fwsvc = internService(svc);
      if (services_iface.onservicefound) {
        services_iface.onservicefound(fwsvc.id);
      }
    },

    servicelost(svc) {
      let idx = lookupService(svc);
      if (idx !== undefined) {
        services.splice(idx, 1);
        if (services_iface.onservicelost)
          services_iface.onservicelost(fwsvc.id);
      }
    }
  };

  function lookupService(svc) {
    for (let i = 0; i < services.length; i++) {
      let {impl: service_impl} = services[i];
      if (svc.equals(service_impl))
        return i;
    }
  }
  function internService(svc) {
    // generate new id and add service.
    let fwsvc = makeFlyWebService(newServiceId(), svc);
    services.push(fwsvc);
    return fwsvc;
  }

  return {iface:services_iface, impl:services_impl};
}

function makeFlyWebService(serviceId, svc) {
  let service = svc;
  let service_iface = Object.create(null);
  service_iface.onavailable = null;
  service_iface.onunavailable = null;
  let service_online = true;
  let service_config = make_svc_config();
  Object.defineProperty(service_iface, 'id', { value: serviceId });
  Object.defineProperty(service_iface, 'name', { get: () => svc.location });
  Object.defineProperty(service_iface, 'type', { value: 'server' });
  Object.defineProperty(service_iface, 'config', { get: () => service_config });
  Object.defineProperty(service_iface, 'online', { get: () => service_online });
  Object.defineProperty(service_iface, 'establishSession', {
    value: function () {
      return new Promise((resolve, reject) => {
        let session_id = newSessionId();
        let url = "http://" + service.ip + ":" + service.port;
        if (service_config.path)
            url += "/" + service_config.path;
        makeFlyWebServerHandle(session_id, url, resolve);
      });
    }
  });

  let service_impl = {
    update: function (updated_svc) {
      service = updated_svc;
      service_config = make_svc_config();
    }
  };

  return {iface:service_iface, impl:service_impl};

  function make_svc_config() {
    let svc_config = Object.create(null);
    for (let svc_config_key of Object.getOwnPropertyNames(svc.txt)) {
      svc_config[svc_config_key] = svc.txt[svc_config_key];
    }
    return svc_config;
  }
}

function makeFlyWebServerHandle(sessionId, url, resolve) {
  let handle_iface = Object.create(null);
  handle_iface.ondisconnect = null;
  Object.defineProperty(handle_iface, 'sessionId', {value: sessionId});
  Object.defineProperty(handle_iface, 'serverURL', {value: url});
  Object.defineProperty(handle_iface, 'disconnect', {
    value: function () {
      return new Promise.resolve();
    }
  });
  resolve(handle_iface);
  return {iface:handle_iface};
}


function publishServer(name, config) {
  return new Promise((resolve, reject) => {
    // Create and start a new HTTP server, get port.
    let httpServer = new HTTPServer();
    httpServer.start();
    let port = httpServer.port;

    // Advertise it and return from the promise.
    let server_wrapper = makeFlyWebPublishedServer({name, config, httpServer});
    resolve(server_wrapper.iface);
  });
}

function makeFlyWebPublishedServer({name, config, httpServer}) {
  // Copy config into options
  let options = Object.create(null);
  for (let key in config) {
    options[key] = '' + config[key];
  }
  Object.freeze(options);

  // Request handler.
  httpServer.onrequest = function (request, response) {
    published_server_impl.request(request, response);
  };

  DNSSD.registerService("_flyweb._tcp.local", name, httpServer.port, config);

  let published_server_iface = Object.create(null);
  Object.defineProperty(published_server_iface, 'onrequest', { value: null, writable:true });
  Object.defineProperty(published_server_iface, 'name', { get: () => name });
  Object.defineProperty(published_server_iface, 'config', { get: () => options });
  Object.defineProperty(published_server_iface, 'stop', { value: () => {
    published_server_impl.stop();
  }});

  var published_server_impl = {
    request: (req, resp) => {
        if (published_server_iface.onrequest) {
            utils.suppressError(() => { published_server_iface.onrequest(req, resp); });
        }
    },
    stop: () => {
        return new Promise((resolve, reject) => {
            httpServer.stop();
            resolve();
        });
    }
  };

  return {iface:published_server_iface, impl:published_server_impl};
}

exports.discoverNearbyServices = discoverNearbyServices;
exports.publishServer = publishServer;
