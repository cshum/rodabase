var bytewise  = require('bytewise'),
    d64       = require('d64')(
      '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'+
      '_abcdefghijklmnopqrstuvwxyz'
    );

var util = module.exports;

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
  format = format || 'binary';
  return bytewise.encode(source).toString(format);
};
util.decode = function(source, format){
  format = format || 'binary';
  return bytewise.decode(new Buffer(source, format));
};

util.clocksObject = function(arr){
  var obj = {};
  arr.forEach(function(rev){
    obj[rev.slice(0,8)] = rev.slice(8);
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
  return String(str + (new Array(count)).join('-')).slice(0, count);
}

util.encodeNumber = function(n, trim){
  var str = d64.encode(bytewise.encode(n).slice(1));

  if(trim) return str.replace(padX,'');
  else return str;
};

util.decodeNumber = function(str){
  return bytewise.decode(new Buffer(
    'B'+d64.decode(pad(str, 11)).toString('binary'), 'binary'));
};

util.timeIndex = function(doc){
  return doc._rev.slice(8) + ' ' + doc._rev.slice(0,8);
};
