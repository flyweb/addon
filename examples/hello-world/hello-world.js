
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
    // Clear out FlyWebServices list.
    FlyWebServices = [];

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
            window.open(conn.url, '_blank');
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

    navigator.publishServer(ServerName).then(server => {
        console.log("Published server: " + JSON.stringify(server));
        server.onrequest(requestEvent => {
            var rawReq = requestEvent.requestRaw();
            var streamReader = new StreamReader(rawReq);
            GLOBAL_STREAM_READER = streamReader;
            streamReader.readHeader().then(reqinfo => {
                console.log("HEADER: ", reqinfo);
                var method = reqinfo.method;
                var path = reqinfo.path;
                //console.log("Got " + method + " request for " + path);
                if (path == "/get-text") {
                    serveGetText(requestEvent);
                } else if (path == "/web/socket") {
                    serveWebSocket(requestEvent, streamReader, reqinfo.headers);
                } else if (path == "/") {
                    serveMainPage(requestEvent);
                } else {
                    serveErrorPage(requestEvent);
                }
            });
        });
    });
}

function serveGetText(requestEvent) {
    requestEvent.stream().then(stream => {
        stream.oncomplete(() => {
            //console.log("Sent data!\n");
        });
        var inputElement = document.getElementById('sendText');
        var text = '' + inputElement.value;
        var content = JSON.stringify({text: text});
        stream.send("HTTP/1.1 200 OK\r\n");
        stream.send("Content-Type: application/json\r\n");
        stream.send("Content-Length: " + content.length + "\r\n");
        stream.send("Access-Control-Allow-Origin: *\r\n");
        stream.send("\r\n");
        stream.send(content);
        stream.end();
    });
}

function serveWebSocket(requestEvent, instream, headers) {
    requestEvent.stream().then(outstream => {
        function onmessage(msg) {
            console.log("WebSocket got message: " + msg);
        }
        function onerror(msg) {
            console.log("WebSocket got error: " + msg);
        }
        var ws = new ServerWebSocket({
            instream, outstream, headers, onmessage, onerror,
            stringMessage: true});
        window.SERVER_WS = ws;

        var inputElement = document.getElementById('sendText');
        inputElement.onkeyup = function () {
            var text = '' + inputElement.value;
            var content = JSON.stringify({text: text});
            ws.send(content);
        };
    });
}

function serveMainPage(requestEvent) {
    requestEvent.stream().then(stream => {
        stream.oncomplete(() => {
            //console.log("Sent data!\n");
        });
        function updateThing() {
          if (!window.UPDATE_TIME)
            window.UPDATE_TIME = 60000;

          var wsurl = "ws://" + window.location.host + "/web/socket";
          var ws = new WebSocket(wsurl);

          ws.onmessage = function (msg) {
            var data = JSON.parse(msg.data);
            var elem = document.getElementById('h');
            var text = (data.text.length > 0) ? "'" + data.text + "'" : "NOTHING!";
            elem.innerHTML = "WebSocket SAYS " + text;
            window.OLD_TEXT = data.text;
          }

          /*
          var xmlhttp = new XMLHttpRequest();
          var oldText = window.OLD_TEXT || '';

          xmlhttp.onreadystatechange = function() {
            if (xmlhttp.readyState == 4 && xmlhttp.status == 200) {
                var data = JSON.parse(xmlhttp.responseText);
                if (data.text == oldText)
                    return;
                var elem = document.getElementById('h');
                var text = (data.text.length > 0) ? "'" + data.text + "'" : "NOTHING!";
                elem.innerHTML = "OTHER PAGE SAYS " + text;
                window.OLD_TEXT = data.text;
            }
          }
          xmlhttp.open("GET", "/get-text", true);
          xmlhttp.send();
          */

          setTimeout(updateThing, window.UPDATE_TIME);
        }
        var content = ["<html><head><title>AAAAAAAAAHAHAHAHAHAHAH!!!!!!</title>",
                       '<script type="text/javascript">',
                       updateThing.toString(),
                       '</script>',
                       "</head>",
                       '<body onload="updateThing()"><h1 id="h">OTHER PAGE SAYS WHAT?</h1></body>',
                       "</html>"].join('\n');

        stream.send("HTTP/1.1 200 OK\r\n");
        stream.send("Content-Type: text/html\r\n");
        stream.send("Content-Length: " + content.length + "\r\n");
        stream.send("\r\n");
        stream.send(content);
        stream.end();
    });
}

function serveErrorPage(requestEvent) {
    requestEvent.stream().then(stream => {
        stream.oncomplete(() => {
            //console.log("Sent data!\n");
        });
        var content = ["<html><head><title>Not Found</title></head>",
                       '<body><h1>PAGE NOT FOUND</h1></body></html>'].join('\n');
        stream.send("HTTP/1.1 404 Not Found\r\n");
        stream.send("Content-Type: text/html\r\n");
        stream.send("Content-Length: " + content.length + "\r\n");
        stream.send("\r\n");
        stream.send(content);
        stream.end();
    });
}
