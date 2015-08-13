var SEQ_64 = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var MID_LEN = 8;

var bytewise     = require('bytewise-core'),
    bytewiseUtil = require('bytewise-core/util'),
    d64          = require('d64')(SEQ_64);

var codec = module.exports;

codec.encode = function(source){
  return bytewise.encode(source).toString('binary');
};
codec.decode = function(source){
  return bytewise.decode(new Buffer(source, 'binary'));
};
codec.seqKey = function(rev){
  return rev.slice(MID_LEN) + '%' + rev.slice(0, MID_LEN);
};

codec.encodeNumber = function(n, trim){
  var str = d64.encode(bytewiseUtil.encodeFloat(n));
  return trim ? str.replace(padX,'') : str;
};

var padX = /-*$/;
var pad = '-----------';

codec.decodeNumber = function(str){
  return bytewiseUtil.decodeFloat(
    d64.decode((str + pad).slice(0,11))
  );
};
