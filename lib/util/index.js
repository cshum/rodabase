var bytewise  = require('bytewise'),
    d64       = require('d64')(
      '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'+
      '_abcdefghijklmnopqrstuvwxyz'
    );

var util = module.exports;

util.timestamp = require('./timestamp');

util.encode = function(source, format){
  format = format || 'binary';
  return bytewise.encode(source).toString(format);
};
util.decode = function(source, format){
  format = format || 'binary';
  return bytewise.decode(new Buffer(source, format));
};
util.encode64 = function (source){
  return d64.encode(bytewise.encode(source));
};
util.decode64 = function (source){
  return bytewise.decode(d64.decode(source));
};
util.clockObject = function(arr){
  var obj = {};
  arr.forEach(function(rev){
    obj[rev.slice(0,8)] = rev.slice(8);
  });
  return obj;
};
util.clock = function(obj){
  var arr = [];
  for(var key in obj)
    arr.push(key + obj[key]);
  return arr.sort();
};
function pad(str, count){
  return String(str + (new Array(count)).join('-')).slice(0, count);
}
function trim(str){
  return String(str).replace(/-*$/,'');
}
util.time64 = function(time){
  return trim(util.encode64(time));
};
util.time = function(time){
  return util.decode64(pad(time, 12));
};
util.revEncode = function(rev){
  return util.encode(util.time(rev.slice(8))) + rev.slice(0,8);
};
