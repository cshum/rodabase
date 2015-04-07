var fs     = require('fs'),
    path   = require('path'),
    mkdirp = require('mkdirp'),
    crypto = require('crypto');

module.exports = function(file){
  file += '.id';
  mkdirp.sync(path.dirname(file));

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
