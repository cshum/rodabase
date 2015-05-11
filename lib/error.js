function error(status, name, message){
  if(!(this instanceof error))
    return new error(status, name, message);

  Error.call(message);

  this.status = status;
  this.name = name;
  this.message = message;
  this[name] = true;
  this.error = true;
}

error.prototype = new Error();

error.prototype.toString = function(){
  return JSON.stringify({
    status: this.status,
    name: this.name,
    message: this.message
  });
};

error.INVALID_TX = error(500, 'invalidTx', 'Invalid transaction instance.');
error.MID_LEN    = error(400, 'midLen',    'MID must be length 8');
error.CONFLICT   = error(409, 'conflict',  'Document merge conflict.');
error.NOT_READY  = error(400, 'notReady',  'Not ready.');

error.keyNotFound = function(key){
  var e = error(404, 'keyNotFound', '`'+key+'` not found.');
  e.key = key;
  return e;
};
error.keyExists = function(key){
  var e = error(412, 'keyExists', '`'+key+'` already exists.');
  e.key = key;
  return e;
};

module.exports = error;

