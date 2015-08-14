/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is FlyWeb API code.
 *
 * The Initial Developer of the Original Code is
 * the Mozilla Corporation.
 * Portions created by the Initial Developer are Copyright (C) 2015
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Kannan Vijayan <kvijayan@mozilla.com>  (Original Author)
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

let Cu = Components.utils;
let Ci = Components.interfaces;
let Cc = Components.classes;
let Cr = Components.results;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

function log(aMessage) {
  var _msg = "FlyWebAPI: " + aMessage + "\n";
  dump(_msg);
}

/**
 * FlyWeb API
 *
 * init method returns the API that is content JS accessible.
 */

function FlyWebAPI() {}

FlyWebAPI.prototype = {

  classID: Components.ID("{4e544888-f44c-4311-8223-d7a9b31fab16}"),

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIDOMGlobalPropertyInitializer,
                                         Ci.nsIObserver,]),

  sandbox: null,

  /**
   * We must free the sandbox and window references every time an
   * innerwindow is destroyed
   * TODO: must listen for back/forward events to reinstate the window object
   *
   * @param object aSubject
   * @param string aTopic
   * @param string aData
   *
   * @returns void
   */
  observe: function DA_observe(aSubject, aTopic, aData)
  {
    if (aTopic == "inner-window-destroyed") {
      let windowID = aSubject.QueryInterface(Ci.nsISupportsPRUint64).data;
      let innerWindowID = this.window.QueryInterface(Ci.nsIInterfaceRequestor).
                            getInterface(Ci.nsIDOMWindowUtils).currentInnerWindowID;
      if (windowID == innerWindowID) {
        delete this.sandbox;
        delete this.window;
        Services.obs.removeObserver(this, "inner-window-destroyed");
      }
    }
  },

  /**
   * This method sets up the crypto API and returns the object that is
   * accessible from the DOM
   *
   * @param nsIDOMWindow aWindow
   * @returns object
   *          The object returned is the API object called 'window.mozCipher'
   */
  init: function DA_init(aWindow) {

    let self = this;

    this.window = XPCNativeWrapper.unwrap(aWindow);

    this.sandbox = Cu.Sandbox(this.window,
                              { sandboxPrototype: this.window, wantXrays: false });

    // keep a xul window reference.
    this.xulWindow = aWindow.QueryInterface(Ci.nsIDOMWindow)
      .QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIWebNavigation)
      .QueryInterface(Ci.nsIDocShellTreeItem)
      .rootTreeItem
      .QueryInterface(Ci.nsIInterfaceRequestor)
      .getInterface(Ci.nsIDOMWindow)
      .QueryInterface(Ci.nsIDOMChromeWindow);

    Services.obs.addObserver(this, "inner-window-destroyed", false);

    let api = {

      // "pk": Public Key encryption namespace
      FlyWeb: {
        hello: self.hello.bind(self),
        __exposedProps__: {
          hello: "r"
        }
      },

      __exposedProps__: {
        FlyWeb: "r",
      },
    };

    return api;
  },

  hello: function () {
    console.log("KVKV: HELLO!");
  }
};


var NSGetFactory = XPCOMUtils.generateNSGetFactory([FlyWebAPI]);

