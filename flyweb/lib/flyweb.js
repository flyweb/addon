'use strict';

var { Class } = require('sdk/core/heritage');
var { Cc, Ci, Cu, Cm } = require('chrome');
var xpcom = require('sdk/platform/xpcom');
var categoryManager = Cc["@mozilla.org/categorymanager;1"]
                      .getService(Ci.nsICategoryManager);

var contractId = '@mozilla.org/flyweb;1';

var dnsSD = require('./dns-sd');
var {HTTPServer} = require('./http-server');

var FlyWeb = Class({
  extends: xpcom.Unknown,
  interfaces: [ Ci.nsIDOMGlobalPropertyInitializer ],
  get wrappedJSObject() this,

  init: function(win) {
    return {
      hello: function(string) {
        dump(string + "\n");
      },

      ev: function(string) {
        return eval(string);
      },

      dns_sd: dnsSD,
      HTTPServer: HTTPServer,

      __exposedProps__: {
        hello: 'r',
        ev: 'r',
        dns_sd: 'r'
      }
    };
  }
});

// Create and register the factory
var factory = xpcom.Factory({
  contract: contractId,
  Component: FlyWeb,
  unregister: false
});

// XPCOM clients can retrieve and use this new
// component in the normal way
var wrapper = Cc[contractId].createInstance(Ci.nsISupports);

categoryManager.deleteCategoryEntry("JavaScript-navigator-property", contractId, false);
categoryManager.addCategoryEntry("JavaScript-navigator-property", "flyweb", contractId, false, true);

