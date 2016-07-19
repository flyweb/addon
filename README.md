# **** THIS REPO IS OBSOLETE!!! ****

### FlyWeb has now landed in Firefox Nightly. See http://flyweb.github.io/ for more information

-

#FlyWeb

This is a Firefox add-on to prototype the fly web concept.  Please note that this add-on is very experimental, and likely contains security vulnerabilities, and is not intended for any production usage.  Use at your own risk.

#Building the addon

The addon can be built using the firefox jetpack tool 'jpm'.

See https://developer.mozilla.org/en-US/Add-ons/SDK/Tools/jpm#Installation for
info on how to install jpm (short version: `npm install jpm --global`).

To build the addon, do `jpm xpi` from inside the flyweb directory.

#Running examples

Examples are meant to be run using python's SimpleHTTPServer.

Do `python -m SimpleHTTPServer -p SOMEPORT` within the `examples` directory,
and navigate to your machine on that port to test the examples.
