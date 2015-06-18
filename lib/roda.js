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

var MID_LEN = util.MID_LEN;
var defaults = {};

if(process.browser)
  defaults.db = require('level-js');

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
    name = String(name).trim();

    if(!(this instanceof Roda))
      return roda[name] || new Roda(name);

    if(roda[name] && this !== roda[name])
      throw new Error('Roda `'+name+'` already exists.');
    else
      roda[name] = this;

    // roda "/" prefixed
    var store = this.store = db.sublevel('/'+name);
    //can retrieve global clock without scanning through rodas

    this._name = name;

    this._snapshot = store.sublevel('shot');
    this._meta = store.sublevel('meta');
    this._timeline = store.sublevel('time');
    this._changes = store.sublevel('changes');
    this._index = store.sublevel('index');

    this._clocks = store.sublevel('clocks');
    this._triggers = store.sublevel('triggers');
    this._queue = store.sublevel('queue');

    this._mapper = null;

    var self = this;

    this._timeline.post(function(data){
      if(data.value)
        self.emit('_write', data);
    });

    EventEmitter.call(this);

    //emitter.setMaxListeners()
    this.setMaxListeners(0);

    //replicate worker
    this._working = false;
    this._replicated = false;
    replicateWorker.call(this); 
  }

  ginga(Roda);
  extend(Roda.prototype, EventEmitter.prototype);

  Roda.db = db;
  Roda.transaction = db.transaction;
  Roda.util = util;
  Roda.error = error;

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
        randomBytes(MID_LEN, function(err, buf){
          if(err) return next(err);
          ctx.mid = buf.toString('base64')
            .replace(/\//g,'_')
            .replace(/\+/g,'-')
            .slice(0, MID_LEN);

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

  Roda.fn.define('get', params('id','deleted:boolean?','tx?'), function(ctx, done){
    var id = String(ctx.params.id).trim();

    function callback(err, doc){
      if(err && err.notFound)
        return done(error.notFound(id));
      if(err) 
        return done(err);
      if(ctx.params.tx && doc){
        //lamport timestamp gets-from ordering
        tx._stamp = Math.max(tx._stamp || 0, util.decodeNumber(
          doc._rev.slice(MID_LEN)
        ));
      }
      if(doc && doc._deleted && !ctx.params.deleted)
        return done(error.notFound(id));
      done(null, doc);
    }

    if(ctx.params.tx){
      var tx = ctx.params.tx;

      if(tx.db !== db)
        return done(error.INVALID_TX);

      tx.get(util.encode(id), { prefix: this._snapshot }, callback);
    }else{
      this._snapshot.get(util.encode(id), callback);
    }
  });

  Roda.fn.readStream = 
  Roda.fn.createReadStream = 
  function(opts){
    opts = opts || {};
    var store = typeof opts.index === 'string' ? 
      this._index.sublevel(opts.index) : this.store;

    return H(store.createValueStream(range(opts)));
  };

  Roda.fn.timeStream = 
  Roda.fn.createTimeStream = 
  function(opts){
    opts = extend({}, opts);

    var self = this;
    var live = opts.live === true;
    if(live) opts.limit = 1;

    return (
      live ? H(function(push, next){
        H(self._timeline.createReadStream(range(opts)))
          .stopOnError(push)
          .toArray(function(arr){
            if(arr.length > 0){
              //pull readStream 1 by 1
              push(null, arr[0]);
              next();
            }else{
              //readStream done. Switch to liveStream
              next(H('_write', self)); 
            }
          });
      }) : H(this._timeline.createReadStream(range(opts)))
    ).map(function(data){
      var doc = extend({}, data.value);
      doc._time = opts.gt = util.decode(data.key);
      return doc;
    });
  };

  //Hooks
  function xparams(ctx, next){
    extend(ctx, ctx.params);
    next();
  }
  Roda.fn.define('validate', params(
    'result', 'transaction'
  ), xparams, function(ctx, done){
    done(null, ctx.result);
  });
  Roda.fn.define('diff', params(
    'meta', 'current','result','transaction'
  ), xparams, function(ctx, done){
    done(null, ctx.meta);
  });
  Roda.fn.define('conflict', params(
    'conflict','result','transaction'
  ), xparams, null);

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

          delete result._key;
          delete result._after;
          delete result._deleted;
          delete result._from;
          delete result._rev;
          delete result._time;

          ctx.result = result;

          cb();
        });
      });

    //get roda mid
    var self = this;
    ctx.transaction.defer(function(cb){
      self.mid(function(err, mid){
        if(err) return next(err);
        ctx.mid = mid;

        if('id' in ctx.params)
          ctx.result._id = String(ctx.params.id).trim();
        else
          ctx.result._id = util.encodeNumber(util.timestamp()) + ctx.mid;
          //monotonic timestamp + mid
        next();

        cb();
      });
    });
  }

  function operation(ctx, next){
    var self = this;
    var tx = ctx.transaction;
    var resolveConflict = false;

    tx.get(ctx.result._id, {
      prefix: self._meta
    }, function(err, meta){
      ctx.meta = meta || {};
    });

    //get current document by id
    this.get(ctx.result._id, true, tx, function(err, val){
      //return IO/other errors
      if(err && !err.notFound) 
        return next(err);
      //has current
      ctx.current = val;

      if(ctx.current){
        if(!ctx.current._deleted && ctx.noExists === true)
          return next(error.exists(ctx.result._id));
        //delete current change

        //has _rev: check conflict
        if(ctx.result._rev){
          //conflict if _from mismatch and is remote write
          if(ctx.result._from !== ctx.current._rev && 
            ctx.result._rev.indexOf(ctx.current._rev.slice(0, MID_LEN)) !== 0){

            if(self._resolver(ctx.result) > self._resolver(ctx.current)){
              //current conflict: apply result, do resolve conflict hook
              resolveConflict = true;
            }else{
              //replicate conflict: change nothing, rollback.
              return next(error.CONFLICT);
            }
          }
        }

        //given mid i.e. local write
        if(ctx.mid){
          if(ctx.current._rev.indexOf(ctx.mid) !== 0){
            ctx.result._from = ctx.current._rev; //read from remote
          }else{
            tx.del(ctx.current._rev, {
              prefix: self._changes 
            });
            if(ctx.current._from)
              ctx.result._from = ctx.current._from; //local, copy _from over
            else
              delete ctx.result._from;
          }
        }
      }
      if((!ctx.current || ctx.current._deleted) && ctx.withExists === true){
        return next(error.notFound(ctx.result._id));
      }

      //lock clock
      var mid = ctx.mid || ctx.result._rev.slice(0, MID_LEN);
      var stamp;
      tx.get(mid, {
        prefix: self._clocks
      }, function(err, curr){
        //given mid i.e. local write or remote merge
        if(ctx.mid){
          //generate _rev i.e. lamport timestamp
          stamp = util.encodeNumber(Math.max(
            curr ? util.decodeNumber(curr) : 0, //execution order
            tx._stamp || 0 //gets from
          ) + 1, true);

          ctx.result._rev = ctx.mid + stamp;
        }else{
          stamp = ctx.result._rev.slice(MID_LEN);
        }
        //clock update
        tx.put(mid, stamp, {
          prefix: self._clocks 
        });
        var enId = util.encode(ctx.result._id); 
        //put snapshot
        tx.put(enId, ctx.result, {
          prefix: self._snapshot 
        });
        if(ctx.result._deleted){
          //store del
          tx.del(enId, { prefix: self.store });
        }else{
          //store put
          tx.put(enId, ctx.result, { prefix: self.store });
        }

        //put changes
        tx.put(ctx.result._rev, ctx.result, {
          prefix: self._changes 
        });

        //timestream
        if(ctx.meta.time)
          tx.del(ctx.meta.time, {
            prefix: self._timeline
          });

        ctx.meta.time = util.encode(util.timestamp());
        tx.put(ctx.meta.time, ctx.result, {
          prefix: self._timeline
        });

        //diff transaction hook
        tx.defer(function(cb){
          self.diff(
            ctx.meta,
            ctx.current || null, 
            extend({}, ctx.result), 
            tx, function(err, meta){
            if(err) return next(err);

            tx.put(ctx.result._id, meta, {
              prefix: self._meta
            });

            //conflict handling comes after diff
            if(resolveConflict)
              tx.defer(function(cb){
                self.conflict(
                  ctx.current, ctx.result, 
                  ctx.transaction, cb);
              });

            next();
            cb();
          });
        });
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
    ctx.noExists = true;
    next();
  }, operation, write);

  Roda.fn.define('put', params(
    'id','result:object','tx?'
  ), local, operation, write);

  Roda.fn.define('del', params(
    'id','tx?'
  ), local, function(ctx, next){
    ctx.withExists = true;
    next();
  }, operation, write);

  Roda.fn.define('update', params(
    'id','result:object','tx?'
  ), local, function(ctx, next){
    ctx.withExists = true;
    next();
  }, operation, write);

  //custom function for resolving conflicts
  Roda.fn._resolver = function(doc){
    return util.stampKey(doc._rev);
  };

  //Index Mapper
  Roda.fn.index = function(name, fn){
    this._mapper = this._mapper || {};

    if(typeof name === 'string' && typeof fn === 'function'){
      if(this._mapper[name])
        throw new Error('Index mapper `'+name+'` has already been assigned.');
      this._mapper[name] = fn;
    }else{
      throw new Error('Invalid index mapper.');
    }
    return this;
  };

  Roda.fn.use('diff', function(ctx, next){
    if(!this._mapper) return next();

    var self = this;
    var tx = ctx.transaction;

    //delete current indices
    var name, i, l, keys;
    if(ctx.meta.indexed){
      for(name in ctx.meta.indexed){
        keys = ctx.meta.indexed[name];
        for(i = 0, l = keys.length; i < l; i++){
          tx.del(keys[i], {
            prefix: self._index.sublevel(name)
          });
        }
      }
    }
    ctx.meta.indexed = {};
    //clear index when delete
    if(ctx.result._deleted)
      return next();

    var result = extend({}, ctx.result);
    var indexed = {};
    var async = false;
    var errored = null;

    function emit(name, key, value, unique){
      if(async)
        throw new Error('Index mapper must not be async.');

      //optional value arg
      if(value === true){
        unique = true;
        value = null;
      }

      var opts = {
        prefix: self._index.sublevel(name)
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
    ctx.meta.indexed = indexed;
    async = true;

    tx.defer(function(cb){
      if(errored)
        return next(errored);
      next();
      cb();
    });
  });

  //Changes
  Roda.fn.clockStream = 
  Roda.fn.createClockStream = 
  function(){
    return H(this._clocks.createReadStream()).map(function(data){
      return data.key + data.value;
    });
  };

  Roda.fn.liveStream = 
  Roda.fn.createLiveStream = 
  function(){
    return H('_write', this).map(function(data){
      return extend({}, data.value);
    });
  };

  function readChangesStream(current, limit){
    if(!current)
      return H(this._changes.createValueStream({
        limit: limit || -1
      }));

    var self = this;
    var count = 0;
    return H(this._clocks.createReadStream())
    .reject(function(at){
      return (
        at.key in current && at.value <= current[at.key]
      ) || (limit && count >= limit);
    })
    .map(function(at){
      return H(self._changes.createValueStream({
        gt: at.key + (current[at.key] || ''),
        lt: at.key + '~',
        limit: limit ? limit - count : -1
      }));
    })
    .parallel(1).map(function(data){
      count++;
      return data;
    });
  }

  Roda.fn.changesStream = 
  Roda.fn.createChangesStream = 
  function(opts){
    opts = opts || {};

    var limit  = opts.limit && opts.limit > 0 ? opts.limit : null;
    var clocks = Array.isArray(opts.clocks) ? opts.clocks : null;
    var live   = opts.live === true;

    var self = this;

    function stream(clocks){
      var current = clocks.length > 0 ? util.clocksObject(clocks) : null;

      return (
        live ? H(function(push, next){
          //live changes = readChangesStream + liveStream
          readChangesStream.call(self, current, 1)
            .stopOnError(push)
            .toArray(function(arr){
              if(arr.length > 0){
                //pull readStream 1 by 1
                push(null, arr[0]);
                next();
              }else{
                //readStream done. Switch to liveStream
                next(self.liveStream()); 
              }
            });
        }) : readChangesStream.call(self, current, limit)
      ).map(function(data){
        var mid = data._rev.slice(0, MID_LEN);
        current = current || {};

        if(mid in current)
          data._after = current[mid];

        current[mid] = data._rev.slice(MID_LEN);
        return data;
      });
    }
    return clocks ? stream(clocks) : H.pipeline(function(clockStream) {
      return clockStream.collect().map(stream).parallel(1);
    });
  };

  Roda.fn.replicateStream = 
  Roda.fn.createReplicateStream = 
  function(opts){
    opts = opts || {};

    var self = this;
    return H.pipeline(function(changesStream){
      return H(changesStream)
        .map(H.wrapCallback(function(data, cb){
          //write to replicate wait list
          self.mid(function(err, local){
            if(data._rev.indexOf(local) === 0) 
              return cb(null); //ignore local
            self._queue.put(util.stampKey(data._rev), data, cb);
          });
        }))
        .parallel(1)
        .each(replicateWorker.bind(self, true));
    });
  };

  function replicateWorker(replicated){
    if(this._working){
      this._replicated = !!replicated;
      return;
    } 
    this._working = true;
    this._replicated = false;

    var self = this;
    H(this._queue.createValueStream())
      .map(H.wrapCallback(function(doc, cb){
        self._replicate(doc, function(err){  
          if(err){
            if(err.notReady) cb(err); //error: time not ready, stop worker
            else self._conflicted(doc, cb);
          }else{
            cb(null);
          } 
        });
      }))
      .parallel(1)
      .last()
      .pull(function(){
        self._working = false;
        if(self._replicated > 0)
          replicateWorker.call(self);
      });
  }

  Roda.fn.define('_replicate', params('result'), function(ctx, next, end){
    ctx.mid = null;
    ctx.result = extend({}, ctx.params.result);

    var self = this;
    var tx = ctx.transaction = Roda.transaction();
    var mid = ctx.result._rev.slice(0, MID_LEN);
    var stamp = ctx.result._rev.slice(MID_LEN);

    end(function(err){
      tx.release(err); 
    });

    if(ctx.result._from){
      var fromMid = ctx.result._from.slice(0, MID_LEN);
      var fromStamp = ctx.result._from.slice(MID_LEN);
      tx.defer(function(cb){
        tx.get(fromMid, {
          prefix: self._clocks
        }, function(err, fromCurr){
          //must gte _from stamp to replicate
          if(!fromCurr || fromCurr < fromStamp)
            return next(error.NOT_READY);
          cb();
        });
      });
    }

    tx.get(mid, {
      prefix: self._clocks
    }, function(err, curr){
      //to replicate must satisify curr === after
      var after = ctx.result._after;
      //curr not ready
      if((!curr && after) || curr < after)
        return next(error.NOT_READY);

      //delete waitlist item
      tx.del(util.stampKey(ctx.result._rev), {
        prefix: self._queue
      });

      //already in store. Delete then next
      if(curr > after || curr >= stamp)
        return tx.commit(next);

      delete ctx.result._after;

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

  Roda.fn.define('_conflicted', params('result'), function(ctx, done){
    //delete waitlist, put clock, del merge, keep going
    var tx = Roda.transaction();
    var doc = ctx.params.result;
    tx.del(util.stampKey(doc._rev), {
      prefix: this._queue
    });
    tx.put(
      doc._rev.slice(0, MID_LEN), 
      doc._rev.slice(MID_LEN), 
      { prefix: this._clocks }
    );
    tx.commit(done);
  });

  Roda.fn.trigger = function(name, job, opts){
    this._triggers = this._triggers || {};
    if(typeof name === 'string' && typeof job === 'function'){
      if(this._triggers[name])
        throw new Error('Trigger `'+name+'` has already been assigned.');
    }else{
      throw new Error('Invalid trigger.');
    }
    var self = this;
    opts = opts || {};

    var parallel = opts.parallel || 1;
    var delay = opts.retryDelay || 500;

    this._triggers[name] = H(function(push, next){
      self._triggers.get(name, function(err, time){
        next(self.timeStream({
          live: true, gt: time || 0
        }));
      });
    })
    .map(H.wrapCallback(function(data, cb){
      function _cb(err){
        if(err) setTimeout(job.bind(null, data, _cb), delay);
        else cb(null, data._time);
      }
      job.call(null, data, _cb);
    }))
    .parallel(parallel)
    .map(H.wrapCallback(
      this._triggers.put.bind(this._triggers, name)
    ))
    .parallel(1);

    this._triggers[name].resume();

    return this;
  };

  return Roda;
};
