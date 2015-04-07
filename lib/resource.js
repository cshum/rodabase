var _         = require('underscore'),
    ginga     = require('ginga'),
    params    = ginga.params,
    timestamp = require('monotonic-timestamp'),
    util      = require('./util');
    // mapper = require('./mapper');

function Resource(roda, name){
  this.roda = roda;
  this.store = roda.db.sublevel(name);

  this._name = name;
  this._clock = this.store.sublevel('clock');
  this._changes = this.store.sublevel('changes');

  this._queues = {};
}
var R = ginga(Resource.prototype);

R.name = function(){
  return this._name;
};

R.queue = require('./queue');
// R.mapper = mapper;

//Read
R.define('get', params('id:string','tx?'), function(ctx, done){
  function cb(err, val){
    //notFound should not return error but null value
    if(err && !err.notFound)
      done(err);
    else
      done(null, val || null);
  }
  if(ctx.params.tx){
    if(ctx.params.tx.db !== this.roda.db)
      return next(new Error('Invalid transaction object.'));
    ctx.params.tx.get(ctx.params.id, {
      prefix: this.store 
    }, cb);
  }else{
    this.store.get(ctx.params.id, cb);
  }
});

R.define('read', params(
  'limit:number?','options:object?'
), function(ctx, next){
  var opts = ctx.options = _.extend(
    {}, ctx.params, ctx.params.options
  );
  if('prefix' in opts){
    if('gte' in opts)
      opts.gte = opts.prefix + opts.gte;
    else if('gt' in opts)
      opts.gt = opts.prefix + opts.gt;
    else
      opts.gte = opts.prefix;

    if('lte' in opts)
      opts.lte = opts.prefix + opts.lte;
    else if('lt' in opts)
      opts.lt = opts.prefix + opts.lt;
    else
      opts.lte = opts.prefix + '\xff';
  }
  ctx.stream = this.store.createValueStream(opts);

  next();
}, function(ctx, done){
  var result = [];
  ctx.stream
    .on('data', function(data){
      result.push(data);
    })
    .on('close', function(){
      done(null, result);
    })
    .on('error', done);
});


//Hooks
function extend(ctx, next){
  _.extend(ctx, ctx.params);
  next();
}

R.define('validate', params(
  'result', 'transaction'
), extend, function(ctx, done){
  done(null, ctx.result);
});

R.define('diff', params(
  'current', 'result', 'transaction'
), extend, function(ctx, done){
  done(null, ctx.transaction);
});

//Write

function prepare(ctx, next, end){
  //prepare result
  ctx.result = _.clone(ctx.params.result || {});

  var deleted = (!ctx.params.result) && ('id' in ctx.params);

  if(deleted)
    ctx.result._deleted = true;
  else
    delete ctx.result._deleted;

  //init transaction
  if(ctx.params.tx){
    if(ctx.params.tx.db !== this.roda.db)
      return next(new Error('Invalid transaction object.'));
    ctx.transaction = ctx.params.tx;
    //defer if within another transaction
    ctx.transaction.defer(function(cb){
      end(cb);
      next();
    });
  }else{
    ctx.transaction = this.roda.transaction();
    next();
  }
}

function mid(ctx, next){
  this.roda.db.id(function(err, mid){
    ctx.mid = mid;

    if('id' in ctx.params)
      ctx.result._id = ctx.params.id;
    else if(!ctx.result._id){
      //generate _id = monotonic timestamp encode + mid
      ctx.result._id = util.encode(timestamp()) + ctx.mid;
    }
    next();
  });
}

function validate(ctx, next){
  this.validate(
    ctx.result, 
    ctx.transaction,
    function(err, result){
      if(err) return next(err);

      ctx.result = result;
      next();
    }
  );
}

function current(ctx, next){
  var self = this;

  ctx.transaction.get(ctx.result._id, {
    prefix: this.store 
  }, function(err, val){
    //return IO/other errors
    if(err && !err.notFound)
      return next(err);
    //dont proceed if delete non existing item
    if(!val && ctx.result._deleted)
      return next(null);
    if(val){
      ctx.current = val;
      //remove previous change
      ctx.transaction.del(ctx.current._rev, {
        prefix: self._changes 
      });
    }
    next();
  });
}

function rev(ctx, next){
  var self = this;

  ctx.transaction.get(ctx.mid, {
    prefix: this._clock 
  }, function(err, val){
    //lamport timestamp
    var time = util.trim(util.encode(
      Math.max(
        val ? util.decode(
          util.pad(val, 12)
        ) : 0,
        ctx.current ? util.decode(
          util.pad(ctx.current._rev.slice(8), 12)
        ) : 0
      ) + 1
    ));

    //generate rev id
    ctx.result._rev = ctx.mid + time;

    //lamport clock update
    ctx.transaction.put(ctx.mid, time, {
      prefix: self._clock 
    });

    next();
  });
}

function diff(ctx, next){
  this.diff(
    ctx.current || null, 
    ctx.result._deleted ? null: _.clone(ctx.result),
    ctx.transaction,
    function(err, res){
      if(err) return next(err);
      next();
    }
  );
}

function put(ctx, next){
  ctx.transaction
    .put(ctx.result._id, ctx.result, {
      prefix: this.store 
    })
    .put(ctx.result._rev, ctx.result, {
      prefix: this._changes 
    });
  next();
}

function del(ctx, next){
  ctx.transaction
    .del(ctx.result._id, {
      prefix: this.store 
    })
    .put(ctx.result._rev, ctx.result, {
      prefix: this._changes 
    });
  next();
}

function invoke(ctx, done){
  var result = _.clone(ctx.result);
  if(ctx.params.tx){
    //batched not yet committed
    done(null, result);
  }else{
    ctx.transaction.commit(function(err){
      if(err) done(err, null);
      else done(null, result);
    });
  }
}

R.define('put', params('id:string?','result:object','tx?'),
  prepare, mid, validate, current, rev, diff, put, invoke);

R.define('del', params('id:string','tx?'),
  prepare, mid, current, rev, diff, del, invoke);

//Changes
R.define('clock', function(ctx, done){
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

R.define('changes', params(
  'since:string?','limit:number?'
), function(ctx, done, end){
  var limit = ctx.params.limit;
  var count = 0;
  var result = [];
  var self = this;

  function receive(mid, start, cb){
    if(limit && count >= limit)
      return cb(null, result);
    var opts = {};
    if(limit)
      opts.limit = limit - count;
    if(mid){
      opts.gt = mid + (start || '');
      opts.lt = mid + '~';
    }
    self._changes.createValueStream(opts)
      .on('data', function(data){
        result.push(data);
        count++;
      })
      .on('close', function(){
        cb(null, result);
      })
      .on('error', cb);
  }

  if(!ctx.params.since){
    receive(null, null, done);
  }else{
    this.clock(function(err, data){
      var clock = util.clockObject(data);
      var since = util.clockObject(ctx.params.since);
      var q = util.queue();
      for(var mid in clock){
        if(!since[mid] || since[mid] < clock[mid])
          q.add(receive.bind(null, mid, since[mid]));
      }
      q.start(function(err){
        if(err) return done(err);
        done(null, result);
      });
    });
  }
});

module.exports = Resource;
