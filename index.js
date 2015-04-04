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

  var db, id, map = {};

  //level-sublevel
  db = sublevel( levelup(path, options) );
  //level-async-transaction
  db = transaction(db);

  //generate mid
  id = mid(path);

  function roda(name){
    map[name] = map[name] || new Resource(roda, name);
    return map[name];
  }
  roda.db = db;
  roda.transaction = db.transaction;
  roda.base = Resource.prototype;
  roda.util = util;

  roda.id = function(){
    return id;
  };

  return roda;
};
