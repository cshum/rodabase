var rodabase = require('../');

var tape = require('tape');
var _ = require('underscore');
var H = require('highland');

var roda = rodabase('./test/data/db', {
  // db: require('jsondown')
});
var n = 50;

//simulate inconsistent delay
roda.fn
  .use('validate', function(ctx, next){
    setTimeout(next, Math.random() * 5);
  })
  .use('diff', function(ctx, next){
    setTimeout(next, Math.random() * 5);
  });

tape('Transaction: lock increment', function(t){
  var api = roda('1');
  var ok = true;

  t.plan(2);
  function run(i){
    var tx = roda.transaction();
    api.get('k', tx, function(err, val){
      ok &= !err;

      val = val || { k: 0 };
      val.k++;

      api.put('k',val, tx);
    });
    tx.commit();
  }
  for(var i = 0; i < n; i++)
    run(i);

  var tx = roda.transaction();
  api.get('k', tx, function(err, val){
    t.ok(ok, 'no error');
    t.equal(val.k, n, 'Incremential');
  });
  tx.commit();
});

tape('Transaction: sequential operations', function(t){
  t.plan(4);
  var api = roda('3');
  var tx = roda.transaction();

  for(var i = 0; i < n; i++)
    api.put({ i: i }, tx);
    
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

tape('Transaction: isolation', function(t){
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

tape('changeStream', function(t){
  t.plan(3);
  var api = roda('4');
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    api.put(roda.util.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    api.put(roda.util.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    api.del(roda.util.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    api.del(roda.util.encodeNumber(i), tx); //non-exist del

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    api.readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    api.changeStream({clocks:[]}).toArray(function(changes){
      t.equal(changes.length, n, 'changes n ength');
    });
  });
});
tape('Live changeStream', function(t){
  t.plan(2);
  var api = roda('4');

  var liveChanges = [];
  var live = [];
  var m = 17;

  api.liveStream()
    .each(function(data){
      live.push(data);
      if(data.m === m - 1)
        t.equal(live.length, m, 'live m ength');
    });

  api.changeStream({clocks: [], live: true})
    // .map(H.wrapCallback(function(data, cb){
    //   setTimeout(function(){
    //     console.log(data);
    //     cb(null, data);
    //   },50);
    // })).parallel(1)
    .each(function(data){
      liveChanges.push(data);
      if(data.m === m - 1)
        t.equal(liveChanges.length, n + m, 'liveChanges n + m ength');
    });

  var tx = roda.transaction();
  for(i = 0; i < m; i++)
    api.put({ m:i }, tx);
  tx.commit();
});

tape('Transaction Hook: Validate', function(t){
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

tape('Transaction hook: diff', function(t){
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
    roda('5').put(roda.util.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    roda('5').put(roda.util.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    roda('5').del(roda.util.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    roda('5').del(roda.util.encodeNumber(i), tx); //non-exist del
  for(i = 0; i < n; i+=2)
    roda('5.1').del(roda.util.encodeNumber(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('5').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('5').changeStream({clocks:[]}).toArray(function(changes){
      t.equal(changes.length, n, 'changes n length');
    });
    roda('5.1').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('5.1').changeStream({clocks:[]}).toArray(function(list){
      t.equal(list.length, n, 'hook changes n length');
    });
  });

});
tape('Transaction hook: diff 2', function(t){
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
    roda('6').put(roda.util.encodeNumber(i), { i: i }, tx);
  for(i = 0; i < n; i++)
    roda('6').put(roda.util.encodeNumber(i), { i: i }, tx); //redundant put

  for(i = 0; i < n; i+=3)
    roda('6').del(roda.util.encodeNumber(i), tx);
  for(i = 0; i < n; i+=3)
    roda('6').del(roda.util.encodeNumber(i), tx); //non-exist del
  for(i = 0; i < n; i+=2)
    roda('6.1').del(roda.util.encodeNumber(i), tx);

  tx.commit(function(err){
    t.notOk(err, 'commit success');

    roda('6').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n*2/3), 'read 2/3 n length');
    });
    roda('6').changeStream({clocks:[]}).toArray(function(changes){
      t.equal(changes.length, n, 'changes n length');
    });
    roda('6.1').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.1').changeStream({clocks:[]}).toArray(function(list){
      t.equal(list.length, n, 'hook changes n length');
    });
    roda('6.2').readStream().toArray(function(list){
      t.equal(list.length, Math.floor(n/2), 'hook n/2 length');
    });
    roda('6.2').changeStream({clocks:[]}).toArray(function(list){
      t.equal(list.length, n, 'hook changes n length');
    });
  });

});

tape('Index and Range', function(t){
  t.plan(31);
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
  .index('email', function(doc, emit){
    emit(doc.email, true);
  })
  .index('age', function(doc, emit){
    emit(doc.age);
  })
  .index('gender_age', function(doc, emit){
    if(doc.gender)
      emit([doc.gender, doc.age]);
  })
  .put({ email: 'abc' }, function(err, val){
    t.ok(err, 'Invalid Email');
    this.put({ email: 'adrian@cshum.com', age: 25, gender:'M' }, function(err, val){
      t.equal(val.email, 'adrian@cshum.com', 'Email Saved');

      for(var i = 0; i < 10; i++){
        this.put({ email: 'adrian@cshum.com' }, function(err, val){
          t.ok(err.keyExists, 'Repeated Email');
        });
      }

      this.put({ email: 'hello@world.com', age: 15, gender:'m' }, function(err, val){
        t.equal(val.email, 'hello@world.com', 'Email Saved');

        this.put({ email: 'foo@bar.com', age: 15, gender:'F' }, function(err, val){
          t.equal(val.email, 'foo@bar.com', 'Email Saved');

          this.readStream({index:'email'})
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
          this.readStream({index: 'email', eq:'foo@bar.com' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['foo@bar.com'], 'index eq');
            });
          this.readStream({index: 'email', eq:'foo@bar.co' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, [], 'index prefix not eq ');
            });
          this.readStream({index: 'email', prefix:'foo@bar.co' })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['foo@bar.com'], 'index string prefix');
            });
          this.readStream({index: 'age'})
            .pluck('email').toArray(function(list){
              t.deepEqual(list, all, 'Email read by age');
            });
          this.readStream({index: 'age', gt: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(
                list, ['adrian@cshum.com'], 'Email read by age >15'
              );
            });
          this.readStream({index: 'age', lt: 25 })
            .pluck('email').toArray(function(list){
              t.deepEqual(
                list, ['hello@world.com','foo@bar.com'], 'Email read by age <25'
              );
            });
          this.readStream({index: 'age', eq: 15 })
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
          this.readStream({index: 'age', gte: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, all, 'Email read by age >=15');
            });
          this.readStream({index: 'age', lte: 25 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, all, 'Email read by age <=25');
            });
          this.readStream({index: 'gender_age', prefix: ['F'] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['foo@bar.com'], 'Female');
            });
          this.readStream({index: 'gender_age', prefix: ['M'] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['hello@world.com','adrian@cshum.com'], 'Male');
            });
          this.readStream({index: 'gender_age', eq: ['M'] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, [], 'fales eq');
            });
          this.readStream({index: 'gender_age', prefix: ['M'], gt: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['adrian@cshum.com'], 'Male over age 15');
            });
          this.readStream({index: 'gender_age', eq: ['M', 25] })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['adrian@cshum.com'], 'Male age === 25');
            });
          this.readStream({index: 'gender_age', prefix: ['M'], lte: 15 })
            .pluck('email').toArray(function(list){
              t.deepEqual(list, ['hello@world.com'], 'Male age 15');
            });
        });
      });
    });
  });
});

tape('mergeStream', function(t){
  t.plan(3);

  var a = roda('a1');
  var b = roda('b1');
  var c = roda('c1');
  var d = roda('d1');
  var i;

  var tx = roda.transaction();

  for(i = 0; i < n/2; i++)
    a.put({a:i}, tx);
  for(i = 0; i < n/2; i++)
    b.put({b:i}, tx);

  var count = {
    a: 0, c: 0, d: 0
  };
  a.liveStream().each(function(doc){
    count.a++;
    if(count.a === n)
      t.ok(true, 'mergeStream');
  });
  c.liveStream().each(function(doc){
    count.c++;
    if(count.c === n)
      t.ok(true, 'live mergeStream');
  });

  c.clockStream()
    .pipe(a.changeStream({live: true}))
    .pipe(c.mergeStream());

  d.liveStream().each(function(doc){
    count.d++;
    if(count.d === n)
      t.ok(true, 'mutli pipe');
  });

  a.pipe(d);
  b.pipe(d);
  c.pipe(d);
  d.pipe(d);
  b.pipe(d);
  a.pipe(d);
  c.pipe(d);

  tx.commit(function(){
    a.clockStream()
      .pipe(b.changeStream())
      .pipe(a.mergeStream());
  });
});

