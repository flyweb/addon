
function subPage(subpath) {
    var parts = document.location.toString().split("/");
    parts.pop();
    parts.push(subpath);
    return parts.join("/");
}
function runServer() {
    document.location = subPage("hw-server.html");
}
function runClient() {
    document.location = subPage("hw-client.html");
}


var CurrentDiscoverList = null;

var FlyWebServices = [];
var FlyWebConnection = null;

function clientDiscover() {
    var stopOldDiscovery;
    if (CurrentDiscoverList) {
        stopOldDiscovery = CurrentDiscoverList.stopDiscovery();
        CurrenetDiscoverList = null;
    } else {
        stopOldDiscovery = Promise.resolve();
    }
    stopOldDiscovery.then(() => {
        return navigator.discoverNearbyServices()
    }).then(svcs => {
        CurrentDiscoverList = svcs;
        console.log("clientDiscover got services!");

        svcs.onservicefound(function (event) {
            console.log("clientDiscover: onservicefound: ", event.serviceId);
            var svc = svcs.get(event.serviceId);
            console.log("clientDiscover: service: ", svc);
            addClientService(svc);
            renderClientServiceList();
        });

        for (var i = 0; i < svcs.length; i++) {
            var svc = svcs.get(i);
            console.log("clientDiscover: saw service: ", svc);
            addClientService(svc);
        }
        renderClientServiceList();
    });
}

function establishConnection(serviceId) {
    console.log('establishConnection HERE!: ' + serviceId);
    for (var i = 0; i < FlyWebServices.length; i++) {
        var svc = FlyWebServices[i];
        console.log('establishConnection checking svc: ' + svc.id);
        if (svc.id != serviceId)
            continue;
        // Found service.
        console.log('establishConnection proceeding');
        navigator.connectToService(serviceId).then(conn => {
            console.log('establishConnection got connection');
            FlyWebConnection = conn;
        });
    }
}

function addClientService(svc) {
    FlyWebServices.push(svc);
}

function renderClientServiceList() {
    var innerHTML = [];
    for (var i = 0; i < FlyWebServices.length; i++) {
        var svc = FlyWebServices[i];
        var svcText = renderClientService(svc);
        innerHTML.push(svcText);
    }

    var listElem = document.getElementById("client-services-list");
    listElem.innerHTML = innerHTML.join("\n");
}

function renderClientService(svc, outArray) {
    return [
        '<div class="client-service">',
        '  <div class="client-service-type">', svc.type, '</div>',
        '  <div class="client-service-name">', svc.name, '</div>',
        '  <div class="client-service-establish"',
        '       onclick="establishConnection(\'' + svc.id + '\')"',
        '  >',
            'Establish Connection',
        '  </div>',
        '</div>',
        '<br />'
    ].join('\n');
}

var WORDS = ["candy", "james", "pool", "singalong",
             "able", "pine", "tree", "clarity", "star",
             "ice", "sky", "pluto", "kind", "stock",
             "lift", "poppy"];
function generateServerName() {
    // Generate a random server name.
    var arr = [];
    for (var i = 0; i < 2; i++) {
        arr.push(WORDS[(Math.random() * WORDS.length)|0]);
    }
    return arr.join("_");
}

var ServerName = null;
function initServer() {
    ServerName = generateServerName();
    var serverNameElem = document.getElementById("server-name");
    serverNameElem.innerHTML = ServerName;
}

function startServer() {
    if (!ServerName)
        initServer();

    navigator.publishServer(ServerName, {}).then(server => {
        console.log("Published server: " + JSON.stringify(server));
        server.onrequest(requestEvent => {
            requestEvent.sendResponse(200, {"Content-Type": "text/html"},
                        "<html><head><title>AAAAAAAAAHAHAHAHAHAHAH!!!!!!</title></head><body><h1>BOOYEAH</h1></body></html>");
            console.log("GOT REQUEST: ", requestEvent);
        });
    });
}
