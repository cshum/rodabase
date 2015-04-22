var H      = require('highland'),
    ginga  = require('ginga'),
    params = ginga.params,
    util   = require('./util');
 
function Queue(roda, name, n){
  this.roda = roda;

  this._name = name;

  var self = this;
  var durable = !!name;

  this._clocks = this.roda.store
    .sublevel('queues')
    .sublevel(name);

  var clockStream = durable ? H(
    this._clocks.createReadStream()
  ).map(function(data){
    return data.key + data.value;
  }) : H([]);

  function job(retry, data, cb){
    this.job(retry, data, function(err){
      if(err){
        this.error(err, function(){
          job.call(this, retry + 1, data, cb);
        });
      }else 
        cb(null, data);
    });
  }

  this._stream = clockStream
    .pipe(this.roda.changeStream({ live: true }))
    .map(H.wrapCallback(job.bind(this, 0)))
    .parallel(n || 1)
    .map(H.wrapCallback(function(data, cb){
      if(!durable)
        return cb(data);
      //write clock if durable
      var mid = data._rev.slice(0, 8);
      var time = data._rev.slice(8);
      self._clocks.put(mid, time, function(err){
        if(err) cb(err);
        else cb(null, data);
      });
    }))
    .parallel(1);
}

Queue.fn = ginga(Queue.prototype);

Queue.fn.name = function(){
  return this._name;
};
Queue.fn.started = function(){
  // return this._stream._started;
};

Queue.fn.define('start', function(ctx, done){
  this._stream.resume();
  done(null);
});

Queue.fn.define('pause', function(ctx, done){
  this._stream.pause();
  done(null);
});

function extend(ctx, next){
  H.extend(ctx.params, ctx);
  next();
}

Queue.fn.define('job', params(
  'retry', 'result'
), extend, function(ctx, done){
  done(null, ctx.result);
});

Queue.fn.define('error', params(
  'error', 'result'
), extend, null);

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
