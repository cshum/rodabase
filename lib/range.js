var util = require('./util');
var _    = require('underscore');

//levelup encoded range handling

var HIGH = util.encode(undefined);
var LOW = util.encode(null);

function concat(prefix, at){
  var isArr = _.isArray(prefix);
  if(at === LOW) //low
    at = isArr ? [] : '';
  if(at === HIGH) //high
    at = isArr ? undefined : HIGH;
  return util.encode(isArr ? [].concat(prefix, at) : prefix + at);
}

var range = module.exports = function (opts){
  opts = _.clone(opts || {});
  if('eq' in opts)
    opts.gte = opts.lte = opts.eq;

  if('prefix' in opts){
    if('gte' in opts)
      opts.gte = concat(opts.prefix, opts.gte);
    else if('gt' in opts)
      opts.gt = concat(opts.prefix, opts.gt);
    else
      opts.gte = concat(opts.prefix, LOW);

    if('lte' in opts)
      opts.lte = concat(opts.prefix, opts.lte);
    else if('lt' in opts)
      opts.lt = concat(opts.prefix, opts.lt);
    else
      opts.lt = concat(opts.prefix, HIGH);
  }else{
    ['gte','gt','lte','lt'].forEach(function(key){
      if(key in opts)
        opts[key] = util.encode(opts[key]);
    });
  }
  //non-unqiue indices append timestamp, need to go across that
  if('gt' in opts) opts.gt += HIGH;
  //higher than LOW, lower than anything else
  if('lte' in opts) opts.lte += LOW;

  delete opts.options;
  delete opts.prefix;
  delete opts.eq;

  return opts;
};
