var rodabase = require('../');

var test = require('tape');
var _ = require('underscore');
var H = require('highland');

if(process.browser){
  var idb = window.indexedDB || window.mozIndexedDB || 
    window.webkitIndexedDB || window.msIndexedDB || window.shimIndexedDB;
  idb.deleteDatabase('IDBWrapper-./test/db');
}

var n = 50;
// var n = 100;
var roda = rodabase('./test/db', {
  ttl: n * 1000
  // db: require('jsondown')
});
var util = roda.util;

//simulate inconsistent delay
roda.fn
  .use('validate', function(ctx, next){
    setTimeout(next, Math.random() * 5);
  })
  .use('diff', function(ctx, next){
    setTimeout(next, Math.random() * 5);
  });

test('encode decode', function(t){
  var lex = true;
  var id = true;
  var m = 1000000;
  var em = util.encode(m);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = util.encode(n);

    lex &= (n >= m && en >= em) || (n < m && en < em);
    id &= n === util.decode(en);
  }
  t.ok(lex, 'lexicographical');
  t.ok(id, 'identical');
  t.end();
});

test('encode decode number', function(t){
  var lex = true;
  var id = true;
  var m = 1000000;
  var em = util.encodeNumber(m, true);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = util.encodeNumber(n);

    lex &= (n >= m && en >= em) || (n < m && en < em);
    id &= n === util.decodeNumber(en);
  }
  t.ok(lex, 'lexicographical');
  t.ok(id, 'identical');
  t.end();
});

test('clocks', function(t){
  var arr = ['01234567abc','12345678def','23456789ghi'];
  var obj = {
    '01234567':'abc',
    '12345678':'def',
    '23456789':'ghi'
  };
  t.deepEqual(util.clocksObject(arr), obj, 'clocksObject');
  t.deepEqual(util.clocks(obj), arr, 'clocks');
  t.end();
});

test('timestamp', function(t){
  var prev = 0;
  var ok = true;
  for(var i = 0, l = 1000; i < l; i++){
    var time = util.timestamp();
    ok &= prev < time;
    prev = time;
  }
  t.ok(ok, 'monotonic');
  t.end();
});

test('Transaction: lock increment', function(t){
  var api = roda('1');
  var ok = true;

  t.plan(2);
  function run(i){
    var tx = roda.transaction();
    api.get('k', tx, function(err, val){
      ok &= !(err && !err.notFound);

      val = val || { k: 0 };
      val.k++;

      api.put('k',val,tx);
    });
    tx.commit();
  }
  for(var i = 0; i < n; i++)
    run(i);

  var tx = roda.transaction();
  api.get('k', tx, function(err, val){
    t.ok(ok, 'ok');
    t.equal(val.k, n, 'Incremential');
  });
  tx.commit();
});

test('Transaction: sequential operations', function(t){
  t.plan(4);
  var api = roda('3');
  var tx = roda.transaction();

  for(var i = 0; i < n; i++)
    api.post({ i: i }, tx);
    
  api.readStream().toArray(function(list){
    t.equal(list.length, 0, 'list empty before commit');
    tx.commit(function(){
      api.readStream().toArray(function(list){
        list = _.sortBy(list, 'i');
        t.equal(list.length, n, 'list filled after commit');
        t.deepEqual(_.sortBy(list, '_id'), list, '_id incremental');
        t.deepEqual(_.sortBy(list, '_rev'), list, '_rev incremental');
      });
    });
  });
});

test('Transaction: isolation', function(t){
  t.plan(2);
  var c = roda('count');
  var tx = roda.transaction();
  var tx2 = roda.transaction();

  c.put('bob', { n: 167 }, tx);

  tx.commit(function(){
    c.get('bob', tx2, function(err, data){
      data.n++;
      c.put('bob', data, tx2);
    });

    c.get('bob', function(err, val){
      t.equal(val.n, 167, 'before tx2 commit');
      tx2.commit(function(){
        c.get('bob', function(err, val){
          t.equal(val.n, 168, 'after tx2 commit');
        });
      });
    });
  });
});

test('CRUD', function(t){
  var api = roda('crud');
  t.plan(8);

  api.post({'foo':'bar'}, function(err, val){
    t.equal(val.foo, 'bar', 'create');
  });
  api.update('foo', {'foo':'bar'}, function(err){
    t.ok(err.notFound, 'error update key not found');
  });
  api.del('foo', function(err){
    t.ok(err.notFound, 'notFound err for non exist delete');
  });

  var tx = roda.transaction();
  api.put('bla', {'foo':'bar'}, tx, function(err, val){
    t.equal(val.foo, 'bar', 'foo: bar');
    val.foo = 'boo';
    api.update('bla', val, tx, function(err, val){
      t.equal(val.foo, 'boo', 'foo: boo');
    });
    api.del('bla', tx);
    api.del('bla', tx); //redundant del
  });
  tx.commit(function(err){
    t.notOk(err, 'no err for commit');
    api.get('bla', function(err, val){
      t.ok(err.notFound, 'notFound error for non exists get');
      t.notOk(val, 'no val after delete');
    });
  });

});


