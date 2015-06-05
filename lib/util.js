if (!Object.is) {
  Object.is = function(v1, v2) {
    if (v1 === 0 && v2 === 0) {
      return 1 / v1 === 1 / v2;
    }
    if (v1 !== v1) {
      return v2 !== v2;
    }
    return v1 === v2;
  };
}

var util = module.exports;

var SEQ_64 = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

var bytewise = require('bytewise'),
    Buffer   = require('buffer').Buffer,
    d64      = require('d64')(SEQ_64);

var MID_LEN = util.MID_LEN = 8;

util.timestamp = function(){
  //monotonic timestamp
  var count = 0, last = 0;
  return function(){
    var now = Date.now();
    if(last === now)
      count++;
    else
      count = 0;
    last = now;
    return now * 1000 + count;
  };
}();

util.encode = function(source, format){
  return new Buffer(bytewise.encode(source)).toString('binary');
};
util.decode = function(source, format){
  return bytewise.decode(new Buffer(source, 'binary'));
};

util.clocksObject = function(arr){
  var obj = {};
  arr.forEach(function(rev){
    obj[rev.slice(0, MID_LEN)] = rev.slice(MID_LEN);
  });
  return obj;
};

util.clocks = function(obj){
  var arr = [];
  for(var key in obj)
    arr.push(key + obj[key]);
  return arr.sort();
};

var padX = /-*$/;
function pad(str, count){
  return (str + (new Array(count)).join('-')).slice(0, count);
}

util.encodeNumber = function(n, trim){
  var str = d64.encode(new Buffer(bytewise.encode(n)).slice(1));

  if(trim) return str.replace(padX,'');
  else return str;
};

util.decodeNumber = function(str){
  return bytewise.decode(new Buffer(
    'B' + d64.decode(pad(str, 11)).toString('binary'), 'binary'
  ));
};

util.timeIndex = function(rev){
  return pad(rev.slice(MID_LEN), 11) + rev.slice(0,MID_LEN);
};
