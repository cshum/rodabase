var ginga        = require('ginga'),
    params       = ginga.params,
    H            = require('highland'),
    levelup      = require('levelup'),
    transaction  = require('level-transactions'),
    randomBytes  = require('randombytes'),
    EventEmitter = require('events').EventEmitter,
    extend       = require('extend'),
    error        = require('./error'),
    codec        = require('./codec'),
    range        = require('./range'),
    timestamp    = require('./timestamp'),
    section      = require('./section');

var MID_LEN = 8;
var LOW = codec.encode(null);

var defaults = {};
if(process.browser) defaults.db = require('level-js');


module.exports = function(path, opts){
  //levelup instance
  var db = levelup(path, extend({}, defaults, opts, {
    keyEncoding: 'utf8',
    valueEncoding: 'json'
  }));

  //map of roda
  var roda = {};

  function Roda(name){
    name = String(name).trim().replace(/(#|!)/,'');

    if(!(this instanceof Roda))
      return roda[name] || new Roda(name);

    if(roda[name] && this !== roda[name])
      throw new Error('Roda `'+name+'` already exists.');
    else
      roda[name] = this;

    this.roda = Roda;
    this._name = name;

    var pre = '/'+name;

    this._meta = [pre];
    this._state = [pre, 's'];
    this._read = [pre, 'r'];
    this._changes = [pre, 'ch'];
    this._index = [pre, 'i'];
    this._clock = [pre, 'ck'];
    this._queue = [pre, 'q'];

    this._mapper = null;

    EventEmitter.call(this);

    //dismiss emitter warnings
    this.setMaxListeners(0);

    //replicate worker
    this._working = false;
    this._replicated = false;

    var self = this;
    var tx = Roda.transaction();
    tx.lock(this.name());
    tx.defer(function(cb){
      self.init(tx, cb);
    });
    tx.commit(function(err){
      if(err) throw err; //init must not error

      replicateWorker.call(self); 
    });
  }

  Roda.fn = ginga(Roda.prototype);

  extend(Roda.prototype, EventEmitter.prototype);

  Roda.db = db;
  Roda.error = error;

  Roda.transaction = function(opts){
    //level-transactions
    var tx = transaction(db, opts);
    //dismiss emitter warnings
    tx.setMaxListeners(0);
    return tx;
  };

  function xparams(){
    var names = Array.prototype.slice.call(arguments);
    var l = names.length;
    return function(ctx){
      for(var i = 0; i < l; i++)
        ctx[names[i]] = ctx.args[i];
    };
  }

  //Hooks
  Roda.fn.define('init', xparams('transaction'), null);
  Roda.fn.define('validate', xparams('result'), null);
  Roda.fn.define('diff', xparams('current','result','transaction'), null);
  Roda.fn.define('conflict', xparams('conflict','result','transaction'), null);

  Roda.fn.use('init', function(ctx){
    var self = this;
    var tx = ctx.transaction;
    tx.get(section(this._meta, 'mid'), function(err, mid){
      if(mid) self._mid = mid;
    });
    tx.defer(function(cb){
      if(self._mid) 
        return cb();
      randomBytes(MID_LEN, function(err, buf){
        if(err) return done(err);
        self._mid = buf.toString('base64')
          .replace(/\//g,'_')
          .replace(/\+/g,'-')
          .slice(0, MID_LEN);

        tx.put(section(self._meta, 'mid'), self._mid);
        cb();
      });
    });
  });

  Roda.fn.name = function(cb){
    return this._name;
  };

  Roda.fn.define('get', params('id','state:boolean?','tx?'), function(ctx, done){
    var id = String(ctx.params.id).trim();
    var tx = ctx.params.tx;

    if(tx && tx.db !== db) return done(error.INVALID_TX);

    if(tx) tx.lock(this.name()); //lock roda section

    (tx || db).get(section(this._state, id), function(err, state){
      if(err && err.notFound)
        return done(error.notFound(id));
      if(err) return done(err);

      if(tx){
        //lamport timestamp gets-from
        tx._seq = Math.max(tx._seq || 0, codec.decodeNumber(
          state.snapshot._rev.slice(MID_LEN)
        ));
      }

      if(ctx.params.state === true){
        done(null, state);
      }else{
        if(state.snapshot._deleted)
          return done(error.notFound(id));
        done(null, state.snapshot);
      }
    });
  });
  
  Roda.fn.define('getBy', params('index:string','key','tx?'), function(ctx, done){
    var tx = ctx.params.tx;
    var key = ctx.params.key;
    var idx = String(ctx.params.index).trim().replace(/(#|!)/,'');
    if(tx && tx.db !== db) return done(error.INVALID_TX);

    if(tx) tx.lock(this.name()); //lock roda section

    (tx || db).get(section(
      this._index, idx, codec.encode(key)
    ), function(err, val){
      if(err && err.notFound)
        return done(error.notFound(key));
      if(err) return done(err);

      if(tx && val._rev){
        //lamport timestamp gets-from
        tx._seq = Math.max(tx._seq || 0, codec.decodeNumber(
          val._rev.slice(MID_LEN)
        ));
      }
      done(null, val);
    });
  });

  Roda.fn.readStream = 
  Roda.fn.createReadStream = 
  function(opts){
    opts = opts || {};

    if(typeof opts.index === 'string'){
      var idx = String(opts.index).trim().replace(/(#|!)/,'');
      return H(db.createValueStream(
        section(this._index, idx, range(opts))
      ));
    }else{
      return H(db.createValueStream(
        section(this._read, range(opts))
      ));
    }
  };


  //Write operations
  function local(ctx, next, end){
    var del = (!ctx.params.result) && ('id' in ctx.params);
    var tx = ctx.params.tx;

    ctx.local = true;
    ctx.root = !ctx.params.tx; //non-root: within another transaction
    ctx.result = extend({}, ctx.params.result);

    //init transaction
    if(tx){
      if(tx.db !== db) return next(error.INVALID_TX);
      ctx.transaction = tx;
    }else{
      ctx.transaction = Roda.transaction();
    }
    end(function(err){
      //err except notFound causes rollback
      if(err && !err.notFound)
        ctx.transaction.rollback(err);
    });

    if(del)
      ctx.result._deleted = true;
    else
      ctx.transaction.defer(function(cb){
        //trigger validate transaction hook
        self.validate(ctx.result, function(err){
          if(err) return next(err);

          delete ctx.result._id;
          delete ctx.result._rev;
          delete ctx.result._key;
          delete ctx.result._deleted;
          delete ctx.result._after;
          delete ctx.result._from;

          cb();
        });
      });

    //get roda mid
    var self = this;
    ctx.transaction.lock(this.name()); //lock roda section
    ctx.transaction.defer(function(cb){
      if('id' in ctx.params)
        ctx.result._id = String(ctx.params.id).trim();
      else
        ctx.result._id = codec.encodeNumber(timestamp()) + self._mid;
        //monotonic timestamp + mid

        next();

        cb();
    });
  }

  function indexer(state, tx){
    //Index Mapper
    var self = this;
    if(!this._mapper) return;
    //delete current indices
    var name, i, l, keys;
    if(state.indexed){
      for(name in state.indexed){
        keys = state.indexed[name];
        for(i = 0, l = keys.length; i < l; i++){
          tx.del(section(
            self._index, name, keys[i].map(codec.encode).join(LOW)
          ));
        }
      }
    }

    state.indexed = {};

    //clear index when delete
    if(state.snapshot._deleted) return; 

    var result = extend({}, state.snapshot);
    var indexed = {};
    var async = false;
    var errorExists = null;

    var emit = function(name, key, value, unique){
      if(async) throw new Error('Index mapper must not be async.');

      if(key === null || key === undefined){
        errorExists = error.KEY_NULL;
        return;
      }
      //optional value arg
      if(value === true){
        unique = true;
        value = null;
      }
      var idx = [key];
      if(unique === true){
        tx.get(section(
          self._index, name, codec.encode(key)
        ), function(err, val){
          if(val) errorExists = error.exists(key);
        });
      }else{
        //append unique timestamp for non-unqiue key
        idx.push(codec.encodeNumber(timestamp(), true));
      }
      tx.put(
        section(self._index, name, idx.map(codec.encode).join(LOW)), 
        extend({}, value || result, {
          _id: result._id, 
          _key: key,
          _rev: result._rev
        })
      );

      //record encoded key
      indexed[name].push(idx);
    };

    for(name in self._mapper){
      indexed[name] = [];
      self._mapper[name](result, emit.bind(null, name));
    }

    //new indexed keys
    state.indexed = indexed;
    async = true;

    tx.defer(function(cb){
      if(errorExists)
        return cb(errorExists);
      cb();
    });
  }

  function operation(ctx, next){
    var self = this;
    var tx = ctx.transaction;
    var resolveConflict = false;

    tx.lock(this.name()); //lock roda section

    this.get(ctx.result._id, true, tx, function(err, state){
      //return IO/other errors
      if(err && !err.notFound) return next(err);
      //has current
      state = state || {};
      ctx.current = state.snapshot;

      //transaction emitter
      tx.once('end', function(err){
        if(!err) self.emit('_write', state);
      });

      if(ctx.current){
        if(!ctx.current._deleted && ctx.errorIfExists === true)
          return next(error.exists(ctx.result._id));
        //delete current change

        if(!ctx.local){
          //remote write
          //conflict if _from mismatch and is remote write
          if(ctx.result._from !== ctx.current._rev && 
            ctx.result._rev.indexOf(ctx.current._rev.slice(0, MID_LEN)) !== 0){

            if(self.resolver(ctx.result) > self.resolver(ctx.current)){
              //current conflict: apply result, do resolve conflict hook
              resolveConflict = true;
              //del conflicted change
              tx.del(section(self._changes, ctx.current._rev));
            }else{
              //replicate conflict: change nothing, rollback.
              return next(error.CONFLICT);
            }
          }
        }
      }
      if((!ctx.current || ctx.current._deleted) && ctx.errorIfNotExists === true)
        return next(error.notFound(ctx.result._id));

      tx.defer(function(cb){
        //diff transaction hook
        var current = ctx.current && !ctx.current._deleted ? extend({}, ctx.current) : null;
        var result = ctx.result && !ctx.result._deleted ? ctx.result : null;
        self.diff(current, result, tx, cb);
      });

      //lock clock
      var mid = ctx.local ? self._mid : ctx.result._rev.slice(0, MID_LEN);
      var seq;
      tx.get(section(self._clock, mid), function(err, curr){
        //return IO/other errors
        if(err && !err.notFound) return;

        if(ctx.local && ctx.current){
          //local write, current exists
          if(ctx.current._rev.indexOf(self._mid) !== 0){
            //read from remote: add _from
            ctx.result._from = ctx.current._rev;
          }else{
            //read from local: del current change
            tx.del(section(self._changes, ctx.current._rev));
            if(ctx.current._from)
              ctx.result._from = ctx.current._from; //copy _from over
            else
              delete ctx.result._from;
          }
        }
        //given mid i.e. local write or remote merge
        if(ctx.local){
          //generate _rev i.e. lamport timestamp
          seq = codec.encodeNumber(Math.max(
            curr ? codec.decodeNumber(curr) : 0, //execution order
            tx._seq || 0 //gets from
          ) + 1, true);

          ctx.result._rev = self._mid + seq;
        }else{
          seq = ctx.result._rev.slice(MID_LEN);
        }
        //clock update
        tx.put(section(self._clock, mid), seq);

        //put state
        state.snapshot = ctx.result;

        var enId = codec.encode(ctx.result._id); 
        if(ctx.result._deleted){
          //store del
          tx.del(section(self._read, enId));
        }else{
          //store put
          tx.put(section(self._read, enId), ctx.result);
        }
        //put changes
        tx.put(section(self._changes, ctx.result._rev), ctx.result);

        //Index mapper
        indexer.call(self, state, tx);

        tx.defer(function(cb){
          //put state
          tx.put(section(self._state, ctx.result._id), state, cb);
        });
        //conflict handling comes after diff
        if(resolveConflict){
          tx.defer(function(cb){
            self.conflict(ctx.current, ctx.result, tx, cb);
          });
        }
      });

      next();
    });
  }

  function write(ctx, done){
    if(ctx.root){
      ctx.transaction.commit(function(err){
        if(err) done(err, null);
        else done(null, ctx.result);
      });
    }else{
      //no need commit for non-root transaction,
      ctx.transaction.defer(function(cb){
        done(null, ctx.result);
        cb();
      });
    }
  }


  Roda.fn.define('post', params(
    'result:object','tx?'
  ), local, function(ctx){
    ctx.errorIfExists = true;
  }, operation, write);

  Roda.fn.define('put', params(
    'id','result:object','tx?'
  ), local, operation, write);

  Roda.fn.define('del', params(
    'id','tx?'
  ), local, function(ctx){
    ctx.errorIfNotExists = true;
  }, operation, write);

  //custom function for resolving conflicts
  Roda.fn.resolver = function(doc){
    return codec.seqKey(doc._rev);
  };

  Roda.fn.registerIndex = function(name, fn){
    this._mapper = this._mapper || {};

    if(typeof name === 'string' && typeof fn === 'function'){
      name = String(name).trim().replace(/(#|!)/,'');
      if(this._mapper[name])
        throw new Error('Index mapper `'+name+'` has already been assigned.');
      this._mapper[name] = fn;
    }else{
      throw new Error('Invalid index mapper.');
    }
    return this;
  };

  Roda.fn.define('rebuildIndex', params('tag?'), function(ctx, next, end){
    if('tag' in ctx.params){
      db.get(section(this._meta, 'rebuild'), {
        valueEncoding:'utf8' 
      }, function(err, tag){
        if(JSON.stringify(ctx.params.tag) === tag)
          return next(null, true);
        next();
      });
    }else{
      next();
    }
  }, function(ctx, done){
    var self = this;
    var errors = [];
    this.readStream().map(H.wrapCallback(function(data, cb){
      var tx = Roda.transaction();
      self.get(data._id, true, tx, function(err, state){
        if(!state) return tx.rollback(); //should not happen
        indexer.call(self, state, tx);
        tx.put(section(self._state, data._id), state);
      });
      tx.commit(cb);
    }))
    .parallel(1)
    .errors(function(err){
      errors.push(err);
    })
    .done(function(){
      if(errors.length > 0)
        return done(errors);
      if('tag' in ctx.params){
        db.put(section(self._meta, 'rebuild'), ctx.params.tag, done);
      }else{
        done(null);
      }
    });
  });

  //Changes
  Roda.fn.clockStream = 
  Roda.fn.createClockStream = 
  function(){
    return H(db.createReadStream(
      section(this._clock, {})
    )).map(function(data){
      return section(data.key) + data.value;
    });
  };

  Roda.fn.liveStream = 
  Roda.fn.createLiveStream = 
  function(){
    return H('_write', this).map(function(state){
      return extend({}, state.snapshot);
    });
  };

  function readChangesStream(current, limit){
    if(!current)
      return H(db.createValueStream(
        section(this._changes, { limit: limit || -1 })
      ));

    var self = this;
    var count = 0;
    return H(db.createReadStream(
      section(this._clock, {})
    ))
    .map(section)
    .reject(function(at){
      return (
        at.key in current && at.value <= current[at.key]
      ) || (limit && count >= limit);
    })
    .map(function(at){
      return H(db.createValueStream(
        section(self._changes, {
          gt: at.key + (current[at.key] || ''),
          lt: at.key + '~',
          limit: limit ? limit - count : -1
        })
      ));
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
      var current;
      if(clocks.length > 0){
        current = {};
        for(var i = 0, l = clocks.length; i < l; i++){
          var rev = clocks[i];
          current[rev.slice(0, MID_LEN)] = rev.slice(MID_LEN);
        }
      }

      return (
        live ? H(function(push, next){
          //live changes = readChangesStream + liveStream
          readChangesStream.call(self, current, 1)
            .collect().pull(function(err, arr){
              if(err) return push(err);
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
          if(data._rev.indexOf(self._mid) === 0) 
            return cb(null); //ignore local
          db.put(section(self._queue, codec.seqKey(data._rev)), data, cb);
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
    H(db.createValueStream(section(this._queue, {})))
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
    ctx.local = false;
    ctx.result = extend({}, ctx.params.result);

    var self = this;
    var tx = ctx.transaction = Roda.transaction();
    var mid = ctx.result._rev.slice(0, MID_LEN);
    var seq = ctx.result._rev.slice(MID_LEN);

    tx.lock(this.name()); //lock roda section

    end(function(err){
      tx.rollback(err); 
    });

    if(ctx.result._from){
      var fromMid = ctx.result._from.slice(0, MID_LEN);
      var fromSeq = ctx.result._from.slice(MID_LEN);
      tx.defer(function(cb){
        tx.get(section(self._clock, fromMid), function(err, fromCurr){
          //must gte _from seq to replicate
          if(!fromCurr || fromCurr < fromSeq)
            return next(error.NOT_READY);
          cb();
        });
      });
    }

    tx.get(section(self._clock, mid), function(err, curr){
      //to replicate must satisify curr === after
      var after = ctx.result._after;
      //curr not ready
      if((!curr && after) || curr < after)
        return next(error.NOT_READY);

      //delete waitlist item
      tx.del(section(self._queue, codec.seqKey(ctx.result._rev)));

      //already in store. Delete then next
      if(curr > after || curr >= seq)
        return tx.commit(next);

      delete ctx.result._after;

      if(!ctx.result._deleted)
        self.validate(ctx.result, function(err){
          if(err) return next(err);
          next();
        });
      else{
        next();
      }
    });
  }, operation, function(ctx, done){
    ctx.transaction.commit(done);
  });

  Roda.fn.define('_conflicted', params('result'), function(ctx, done){
    //delete waitlist, put clock, del merge, keep going
    var tx = Roda.transaction();
    var doc = ctx.params.result;
    tx.del(section(this._queue, codec.seqKey(doc._rev)));
    tx.put(
      section(this._clock, doc._rev.slice(0, MID_LEN)), 
      doc._rev.slice(MID_LEN)
    );
    tx.commit(done);
  });

  return Roda;
};
