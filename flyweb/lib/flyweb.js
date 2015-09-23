'use strict';

var { Class } = require('sdk/core/heritage');
var { Cc, Ci, Cu, Cm } = require('chrome');
var xpcom = require('sdk/platform/xpcom');
var categoryManager = Cc["@mozilla.org/categorymanager;1"]
                      .getService(Ci.nsICategoryManager);

var contractId = '@mozilla.org/flyweb;1';

var DNSSD = require('./dns-sd');
var API = require('./api');
var PageMod = require('sdk/page-mod');
var Self = require('sdk/self');
var {HTTPServer} = require('./http-server');

PageMod.PageMod({
    include: "*",
    contentScriptFile: Self.data.url('page-script.js'),
    onAttach: function (worker) {
        dump("ATTACHED!\n");
        worker.port.on("request", function (message) {
            dump("Addon got message: " + message + "\n");
            let obj = JSON.parse(message);
            if (!obj.messageName) {
                dump("  No name for message!?\n");
                return;
            }
            if (!obj.messageId) {
                dump("  No id for message!? (" + obj.messageName + ")\n");
                return;
            }
            let {messageName, messageId} = obj;
            delete obj.messageName;
            delete obj.messageId;
            API.dispatchRequest(worker, messageName, obj, resultObj => {
                resultObj.messageName = messageName;
                resultObj.messageId = messageId;
                worker.port.emit("response", JSON.stringify(resultObj));
            });
        });
    }
});

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

      dns_sd: DNSSD,
      HTTPServer: HTTPServer,

      discoverNearbyServices: function(spec) {
        return API.discoverNearbyServices(spec);
      },
      publishServer: function(name, config) {
        return API.publishServer(name, config);
      },
      __exposedProps__: {
        discoverNearbyServices: 'r',
        publishServer: 'r'
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
