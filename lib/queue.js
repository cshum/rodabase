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

function Queue(roda, name){
  this.roda = roda;
  this.store = roda.store.sublevel('queue');

  if(name)
    this._clocks = this.store.sublevel(name);

  this._name = name;
  this._started = false;
  this._running = false;
  this._ended = false;

  var self = this;

  //run on roda store change
  roda.store.post(function(){
    self._ended = false;
    run.call(self);
  });
}

Queue.fn = ginga(Queue.prototype);

Queue.fn.name = function(){
  return this._name;
};
Queue.fn.started = function(){
  return this._started;
};
Queue.fn.ended = function(){
  return this._ended;
};

Queue.fn.define('start', function(ctx, done){
  this._started = true;
  run.call(this);
  done(null);
});

Queue.fn.define('pause', function(ctx, done){
  this._started = false;
  done(null);
});

Queue.fn.clockStream = 
Queue.fn.createClockStream = 
function(){
  if(this._clocksObj)
    return H(util.clock(this._clocksObj));

  if(this._clocks){
    var self = this;
    var clockObj = {};

    return H(this._clocks.createReadStream())
      .map(function(data){
        var mid = data.key.slice(-8);
        var time = data.value;

        clockObj[mid] = time;

        return mid + time;
      })
      .on('end', function(){
        self._clocksObj = clockObj;
      });
  }else{
    this._clocksObj = {};
    return H([]);
  }
};

Queue.fn.define('job', function(ctx, next){
  var self = this;
  this.clockStream()
    .pipe(this.roda.changeStream({limit: 1}))
    .stopOnError(next)
    .toArray(function(res){
      if(!res.length){
        self.end(next);
      }else{
        ctx.result = res[0].result;
        ctx._rev = ctx.result._rev;
        next();
      }
    });
}, function(ctx, next){
  ctx.mid = ctx._rev.slice(0, 8);
  ctx.time = ctx._rev.slice(8);
  if(this._clocks)
    this._clocks.put(ctx.mid, ctx.time, function(err){
      if(err) return next(err);
      next();
    });
  else
    next();
}, function(ctx, done){
  if(this._clocksObj)
    this._clocksObj[ctx.mid] = ctx.time;
  done(null);
});

Queue.fn.define('error', params('error?'), function(ctx, next){
  ctx.error = ctx.params.error;
  next();
},function(ctx, next){
  //default error behaviour: wait half sec then retry
  setTimeout(next, 500);
});

Queue.fn.define('end', function(ctx, done){
  this._ended = true;
  done(null);
});

module.exports = function(name){
  //volatile queue
  if(!name) return new Queue(this);

  //presistent queue
  this._queues = this._queues || {};
  this._queues[name] = this._queues[name] || new Queue(this, name);
  return this._queues[name];
};
