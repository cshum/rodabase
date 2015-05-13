var extend = require('extend');

function error(status, name, message, obj){
  if(!(this instanceof error))
    return new error(status, name, message, obj);

  Error.call(message);

  this.error = true;
  this.status = status;
  this.name = name;
  this.message = message;
  this[name] = true;

  extend(this, obj);
}

error.prototype = new Error();

error.prototype.toString = function(){
  return JSON.stringify(this);
};

error.INVALID_TX = error(500, 'invalidTx', 'Invalid transaction instance.');
error.MID_LEN    = error(400, 'midLen',    'MID must be length 8');
error.CONFLICT   = error(409, 'conflict',  'Document merge conflict.');
error.NOT_READY  = error(400, 'notReady',  'Not ready.');
error.NOT_FOUND  = error(404, 'notFound',  'Not found.');

error.notFound = function(key){
  return error(404, 'notFound', '`'+key+'` not found.', {key: key});
};
error.exists = function(key){
  return error(412, 'exists', '`'+key+'` already exists.', {key: key});
};

module.exports = error;

