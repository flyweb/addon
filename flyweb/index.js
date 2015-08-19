var self = require('sdk/self');
var dns_sd = require('./lib/flyweb');



// a dummy function, to show how tests work.
// to see how to test this function, look at test/test-index.js
function dummy(text, callback) {
  callback(text);
}

exports.dummy = dummy;
