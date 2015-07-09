var dbPath = './test/db';
if(process.browser){
  require("indexeddbshim");
  require("level-js").destroy(dbPath, function(){});
}else{
  require('rimraf').sync(dbPath);
}

var rodabase = require('../');

var test = require('tape');
var timestamp = require('../lib/timestamp');
var codec = require('../lib/codec');
var _ = require('underscore');
var H = require('highland');

var n = parseInt(process.argv[3]) || 50;
var dbName = process.argv[2] || (process.browser ? 'level-js':'leveldown');
var db = require(dbName);

var roda = rodabase(dbPath, { ttl: n * 1000, db: db });

console.log('Rodabase test db = '+dbName+', n = '+n);

//simulate inconsistent delay
roda.fn.use('validate', function(ctx, next){
  setTimeout(next, Math.random() * 5);
});
roda.fn.use('diff', function(ctx, next){
  setTimeout(next, Math.random() * 5);
});

test('encode decode', function(t){
  var lex = true;
  var id = true;
  var m = 1000000;
  var em = codec.encode(m);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = codec.encode(n);

    lex &= (n >= m && en >= em) || (n < m && en < em);
    id &= n === codec.decode(en);
  }
  t.ok(lex, 'lexicographical');
  t.ok(id, 'identical');
  t.end();
});

test('encode decode number', function(t){
  var lex = true;
  var id = true;
  var m = 1000000;
  var em = codec.encodeNumber(m, true);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = codec.encodeNumber(n);

    lex &= (n >= m && en >= em) || (n < m && en < em);
    id &= n === codec.decodeNumber(en);
  }
  t.ok(lex, 'lexicographical');
  t.ok(id, 'identical');
  t.end();
});

test('timestamp', function(t){
  var prev = 0;
  var ok = true;
  for(var i = 0, l = 1000; i < l; i++){
    var time = timestamp();
    ok &= prev < time;
    prev = time;
  }
  t.ok(ok, 'monotonic');
  t.end();
});

