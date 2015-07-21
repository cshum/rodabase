var extend = require('extend');

function RodaError(status, name, message, obj){
  if(!(this instanceof RodaError))
    return new RodaError(status, name, message, obj);

  Error.call(message);

  this.error = true;
  this.status = status;
  this.name = name;
  this.message = message;
  this[name] = true;

  extend(this, obj);
}

RodaError.prototype = new Error();

RodaError.INVALID_TX = RodaError(500, 'invalidTx', 'Invalid transaction instance.');
RodaError.MID_LEN    = RodaError(400, 'midLen',    'MID must be length 8');
RodaError.CONFLICT   = RodaError(409, 'conflict',  'Document merge conflict.');
RodaError.NOT_READY  = RodaError(400, 'notReady',  'Not ready.');
RodaError.NOT_FOUND  = RodaError(404, 'notFound',  'Not found.');

RodaError.notFound = function(key){
  return RodaError(404, 'notFound', '`'+key+'` not found.', {key: key});
};
RodaError.exists = function(key){
  return RodaError(412, 'exists', '`'+key+'` already exists.', {key: key});
};

module.exports = RodaError;

