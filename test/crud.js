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
tape('Put '+ n +' increment', function(t){
  t.plan(n + 2);
  var _id = '', _rev = '';
  var list = [];
  // roda('test').use('diff', function(ctx, next){
  //   setTimeout(next, 100);
  // });
  for(var i = 0; i < n; i++){
    roda('test').put({
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

