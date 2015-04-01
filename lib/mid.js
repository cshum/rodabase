var fs     = require('fs'),
    path   = require('path'),
    d64    = require('d64'),
    mkdirp = require('mkdirp'),
    crypto = require('crypto');

module.exports = function(file){
  file += '.mid';
  mkdirp.sync(path.dirname(file));

  var id;
  try{
    id = fs.readFileSync(file, 'utf8');
  }catch(e){
    id = d64.encode(crypto.randomBytes(6));

    fs.writeFileSync(file, id, 'utf8');
  }
  return id;
};
