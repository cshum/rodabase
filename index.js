var _           = require('underscore'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),
    util        = require('./lib/util'),
    mid         = require('./lib/mid'),
    Resource    = require('./lib/resource');

module.exports = function(path, options){
  //default options
  options = _.extend({
  }, options, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  var db, map = {};

  //level-sublevel
  db = sublevel( levelup(path, options) );
  //level-async-transaction
  transaction(db);
  //unique id for db
  mid(db);

  function roda(name){
    name = String(name);
    map[name] = map[name] || new Resource(roda, name);
    return map[name];
  }
  roda.db = db;
  roda.transaction = db.transaction;
  roda.base = Resource.prototype;
  roda.util = util;

  return roda;
};
