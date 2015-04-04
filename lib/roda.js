var _         = require('underscore'),
    ginga     = require('ginga'),
    params    = ginga.params,
    throught  = require('through'),
    timestamp = require('monotonic-timestamp'),
    util      = require('./util');
    // queue  = require('./queue'),
    // mapper = require('./mapper');

function Roda(roda, name){
  this.roda = roda;
  this.store = roda.db.sublevel(name);

  this._name = name;
  this._clock = this.store.sublevel('clock');
  this._changes = this.store.sublevel('changes');
}
var R = ginga(Roda.prototype);

//util

R.name = function(){
  return this._name;
};

// R.queue = queue;
// R.mapper = mapper;

//Read
R.define('get', params('id:string','tx?'), function(ctx, done){
  if(ctx.params.tx){
    if(ctx.params.tx.db !== this.roda.db)
      return next(new Error('Invalid transaction object.'));
    ctx.params.tx.get(ctx.params.id, {
      prefix: this.store 
    }, done);
  }else{
    this.store.get(ctx.params.id, done);
  }
});

R.define('read', params(
  'limit:number?','options:object?'
), function(ctx, next){
  ctx.options = _.extend(
    {}, ctx.params, ctx.params.options
  );
  ctx.stream = this.store.createValueStream(ctx.options);

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
  'result'
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
  //init transaction
  if(ctx.params.tx){
    if(ctx.params.tx.db !== this.roda.db)
      return next(new Error('Invalid transaction object.'));
    ctx.transaction = ctx.params.tx;
    //defer if within another transaction
    ctx.transaction.defer(end);
  }else{
    ctx.transaction = this.roda.transaction();
  }

  var mid = this.roda.id();

  //prepare result
  ctx.result = _.clone(ctx.params.result || {});

  if('id' in ctx.params)
    ctx.result._id = ctx.params.id;
  else if(!ctx.result._id){
    //generate _id = monotonic timestamp encode + mid
    ctx.result._id = util.encode(timestamp()) + mid;
  }
  var deleted = (!ctx.params.result) && ('id' in ctx.params);

  if(deleted)
    ctx.result._deleted = true;
  else
    delete ctx.result._deleted;

  next();
}

function validate(ctx, next){
  this.validate(
    ctx.result, 
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
  var mid = this.roda.id();
  var self = this;

  ctx.transaction.get(mid, {
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
    ctx.result._rev = mid + time;

    //lamport clock update
    ctx.transaction.put(mid, time, {
      prefix: self._clock 
    });

    next();
  });
}

function diff(ctx, next){
  this.diff(
    ctx.current || null, 
    ctx.result._deleted ? null: ctx.result,
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
  prepare, validate, current, rev, diff, put, invoke);

R.define('del', params('id:string','tx?'),
  prepare, current, rev, diff, del, invoke);

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
), function(ctx, done){
  var since = ctx.params.since;
  var limit = ctx.params.limit;
  var count = 0;
  var result = [];

  function receive(stream, cb){
    if(limit && count >= limit)
      return cb(null, result);
    stream
      .on('data', function(data){
        result.push(data.value);
        count++;
      })
      .on('close', function(){
        cb(null, result);
      })
      .on('error', cb);
  }

  if(!since){
    receive(this._changes.createReadStream({
      limit: limit || -1 
    }), done);
  }else{
    this.clock(function(err, clock){
      clock = util.clockObject(clock);
      since = util.clockObject(since);
      var q = queue(1);
      for(var mid in clock){
        if(!since[mid] || since[mid] < clock[mid]){
          q.defer(receive, this._changes.createReadStream({ 
            gt: mid + since[mid],
            lt: mid + since[mid] + '~',
            limit: limit || -1
          }) );
        }
      }
      q.awaitAll(function(err){
        if(err)
          done(err, null);
        else
          done(null, result);
      });
    });
  }
});

module.exports = Roda;
