#! /bin/bash

mv built/flyweb.xpi /tmp
cd flyweb/
zip -r flyweb.xpi * 
mv flyweb.xpi ../built

echo "the flyweb .xpi was built"
