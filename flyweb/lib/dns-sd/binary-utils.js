"use strict";

function stringToArrayBuffer(string) {
  let length = (string || '').length;
  let arrayBuffer = new ArrayBuffer(length);
  let uint8Array = new Uint8Array(arrayBuffer);
  for (let i = 0; i < length; i++) {
    uint8Array[i] = string.charCodeAt(i);
  }

  return arrayBuffer;
}

function arrayBufferToString(arrayBuffer) {
  let results = [];
  let uint8Array = new Uint8Array(arrayBuffer);

  for (let i = 0, length = uint8Array.length; i < length; i += 200000) {
    let subArray = uint8Array.subarray(i, i + 200000);
    results.push(String.fromCharCode.apply(null, subArray));
  }

  return results.join('');
}

function blobToArrayBuffer(blob, callback) {
  let fileReader = new FileReader();
  fileReader.onload = function() {
    if (typeof callback === 'function') {
      callback(fileReader.result);
    }
  };
  fileReader.readAsArrayBuffer(blob);

  return fileReader.result;
}

function mergeArrayBuffers(arrayBuffers, callback) {
  return blobToArrayBuffer(new Blob(arrayBuffers), callback);
}

exports.BinaryUtils = {
  stringToArrayBuffer,
  arrayBufferToString,
  blobToArrayBuffer,
  mergeArrayBuffers
};
