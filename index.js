var _           = require('underscore'),
    ginga       = require('ginga'),
    params      = ginga.params,
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),
    util        = require('./lib/util'),
    mid         = require('./lib/mid'),
    Resource    = require('./lib/resource');

var rodabase = ginga()
  .define('clock', function(ctx, done){
    var obj = {};
    this.db.sublevel('clock').createReadStream()
      .on('data', function(data){
        var name = data.key.slice(0, -8);
        obj[name] = obj[name] || [];
        obj[name].push(data.key.slice(-8) + data.value);
      })
      .on('close', function(){
        for(var name in obj)
          obj[name] = obj[name].join(',');
        done(null, obj);
      })
      .on('error', done);
  })
  .define('id', function(ctx, done){
    this.db.mid(done);
  });

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

  _.extend(roda, rodabase);

  roda.db = db;
  roda.transaction = db.transaction;
  roda.base = Resource.prototype;
  roda.util = util;

  return roda;
};
