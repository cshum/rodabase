var tape = require('tape');
var rodabase = require('../');
var memdown = require('memdown');
var jsondown = require('jsondown');
var _ = require('underscore');

var roda = rodabase('./test/data/crud.json', {
  // db: memdown
  db: jsondown
});

tape('Put 10 increment', function(t){
  t.plan(2 * 10 + 2);
  var _id = '', _rev = '';
  var list = [];
  for(var i = 0; i < 100; i++){
    roda('test').put({
      i: i
    }, function(err, val){
      t.notOk(err, 'no error');
      t.ok(val, 'has value');
      list.push(val);
      if(val.i === 9){
        list = _.sortBy(list, 'i');
        t.deepEqual(_.sortBy(list, '_id'), list, '_id incremental');
        t.deepEqual(_.sortBy(list, '_rev'), list, '_rev incremental');
      }
    });
  }
});

