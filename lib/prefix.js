var HIGH = '\xff';

module.exports = function(){
  var args = Array.prototype.concat.apply([], arguments);
  var range = args.pop();
  var prefix = '!' + args.join('#') + '!';

  if(typeof range === 'string')
    return prefix + range;

  range = range || {};

  if('gte' in range) range.gte = prefix + range.gte;
  else if('gt' in range) range.gt = prefix + range.gt;
  else range.gte = prefix;

  if('lte' in range) range.lte = prefix + range.lte;
  else if('lt' in range) range.lt = prefix + range.lt;
  else range.lt = prefix + HIGH;

  return range;
};
