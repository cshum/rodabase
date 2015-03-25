var _           = require('underscore'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),

    util   = require('./lib/util.js'),
    Roda   = require('./lib/roda.js'),
    nodeId = require('./lib/nodeid.js');

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

  var db, map = {};

  if(typeof options.db.sublevel === 'function')
    db = options.db.sublevel(path, options);
  else
    db = sublevel( levelup(path, options) );

  db = transaction(db);

  //base API
  function base(name){
    map[name] = map[name] || new Roda(base, name);
    return map[name];
  }
  base.db = db;
  base.transaction = db.transaction;
  base.api = Roda.prototype;

  //mixin util functions
  _.extend(base, util);

  base.id = nodeId(db);

  return base;
};
