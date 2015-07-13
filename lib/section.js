var extend = require('extend');
var HIGH   = '\xff';

module.exports = function prefix(){
  var args = Array.prototype.concat.apply([], arguments);
  var at = args.pop();

  //no pre === decoder
  if(args.length === 0){
    //decode key
    if(typeof at === 'string')
      return at.slice(at.indexOf('!', 1) + 1);
    //decode object
    return extend({}, at, { key: prefix(at.key)});
  }

  var pre = '!' + args.join('#') + '!';

  if(typeof at === 'string') return pre + at;

  at = extend({}, at);

  if('gte' in at) at.gte = pre + at.gte;
  else if('gt' in at) at.gt = pre + at.gt;
  else at.gte = pre;

  if('lte' in at) at.lte = pre + at.lte;
  else if('lt' in at) at.lt = pre + at.lt;
  else at.lt = pre + HIGH;

  return at;
};