test('Transaction: parallelism', function(t){
  var api = roda('1');
  var count = 0;

  t.plan(1);
  function run(i){
    var tx = roda.transaction();
    api.get('k', tx, function(err, val){
      val = val || { k: 0 };
      val.k++;

      api.put('k',val,tx);
    });
    tx.commit(function(err){
      count++;
      if(count === n)
        api.get('k', function(err, val){
          t.equal(val.k, n, 'Incremential');
        });
    });
  }
  for(var i = 0; i < n; i++) run(i);
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
        t.deepEqual(_.sortBy(_.shuffle(list), '_id'), list, '_id incremental');
        t.deepEqual(_.sortBy(_.shuffle(list), '_rev'), list, '_rev incremental');
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

test('Transactional CRUD', function(t){
  var api = roda('crud');
  t.plan(13);

  t.equal(api.name(), 'crud', 'name()');

  api.create('asdf',{'foo':'bar'}, function(err, val){
    t.equal(val.foo, 'bar', 'create');
    api.create('asdf',{'foo':'bla'}, function(err, val){
      t.ok(err.exists, 'create error if exists');
    });
  });
  api.post({'foo':'bar'}, function(err, val){
    t.equal(val.foo, 'bar', 'post');
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
    api.get('bla', true, function(err, state){
      t.notOk(err, 'no err.notFound with state');
      t.ok(state.snapshot._deleted, 'val deleted');
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
  t.plan(8);
  roda('6').use('diff', function(ctx, next){
    if(!ctx.result._deleted){
      roda('6.1').put(ctx.result._id, {
        i: ctx.result.i * 10
      }, ctx.transaction);
    }
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
    roda('6').put(codec.encodeNumber(i), { i: i }, tx);

  for(i = 0; i < n; i+=3)
    roda('6').del(codec.encodeNumber(i), tx);

  roda('6').del(codec.encodeNumber(0), tx, function(err){
    t.ok(err.notFound, 'notFound error for non-exists del');
  });

  for(i = 0; i < n; i+=2)
    roda('6.1').del(codec.encodeNumber(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('6').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('6').historyStream().toArray(function(list){
      t.equal(list.length, n, 'time n length');
    });
    roda('6.1').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.1').historyStream().toArray(function(list){
      t.equal(list.length, n, 'hook time n length');
    });
    roda('6.2').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.2').historyStream().toArray(function(list){
      t.equal(list.length, n, 'hook time n length');
    });
  });

});

test('historyStream and trigger', function(t){
  t.plan(7);
  var api = roda('4');
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    api.put(codec.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    api.put(codec.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    api.del(codec.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    api.del(codec.encodeNumber(i), tx); //non-exist del

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    api.readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    api.historyStream().toArray(function(list){
      t.equal(list.length, n, 'historyStream n length');
      t.deepEqual(_.sortBy(_.shuffle(list), '_key'), list, '_key incremental');

      var linear = [];
      var parallel = [];
      var retry = [];
      var count = 0;
      
      api.trigger('linear', function(doc, next){
        linear.push(doc);
        if(linear.length === n)
          t.deepEqual(linear, list, 'linear trigger incremental');
        setTimeout(next, Math.random() * 10);
      })
      .trigger('parallel', function(doc, next){
        parallel.push(doc);
        if(parallel.length === n)
          t.deepEqual(parallel, list, 'parallel trigger incremental');
        setTimeout(next, Math.random() * 10);
      }, { parallel: 7 })
      .trigger('retry', function(doc, next){
        if(count < Math.random() * 5){
          count++;
          next(new Error());
        }else{
          retry.push(doc);
          count = 0;
          if(retry.length === n)
            t.deepEqual(retry, list, 'retry trigger incremental');
          next();
        }
      }, { retryDelay: 1 });
    });
  });
});

test('liveStream historyStream trigger', function(t){
  t.plan(3);
  var api = roda('4');
  var m = 17;

  api.liveStream()
    .drop(m - 1)
    .pull(function(err, data){
      t.equal(data.m, m - 1, 'liveStream tail');
    });

  api.historyStream({ live: true })
    .drop(n + m - 1)
    .pull(function(err, data){
      t.equal(data.m, m - 1, 'live historyStream tail');
    });

  //destroy trigger instance to test durability
  api._triggered.linear.destroy();
  delete api._triggered.linear;

  api.liveStream().take(m).pluck('_rev').collect().pull(function(err, list){
    var linear = [];
    api.trigger('linear', function(doc, next){
      linear.push(doc._rev);
      if(linear.length === m)
        return t.deepEqual(linear, list, 'durable trigger');
      next();
    });
  });

  var tx = roda.transaction();
  for(i = 0; i < m; i++)
    api.post({ m:i }, tx);
  tx.commit();
});


test('Index and range', function(t){
  t.plan(22 + 30);
  function isEmail(str){
    return /\S+@\S+\.\S+/.test(str);
  }
  var users = roda('users');
  users.use('validate', function(ctx, next){
    if(!isEmail(ctx.result.email))
      return next(new Error('Invalid email.'));
    if(_.isString(ctx.result.gender))
      ctx.result.gender = ctx.result.gender.toUpperCase();
    next();
  })
  .registerIndex('email', function(doc, emit){
    emit(doc.email, true);
  })
  .registerIndex('age', function(doc, emit){
    emit(doc.age);
  })
  .registerIndex('foo', function(doc, emit){
    emit(doc.email, {foo:'bar'}, true);
  })
  .registerIndex('gender_age', function(doc, emit){
    if(doc.gender)
      emit([doc.gender, doc.age]);
  })
  .post({ email: 'abc' }, function(err, val){
    t.ok(err, 'Invalid Email');

    var tx = roda.transaction();

    users
      .post({ email: 'adrian@cshum.com', age: 25, gender:'M' }, tx)
      .post({ email: 'hello@world.com', age: 15, gender:'m' }, tx)
      .put('dummy', { email: 'foo@bar.com', age: 167, gender: 'F'}, tx)
      .del('dummy', tx)
      .post({ email: 'foo@bar.com', age: 15, gender:'F' }, tx);

    tx.commit(function(err){
      t.notOk(err, 'commit success');

      users.post({ email: 'adrian@cshum.com' }, function(err, val){
        t.ok(err.exists, 'Repeated');
      });
      //stress it
      for(var i = 0; i< 10; i++){
        users.post({ email: 'foo@bar.com' }, function(err, val){
          t.ok(err.exists, 'Repeated');
        });
        users.post({ email: 'hello@world.com' }, function(err, val){
          t.ok(err.exists, 'Repeated');
        });
        users.post({ email: 'adrian@cshum.com' }, function(err, val){
          t.ok(err.exists, 'Repeated');
        });
      }

      users.readStream({ index:'email' })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, [
            'adrian@cshum.com',
            'foo@bar.com',
            'hello@world.com'
          ], 'Email read by email');
        });
      users.readStream()
        .pluck('email').toArray(function(list){
          t.deepEqual(list, [
            'adrian@cshum.com',
            'hello@world.com',
            'foo@bar.com',
          ], 'Email read by order');
        });
      users.readStream({index: 'foo'}).pull(function(err, item){
        t.equal(item._key, 'adrian@cshum.com', 'Email Key');
        t.equal(item.foo, 'bar', 'custom field');
      });
      users.readStream({index: 'email', eq:'foo@bar.com' })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['foo@bar.com'], 'index eq');
        });
      users.readStream({index: 'email', eq:'foo@bar.co' })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, [], 'index prefix not eq ');
        });
      users.readStream({index: 'email', prefix:'foo@bar.co' })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['foo@bar.com'], 'index string prefix');
        });
      users.readStream({index: 'age'})
        .pluck('email').toArray(function(list){
          t.deepEqual(list, all, 'Email read by age');
        });
      users.readStream({index: 'age', gt: 15 })
        .pluck('email').toArray(function(list){
          t.deepEqual(
            list, ['adrian@cshum.com'], 'Email read by age >15'
          );
        });
      users.readStream({index: 'age', lt: 25 })
        .pluck('email').toArray(function(list){
          t.deepEqual(
            list, ['hello@world.com','foo@bar.com'], 'Email read by age <25'
          );
        });
      users.readStream({index: 'age', eq: 15 })
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
      users.readStream({index: 'age', gte: 15 })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, all, 'Email read by age >=15');
        });
      users.readStream({index: 'age', lte: 25 })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, all, 'Email read by age <=25');
        });
      users.readStream({index: 'gender_age', prefix: ['F'] })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['foo@bar.com'], 'Female');
        });
      users.readStream({index: 'gender_age', prefix: ['M'] })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['hello@world.com','adrian@cshum.com'], 'Male');
        });
      users.readStream({index: 'gender_age', eq: ['M'] })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, [], 'fales eq');
        });
      users.readStream({index: 'gender_age', prefix: ['M'], gt: 15 })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['adrian@cshum.com'], 'Male over age 15');
        });
      users.readStream({index: 'gender_age', eq: ['M', 25] })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['adrian@cshum.com'], 'Male age === 25');
        });
      users.readStream({index: 'gender_age', prefix: ['M'], lte: 15 })
        .pluck('email').toArray(function(list){
          t.deepEqual(list, ['hello@world.com'], 'Male age 15');
        });
    });
  });
});

