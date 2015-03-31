var _           = require('underscore'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),
    mid         = require('./lib/mid'),
    Roda        = require('./lib/roda');

module.exports = function(path, options){
  //default options
  options = _.extend({
  }, options, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  var db, id = options.id, rodas = {};

  //level-sublevel
  db = sublevel( levelup(path, options) );
  //level-async-transaction
  db = transaction(db);

  if(!id){
    //generate mid
    id = mid(path);
  }

  //base API
  function base(name){
    rodas[name] = rodas[name] || new Roda(base, name);
    return rodas[name];
  }
  base.db = db;
  base.transaction = db.transaction;
  base.api = Roda.prototype;

  base.id = function(){
    return id;
  };

  return base;
};
