"use strict";

class AdvertisedService {
  constructor({serviceName, name, port, options}) {
    this.serviceName = serviceName;
    this.name = name;
    this.port = port || 0;
    this.options = options || {};
  }

  get fullname() {
    return this.name + "." + this.serviceName;
  }

  get location() {
    return this.name + "." + this.serviceName;
  }

  get target() {
    return this.name + ".local";
  }
}

class AdvertiseRegistry {
  constructor() {
    this.services = {};
  }

  addService(svc) {
    this.services[svc.fullname] = svc;
  }

  getService(fullname) {
    return this.services[fullname];
  }

  delService(fullname) {
    delete this.services[fullname];
  }

  names() {
    return Object.keys(this.services);
  }

  numServices() {
    return this.names().length;
  }

  hasServices() {
    return this.numServices() == 0;
  }
}

exports.AdvertiseRegistry = AdvertiseRegistry;
exports.AdvertisedService = AdvertisedService;
