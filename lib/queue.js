var H      = require('highland'),
    ginga  = require('ginga'),
    util   = require('./util'),
    params = ginga.params;
 
function run(){
  var self = this;
  if(this._started && !this._running && !this._ended){
    this.job(function(err){
      self._running = false;

      if(!err) run.call(self);
      else self.error(err, run.bind(self));
    });
    this._running = true;
  }
}

function Queue(roda, name, n){
  throw 'in progress';
  this.roda = roda;

  this._name = name;
  this._ended = false;
  this._count = 0;

  var self = this;

  function job(data, cb){
    self.job(data, function(err){
      if(err){
        self.error(err, job.bind());
      }else 
        cb();
    });
  }
  this._clocks = this.roda.store
    .sublevel('queues')
    .sublevel(name);

  var clockStream;
  if(name){
    //durable queue
    clockStream = H(
      this._clocks.createReadStream()
    ).map(function(data){
      return data.key + data.value;
    });
  }else{
    //volatile queue
    clockStream = H([]);
  }

  this._stream = clockStream
    .pipe(this.roda.changeStream({ live: true }))
    .map(H.wrapCallback(function(data, cb){
      self.job(data, cb.bind(null, null, data));
    }))
    .parallel(n)
    .map(H.wrapCallback(function(data, cb){
      if(self._clocks){
        //durable queue
        var mid = data._rev.slice(0, 8);
        var time = data._rev.slice(8);
        self._clocks.put(mid, time, function(err){
          if(err) cb(err);
          else cb(null, data);
        });
      }else{
        cb(null, data);
      }
    }))
    .parallel(1)
    .map(function(data){
      self._count++;
      return data;
    });
}

Queue.fn = ginga(Queue.prototype);

Queue.fn.name = function(){
  return this._name;
};
Queue.fn.started = function(){
  // return this._stream._started;
};
Queue.fn.ended = function(){
  return this._ended;
};

Queue.fn.define('start', function(ctx, done){
  this._stream.resume();
  done(null);
});

Queue.fn.define('pause', function(ctx, done){
  this._stream.pause();
  done(null);
});

Queue.fn.define('job', params('result'), function(ctx, next){
  ctx.result = ctx.params.result;
  next();
}, function(ctx, done){
  done(null, ctx.result);
});

Queue.fn.define('error', params('error?'), function(ctx, next){
  ctx.error = ctx.params.error;
  next();
}, null);

Queue.fn.define('end', function(ctx, done){
  this._ended = true;
  done(null);
});

module.exports = function(){
  var args = Array.prototype.slice(arguments);
  var name = null;
  var n = 1;

  if(typeof args[0] === 'string') name = args.shift();
  if(typeof args[0] === 'number') n = args.shift();
  //volatile queue
  if(!name) return new Queue(this, name, n);

  //presistent queue
  this._queues = this._queues || {};
  this._queues[name] = this._queues[name] || 
    new Queue(this, name, n);
  return this._queues[name];
};
