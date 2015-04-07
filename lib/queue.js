var _      = require('underscore'),
    ginga  = require('ginga'),
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

function Queue(resource, name){
  this.resource = resource;
  this.store = this.resource.store.sublevel('queue');

  this._clock = this.store.sublevel(name);

  this._name = name;
  this._started = false;
  this._running = false;
  this._ended = false;

  var self = this;

  //run on resource store change
  this.resource.store.post(function(){
    self._ended = false;
    run.call(self);
  });
}

var Q = ginga(Queue.prototype);

Q.name = function(){
  return this._name;
};
Q.ended = function(){
  return this._ended;
};

Q.define('start', function(ctx, done){
  this._started = true;
  run.call(this);
  done(null);
});

Q.define('stop', function(ctx, done){
  this._started = false;
  done(null);
});

Q.define('clock', function(ctx, done){
  var self = this;
  var arr = [];
  this._clock.createReadStream()
    .on('data', function(data){
      arr.push(data.key + data.value);
    })
    .on('close', function(){
      done(null, arr.join(','));
    })
    .on('error', done);
});

function clock(ctx, next){
  this.clock(function(err, clock){
    if(err) return next(err);
    ctx.clock = clock;
    next();
  });
}

Q.define('remaining', params(
  'limit:number?'
), clock, function(ctx, done){
  this.resource.changes(
    ctx.clock, 
    ctx.params.limit, 
    done
  );
});

Q.define('job', clock, function(ctx, next){
  var self = this;
  this.resource.changes(ctx.clock, 1, function(err, res){
    if(!res.length){
      self.end(next);
    }else{
      ctx.result = res[0];
      next();
    }
  });
}, function(ctx, done){
  var self = this;
  this._clock.put(
    ctx.result._rev.slice(0, 8), 
    ctx.result._rev.slice(8), 
    function(err){
      if(err) return done(err);
      done(null);
    }
  );
});

Q.define('error', params('error?'), function(ctx, next){
  ctx.error = ctx.params.error;
  next();
},function(ctx, next){
  //default error behaviour: wait half sec then retry
  setTimeout(next, 500);
});

Q.define('end', function(ctx, done){
  this._ended = true;
  done(null);
});

module.exports = function(name){
  this._queues = this._queues || {};
  this._queues[name] = this._queues[name] || new Queue(this, name);
  return this._queues[name];
};
