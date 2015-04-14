var rodabase = require('../');

var tape = require('tape');
var jsondown = require('jsondown');
var _ = require('underscore');

var roda = rodabase('./test/data/resource.json', {
  db: jsondown
});
var n = 100;

tape('Read lock', function(t){
  var api = roda('1');
  var ok = true;

  t.plan(2);
  function run(i){
    var tx = roda.transaction();
    api.get('k', tx, function(err, val){
      ok &= !err;

      api.put('k',{
        k: (val ? val.k : 0) + 1
      }, tx);

      tx.commit();
    });
  }
  for(var i = 0; i < n; i++)
    run(i);

  var tx = roda.transaction();

  api.get('k', tx, function(err, val){
    t.ok(ok, 'no error');
    t.equal(val.k, n, 'Tx incrememnt');
  });

  tx.commit();
});

tape('Increment', function(t){
  t.plan(2);
  var api = roda('2');

  for(var i = 0; i < n; i++)
    api.put({ i: i }, function(err, val){
      if(val.i === n - 1){
        api.read(function(err, list){
          list = _.sortBy(list, 'i');
          t.deepEqual(_.sortBy(list, '_id'), list, '_id incremental');
          t.deepEqual(_.sortBy(list, '_rev'), list, '_rev incremental');
        });
      }
    });
});

tape('Tx increment', function(t){
  t.plan(4);
  var api = roda('3');
  var tx = roda.transaction();

  for(var i = 0; i < n; i++)
    api.put({ i: i }, tx);
    
  api.read(function(err, list){
    t.equal(list.length, 0, 'list empty before commit');
    tx.commit(function(){
      api.read(function(err, list){
        list = _.sortBy(list, 'i');
        t.equal(list.length, n, 'list filled after commit');
        t.deepEqual(_.sortBy(list, '_id'), list, '_id incremental');
        t.deepEqual(_.sortBy(list, '_rev'), list, '_rev incremental');
      });
    });
  });
});

tape('tx count', function(t){
  t.plan(1);
  var c = roda('counts');
  c.put('bob', { n: 167 });

  var tx = roda.transaction();
  c.get('bob', tx, function(err, data){
    data.n++;

    c.put('bob', data, tx);
    tx.commit(function(){
      c.get('bob', function(err, val){
        t.equal(val.n, 168, 'tx increment');
      });
    });
  });
});

tape('Changes', function(t){
  t.plan(3);
  var api = roda('4');
  var tx = roda.transaction();
  var i;

  function encode(i){
    return roda.util.trim(roda.util.encode64(i));
  }

  for(i = 0; i < n; i++)
    api.put(encode(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    api.put(encode(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    api.del(encode(i), tx);
  for(i = 0; i < n; i+=3)
    api.del(encode(i), tx); //non-exist del

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    api.read(function(err, list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    api.changes(function(err, changes){
      t.equal(changes.length, n, 'changes n ength');
    });
  });
});

tape('Nested Put', function(t){
  t.plan(5);
  roda('5').use('validate', function(ctx, next){
    roda('5.1').put(ctx.result._id, {
      i: ctx.result.i * 10
    }, ctx.transaction);
    next();
  });
  var tx = roda.transaction();
  var i;

  function encode(i){
    return roda.util.trim(roda.util.encode64(i));
  }

  for(i = 0; i < n; i++)
    roda('5').put(encode(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    roda('5').put(encode(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    roda('5').del(encode(i), tx);
  for(i = 0; i < n; i+=3)
    roda('5').del(encode(i), tx); //non-exist del
  for(i = 0; i < n; i+=2)
    roda('5.1').del(encode(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('5').read(function(err, list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('5').changes(function(err, changes){
      t.equal(changes.length, n, 'changes n length');
    });
    roda('5.1').read(function(err, list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('5.1').changes(function(err, list){
      t.equal(list.length, n, 'hook changes n length');
    });
  });

});
tape('Double Nested Put', function(t){
  t.plan(7);
  roda('6').use('validate', function(ctx, next){
    roda('6.1').put(ctx.result._id, {
      i: ctx.result.i * 10
    }, ctx.transaction);
    //redundant
    roda('6.1').put(ctx.result._id, {
      i: ctx.result.i * 10
    }, ctx.transaction);
    next();
  });
  roda('6.1').use('diff', function(ctx, next){
    if(ctx.result)
      roda('6.2').put(ctx.result._id, {
        i: ctx.result.i * 10
      }, ctx.transaction);
    else
      roda('6.2').del(ctx.current._id, ctx.transaction);
    next();
  });
  var tx = roda.transaction();
  var i;

  function encode(i){
    return roda.util.trim(roda.util.encode64(i));
  }

  for(i = 0; i < n; i++)
    roda('6').put(encode(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    roda('6').put(encode(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    roda('6').del(encode(i), tx);
  for(i = 0; i < n; i+=3)
    roda('6').del(encode(i), tx); //non-exist del
  for(i = 0; i < n; i+=2)
    roda('6.1').del(encode(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('6').read(function(err, list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('6').changes(function(err, changes){
      t.equal(changes.length, n, 'changes n length');
    });
    roda('6.1').read(function(err, list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.1').changes(function(err, list){
      t.equal(list.length, n, 'hook changes n length');
    });
    roda('6.2').read(function(err, list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.2').changes(function(err, list){
      t.equal(list.length, n, 'hook changes n length');
    });
  });

});
tape('Valdate', function(t){
  t.plan(10);
  roda('7')
    .use('validate', function(ctx, next){
      if(ctx.result.i % 3 === 0)
        return next(new Error('No 3 multiple'));
      next();
    })
    .use('validate', function(ctx, next){
      if(ctx.result.i % 2 === 0)
        return next(new Error('No 2 multiple'));
      next();
    });
  var i;

  for(i = 0; i < 10; i++){
    roda('7').put({ i: i }, function(i, err, val){
      if(i % 3 === 0 || i % 2 === 0){
        t.notOk(val, i + ' err');
      }else{
        t.equal(val.i, i, i + ' value');
      }
    }.bind(null, i));
  }
});
tape('Unique Index', function(t){
  t.plan(5);
  function isEmail(str){
    return /\S+@\S+\.\S+/.test(str);
  }
  roda('users')
    .use('validate', function(ctx, next){
      if(!isEmail(ctx.result.email))
        return next(new Error('Invalid email.'));
      next();
    })
    .index('email', function(doc, emit){
      emit(doc.email, doc, true);
    })
    .put({ email: 'abc' }, function(err, val){
      t.ok(err, 'Invalid Email');
    })
    .put({ email: 'foo@bar.com' }, function(err, val){
      t.equal(val.email, 'foo@bar.com', 'Email Saved');
    })
    .put({ email: 'adrian@cshum.com' }, function(err, val){
      t.equal(val.email, 'adrian@cshum.com', 'Email Saved');
    })
    .put({ email: 'adrian@cshum.com' }, function(err, val){
      t.ok(err, 'Repeated Email');
      this.read(function(err, list){
        t.deepEqual(list.map(function(doc){
          return doc.email; 
        }), [
          'foo@bar.com',
          'adrian@cshum.com'
        ], 'Email list');
      });
    })
});
