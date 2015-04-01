var tape = require('tape');
var rodabase = require('../');
var memdown = require('memdown');
var jsondown = require('jsondown');
var _ = require('underscore');

var roda = rodabase('./test/data/crud.json', {
  // db: memdown
  db: jsondown
});
var n = 100;

tape('Put tx increment', function(t){
  var api = roda('t1');
  // api.use('diff', function(ctx, next){
  //   setTimeout(next, 50);
  // });
  t.plan(n + 2);
  function run(i){
    var tx = roda.transaction();
    api.get('k', tx, function(err, val){
      console.log(val);
      api.put('k', {k: (val ? val.k : 0) + 1}, tx);
      tx.commit(function(err){
        t.notOk(err,'committed '+ i);
        if(i === n - 1){
          api.get('k', function(err, val){
           t.ok(val);
           t.equal(val.k, n, 'Tx incrememnt');
          });
        }
      });
    });
  }
  for(var i = 0; i < n; i++)
    run(i);
});

tape('Put '+ n +' increment', function(t){
  t.plan(n + 2);
  var _id = '', _rev = '';
  var list = [];
  // roda('test').use('diff', function(ctx, next){
  //   setTimeout(next, 100);
  // });
  for(var i = 0; i < n; i++){
    roda('t2').put({
      i: i
    }, function(err, val){
      t.ok(!err && val, 'no error');
      list.push(val);
      if(val.i === n - 1){
        list = _.sortBy(list, 'i');
        t.deepEqual(_.sortBy(list, '_id'), list, '_id incremental');
        t.deepEqual(_.sortBy(list, '_rev'), list, '_rev incremental');
      }
    });
  }
});