test('Transaction middleware: Validate', function(t){
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
    roda('7').post({ i: i }, function(i, err, val){
      if(i % 3 === 0 || i % 2 === 0){
        t.notOk(val, i + ' err');
      }else{
        t.equal(val.i, i, i + ' value');
      }
    }.bind(null, i));
  }
});

test('Transaction middleware: diff', function(t){
  t.plan(5);
  roda('5').use('diff', function(ctx, next){
    roda('5.1').put(ctx.result._id, {
      i: ctx.result.i * 10
    }, ctx.transaction);
    next();
  });
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    roda('5').put(util.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    roda('5').put(util.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    roda('5').del(util.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    roda('5').del(util.encodeNumber(i), tx); //non-exist del
  for(i = 0; i < n; i+=2)
    roda('5.1').del(util.encodeNumber(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('5').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('5').changesStream({clocks:[]}).toArray(function(changes){
      t.equal(changes.length, n, 'changes n length');
    });
    roda('5.1').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('5.1').changesStream({clocks:[]}).toArray(function(list){
      t.equal(list.length, n, 'hook changes n length');
    });
  });
});

test('Transaction middleware: diff 2', function(t){
  t.plan(7);
  roda('6').use('diff', function(ctx, next){
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
    if(!ctx.result._deleted)
      roda('6.2').put(ctx.result._id, {
        i: ctx.result.i * 10
      }, ctx.transaction);
    else
      roda('6.2').del(ctx.current._id, ctx.transaction);
    next();
  });
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    roda('6').put(util.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    roda('6').put(util.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    roda('6').del(util.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    roda('6').del(util.encodeNumber(i), tx); //non-exist del
  for(i = 0; i < n; i+=2)
    roda('6.1').del(util.encodeNumber(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('6').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('6').changesStream({clocks:[]}).toArray(function(changes){
      t.equal(changes.length, n, 'changes n length');
    });
    roda('6.1').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.1').changesStream({clocks:[]}).toArray(function(list){
      t.equal(list.length, n, 'hook changes n length');
    });
    roda('6.2').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.2').changesStream({clocks:[]}).toArray(function(list){
      t.equal(list.length, n, 'hook changes n length');
    });
  });

});

test('changesStream', function(t){
  t.plan(3);
  var api = roda('4');
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    api.put(util.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    api.put(util.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    api.del(util.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    api.del(util.encodeNumber(i), tx); //non-exist del

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    api.readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    api.changesStream({clocks:[]}).toArray(function(changes){
      t.equal(changes.length, n, 'changes n ength');
    });
  });
});

test('Live changesStream', function(t){
  t.plan(3);
  var api = roda('4');

  var liveChanges = [];
  var live = [];
  var m = 17;

  var tx = roda.transaction();
  for(i = 0; i < m; i++)
    api.post({ m:i }, tx);

  api.liveStream()
    .each(function(data){
      live.push(data);
      if(data.m === m - 1)
        t.equal(live.length, m, 'live m ength');
    });

  api.changesStream({clocks: [], live: true, sync: true})
    .each(function(data){
      liveChanges.push(data);
      if(data._sync){
        t.equal(liveChanges.length, n + 1, 'sync emitted at n + 1');
        tx.commit();
      }
      if(data.m === m - 1)
        t.equal(liveChanges.length, n + m + 1, 'liveChanges n + m + 1 ength');
    });

});


test('Mapper and Range', function(t){
  t.plan(21 + n);
  function isEmail(str){
    return /\S+@\S+\.\S+/.test(str);
  }
  roda('users').use('validate', function(ctx, next){
    if(!isEmail(ctx.result.email))
      return next(new Error('Invalid email.'));
    if(_.isString(ctx.result.gender))
      ctx.result.gender = ctx.result.gender.toUpperCase();
    next();
  })
  .mapper('email', function(doc, emit){
    emit(doc.email, true);
  })
  .mapper('age', function(doc, emit){
    emit(doc.age);
  })
  .mapper('gender_age', function(doc, emit){
    if(doc.gender)
      emit([doc.gender, doc.age]);
  })
  .post({ email: 'abc' }, function(err, val){
    t.ok(err, 'Invalid Email');
    this.post({ email: 'adrian@cshum.com', age: 25, gender:'M' }, function(err, val){
      t.equal(val.email, 'adrian@cshum.com', 'Email Saved');

      for(var i = 0; i < n; i++){
        this.post({ email: 'adrian@cshum.com' }, function(err, val){
          t.ok(err.exists, 'Repeated');
        });
      }

      this.post({ email: 'hello@world.com', age: 15, gender:'m' }, function(err, val){
        t.equal(val.email, 'hello@world.com', 'Email Saved');

        this.post({ email: 'foo@bar.com', age: 15, gender:'F' }, function(err, val){
          t.equal(val.email, 'foo@bar.com', 'Email Saved');

          this.readStream({ map:'email' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, [
                'adrian@cshum.com',
                'foo@bar.com',
                'hello@world.com'
              ], 'Email read by email');
            });
          this.readStream()
            .pluck('email').toArray(function(list){
              t.deepEqual(list, [
                'adrian@cshum.com',
                'hello@world.com',
                'foo@bar.com',
              ], 'Email read by order');
            });
          this.readStream({map: 'email', eq:'foo@bar.com' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['foo@bar.com'], 'index eq');
            });
          this.readStream({map: 'email', eq:'foo@bar.co' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, [], 'index prefix not eq ');
            });
          this.readStream({map: 'email', prefix:'foo@bar.co' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['foo@bar.com'], 'index string prefix');
            });
          this.readStream({map: 'age'})
            .pluck('email').toArray(function(list){
              t.deepEqual(list, all, 'Email read by age');
            });
          this.readStream({map: 'age', gt: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(
                list, ['adrian@cshum.com'], 'Email read by age >15'
              );
            });
          this.readStream({map: 'age', lt: 25 })
            .pluck('email').toArray(function(list){
              t.deepEqual(
                list, ['hello@world.com','foo@bar.com'], 'Email read by age <25'
              );
            });
          this.readStream({map: 'age', eq: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(
                list, ['hello@world.com','foo@bar.com'], 'Email read by age === 15'
              );
            });
          var all = [
            'hello@world.com',
            'foo@bar.com',
            'adrian@cshum.com'
          ];
          this.readStream({map: 'age', gte: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, all, 'Email read by age >=15');
            });
          this.readStream({map: 'age', lte: 25 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, all, 'Email read by age <=25');
            });
          this.readStream({map: 'gender_age', prefix: ['F'] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['foo@bar.com'], 'Female');
            });
          this.readStream({map: 'gender_age', prefix: ['M'] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['hello@world.com','adrian@cshum.com'], 'Male');
            });
          this.readStream({map: 'gender_age', eq: ['M'] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, [], 'fales eq');
            });
          this.readStream({map: 'gender_age', prefix: ['M'], gt: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['adrian@cshum.com'], 'Male over age 15');
            });
          this.readStream({map: 'gender_age', eq: ['M', 25] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['adrian@cshum.com'], 'Male age === 25');
            });
          this.readStream({map: 'gender_age', prefix: ['M'], lte: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['hello@world.com'], 'Male age 15');
            });
        });
      });
    });
  });
});

