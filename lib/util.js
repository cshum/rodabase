var _         = require('underscore'),
    bytewise  = require('bytewise');

var util = module.exports;

util.encode = function(){
  return bytewise
    .encode(_.flatten(arguments))
    .toString('binary');
};

util.stringArray =  function(){
  var key = _.flatten(arguments).map(String);
  return key.length === 1 ? key[0]:key;
};
