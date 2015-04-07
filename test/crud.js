var rodabase = require('../');

var tape = require('tape');
var memdown = require('memdown');
var jsondown = require('jsondown');
var _ = require('underscore');

var roda = rodabase('./test/data/crud.json', {
  // db: memdown
  db: jsondown
});
var n = 100;

// roda.base.use('diff', function delay(ctx, next){
//   if(this.name() > '2'){
//     console.log(ctx.result);
//     setTimeout(next, 10);
//   }else 
//     next();
// });

tape('Read lock', function(t){
  var api = roda('1');

  t.plan(2);
  function run(i){
    var tx = roda.transaction();
    api.get('k', tx, function(err, val){

      api.put({
        _id: 'k',
        k: (val ? val.k : 0) + 1
      }, tx);

      tx.commit();
    });
  }
  for(var i = 0; i < n; i++)
    run(i);

  var tx = roda.transaction();

  api.get('k', tx, function(err, val){
    t.ok(val);
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

tape('Changes', function(t){
  t.plan(3);
  var api = roda('4');
  var tx = roda.transaction();
  var i;

  function encode(i){
    return roda.util.trim(roda.util.encode(i));
  }

  for(i = 0; i < n; i++)
    api.put({ _id: encode(i), i: i }, tx);

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
tape('Nested', function(t){
  t.plan(5);
  roda('5').use('validate', function(ctx, next){
    roda('5.1').put({
      _id: ctx.result._id,
      i: ctx.result.i * 10
    }, ctx.transaction);
    next();
  });
  var tx = roda.transaction();
  var i;

  function encode(i){
    return roda.util.trim(roda.util.encode(i));
  }

  for(i = 0; i < n; i++)
    roda('5').put({ _id: encode(i), i: i }, tx);

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
      console.log(changes);
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
