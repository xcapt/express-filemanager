/*
* This is modified version of fs.access Ponyfill by Sindre Sorhus
* available under the MIT license: https://github.com/sindresorhus/fs-access
*/

'use strict';
var fs = require('fs');
var nullCheck = require('null-check');

var access = module.exports = function (pth, mode, cb) {
  if (typeof pth !== 'string') {
    throw new TypeError('path must be a string');
  }

  if (typeof mode === 'function') {
    cb = mode;
    mode = access.F_OK;
  } else if (typeof cb !== 'function') {
    throw new TypeError('callback must be a function');
  }

  if (!nullCheck(pth, cb)) {
    return;
  }

  mode = mode | 0;

  fs.stat(pth, function (err, stat) {
    if (err) {
      cb(err);
      return;
    }

    if (!checkPermissions(stat, mode)) {
      cb(new Error());
      return;
    }

    cb();
  });
};

access.sync = function (pth, mode) {
  nullCheck(pth);

  mode = mode === undefined ? access.F_OK : mode | 0;

  if (!checkPermissions(fs.statSync(pth), mode)) {
    throw new Error();
  }
};

access.F_OK = 0;
access.R_OK = 4;
access.W_OK = 2;
access.X_OK = 1;

function checkPermissions(stat, mode) {
  var uid = 0;
  var gid = 0;

  if (process.getuid && process.getgid) {
    uid = process.getuid();
    gid = process.getgid();
  }

  var m = uid === stat.uid ? 8 * 8
    : gid === stat.gid ? 8
    : 1;

  return (mode * m) & stat.mode;
}