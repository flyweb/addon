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
