var ginga       = require('ginga'),
    params      = ginga.params,
    H           = require('highland'),
    levelup     = require('levelup'),
    sublevel    = require('level-sublevel'),
    transaction = require('level-async-transaction'),
    crypto      = require('crypto'),
    util        = require('./util'),
    range       = require('./range');

module.exports = function(path, opts){

  //default options
  opts = H.extend({}, opts);
  opts.keyEncoding = 'utf8';
  opts.valueEncoding = 'json';

  //map of roda
  var roda = {};

  //level-sublevel
  var db = sublevel(levelup(path, opts));
  //level-async-transaction
  transaction(db);

  var clocks = db.sublevel('clocks');
  var ids = db.sublevel('ids');

  function Roda(name){
    name = String(name);

    if(!(this instanceof Roda))
      return roda[name] || new Roda(name);

    if(roda[name] && this !== roda[name])
      throw new Error('Roda `'+name+'` has already been created.');
    else
      roda[name] = this;

    // roda "/" prefixed
    var store = this.store = db.sublevel('/'+name);
    //can retrieve global clock without scanning through rodas

    this._name    = name;
    this._changes = this.store.sublevel('changes');
    this._merges  = this.store.sublevel('merges');
    this._indices = this.store.sublevel('indices');
    this._indexed = this.store.sublevel('indexed');

    this._mapper = null;

    this._changes.post(function(data){
      if(data.value)
        store.emit('change', data.value);
    });
  }

  ginga(Roda);

  Roda.db = db;
  Roda.transaction = db.transaction;
  Roda.util = util;
  Roda.id = db.mid;

  //Methods
  Roda.fn = ginga(Roda.prototype);

  Roda.fn.name = function(){
    return this._name;
  };
  Roda.fn.queue = require('./queue');

  //Unique machine id for each Roda
  Roda.fn.define('mid', params('tx?'), function(ctx, next, end){
    if(this._mid)
      return next(null, this._mid);
    //init transaction
    if(ctx.params.tx){
      if(ctx.params.tx.db !== db)
        return next(new Error('Invalid transaction object.'));
      ctx.transaction = ctx.params.tx;
      //defer if within another transaction
    }else{
      ctx.transaction = Roda.transaction();
      end(function(err){
        if(err)
          ctx.transaction.rollback(err);
      });
    }

    var self = this;
    ctx.transaction.get(this._name, {
      prefix: ids
    }, function(err, val){
      if(val){
        ctx.mid = val;
        self._mid = ctx.mid;
        return next();
      }
      ctx.transaction.defer(function(cb){
        crypto.randomBytes(6, function(err, buf){
          if(err) return next(err);
          ctx.mid = buf.toString('base64')
            .replace(/\//g,'_')
            .replace(/\+/g,'-');
          if(ctx.mid.length !== 8)
            return next(new Error('MID must be length 8'));

          ctx.transaction.put(self._name, ctx.mid, {
            prefix: ids
          });
          next();

          cb();
        });
      });
    });
  }, function(ctx, done){
    if(ctx.params.tx)
      done(null, ctx.mid);
    else
      ctx.transaction.commit(function(err){
        if(err)
          return done(err);
        done(null, ctx.mid);
      });
  });

  //Read Operations

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

  Roda.fn.readStream = 
  Roda.fn.createReadStream = 
  function(opts){
    opts = opts || {};

    var store = typeof opts.index === 'string' ? 
      this._indices.sublevel(opts.index) : this.store;

    return H(store.createValueStream(range(opts)));
  };

  //Hooks
  function extend(ctx, next){
    H.extend(ctx.params, ctx);
    next();
  }

  Roda.fn.define('validate', params(
    'result', 'transaction'
  ), extend, function(ctx, done){
    done(null, ctx.result);
  });

  Roda.fn.define('diff', params(
    'mid','clock', 'current', 'result', 'transaction'
  ), extend, null);


  //Write Operations

  Roda.fn.define('put', params('id:string?','result:object','tx?'),
    prepare, validate, mid, current, rev, diff, put, invoke);

  Roda.fn.define('del', params('id:string','tx?'),
    prepare, mid, current, rev, diff, del, invoke);

  Roda.fn.delete = Roda.fn.del;

  function prepare(ctx, next, end){
    //prepare result
    ctx.result = H.extend(ctx.params.result, {});

    var deleted = (!ctx.params.result) && ('id' in ctx.params);

    if(deleted)
      ctx.result._deleted = true;

    //init transaction
    if(ctx.params.tx){
      if(ctx.params.tx.db !== db)
        return next(new Error('Invalid transaction object.'));
      ctx.transaction = ctx.params.tx;
    }else{
      ctx.transaction = Roda.transaction();
      end(function(err){
        //rollback on error
        if(err)
          ctx.transaction.rollback(err);
      });
    }

    next();
  }

  function validate(ctx, next){
    //trigger validate transaction hook
    var self = this;
    ctx.transaction.defer(function(cb){
      self.validate(ctx.result, ctx.transaction, function(err, result){
        if(err) return next(err);

        delete ctx.result._deleted;
        ctx.result = result;
        next();

        cb();
      });
    });
  }

  function mid(ctx, next){
    this.mid(ctx.transaction, function(err, mid){
      if(err)
        return next(err);
      ctx.mid = mid;
      next();
    });
  }

  function current(ctx, next){
    var self = this;
    if('id' in ctx.params)
      ctx.result._id = ctx.params.id;
    else{
      //monotonic timestamp + mid
      ctx.result._id = util.encode64(util.timestamp()) + ctx.mid;
    }

    //get current document by id
    ctx.transaction.get(util.encode(ctx.result._id), {
      prefix: this.store 
    }, function(err, val){
      //return IO/other errors
      if(err && !err.notFound)
        return next(err);
      if(!val){
        if(ctx.result._deleted)
          return next(null); //dont proceed if delete non existing item
        else
          return next(); //just pass if no current
      }

      //has current
      ctx.current = val;

      var rev = ctx.current._rev;

      //delete current change
      ctx.transaction.del(util.revEncode(rev), {
        prefix: self._changes 
      });

      //non-local read from
      if(rev.slice(0, 8) !== ctx.mid)
        ctx.result._from = rev;
      else if('_from' in ctx.current)
        ctx.result._from = ctx.current._from;

      next();
    });
  }

  function rev(ctx, next){
    var self = this;

    //get current clock, 
    //hence genreate new _rev based on current clock and _rev
    var key = this._name + ctx.mid;
    ctx.transaction.get(key, {
      prefix: clocks
    }, function(err, val){
      if(val)
        ctx.clock = ctx.mid + val;

      var time = Math.max(
        val ? util.time(val) : 0,
        ctx.current ? util.time(
          ctx.current._rev.slice(8)
        ) : 0
      ) + 1;

      var time64 = util.time64(time);

      //generate rev id
      ctx.result._rev = ctx.mid + time64;

      //clock update
      ctx.transaction.put(key, time64, {
        prefix: clocks
      });

      next();
    });
  }


  function diff(ctx, next){
    var self = this;

    //trigger diff transaction hook
    ctx.transaction.defer(function(cb){
      self.diff(
        ctx.mid,
        ctx.clock || null,
        ctx.current || null, 
        H.extend(ctx.result, {}), //dont modify result
        ctx.transaction,
        function(err, res){
          if(err) return next(err);
          next();

          cb();
        }
      );
    });
  }

  function put(ctx, next){
    //put: put doc, put changes
    ctx.transaction
      .put(util.encode(ctx.result._id), ctx.result, {
        prefix: this.store 
      })
      .put(util.revEncode(ctx.result._rev), ctx.result, {
        prefix: this._changes 
      });
    next();
  }

  function del(ctx, next){
    //del: del doc, put changes
    ctx.transaction
      .del(util.encode(ctx.result._id), {
        prefix: this.store 
      })
      .put(util.revEncode(ctx.result._rev), ctx.result, {
        prefix: this._changes 
      });
    next();
  }

  function invoke(ctx, done){
    //no need commit for nested transaction,
    //root will take care of it
    var result = H.extend(ctx.result, {});
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

  //_rev validation
  Roda.fn.use('diff', function(ctx, next){
    if(ctx.current && ctx.result._rev <= ctx.current._rev)
      return next(new Error('Revision must be incremental with current.'));

    if(ctx.clock && ctx.result._rev <= ctx.clock)
      return next(new Error('Revision must be incremental with clock.'));

    next();
  });

  //Index API

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

      var result = H.extend(ctx.result, {});
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
          tx.get(enKey, {
            prefix: self._indices.sublevel(name)
          }, function(err, val){
            if(val) tx.rollback(new Error(key + ' must be unique.'));
          });

        //put index store
        tx.put(enKey, H.extend({
          _id: ctx.result._id, _key: key
        }, value || H.extend(result, {})), {
          prefix: self._indices.sublevel(name)
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

  Roda.fn.clockStream = 
  Roda.fn.createClockStream = 
  function(){
    return H(clocks.createReadStream({
      gt: this._name, lt: this._name + '~'
    })).map(function(data){
      return data.key.slice(-8) + data.value;
    });
  };

  Roda.fn.liveStream = 
  Roda.fn.createLiveStream = 
  function(){
    return H('change', this.store);
  };

  function readChangeStream(afterObj, limit){
    var count = 0;
    var self = this;
    if(!afterObj)
      return H(this._changes.createValueStream({ limit: limit || -1 }));

    var from = null;
    for(var key in afterObj){
      var time = afterObj[key];
      from = from && from < time ? from : time;
    }

    return H(this._changes.createValueStream({
      gt: util.encode(util.time(from))
    })).reject(function(data){
      var rev = data._rev;
      var mid = rev.slice(0, 8);
      var time = rev.slice(8);
      var after = afterObj[mid];
      return after && after >= time;
    }).take(limit || null);
  }

  Roda.fn.changeStream = 
  Roda.fn.createChangeStream = 
  function(opts){
    opts = opts || {};
    var limit = opts.limit;
    var live = opts.live === true;
    var since = Array.isArray(opts.since) ? opts.since : null;

    var self = this;

    function stream(since){
      var afterObj = since && since.length > 0 ? util.clockObject(since) : null;

      return live ? H(function(push, next){
        //live changes = readChangeStream + liveStream
        readChangeStream.call(self, afterObj, 1)
          .collect()
          .pull(function(err, arr){
            //pull readStream 1 by 1
            if(err){
              return push(err);
            }else if(arr.length > 0){
              var doc = arr[0];
              afterObj = afterObj || {};
              afterObj[doc._rev.slice(0,8)] = doc._rev.slice(8);
              push(null, doc);
              next();
            }else{
              //switch to liveStream when readStream done
              next(self.liveStream()); 
            }
          });
      }): readChangeStream.call(self, afterObj, limit);
    }
    return since ? 
      stream(since) : 
      H.pipeline(function (clockStream) {
        return clockStream.collect().map(stream).parallel(1);
      });
  };

  Roda.fn.define('merge', params(
    'change:object'
  ), function(ctx, next){

  });

  Roda.fn.mergeStream = 
  Roda.fn.createMergeStream = 
  function(){
    var merge = _.wrapCallback(Roda.fn.merge.bind(this));
    return H.pipeline(function (changeStream){
      return changeStream
        .map(merge)
        .parallel(1);
    });
  };

  return Roda;
};
