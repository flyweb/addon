
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


var FlyWebServices = [];
var FlyWebConnection = null;

function clientDiscover() {
    navigator.discoverNearbyServices().then(svcs => {
        console.log("clientDiscover got services!");

        svcs.onservicefound(function (event) {
            console.log("clientDiscover: onservicefound: " + event.serviceId);
            var svc = svcs.get(event.serviceId);
            console.log("clientDiscover: service: " + JSON.stringify(svc));
            addClientService(svc);
            renderClientServiceList();
        });

        for (var i = 0; i < svcs.length; i++) {
            var svc = svcs.getService(i);
            console.log("clientDiscover: saw service: " + svc.id);
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
