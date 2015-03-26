var fs     = require('fs'),
    path   = require('path'),
    mkdirp = require('mkdirp'),
    crypto = require('crypto');

module.exports = function(dir){
  var file = path.resolve(dir,'.nid');
  var id;
  try{
    id = fs.readFileSync(file, 'utf8');
  }catch(e){
    id = crypto.randomBytes(6)
      .toString('base64')
      .replace(/\//g,'_')
      .replace(/\+/g,'-');

    mkdirp.sync(dir);
    fs.writeFileSync(file, id, 'utf8');
  }
  return id;
};
