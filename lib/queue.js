var H      = require('highland'),
    ginga  = require('ginga'),
    extend = require('extend'),
    params = ginga.params,
    util   = require('./util');
 
function Queue(roda, name, n){
  this.roda = roda;
  this._name = name;

  var self = this;
  var durable = !!name;
  var queues = roda.store.sublevel('queues');

  this._stream = H(function(push, next){
    queues.get(name, function(err, time){
      next(roda.timeStream({
        live: true, gt: time || 0
      }));
    });
  })
  .map(H.wrapCallback(function doJob(retry, data, cb){
    this.job(retry, data, function(err){
      if(err){
        this.error(err, doJob.bind(
          this, retry + 1, data, cb
        ));
      }else 
        cb(null, data);
    });
  }.bind(this, 0)))
  .parallel(n || 1)
  .map(H.wrapCallback(function(data, cb){
    //write time if durable
    if(durable) 
      queues.put(name, data._time, cb);
    else 
      cb();
  }))
  .parallel(1);
}

Queue.fn = ginga(Queue.prototype);

Queue.fn.name = function(){
  return this._name;
};
Queue.fn.started = function(){
  return this._stream._started;
};
Queue.fn.start = Queue.fn.resume = function(){
  this._stream.resume();
};
Queue.fn.pause = function(){
  this._stream.pause();
};

function xparams(ctx, next){
  extend(ctx, ctx.params);
  next();
}

Queue.fn.define('job', params(
  'retry', 'result'
), xparams, function(ctx, done){
  done(null, ctx.result);
});

Queue.fn.define('error', params(
  'error', 'result'
), xparams, null);

module.exports = function(name, n){
  var args = Array.prototype.slice(arguments);

  if(typeof name === 'number') {
    n = name;
    name = null;
  }
  //volatile queue
  if(!name) return new Queue(this, null, n);

  //presistent queue
  this._queues = this._queues || {};
  this._queues[name] = this._queues[name] || 
    new Queue(this, name, n);
  return this._queues[name];
};
