var _         = require('underscore'),
    d64       = require('d64'),
    bytewise  = require('bytewise');

var util = module.exports;

util.encode = function (source){
  return d64.encode(bytewise.encode(source));
};
util.decode = function (source){
  return bytewise.decode(d64.decode(source));
};
