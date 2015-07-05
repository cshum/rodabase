var SEQ_64 = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var MID_LEN = 8;

var bytewise = require('bytewise-core'),
    d64      = require('d64')(SEQ_64);

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
  var str = d64.encode(bytewise.encode(n).slice(1));
  return trim ? str.replace(padX,'') : str;
};

var padX = /-*$/;
var pad = '-----------';
var NUMBER_TAG = Buffer('B'); //bytewise tag for number

codec.decodeNumber = function(str){
  return bytewise.decode(
    Buffer.concat([NUMBER_TAG, d64.decode((str + pad).slice(0,11))])
  );
};
