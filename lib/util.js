var _         = require('underscore'),
    bytewise  = require('bytewise');

var util = module.exports;

util.encode = function (source){
  return bytewise.encode(source)
    .toString('base64')
    .replace(/\//g,'_')
    .replace(/\+/g,'-');
};
util.decode = function (source){
  source = String(source)
    .replace(/\_/g,'/')
    .replace(/\-/g,'+');

  return bytewise.decode(
    new Buffer(source, 'base64')
  );
};
