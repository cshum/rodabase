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

// roda.all.use('diff', function delay(ctx, next){
//   setTimeout(next, 10);
//   console.log(ctx.result);
// });

tape('Put tx read lock', function(t){
  var api = roda('t1');

  console.log(api._hooks);

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

tape('Put increment', function(t){
  t.plan(2);
  var api = roda('t2');
  var _id = '', _rev = '';
  var list = [];

  for(var i = 0; i < n; i++)
    api.put({ i: i }, function(err, val){
      list.push(val);
      if(val.i === n - 1){
        list = _.sortBy(list, 'i');
        t.deepEqual(_.sortBy(list, '_id'), list, '_id incremental');
        t.deepEqual(_.sortBy(list, '_rev'), list, '_rev incremental');
      }
    });
});

