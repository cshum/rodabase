var _           = require('underscore'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),

    Roda   = require('./lib/roda');

module.exports = function(path, options){
  //default options
  options = _.extend({
  }, options, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  //setup db
  if(!options.db) 
    options.db = require('leveldown');

  var db, id = options.id, rodas = {};

  if(typeof options.db.sublevel === 'function')
    db = options.db.sublevel(path, options);
  else
    db = sublevel( levelup(path, options) );

  db = transaction(db);

  //base API
  function base(name){
    rodas[name] = rodas[name] || new Roda(base, name);
    return rodas[name];
  }
  base.db = db;
  base.transaction = db.transaction;
  base.api = Roda.prototype;

  if(!id){
    //todo: generate node id
  }
  base.id = function(){
    return id;
  };

  return base;
};
