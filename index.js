var _           = require('underscore'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),

    Roda = require('./lib/roda.js');

module.exports = function(path, options){
  options = _.extend({

  }, options, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  if(!options.db) 
    options.db = require('leveldown');

  var db, id, map = {};

  if(typeof options.db.sublevel === 'function')
    db = options.db.sublevel(path, options);
  else
    db = sublevel( levelup(path, options) );

  db = transaction(db);

  function Base(name){
    map[name] = map[name] || new Roda(Base);
    return map[name];
  }
  Base.db = db;
  Base.transaction = db.transaction;
  Base.api = Roda.prototype;

  return Base;
};