test('Rebuild Index', function(t){
  t.plan(4);
  var users = roda('users');

  users.liveStream().each(function(){
    t.error('Should not invoke write');
  });
  users.registerIndex('random', function(doc, emit){
    emit(Math.random());
  });
  users.rebuildIndex(function(err){
    users.readStream({ index:'random' }).toArray(function(list){
      t.equal(list.length, 3, 'Index rebuilt');
      users.registerIndex('random2', function(doc, emit){
        emit(Math.random());
      });
      users.rebuildIndex('random2', function(err){
        users.readStream({ index:'random2' }).toArray(function(list){
          t.equal(list.length, 3, 'Index rebuilt');
        });
        users.rebuildIndex('random2', function(err, cached){
          t.notOk(err, 'rebuild no error');
          t.ok(cached, 'cached index rebuild tag');
        });
      });
    });
  });
});

function pipe(source, dest){
  var stream = dest.clockStream()
    .pipe(source.changesStream({ live: true }))
    .take(n)
    .on('end', function(){
      //simulate reconnection such that 
      //clockStream triggered more than once
      pipe(source, dest);
    })
    .pipe(dest.replicateStream());
}

test('Replications', function(t){
  t.plan(3);

  var a = roda('a1');
  var b = roda('b1');
  var c = roda('c1');
  var d = roda('d1');
  var i, result;

  //avoid process exits
  a.liveStream().drop(n*2 - 1).pull(function(err, doc){
    a.readStream().toArray(function(arr){
      result = arr;
      t.equal(result.length, n*2, 'b to a');
    });
  });
  c.liveStream().drop(n*2 - 1).pull(function(err, doc){
    c.readStream().toArray(function(arr){
      t.deepEqual(arr, result, 'a to c');
    });
  });
  d.liveStream().drop(n*2 - 1).pull(function(err, doc){
    d.readStream().toArray(function(arr){
      t.deepEqual(arr, result, 'sink');
    });
  });

  for(i = 0; i < n; i++)
    a.post({a:i});
  for(i = 0; i < n; i++)
    b.post({b:i});

  pipe(b, a);
  pipe(a, c);

  //stress
  for(i = 0; i < 3; i++){
    pipe(a, d);
    pipe(b, d);
    pipe(c, d);
    pipe(d, d);
  }
});

function sync(client, server){
  server.clockStream()
    .pipe(client.changesStream({ live: true }))
    .pipe(server.replicateStream());
  client.clockStream()
    .pipe(server.changesStream({ live: true }))
    .pipe(client.replicateStream());
}

