#FlyWeb
A local-area web platform.

#Building the addon

The addon can be built using the firefox jetpack tool 'jpm'.

See [https://developer.mozilla.org/en-US/Add-ons/SDK/Tools/jpm#Installation] for
info on how to install jpm (short version: `npm install jpm --global`).

To build the addon, do `jpm xpi` from inside the flyweb directory.

#Running examples

Examples are meant to be run using python's SimpleHTTPServer.

Do `python SimpleHTTPServer -p SOMEPORT` within the `examples` directory,
and navigate to your machine on that port to test the examples.
