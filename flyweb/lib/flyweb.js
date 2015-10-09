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
        dump("[FlyWeb-Addon] Attached to page!\n");
        API.registerWorker(worker);
        worker.port.on("request", function (message) {
            let obj = JSON.parse(message);
            // Only dump message contents if there is a message error.
            if (!obj.messageName || !obj.messageId) {
                dump("Addon got message: " + message + "\n");
                if (!obj.messageName) {
                    dump("  No name for message!?\n");
                }
                if (!obj.messageId) {
                    dump("  No id for message!? (" + obj.messageName + ")\n");
                }
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
        worker.on('detach', function () {
            API.unregisterWorker(this);
        });
    }
});
