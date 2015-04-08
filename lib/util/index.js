var _         = require('underscore'),
    bytewise  = require('bytewise'),
    d64       = require('d64')(
      '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'+
      '_abcdefghijklmnopqrstuvwxyz'
    );

var util = module.exports;

util.encode = function (source){
  return d64.encode(bytewise.encode(source));
};
util.decode = function (source){
  return bytewise.decode(d64.decode(source));
};
util.pad = function(str, count){
  return String(str + (new Array(count)).join('-')).slice(0, count);
};
util.trim = function(str){
  return String(str).replace(/-*$/,'');
};
util.clockObject = function(str){
  return _.object(
    String(str).split(',').map(function(rev){
      return [rev.slice(0,8), rev.slice(8)];
    })
  );
};

util.semaphore = require('./semaphore');
util.queue = require('./queue');
