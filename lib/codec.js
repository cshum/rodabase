if (!Object.is) Object.is = require('object-is');

var SEQ_64 = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
var MID_LEN = 8;

var bytewise = require('bytewise'),
    Buffer   = require('buffer').Buffer,
    d64      = require('d64')(SEQ_64);

var codec = module.exports;

codec.encode = function(source){
  return new Buffer(bytewise.encode(source)).toString('binary');
};
codec.decode = function(source){
  return bytewise.decode(new Buffer(source, 'binary'));
};
codec.seqKey = function(rev){
  return rev.slice(MID_LEN) + '#' + rev.slice(0, MID_LEN);
};
//base64
/*
codec.encode = function(source){
  return d64.encode(new Buffer(bytewise.encode(source)));
};
codec.decode = function(source){
  return bytewise.decode(d64.decode(source));
};
*/

var padX = /-*$/;

codec.encodeNumber = function(n, trim){
  var str = d64.encode(new Buffer(bytewise.encode(n)).slice(1));
  return trim ? str.replace(padX,'') : str;
};

var pad = '-----------';

codec.decodeNumber = function(str){
  return bytewise.decode(
    Buffer.concat([Buffer('B'), d64.decode((str + pad).slice(0,11))])
  );
};
