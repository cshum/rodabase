function Err(status, name, message){
  Error.call(message);

  this.status = status;
  this.name = name;
  this.message = message;
  this.error = true;
}

Err.prototype = new Error();

Err.prototype.toString = function(){
  return JSON.stringify({
    status: this.status,
    name: this.name,
    message: this.message
  });
};

Err.INVALID_TX = new Err(
  500, 'invalid_tx', 'Invalid transaction object.');

Err.MID_LEN = new Err(
  400, 'mid_len', 'MID must be length 8');

Err.CONFLICT = new Err(
  409, 'conflict', 'Document merge conflict.');

Err.keyExists = function(key){
  var e = new Err(
    412, 'key_exists', 
    'Index could not be created. `' + key + '` already exists.');
  e.key = key;
  return e;
};

module.exports = Err;