test('pipes', function(t){
  t.plan(6);

  var a = roda('a1');
  var b = roda('b1');
  var c = roda('c1');
  var d = roda('d1');
  var i;

  var count = {
    a: 0, c: 0, d: 0, aL: 0
  };
  a.liveStream().each(function(doc){
    count.a++;
    if(count.a === n*2){
      t.ok(true, 'b pipe a');
      a.changesStream({ clocks:[], local: true }).toArray(function(arr){
        t.equal(arr.length, n, 'a local changes');
      });
    }
  });
  roda.emptyStream().pipe(
    a.changesStream({ local: true, live: true })
  ).each(function(doc){
    count.aL++;
    if(count.aL === n){
      t.ok(true, 'a local');
    }
  });
  c.liveStream().each(function(doc){
    count.c++;
    if(count.c === n*2){
      t.ok(true, 'a pipe c');
    }
  });
  d.liveStream().each(function(doc){
    count.d++;
    if(count.d === n*2){
      t.ok(true, 'sink');
      d.changesStream({ clocks:[], local: true }).toArray(function(arr){
        t.equal(arr.length, 0, 'd local changes empty');
      });
    }
  });

  for(i = 0; i < n; i++)
    a.post({a:i});
  for(i = 0; i < n; i++)
    b.post({b:i});

  b.pipe(a).pipe(c);

  for(i = 0; i< 2; i++){
    a.pipe(d);
    b.pipe(d);
    c.pipe(d);
    d.pipe(d);
  }

});

