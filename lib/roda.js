var _         = require('underscore'),
    ginga     = require('ginga'),
    params    = ginga.params,
    timestamp = require('monotonic-timestamp'),
    util      = require('./util');
    // queue     = require('./queue'),
    // mapper    = require('./mapper');

function Roda(app, name){
  this.app = app;
  this.store = app.db.sublevel(name);

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
    if(ctx.params.tx.db !== this.app.db)
      return next(new Error('Transaction must be within the same database'));
    ctx.params.tx.get(ctx.params.id, {
      prefix: this.store 
    }, done);
  }else{
    this.store.get(ctx.params.id, done);
  }
});

R.createReadStream = function(options){
  //todo: prefix range
  return this.store.createValueStream(options);
};

R.createChangesStream = function(options){

};

R.define('clock', function(ctx, done){
  var result = {};
  this._clock.createReadStream()
    .on('data', function(data){
      result[data.key] = data.value;
    })
    .on('error', function(err){
      done(err, null);
    })
    .on('close', function(){
      done(null, result);
    });
});

//Hooks

R.define('validate', params('result'), function(ctx, next){
  ctx.result = _.clone(ctx.params.result);
  next();
}, function(ctx, done){
  done(null, ctx.result);
});

R.define('diff', params('current', 'result', 'tx'), function(ctx, next){
  ctx.current = ctx.params.current;
  ctx.result = _.clone(ctx.params.result);
  ctx.transaction = ctx.params.tx;
  next();
}, function(ctx, done){
  done(null, ctx.transaction);
});

//Write

function validate(ctx, next){
  this.validate(
    ctx.params.result, 
    function(err, result){
      if(err) return next(err);

      ctx.result = result;
      next();
    }
  );
}

function prepare(ctx, next, end){
  //init transaction
  if(ctx.params.tx){
    if(ctx.params.tx.db !== this.app.db)
      return next(new Error('Transaction must be within the same database'));
    ctx.transaction = ctx.params.tx;
    //defer if within another transaction
    ctx.transaction.defer(end);
  }else{
    ctx.transaction = this.app.transaction();
  }

  var mid = this.app.id();

  //prepare result
  ctx.result = ctx.result || {};

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

function current(ctx, next){
  var self = this;

  ctx.transaction.get(ctx.result._id, {
    prefix: this.store 
  }, function(err, val){
    if(err && !err.notFound)
      return next(err);
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
  var mid = this.app.id();
  var self = this;

  ctx.transaction.get(mid, {
    prefix: this._clock 
  }, function(err, val){
    //lamport timestamp
    var time = util.encode(Math.max(
      val ? util.decode(val) : 0,
      ctx.current ? util.decode(ctx.current._rev.slice(8)) : 0
    ) + 1);

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
  validate, prepare, current, rev, diff, put, invoke);

R.define('del', params('id:string','tx?'),
  prepare, current, rev, diff, del, invoke);

module.exports = Roda;
