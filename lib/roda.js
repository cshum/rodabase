var ginga        = require('ginga'),
    params       = ginga.params,
    H            = require('highland'),
    levelup      = require('levelup'),
    sublevel     = require('level-sublevel'),
    transaction  = require('level-async-transaction'),
    randomBytes  = require('randombytes'),
    EventEmitter = require('events').EventEmitter,
    extend       = require('extend'),
    error        = require('./error'),
    util         = require('./util'),
    range        = require('./range');

var defaults = {};

if(process.browser){
  require("indexeddbshim");
  defaults.db = require('level-js');
}

module.exports = function(path, opts){
  //options
  opts = extend({}, defaults, opts, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  });

  //map of roda
  var roda = {};

  //level-sublevel
  var db = sublevel(levelup(path, opts));
  //level-async-transaction
  transaction(db, opts);

  var ids = db.sublevel('ids');

  function Roda(name){
    name = String(name);

    if(!(this instanceof Roda))
      return roda[name] || new Roda(name);

    if(roda[name] && this !== roda[name])
      throw new Error('Roda `'+name+'` already exists.');
    else
      roda[name] = this;

    // roda "/" prefixed
    var store = this.store = db.sublevel('/'+name);
    //can retrieve global clock without scanning through rodas

    this._name    = name;
    this._indices = store.sublevel('indices');
    this._indexed = store.sublevel('indexed');

    this._clocks  = store.sublevel('clocks');
    this._changes = store.sublevel('changes');

    this._waitlist  = store.sublevel('waitlist');

    this._mapper = null;

    this._changes.post(function(data){
      if(data.value)
        this.emit('change', data.value);
    }.bind(this));

    replicateWorker.call(this); //start replicateWorker
    EventEmitter.call(this);

    //emitter.setMaxListeners()
    this.setMaxListeners(0);
  }

  ginga(Roda);
  extend(Roda.prototype, EventEmitter.prototype);

  Roda.db = db;
  Roda.transaction = db.transaction;
  Roda.util = util;
  Roda.error = error;

  Roda.rodaStream =
  Roda.createRodaStream = 
  function(){
    return H(ids.createReadStream())
      .map(function(data){
        return {
          name: data.key,
          mid: data.value
        };
      });
  };

  Roda.emptyStream =
  Roda.createEmptyStream =
  function(){
    return H([]);
  };

  //Methods
  Roda.fn = ginga(Roda.prototype);

  Roda.fn.name = function(cb){
    return this._name;
  };

  //Unique machine id for each Roda
  Roda.fn.define('mid', function(ctx, next, end){
    if(this._mid)
      return next(null, this._mid);
    //init transaction
    ctx.transaction = Roda.transaction();
    end(function(err){
      ctx.transaction.release(err);
    });

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
        randomBytes(6, function(err, buf){
          if(err) return next(err);
          ctx.mid = buf.toString('base64')
            .replace(/\//g,'_')
            .replace(/\+/g,'-');
          if(ctx.mid.length !== 8)
            return next(error.MID_LEN);

          ctx.transaction.put(self._name, ctx.mid, {
            prefix: ids
          });
          next();

          cb();
        });
      });
    });
  }, function(ctx, done){
    ctx.transaction.commit(function(err){
      if(err)
        return done(err);
      done(null, ctx.mid);
    });
  });

  Roda.fn.define('get', params('id:string','tx?'), function(ctx, done){
    if(ctx.params.tx){
      var tx = ctx.params.tx;

      if(tx.db !== db)
        return next(error.INVALID_TX);

      tx.get(util.encode(ctx.params.id), {
        prefix: this.store
      }, function(err, doc){
        if(err && err.notFound)
          return done(error.notFound(ctx.params.id), null);
        if(err) 
          return done(err);

        if(doc){
          //lamport timestamp gets-from ordering
          tx._time = Math.max(tx._time || 0, util.decodeNumber(doc._rev.slice(8)));
        }
        done(null, doc);
      });
    }else{
      this.store.get(util.encode(ctx.params.id), function(err, doc){
        if(err && err.notFound)
          return done(error.notFound(ctx.params.id), null);
        if(err) 
          return done(err);
        done(null, doc);
      });
    }
  });

  Roda.fn.readStream = 
  Roda.fn.createReadStream = 
  function(opts){
    opts = opts || {};
    var store = typeof opts.map === 'string' ? 
      this._indices.sublevel(opts.map) : this.store;

    return H(store.createValueStream(range(opts)));
  };

  //Hooks
  function xparams(ctx, next){
    extend(ctx, ctx.params);
    next();
  }
  Roda.fn.define('validate', params(
    'result', 'transaction'
  ), xparams, function(ctx, done){
    delete ctx.result._deleted;
    delete ctx.result._last;
    delete ctx.result._merge;
    delete ctx.result._from;
    done(null, ctx.result);
  });
  Roda.fn.define('diff', params(
    'local','current','result','transaction'), xparams, null);
  Roda.fn.define('conflict', params(
    'conflict','result','transaction'), xparams, null);

  //Write operations
  function local(ctx, next, end){
    var del = (!ctx.params.result) && ('id' in ctx.params);
    ctx.result = extend({}, ctx.params.result);

    //init transaction
    if(ctx.params.tx){
      if(ctx.params.tx.db !== db)
        return next(error.INVALID_TX);
      ctx.transaction = ctx.params.tx;
      ctx.root = false; //non-root: within another transaction
    }else{
      ctx.transaction = Roda.transaction();
      ctx.root = true;
      end(function(err){
        ctx.transaction.release(err);
      });
    }

    if(del)
      ctx.result._deleted = true;
    else
      ctx.transaction.defer(function(cb){
        //trigger validate transaction hook
        self.validate(ctx.result, ctx.transaction, function(err, result){
          if(err) return next(err);

          ctx.result = result;

          cb();
        });
      });

    //get roda mid
    var self = this;
    ctx.transaction.defer(function(cb){
      self.mid(function(err, mid){
        if(err) return next(err);
        ctx.local = mid;

        if('id' in ctx.params)
          ctx.result._id = String(ctx.params.id);
        else
          ctx.result._id = util.encodeNumber(util.timestamp()) + ctx.local;
          //monotonic timestamp + mid
        next();

        cb();
      });
    });
  }

  function operation(ctx, next){
    //ctx.local
    //ctx.result
    //ctx.transaction
    //ctx.noCurrent
    //ctx.withCurrent

    var self = this;
    var tx = ctx.transaction;
    var conflicted = false;

    //get current document by id
    this.get(ctx.result._id, tx, function(err, val){
      //return IO/other errors
      if(err && !err.notFound) 
        return next(err);
      //has current
      ctx.current = val;

      if(ctx.current){
        if(ctx.noCurrent === true)
          return next(error.exists(ctx.result._id));
        //delete current change
        tx.del(ctx.current._rev, {
          prefix: self._changes 
        });

        if(ctx.local){
          //local write
          if(ctx.current._rev.slice(0,8) !== ctx.local)
            ctx.result._from = rev; //read from non-local 
          else if('_from' in ctx.current)
            ctx.result._from = ctx.current._from;
        }else{
          //remote write: conflict detection
          if(ctx.result._from !== ctx.current._rev && 
            ctx.result._rev.slice(0,8) !== ctx.current._rev.slice(0,8) ){

            var res  = self._resolver(ctx.result);
            var curr = self._resolver(ctx.current);

            if(res > curr){
              //current conflict: apply result, do onflict hook
              conflicted = true;
            }else{
              //replicate conflict: change nothing, rollback.
              return next(error.CONFLICT);
            }
          }
        }
      }else{
        if(ctx.result._deleted || ctx.withCurrent === true)
          return next(err); //err.notFound
      } 

      //lock local clock, 
      //hence genreate new _rev based on current clock and _rev
      if(ctx.local){
        tx.get(ctx.local, {
          prefix: self._clocks
        }, function(err, curr){
          if(curr)
            ctx.clock = ctx.local + curr;

          //lamport timestamp
          var time = util.encodeNumber(Math.max(
            curr ? util.decodeNumber(curr) : 0, //execution order
            tx._time || 0 //gets from
          ) + 1, true);

          //generate rev id
          ctx.result._rev = ctx.local + time;
        });
      }

      //no need locking remote clock since replicate worker follows execution order
      tx.defer(function(cb){
        var mid  = ctx.result._rev.slice(0,8);
        var time = ctx.result._rev.slice(8);

        //clock update
        tx.put(mid, time, {
          prefix: self._clocks
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
        tx.put(ctx.result._rev, ctx.result, {
          prefix: self._changes 
        });

        //diff transaction hook
        self.diff(
          !!ctx.local,
          ctx.current || null, 
          extend({}, ctx.result), //clone result
          tx, function(err){
            if(err) 
              return next(err);

            //conflict handling comes after diff
            if(conflicted)
              tx.defer(function(cb){
                self.conflict(
                  ctx.current, ctx.result, 
                  ctx.transaction, cb);
              });

            next();
            cb();
          }
        );

      });
    });
  }

  function write(ctx, done){
    var result = extend({}, ctx.result);
    if(ctx.root){
      ctx.transaction.commit(function(err){
        if(err) done(err, null);
        else done(null, result);
      });
    }else{
      //no need commit for non-root transaction,
      done(null, result);
    }
  }

  Roda.fn.define('post', params(
    'result:object','tx?'
  ), local, function(ctx, next){
    ctx.noCurrent = true;
    next();
  }, operation, write);

  Roda.fn.define('put', params(
    'id','result:object','tx?'
  ), local, operation, write);

  Roda.fn.define('del', params(
    'id','tx?'
  ), local, operation, write);

  Roda.fn.define('update', params(
    'id','result:object','tx?'
  ), local, function(ctx, next){
    ctx.withCurrent = true;
    next();
  }, operation, write);

  //custom function for resolving conflicts
  Roda.fn.resolver = function(fn){
    if(typeof fn === 'function')
      this._resolver = fn;
    else
      throw new Error('Resolver must be a function');
    return this;
  };
  Roda.fn._resolver = util.timeIndex;

  //Index Mapper
  Roda.fn.mapper = function(name, fn){
    this._mapper = this._mapper || {};

    if(typeof name === 'string' && typeof fn === 'function'){
      if(this._mapper[name])
        throw new Error('Mapper `'+name+'` has already been assigned.');
      this._mapper[name] = fn;
    }else{
      throw new Error('Invalid mapper.');
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

      var result = extend({}, ctx.result);
      var indexed = {};
      var async = false;

      var plan = 0;
      var errored = null;

      function emit(name, key, value, unique){
        if(async)
          throw new Error('Mapper must not be async.');

        //optional value arg
        if(value === true){
          unique = true;
          value = null;
        }

        var opts = {
          prefix: self._indices.sublevel(name)
        };

        var enKey = util.encode(key) + '\x00';
        if(unique === true){
          tx.get(enKey, opts, function(err, val){
            if(val) 
              errored = error.exists(key);
          });
        }else{
          //append unique timestamp for non-unqiue key
          enKey += util.encode(util.timestamp());
        }
        tx.put(enKey, extend({}, value || result, {
          _id: ctx.result._id,
          _key: key
        }), opts);

        //record encoded key
        indexed[name].push(enKey);
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

      tx.defer(function(cb){
        if(errored)
          return next(errored);
        next();
        cb();
      });
    });
  });

  //Changes
  Roda.fn.clockStream = 
  Roda.fn.createClockStream = 
  function(){
    return H(this._clocks.createReadStream())
      .map(function(data){
        return data.key + data.value;
      });
  };

  Roda.fn.liveStream = 
  Roda.fn.createLiveStream = 
  function(){
    return H('change', this);
  };

  function readChangesStream(checkpoint, mid, limit){
    if(mid)
      return H(this._changes.createValueStream({
        gt: mid + (checkpoint && checkpoint[mid] ? checkpoint[mid] : ''),
        lt: mid + '~',
        limit: limit || -1
      }));

    if(!checkpoint)
      return H(this._changes.createValueStream({
        limit: limit || -1
      }));

    var self = this;
    return H(this.clockStream())
      .map(function(curr){
        return {
          mid: curr.slice(0,8),
          time: curr.slice(8)
        };
      })
      .reject(function(at){
        return at.mid in checkpoint && at.time <= checkpoint[at.mid];
      })
      .map(function(at){
        return H(self._changes.createValueStream({
          gt: at.mid + (checkpoint[at.mid] || ''),
          lt: at.mid + '~'
        }));
      })
      .parallel(1)
      .take(limit || Infinity);
  }

  Roda.fn.changesStream = 
  Roda.fn.createChangesStream = 
  function(opts){
    opts = opts || {};

    var limit  = opts.limit && opts.limit > 0 ? opts.limit : null;
    var clocks = Array.isArray(opts.clocks) ? opts.clocks : null;
    var live   = opts.live === true;
    var local  = opts.local === true;

    var self = this;

    function stream(clocks){
      var checkpoint = clocks.length > 0 ? util.clocksObject(clocks) : null;

      return H(function(push){
        if(local)
          self.mid(function(err, mid){
            push(err, mid);
            push(null, H.nil);
          });
        else{
          push(null, null);
          push(null, H.nil);
        }
      })
      .map(function(mid){
        return live ? H(function(push, next){
          //live changes = readChangesStream + liveStream
          readChangesStream.call(self, checkpoint, mid, 1)
            .stopOnError(push)
            .toArray(function(arr){
              if(arr.length > 0){
                //pull readStream 1 by 1
                push(null, arr[0]);
                next();
              }else{
                //readStream done. Switch to liveStream
                next(
                  self.liveStream().reject(function(data){
                    //reject non-local if mid exists
                    return mid && data._rev.indexOf(mid) !== 0;
                  })
                ); 
              }
            });
        }) : readChangesStream.call(self, checkpoint, mid, limit);
      })
      .parallel(1)
      .map(function(data){
        if(!('_rev' in data))
          return data;

        var mid = data._rev.slice(0,8);
        checkpoint = checkpoint || {};

        if(mid in checkpoint)
          data._last = checkpoint[mid];

        checkpoint[mid] = data._rev.slice(8);
        return data;
      });
    }
    return clocks ? stream(clocks) : H.pipeline(function (clockStream) {
      return clockStream.collect().map(stream).parallel(1);
    });
  };

  Roda.fn.replicateStream = 
  Roda.fn.createReplicateStream = 
  function(){
    var self = this;
    return H.pipeline(function(changesStream){
      return H(changesStream)
        .map(H.wrapCallback(function(data, cb){
          //write to replicate wait list
          self.mid(function(err, local){
            var mid = data._rev.slice(0,8);
            if(local === mid) 
              return cb(null); //ignore local
            var tx = Roda.transaction();
            tx.get(mid, {
              prefix: self._clocks
            }, function(err, time){
              if(!time || data._rev.slice(8) > time)
                tx.put(util.timeIndex(data), data, {
                  prefix: self._waitlist
                });
              tx.commit(cb);
            });
          });
        }))
        .parallel(1)
        .debounce(50)
        .each(replicateWorker.bind(self));
    });
  };

  function replicateWorker(){
    if(this._working) 
      return;
    this._working = true;

    var self = this;
    var count = 0;
    H(this._waitlist.createValueStream())
      .map(H.wrapCallback(function(doc, cb){
        self.replicate(doc, function(err){  
          if(err){
            if(err.notReady) 
              cb(err); //error: time not ready, stop worker
            else 
              self._waitlist.del(util.timeIndex(doc), cb); 
              //replicate conflict: delete waitlist, keep going
          }else{
            count++;
            cb(null);
          } 
        });
      }))
      .parallel(1)
      .last()
      .pull(function(){
        self._working = false;
        if(count > 0)
          replicateWorker.call(self);
      });
  }

  Roda.fn.define('replicate', params('result'), function(ctx, next, end){
    ctx.local = null;
    ctx.result = extend({}, ctx.params.result);

    var self = this;
    var tx = ctx.transaction = Roda.transaction();
    var mid = ctx.result._rev.slice(0,8);

    end(function(err){ 
      tx.release(err); 
    });

    tx.get(mid, {
      prefix: self._clocks
    }, function(err, time){
      var curr = ctx.result._last;
      //time not ready
      if((!time && curr) || time < curr)
        return next(error.NOT_READY);

      //delete waitlist item
      tx.del(util.timeIndex(ctx.result), {
        prefix: self._waitlist
      });

      //already in store. Delete then next
      if(time > curr)
        return tx.commit(next);

      delete ctx.result._last;
      delete ctx.result._merge;

      if(!ctx.result._deleted)
        tx.defer(function(cb){
          self.validate(ctx.result, tx, function(err, result){
            if(err) return cb(err);

            ctx.result = result;
            cb();
          });
        });

      next();
    });
  }, operation, function(ctx, done){
    ctx.transaction.commit(done);
  });

  Roda.fn.pipe = function(to){
    to = typeof to === 'string' ? Roda(to) : to;
    to.clockStream()
      .pipe(this.changesStream({live: true}))
      .pipe(to.replicateStream());
    return to;
  };

  return Roda;
};
