var util = require('./util');
var _    = require('underscore');

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

module.exports = function(opts){
  opts = _.clone(opts);
  if('eq' in opts)
    opts.gte = opts.lte = opts.eq;

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
