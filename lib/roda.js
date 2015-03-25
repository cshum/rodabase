var _         = require('underscore'),
    ginga     = require('ginga'),
    params    = ginga.params,
    bytewise  = require('bytewise'),
    uuid      = require('node-uuid'),
    timestamp = require('monotonic-timestamp'),

    queue  = require('./queue.js'),
    mapper = require('./mapper.js');


function Roda(base, name){
  this.base = base;
  this.store = base.db.sublevel(name);

  this._name = name;
  this._clock = this.store.sublevel('clock');
  this._changes = this.store.sublevel('changes');
}
var R = ginga(Roda.prototype);

R.name = function(){
  return this._name;
};

R.queue = queue;
R.mapper = mapper;
