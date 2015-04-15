var _         = require('underscore'),
    bytewise  = require('bytewise'),
    d64       = require('d64')(
      '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'+
      '_abcdefghijklmnopqrstuvwxyz'
    );

var util = module.exports;

util.semaphore = require('./semaphore');
util.queue = require('./queue');
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
util.clockString = function(obj){
  return _.map(obj, function(val, key){
    return key + val;
  }).sort().join(',');
};

//levelup encoded range handling

function concat(prefix, at){
  var isArr = _.isArray(prefix);
  if(at === null) //low
    at = isArr ? [] : '';
  if(at === undefined) //high
    at = isArr ? undefined : '\xff';
  return util.encode(
    isArr ? [].concat(prefix, at) : prefix + at
  );
}

util.range = function(opts){
  if('prefix' in opts){
    if('gte' in opts)
      opts.gte = concat(opts.prefix, opts.gte);
    else if('gt' in opts)
      opts.gt = concat(opts.prefix, opts.gt);
    else
      opts.gte = concat(opts.prefix, null);

    if('lte' in opts)
      opts.lte = concat(opts.prefix, opts.lte);
    else if('lt' in opts)
      opts.lt = concat(opts.prefix, opts.lt);
    else
      opts.lt = concat(opts.prefix, undefined);
  }else{
    ['gte','gt','lte','lt'].forEach(function(key){
      if(key in opts)
        opts[key] = util.encode(opts[key]);
    });
  }
  //non-unqiue indices append timestamp, need to go across that
  if('gt' in opts) opts.gt += '\xff';
  if('lte' in opts) opts.lte += '\xff';

  return opts;
};
