var ginga       = require('ginga'),
    params      = ginga.params,
    _           = require('underscore'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),
    mid         = require('./mid'),
    util        = require('./util'),
    range       = require('./range');

module.exports = function(path, opts){
  //default options
  opts = _.clone(opts || {});
  opts.keyEncoding = 'utf8';
  opts.valueEncoding = 'json';

  var roda = {};

  //level-sublevel
  var db = sublevel(levelup(path, opts));
  //level-async-transaction
  transaction(db);
  //unique id for db
  mid(db);

  var clock = db.sublevel('clock');

  function Roda(name){
    name = String(name);

    if(!(this instanceof Roda))
      return roda[name] || new Roda(name);

    if(roda[name] && this !== roda[name])
      throw new Error('Roda `'+name+'` has already been initialised.');
    else
      roda[name] = this;

    // roda "/" prefixed
    this.store = db.sublevel('/'+name);
    //can retrieve global clock without scanning through rodas

    this._name = name;
    this._changes = this.store.sublevel('changes');
    this._indices = this.store.sublevel('indices');
    this._indexed = this.store.sublevel('indexed');

    this._mapper = null;
  }

  ginga(Roda);

  Roda.db = db;
  Roda.transaction = db.transaction;
  Roda.util = util;
  Roda.id = db.mid;

  Roda.define('clock', function(ctx, done){
    var obj = {};
    clock.createReadStream()
      .on('data', function(data){
        var name = data.key.slice(0, -8);
        obj[name] = obj[name] || [];
        obj[name].push(data.key.slice(-8) + data.value);
      })
      .on('close', function(){
        for(var name in obj)
          obj[name] = obj[name].join(',');
        done(null, obj);
      })
      .on('error', done);
  });

  //Methods
  Roda.fn = ginga(Roda.prototype);

  Roda.fn.name = function(){
    return this._name;
  };
  Roda.fn.queue = require('./queue');

  //Read
  Roda.fn.define('get', params('id:string','tx?'), function(ctx, done){
    function cb(err, val){
      //notFound should not return error but null value
      if(err && !err.notFound)
        done(err);
      else
        done(null, val || null);
    }
    if(ctx.params.tx){
      if(ctx.params.tx.db !== db)
        return next(new Error('Invalid transaction object.'));
      ctx.params.tx.get(util.encode(ctx.params.id), {
        prefix: this.store
      }, cb);
    }else{
      this.store.get(util.encode(ctx.params.id), cb);
    }
  });

  Roda.fn.define('read', params(
    'index:string?','options:object?'
  ), function(ctx, next){
    ctx.options = _.extend(ctx.params, ctx.params.options);

    var opts = range(ctx.options);

    if(ctx.options.index)
      ctx.stream = this._indices
        .sublevel(ctx.options.index)
        .createValueStream(opts);
    else
      ctx.stream = this.store
        .createValueStream(opts);

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

  function extend(ctx, next){
    _.extend(ctx, ctx.params);
    next();
  }

  //Hooks
  Roda.fn.define('validate', params(
    'result', 'transaction'
  ), extend, function(ctx, done){
    done(null, ctx.result);
  });

  Roda.fn.define('diff', params(
    'clock','current', 'result', 'transaction'
  ), extend, null);

  //Write Operations

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
      if(ctx.params.tx.db !== db)
        return next(new Error('Invalid transaction object.'));
      ctx.transaction = ctx.params.tx;
      //defer if within another transaction
      ctx.transaction.defer(function(cb){
        end(cb);
        next();
      });
    }else{
      ctx.transaction = db.transaction();
      next();
    }
  }

  function id(ctx, next){
    db.mid(function(err, mid){
      ctx.mid = mid;

      if('id' in ctx.params)
        ctx.result._id = ctx.params.id;
      else{
        //monotonic timestamp + mid
        ctx.result._id = util.encode64(util.timestamp()) + ctx.mid;
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

    ctx.transaction.get(util.encode(ctx.result._id), {
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

    var key = this._name + ctx.mid;
    ctx.transaction.get(key, {
      prefix: clock 
    }, function(err, val){
      if(val)
        ctx.clock = ctx.mid + val;

      //lamport timestamp
      var time = util.trim(util.encode64(
        Math.max(
          val ? util.decode64(
            util.pad(val, 12)
          ) : 0,
          ctx.current ? util.decode64(
            util.pad(ctx.current._rev.slice(8), 12)
          ) : 0
        ) + 1
      ));

      //generate rev id
      ctx.result._rev = ctx.mid + time;

      //lamport clock update
      ctx.transaction.put(key, time, {
        prefix: clock 
      });

      next();
    });
  }


  function diff(ctx, next){
    this.diff(
      ctx.clock || null,
      ctx.current || null, 
      _.clone(ctx.result), //dont modify result
      ctx.transaction,
      function(err, res){
        if(err) return next(err);
        next();
      }
    );
  }

  function put(ctx, next){
    ctx.transaction
      .put(util.encode(ctx.result._id), ctx.result, {
        prefix: this.store 
      })
      .put(ctx.result._rev, ctx.result, {
        prefix: this._changes 
      });
    next();
  }

  function del(ctx, next){
    ctx.transaction
      .del(util.encode(ctx.result._id), {
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

  Roda.fn.define('put', params('id:string?','result:object','tx?'),
    prepare, id, validate, current, rev, diff, put, invoke);

  Roda.fn.define('del', params('id:string','tx?'),
    prepare, id, current, rev, diff, del, invoke);

  //Index Mapper
  Roda.fn.index = function(name, mapper){
    this._mapper = this._mapper || {};

    if(typeof name === 'string' && typeof mapper === 'function'){
      if(this._mapper[name])
        throw new Error('Index `'+name+'` has already been assigned.');
      this._mapper[name] = mapper;
    }else{
      throw new Error('Invalid index mapper');
    }
    return this;
  };

  //_rev validation
  Roda.fn.use('diff', function(ctx, next){
    if(ctx.current && ctx.result._rev <= ctx.current._rev)
      return next(new Error('Revision must be incremental with current.'));

    if(ctx.clock && ctx.result._rev <= ctx.clock)
      return next(new Error('Revision must be incremental with clock.'));

    next();
  });

  //Index generation
  Roda.fn.use('diff', function(ctx, next){
    if(!this._mapper) return next();

    var self = this;
    var tx = ctx.transaction;

    tx.get(ctx.result._id, {
      prefix: this._indexed
    }, function(err, current){
      //delete current indices
      var name, i, l, keys, key;
      if(current){
        for(name in current){
          keys = current[name];
          for(i = 0, l = keys.length; i < l; i++){
            tx.del(keys[i], {
              prefix: self._indices.sublevel(name)
            });
          }
        }
      }

      //when delete
      if(!ctx.result){
        tx.put(ctx.result._id, {}, {
          prefix: self._indexed
        });
        return next();
      }

      var result = _.clone(ctx.result);
      var indexed = {};
      var async = false;

      var plan = 0;

      function emit(name, key, value, unique){
        if(async)
          throw new Error('Index mapper must not be async.');

        //optional value arg
        if(value === true){
          unique = true;
          value = null;
        }

        //append unique timestamp for non-unqiue key
        var enKey = util.encode(key) + '\x00';
        if(unique !== true)
          enKey += util.encode(util.timestamp());

        //record encoded key
        indexed[name].push(enKey);

        //check unique
        if(unique === true)
          tx.defer(function(cb){
            tx.get(enKey, {
              prefix: self._indices.sublevel(name)
            }, function(err, val){
              if(val) cb(new Error(key + ' must be unique.'));
              else cb();
            });
          });

        //put index store
        tx.defer(function(cb){
          tx.put(enKey, _.extend(value || _.clone(result), {
            _id: ctx.result._id, _key: key
          }), {
            prefix: self._indices.sublevel(name)
          }, cb);
        });
      }

      for(name in self._mapper){
        indexed[name] = [];
        self._mapper[name](result, emit.bind(null, name));
      }
      //new indexed keys
      tx.put(ctx.result._id, indexed, {
        prefix: self._indexed
      });
      async = true;

      next();
    });
  });

  //Changes

  Roda.fn.define('clock', function(ctx, done){
    var arr = [];
    clock.createReadStream({
      gt: this._name, lt: this._name + '~'
    })
      .on('data', function(data){
        arr.push(data.key.slice(-8) + data.value);
      })
      .on('close', function(){
        done(null, arr.join(','));
      })
      .on('error', done);
  });

  Roda.fn.define('changes', params(
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

  return Roda;
};
