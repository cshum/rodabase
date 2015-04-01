var fs     = require('fs'),
    path   = require('path'),
    mkdirp = require('mkdirp'),
    crypto = require('crypto');

module.exports = function(dir){
  dir = path.dirname(dir);
  mkdirp.sync(dir);

  var file = path.resolve(dir,'.mid');
  var id;
  try{
    id = fs.readFileSync(file, 'utf8');
  }catch(e){
    id = crypto.randomBytes(6)
      .toString('base64')
      .replace(/\//g,'_')
      .replace(/\+/g,'-');

    fs.writeFileSync(file, id, 'utf8');
  }
  return id;
};
