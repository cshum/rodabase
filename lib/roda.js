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

    var self = this;
    this._changes.post(function(data){
      if(data.value){
        store.emit('change', data.value);
        //clocksObj cache
        if(self._clocksObj){
          var rev = data.value._rev;
          self._clocksObj[rev.slice(0,8)] = rev.slice(8);
        }
      }
    });

    this.merger(); //start merger whenever
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
    prepare, diff, invoke);

  Roda.fn.define('del', params('id:string','tx?'),
    prepare, diff, invoke);

  Roda.fn.delete = Roda.fn.del;

  function prepare(ctx, next, end){
    //prepare result
    ctx.result = H.extend(ctx.params.result, {});

    var deleted = (!ctx.params.result) && ('id' in ctx.params);

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

    //trigger validate transaction hook
    var self = this;
    if(deleted){
      ctx.result._deleted = true;
      next();
    }else
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

  function diff(ctx, next){
    if('id' in ctx.params)
      ctx.result._id = ctx.params.id;
    else{
      //monotonic timestamp + mid
      ctx.result._id = util.encode64(util.timestamp()) + ctx.mid;
    }
    var self = this;
    var tx = ctx.transaction;

    tx.defer(function(cb){
      self.mid(function(err, mid){
        if(err) 
          return cb(err);
        ctx.mid = mid;
        cb();
      });
    });

    //get current document by id
    tx.get(util.encode(ctx.result._id), {
      prefix: this.store 
    }, function(err, val){
      //return IO/other errors
      if(err && !err.notFound)
        return next(err);
      //has current
      ctx.current = val;

      if(ctx.current){
        var rev = ctx.current._rev;

        //delete current change
        tx.del(util.encodeRev(rev), {
          prefix: self._changes 
        });

        //non-local read from
        if(rev.slice(0, 8) !== ctx.mid)
          ctx.result._from = rev;
        else if('_from' in ctx.current)
          ctx.result._from = ctx.current._from;

      }else if(ctx.result._deleted){
        if(!ctx.params.tx)
          tx.rollback();
        return next(null); //dont proceed if delete non existing item
      }

      //get current clock, 
      //hence genreate new _rev based on current clock and _rev
      tx.get(self._name + ctx.mid, {
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
        tx.put(self._name + ctx.mid, time64, {
          prefix: clocks
        });

        if(ctx.result._deleted){
          //del doc
          tx.del(util.encode(ctx.result._id), {
            prefix: self.store 
          });
        }else{
          //put doc
          tx.put(util.encode(ctx.result._id), ctx.result, {
            prefix: self.store 
          });
        }
        //put change
        tx.put(util.encodeRev(ctx.result._rev), ctx.result, {
          prefix: self._changes 
        });

      });

      //trigger diff transaction hook
      tx.defer(function(cb){
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

    });
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
    if(this._clocksObj)
      return H(util.clocks(this._clocksObj)); //cached clocks
    else{
      var self = this;
      var clocksObj = {};
      return H(clocks.createReadStream({
        gt: this._name, 
        lt: this._name + '~'
      })).map(function(data){
        var mid = data.key.slice(-8);
        clocksObj[mid] = data.value;
        return mid + data.value;
      }).on('end', function(){
        //cache clock on end
        self._clocksObj = clocksObj;
      });
    }
  };

  Roda.fn.liveStream = 
  Roda.fn.createLiveStream = 
  function(){
    return H('change', this.store);
  };

  function readChangeStream(clocksObj, limit){
    var from, mid, opts = {};
    for(mid in clocksObj){
      var en = util.encodeRev(mid + clocksObj[mid]);
      from = from && from < en ? from : en;
    }
    if(from) opts.gt = from;

    return H(this._changes.createValueStream(opts))
      .reject(function(data){
        var mid = data._rev.slice(0, 8);
        return mid in clocksObj && data._rev.slice(8) <= clocksObj[mid];
      })
      .take(limit || Infinity);
  }

  Roda.fn.changeStream = 
  Roda.fn.createChangeStream = 
  function(opts){
    opts = opts || {};
    var limit = opts.limit;
    var live = opts.live === true;
    var clocks = Array.isArray(opts.clocks) ? opts.clocks : null;

    var self = this;

    function changeStream(clocks){
      var clocksObj = util.clocksObject(clocks);

      var stream = live ? H(function(push, next){
        //live changes = readChangeStream + liveStream
        readChangeStream.call(self, clocksObj, 1)
          .collect()
          .pull(function(err, arr){
            //pull readStream 1 by 1
            if(err){
              return push(err);
            }else if(arr.length > 0){
              push(null, arr[0]);
              next();
            }else{
              //switch to liveStream when readStream done
              next(self.liveStream()); 
            }
          });
      }) : readChangeStream.call(self, clocksObj, limit);

      return stream.map(function(data){
        var mid = data._rev.slice(0,8);
        if(mid in clocksObj)
          data._clock = clocksObj[mid];
        clocksObj[mid] = data._rev.slice(8);
        return data;
      });
    }
    return clocks ? 
      changeStream(clocks) : 
      H.pipeline(function (clockStream) {
        return clockStream.collect().map(changeStream).parallel(1);
      });
  };

  Roda.fn.mergeStream = 
  Roda.fn.createMergeStream = 
  function(){
    var self = this;
    return H.pipeline(function(changeStream){
      return changeStream
        .map(H.wrapCallback(function(data, cb){
          //write to merge wait list
          self._merges.put(util.encodeRev(data._rev), data, cb);
        }))
        .parallel(1)
        .map(function(data){
          self.merger(); //trigger merge whatever comes
          return data;
        });
    });
  };

  Roda.fn.define('merger', function(ctx, next, end){
    end(function(err, keep){
      this._merging = false;
      //todo: handle err
      if(keep === true)
        this.merger(); //keep running until done
    });

    if(this._merging) 
      return next(null);
    this._merging = true;

    if(this._clocksObj)
      next();
    else
      this.clockStream().collect().pull(function(err){
        if(err) next(err);
        else setImmediate(next);
      });
  }, function(ctx, next){
    //clocks should have been cached by now
    ctx.clocksObj = this._clocksObj;

    H(this._merges.createReadStream({limit: 1}))
      .collect()
      .pull(function(err, arr){
        if(err) 
          next(err); //stops on error
        else if(arr.length === 0)
          next(null); //done if no more item on wait list
        else{
          ctx.result = arr[0];
          next();
        }
      });
  }, function(ctx, next){
    var mid, time, now;

    var clock = ctx.result._clock;
    if(clock){
      //casual+ execution thread
      mid = clock.slice(0, 8);
      time = clock.slice(8);
      if(ctx.clocksObj[mid]){
        now = ctx.clocksObj[mid];
        if(time < now){
          //already in store, delete then keep going
          return this._merges.del(util.encode(ctx.result._rev), function(err){
            if(err) next(err);
            else next(null, true); 
          });
        }else if(now < time){
          //not ready yet
          return next(null);
        }
      }
    }
    var from = ctx.result._from;
    if(from){
      //casual+ gets from
      mid = from.slice(0, 8);
      time = from.slice(8);
      if(ctx.clocksObj[mid]){
        now = ctx.clocksObj[mid];
        if(now < time){
          //not ready yet
          return next(null);
        }
      }
    }
    next();
  }, function(ctx, next, end){
    ctx.transaction = Roda.transaction();
    end(function(err){
      //rollback on error
      if(err)
        ctx.transaction.rollback(err);
    });
  });
  //todo: get current, put validate, diff, etc

  return Roda;
};