test('Replication causal ordering', function(t){
  t.plan(6);

  function pipe(source, dest, delay){
    dest.clockStream()
      .pipe(source.changesStream({ live: true }))
      .ratelimit(1, 50) //break debounce
      .pipe(dest.replicateStream());
  }

  var a = roda('a3');
  var b = roda('b3');
  var c = roda('c3');

  function noConflict(ctx, next){
    t.error({
      conflict: ctx.conflict,
      result: ctx.result
    },'should not conflict');
    next();
  }
  a.use('conflict', noConflict);
  b.use('conflict', noConflict);
  sync(a, b);

  var tx = roda.transaction();

  a.put('a1',{i:0}, tx);
  a.put('a2',{i:0}, tx);

  b.put('b1',{i:0}, tx);
  b.put('b2',{i:0}, tx);

  tx.commit(function(){
    b.liveStream().pull(function(err, data){
      data.i = 1;
      //gets from checkpoint
      b.put('a1', data);
    });
    a.liveStream().drop(1).pull(function(err, data){
      data.i = 1;
      //gets from checkpoint
      a.put('b1', data);
    });
    setTimeout(function(){
      c.clockStream()
        .pipe(a.changesStream())
        .take(6)
        .collect()
        .map(function(list){
          //pipe to replicate stream in a reversed order
          return list.reverse();
        })
        .flatten()
        .ratelimit(1,300) //rate limit so that replicate hits not ready
        .pipe(c.replicateStream());
    }, 500);
  });
  var current = {};
  c.liveStream()
    .pluck('_rev')
    .take(6)
    .each(function(rev){
      var mid = rev.slice(0,8);
      var time = rev.slice(8);
      t.ok(!current[mid] || time > current[mid], 'causal ordering');
      current[mid] = time;
    });
});

test('Replication conflict detection', function(t){
  t.plan(6);

  var server = roda('serverC');
  var server2 = roda('serverC2');
  var a = roda('a5');
  var b = roda('b5');
  var c = roda('c5');
  var conflicts = roda('conflicts5');

  function conflict(ctx, next){
    //conflicted document post into c
    conflicts.post(ctx.conflict, ctx.transaction);
    next();
  }
  server.use('conflict', conflict);
  server2.use('conflict', conflict);

  //exactly n conflicts between server and server2
  conflicts.liveStream().drop(n - 1).pull(function(err, doc){
    conflicts.readStream().toArray(function(arr){
      t.equal(arr.length, n, 'server n conflicts');
    });
    setTimeout(function(){
      var result;
      function read(arr){
        if(result){
          t.deepEqual(arr, result, 'result consistent');
        }else{
          result = arr;
          t.equal(arr.length, n, 'n results');
        }
      }
      //read consistencies
      server.readStream().toArray(read);
      server2.readStream().toArray(read);
      a.readStream().toArray(read);
      b.readStream().toArray(read);
      c.readStream().toArray(read);

    }, 3000);

  });

  var tx = roda.transaction();
  //docs in a b will randomly conflict
  _.shuffle(_.range(n)).forEach(function(i){
    a.put(i, {a:i}, tx);
  });
  _.shuffle(_.range(n)).forEach(function(i){
    b.put(i, {b:i}, tx);
  });
  tx.commit(function(){
    sync(b, server);
    sync(a, server2);
    sync(c, server);
    sync(server, server2);
  });
});

test('gets from dependencies', function(t){
  t.plan(4);
  var server = roda('serverC');
  var server2 = roda('serverC2');
  var a = roda('a5');
  var b = roda('b5');
  var c = roda('c5');
  var conflicts = roda('conflicts5');

  function conflict(ctx, next){
    //conflicted document post into c
    if(ctx.conflict._id === 'foo'){
      t.error('foo should not conflict');
      console.log('foo conflict', ctx.conflict, ctx.result);
    }
    next();
  }
  server.use('conflict', conflict);
  server2.use('conflict', conflict);

  //get from, should not conflict
  var tx = roda.transaction();
  a.put('foo',{a:'a'}, tx);
  tx.commit();
  b.liveStream().pull(function(err, data){
    var bFrom = data._rev;
    var tx = roda.transaction();
    b.del('foo', tx); //local op
    b.put('foo',{b:'b'}, tx);
    tx.commit();
    setTimeout(function(){
      c.get('foo', function(err, data){
        t.equal(
          data._from, bFrom, 
          'B gets from A no conflict'
        );
        t.ok(
          codec.seqKey(data._rev) > codec.seqKey(bFrom), 
          'B gets from A ordering'
        );
        var cFrom = data._rev;
        var tx = roda.transaction();
        c.put('foo', {bar: 'whatever'}, tx); //local op
        c.put('foo', {c:'c'}, tx);
        tx.commit();
        setTimeout(function(){
          a.get('foo', function(err, data){
            t.equal(
              data._from, cFrom, 
              'C gets from B no conflict'
            );
            t.ok(
              codec.seqKey(data._rev) > codec.seqKey(cFrom), 
              'C gets from B ordering'
            );
          });
        }, 1000);
      });
    }, 1000);
  });
});
