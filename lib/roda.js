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

//Utils
R.name = function(){
  return this._name;
};

R.queue = queue;
R.mapper = mapper;

//Read
R.define('get', params('id:string','tx:object?'), function(ctx, done){
  if(ctx.params.tx && ctx.params.tx.db === this.base.db){
    ctx.params.tx.get(
      encode(ctx.params.id), { prefix: this.store }, done
    );
  }else{
    this.store.get(encode(ctx.params.id), done);
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

function tx(ctx, next, end){
  //init transaction
  if(ctx.params.tx && ctx.params.tx.db === this.base.db){
    ctx.transaction = ctx.params.tx;
  }else{
    ctx.transaction = this.base.transaction();
    end(function(err){
      if(err)
        ctx.transaction.rollback();
    });
  }
  ctx.transaction.defer(end);

  //prepare result
  ctx.result = ctx.result || {};

  if('id' in ctx.params)
    ctx.result._id = ctx.params.id;
  else if(!ctx.result._id){
    //todo: generate uuid
  }
  var deleted = (!ctx.params.result) && ('id' in ctx.params);

  //todo: generate rev id (ts + db id)
  ctx.result._rev = null; 
  //todo: tx put clock

  if(deleted)
    ctx.result._deleted = true;
  else
    delete ctx.result._deleted;

  next();
}
function current(ctx, next){
  this.get(ctx.result._id, ctx.transaction, function(err, res){
    if(res){
      ctx.current = res;
      ctx.transaction.del(
        encode(this.base.id(), ctx.current._rev),
        { prefix: this._changes }
      );
    }
    //todo: next if notfound error, otherwise real error
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
    .put(
      encode(ctx.result._id), 
      ctx.result, 
      { prefix: this._store }
    )
    .put(
      encode(this.base.id(), ctx.result._rev), 
      ctx.result,
      { prefix: this._changes }
    );
  next();
}

function del(ctx, next){
  ctx.transaction
    .del(
      encode(ctx.result._id),
      { prefix: this._store }
    )
    .put(
      encode(this.base.id(), ctx.result._rev),
      ctx.result,
      { prefix: this._changes }
    );
  next();
}

function invoke(ctx, done){
  var result = _.clone(ctx.result);
  if(ctx.params.tx){
    //batched not actually committed
    done(null, result);
  }else{
    ctx.transaction.commit(function(err){
      if(err) done(err, null);
      else done(null, result);
    });
  }
}

R.define(
  'put', params('id:string?','result:object','tx:object?'),
  validate, pre, current, diff, put, invoke
);
R.define(
  'del', params('id:string','tx:object?'),
  pre, current, diff, del, invoke
);

module.exports = Roda;
